import type { BeatFxType, CrossfaderAssign, DeckController, DeckId, EQBand, SourceKind, Track } from '../types'

/** Thrown by loadTrackToDeck when a newer load call already took over the same deck; callers should ignore this rather than surface it as a user-facing error. */
export class SupersededLoadError extends Error {
  constructor() {
    super('Superseded by a newer load for this deck')
    this.name = 'SupersededLoadError'
  }
}

/**
 * Persistent Web Audio graph for one deck:
 *   input (gain trim) -> lowShelf -> midPeak -> highShelf -> colorFilter (Sound Color FX)
 *   -> channelGain -> crossfaderGain -> channelAnalyser (VU meter tap) -> masterGain
 * `input` is the connection point a DeckController's source node attaches to.
 * Streaming controllers (SoundCloud/Spotify) never attach here — they have no
 * decodable audio stream available to the page, so EQ/filters/meters don't
 * apply to them; their loudness is instead driven directly through their own SDK.
 */
interface DeckNodes {
  input: GainNode
  lowShelf: BiquadFilterNode
  midPeak: BiquadFilterNode
  highShelf: BiquadFilterNode
  colorFilter: BiquadFilterNode
  channelGain: GainNode
  crossfaderGain: GainNode
  channelAnalyser: AnalyserNode
}

interface DeckRuntimeState {
  volume: number
  assign: CrossfaderAssign
  gainTrim: number
}

export interface AudioEngineContext {
  audioContext: AudioContext
  /** Attach a controller's source node into this deck's EQ/gain chain. */
  connectSource(deckId: DeckId, sourceNode: AudioNode): void
}

type ControllerFactory = (deckId: DeckId, ctx: AudioEngineContext) => DeckController

function eqValueToDb(value: number): number {
  // value range 0..2, 1 = flat (0dB). 0 -> -24dB, 2 -> +6dB, matching a typical club mixer EQ.
  if (value >= 1) return (value - 1) * 6
  return (value - 1) * 24
}

const METER_FFT_SIZE = 512

function readLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer)
  let sumSquares = 0
  for (let i = 0; i < buffer.length; i++) {
    const centered = (buffer[i] - 128) / 128
    sumSquares += centered * centered
  }
  return Math.sqrt(sumSquares / buffer.length)
}

export class AudioEngine {
  readonly ctx: AudioContext
  private masterGain: GainNode
  private masterAnalyser: AnalyserNode
  private meterBuffer: Uint8Array<ArrayBuffer>
  private deckNodes = new Map<DeckId, DeckNodes>()
  private deckRuntime = new Map<DeckId, DeckRuntimeState>()
  private controllers = new Map<DeckId, DeckController>()
  private controllerFactories = new Map<SourceKind, ControllerFactory>()
  /** Bumped on every loadTrackToDeck call so a slower, superseded load can tell it lost the race and back out instead of overwriting a newer track's state. */
  private loadGeneration = new Map<DeckId, number>()
  private crossfaderPos = 0.5
  private masterVolume = 0.85

  // Beat FX: all three effect subgraphs stay permanently wired (avoids
  // graph-rewiring clicks on type change); only the active type's wet gain
  // is ever non-zero.
  private fxOutputSum: GainNode
  private fxInput: GainNode
  private echoDelay: DelayNode
  private echoFeedback: GainNode
  private echoWet: GainNode
  private flangerDelay: DelayNode
  private flangerLfo: OscillatorNode
  private flangerLfoGain: GainNode
  private flangerFeedback: GainNode
  private flangerWet: GainNode
  private reverbConvolver: ConvolverNode
  private reverbWet: GainNode

