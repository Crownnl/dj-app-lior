import type { CrossfaderAssign, DeckController, DeckId, EQBand, SourceKind, Track } from '../types'

/**
 * Persistent Web Audio graph for one deck:
 *   input (gain trim) -> lowShelf -> midPeak -> highShelf -> channelGain -> crossfaderGain -> masterGain
 * `input` is the connection point a DeckController's source node attaches to.
 * Streaming controllers (SoundCloud/Spotify) never attach here — they have no
 * decodable audio stream available to the page, so EQ/filters don't apply to
 * them; their loudness is instead driven directly through their own SDK.
 */
interface DeckNodes {
  input: GainNode
  lowShelf: BiquadFilterNode
  midPeak: BiquadFilterNode
  highShelf: BiquadFilterNode
  channelGain: GainNode
  crossfaderGain: GainNode
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

export class AudioEngine {
  readonly ctx: AudioContext
  private masterGain: GainNode
  private deckNodes = new Map<DeckId, DeckNodes>()
  private deckRuntime = new Map<DeckId, DeckRuntimeState>()
  private controllers = new Map<DeckId, DeckController>()
  private controllerFactories = new Map<SourceKind, ControllerFactory>()
  private crossfaderPos = 0.5
  private masterVolume = 0.85

  constructor() {
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.masterVolume
    this.masterGain.connect(this.ctx.destination)
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
    const channelGain = ctx.createGain()
    const crossfaderGain = ctx.createGain()

    input.connect(lowShelf)
    lowShelf.connect(midPeak)
    midPeak.connect(highShelf)
    highShelf.connect(channelGain)
    channelGain.connect(crossfaderGain)
    crossfaderGain.connect(this.masterGain)

    nodes = { input, lowShelf, midPeak, highShelf, channelGain, crossfaderGain }
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
      throw new Error(`Geen speler beschikbaar voor bron "${track.source}"`)
    }
    const context: AudioEngineContext = {
      audioContext: this.ctx,
      connectSource: (id, node) => {
        const n = this.ensureDeckGraph(id)
        node.connect(n.input)
      },
    }
    const controller = factory(deckId, context)
    this.controllers.set(deckId, controller)
    await controller.load(track)
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

export const audioEngine = new AudioEngine()