  constructor() {
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.masterVolume

    this.masterAnalyser = this.ctx.createAnalyser()
    this.masterAnalyser.fftSize = METER_FFT_SIZE
    this.meterBuffer = new Uint8Array(METER_FFT_SIZE)

    this.fxOutputSum = this.ctx.createGain()
    this.fxInput = this.ctx.createGain()

    // Dry path: always on, full level.
    this.masterGain.connect(this.fxOutputSum)
    this.masterGain.connect(this.fxInput)

    // Echo: input -> delay -> wet -> sum, with a feedback loop for repeats.
    this.echoDelay = this.ctx.createDelay(2)
    this.echoDelay.delayTime.value = 0.35
    this.echoFeedback = this.ctx.createGain()
    this.echoFeedback.gain.value = 0.35
    this.echoWet = this.ctx.createGain()
    this.echoWet.gain.value = 0
    this.fxInput.connect(this.echoDelay)
    this.echoDelay.connect(this.echoFeedback)
    this.echoFeedback.connect(this.echoDelay)
    this.echoDelay.connect(this.echoWet)
    this.echoWet.connect(this.fxOutputSum)

    // Flanger: a short LFO-modulated delay with feedback.
    this.flangerDelay = this.ctx.createDelay(1)
    this.flangerDelay.delayTime.value = 0.006
    this.flangerLfo = this.ctx.createOscillator()
    this.flangerLfo.type = 'sine'
    this.flangerLfo.frequency.value = 0.25
    this.flangerLfoGain = this.ctx.createGain()
    this.flangerLfoGain.gain.value = 0.003
    this.flangerLfo.connect(this.flangerLfoGain)
    this.flangerLfoGain.connect(this.flangerDelay.delayTime)
    this.flangerLfo.start()
    this.flangerFeedback = this.ctx.createGain()
    this.flangerFeedback.gain.value = 0.3
    this.flangerWet = this.ctx.createGain()
    this.flangerWet.gain.value = 0
    this.fxInput.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerFeedback)
    this.flangerFeedback.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerWet)
    this.flangerWet.connect(this.fxOutputSum)

    // Reverb: a convolver with a procedurally generated decaying-noise
    // impulse response (no network fetch needed for an IR file).
    this.reverbConvolver = this.ctx.createConvolver()
    this.reverbConvolver.buffer = createReverbImpulse(this.ctx)
    this.reverbWet = this.ctx.createGain()
    this.reverbWet.gain.value = 0
    this.fxInput.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.reverbWet)
    this.reverbWet.connect(this.fxOutputSum)

    this.fxOutputSum.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.ctx.destination)
  }

  registerControllerFactory(source: SourceKind, factory: ControllerFactory) {
    this.controllerFactories.set(source, factory)
  }

  hasFactory(source: SourceKind): boolean {
    return this.controllerFactories.has(source)
  }

  async resumeIfSuspended() {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
  }

  private ensureDeckGraph(deckId: DeckId): DeckNodes {
    let nodes = this.deckNodes.get(deckId)
    if (nodes) return nodes
    const ctx = this.ctx
    const input = ctx.createGain()
    const lowShelf = ctx.createBiquadFilter()
    lowShelf.type = 'lowshelf'
    lowShelf.frequency.value = 200
    const midPeak = ctx.createBiquadFilter()
    midPeak.type = 'peaking'
    midPeak.frequency.value = 1000
    midPeak.Q.value = 0.9
    const highShelf = ctx.createBiquadFilter()
    highShelf.type = 'highshelf'
    highShelf.frequency.value = 4000
    const colorFilter = ctx.createBiquadFilter()
    colorFilter.type = 'allpass'
    colorFilter.frequency.value = 1000
    const channelGain = ctx.createGain()
    const crossfaderGain = ctx.createGain()
    const channelAnalyser = ctx.createAnalyser()
    channelAnalyser.fftSize = METER_FFT_SIZE

    input.connect(lowShelf)
    lowShelf.connect(midPeak)
    midPeak.connect(highShelf)
    highShelf.connect(colorFilter)
    colorFilter.connect(channelGain)
    channelGain.connect(crossfaderGain)
    crossfaderGain.connect(channelAnalyser)
    channelAnalyser.connect(this.masterGain)

    nodes = { input, lowShelf, midPeak, highShelf, colorFilter, channelGain, crossfaderGain, channelAnalyser }
    this.deckNodes.set(deckId, nodes)
    if (!this.deckRuntime.has(deckId)) {
      this.deckRuntime.set(deckId, {
        volume: 0.8,
        assign: (deckId % 2 === 0 ? 'A' : 'B') as CrossfaderAssign,
        gainTrim: 1,
      })
    }
    return nodes
  }

  async loadTrackToDeck(deckId: DeckId, track: Track): Promise<DeckController> {
    await this.resumeIfSuspended()
    this.ensureDeckGraph(deckId)
    this.controllers.get(deckId)?.destroy()

    const factory = this.controllerFactories.get(track.source)
    if (!factory) {
      throw new Error(`No player available for source "${track.source}"`)
    }

    // Claim this load attempt. If another loadTrackToDeck(deckId, ...) call
    // starts before this one's controller.load() resolves, it bumps this
    // counter again — when this call notices its generation is no longer
    // current, it backs out instead of clobbering the newer track's state.
    const myGeneration = (this.loadGeneration.get(deckId) ?? 0) + 1
    this.loadGeneration.set(deckId, myGeneration)

    const context: AudioEngineContext = {
      audioContext: this.ctx,
      connectSource: (id, node) => {
        const n = this.ensureDeckGraph(id)
        node.connect(n.input)
      },
    }
    const controller = factory(deckId, context)
    this.controllers.set(deckId, controller)

    try {
      await controller.load(track)
    } catch (err) {
      if (this.loadGeneration.get(deckId) === myGeneration) throw err
      controller.destroy()
      throw new SupersededLoadError()
    }

    if (this.loadGeneration.get(deckId) !== myGeneration) {
      // A newer track was loaded onto this deck while this one was still
      // loading — this controller lost the race, tear it down rather than
      // let it (or its caller) touch the deck's now-current state.
      controller.destroy()
      throw new SupersededLoadError()
    }

    this.applyDeckGains(deckId)
    return controller
  }

  getController(deckId: DeckId): DeckController | undefined {
    return this.controllers.get(deckId)
  }

  play(deckId: DeckId) {
    void this.resumeIfSuspended()
    this.controllers.get(deckId)?.play()
  }

  pause(deckId: DeckId) {
    this.controllers.get(deckId)?.pause()
  }

  seek(deckId: DeckId, seconds: number) {
    this.controllers.get(deckId)?.seek(seconds)
  }

  setPitch(deckId: DeckId, rate: number) {
    this.controllers.get(deckId)?.setPlaybackRate(rate)
  }

  setKeylock(deckId: DeckId, enabled: boolean) {
    this.controllers.get(deckId)?.setPreservesPitch(enabled)
  }

  setDeckVolume(deckId: DeckId, volume: number) {
    const rt = this.deckRuntime.get(deckId)
    if (!rt) return
    rt.volume = volume
    this.applyDeckGains(deckId)
  }

  setDeckGainTrim(deckId: DeckId, gainTrim: number) {
    const rt = this.deckRuntime.get(deckId)
    if (rt) rt.gainTrim = gainTrim
    const nodes = this.deckNodes.get(deckId)
    nodes?.input.gain.setTargetAtTime(gainTrim, this.ctx.currentTime, 0.01)
    this.controllers.get(deckId)?.setGainTrim(gainTrim)
  }

  setDeckEQ(deckId: DeckId, band: EQBand, value: number) {
    const nodes = this.deckNodes.get(deckId)
    const db = eqValueToDb(value)
    const node = nodes && (band === 'low' ? nodes.lowShelf : band === 'mid' ? nodes.midPeak : nodes.highShelf)
    node?.gain.setTargetAtTime(db, this.ctx.currentTime, 0.01)
    this.controllers.get(deckId)?.setEQ(band, value)
  }

  /** Sound Color FX knob: -1..1, 0 = flat. Negative sweeps a low-pass in, positive a high-pass. Graph-only (no controller passthrough needed — streaming decks have no signal in this chain to filter). */
  setColorFx(deckId: DeckId, value: number) {
    const nodes = this.deckNodes.get(deckId)
    if (!nodes) return
    const filter = nodes.colorFilter
    const clamped = Math.min(1, Math.max(-1, value))
    const now = this.ctx.currentTime
    if (clamped === 0) {
      filter.type = 'allpass'
      return
    }
    if (clamped < 0) {
      filter.type = 'lowpass'
      const t = -clamped
      const freq = 20000 * Math.pow(200 / 20000, t)
      filter.frequency.setTargetAtTime(freq, now, 0.01)
      filter.Q.setTargetAtTime(0.7, now, 0.01)
    } else {
      filter.type = 'highpass'
      const t = clamped
      const freq = 20 * Math.pow(2000 / 20, t)
      filter.frequency.setTargetAtTime(freq, now, 0.01)
      filter.Q.setTargetAtTime(0.7, now, 0.01)
    }
  }

  /** Master Beat FX unit (echo/flanger/reverb), applied post-crossfader like a real mixer's shared FX section. */
  setBeatFx(type: BeatFxType, mix: number) {
    const now = this.ctx.currentTime
    const clampedMix = Math.min(1, Math.max(0, mix))
    this.echoWet.gain.setTargetAtTime(type === 'echo' ? clampedMix : 0, now, 0.02)
    this.flangerWet.gain.setTargetAtTime(type === 'flanger' ? clampedMix : 0, now, 0.02)
    this.reverbWet.gain.setTargetAtTime(type === 'reverb' ? clampedMix : 0, now, 0.02)
  }

  /** Instantaneous 0..1 level for a channel meter. Always ~0 for streaming decks (no signal reaches this graph). */
  getChannelLevel(deckId: DeckId): number {
    const nodes = this.deckNodes.get(deckId)
    if (!nodes) return 0
    return readLevel(nodes.channelAnalyser, this.meterBuffer)
  }

  /** Instantaneous 0..1 level for the master output meter. */
  getMasterLevel(): number {
    return readLevel(this.masterAnalyser, this.meterBuffer)
  }

  setCrossfaderAssign(deckId: DeckId, assign: CrossfaderAssign) {
    const rt = this.deckRuntime.get(deckId)
    if (!rt) return
    rt.assign = assign
    this.applyDeckGains(deckId)
  }

  setCrossfader(position: number) {
    this.crossfaderPos = Math.min(1, Math.max(0, position))
    for (const deckId of this.deckRuntime.keys()) {
      this.applyDeckGains(deckId)
    }
  }

  setMasterVolume(volume: number) {
    this.masterVolume = volume
    this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
    // Streaming decks bypass the master gain node (no shared graph access), so
    // master volume must be folded into their own volume calls explicitly.
    for (const deckId of this.deckRuntime.keys()) {
      const controller = this.controllers.get(deckId)
      if (controller && !controller.supportsEQ) {
        this.applyDeckGains(deckId)
      }
    }
  }

  private crossfadeMultiplier(assign: CrossfaderAssign): number {
    if (assign === 'THRU') return 1
    const x = this.crossfaderPos
    return assign === 'A' ? Math.cos((x * Math.PI) / 2) : Math.sin((x * Math.PI) / 2)
  }

  private applyDeckGains(deckId: DeckId) {
    const rt = this.deckRuntime.get(deckId)
    if (!rt) return
    const nodes = this.deckNodes.get(deckId)
    const xf = this.crossfadeMultiplier(rt.assign)
    const controller = this.controllers.get(deckId)
    if (controller && controller.supportsEQ) {
      nodes?.channelGain.gain.setTargetAtTime(rt.volume, this.ctx.currentTime, 0.01)
      nodes?.crossfaderGain.gain.setTargetAtTime(xf, this.ctx.currentTime, 0.01)
    } else {
      controller?.setVolume(rt.volume * xf * this.masterVolume)
    }
  }

  destroyDeck(deckId: DeckId) {
    this.controllers.get(deckId)?.destroy()
    this.controllers.delete(deckId)
  }
}

/** A short, cheap exponentially-decaying noise burst — a plausible-enough "room" impulse response without needing to fetch a real recorded IR file. */
function createReverbImpulse(ctx: AudioContext): AudioBuffer {
  const duration = 1.6
  const sampleRate = ctx.sampleRate
  const length = Math.floor(sampleRate * duration)
  const buffer = ctx.createBuffer(2, length, sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.5)
      data[i] = (Math.random() * 2 - 1) * decay
    }
  }
  return buffer
}

export const audioEngine = new AudioEngine()
