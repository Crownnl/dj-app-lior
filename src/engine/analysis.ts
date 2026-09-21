import { analyze } from 'web-audio-beat-detector'
import type { TrackAnalysis, WaveformBand } from '../types'

const PEAK_BUCKETS = 600
const LOW_CUTOFF_HZ = 200
const HIGH_CUTOFF_HZ = 2000
const MID_CENTER_HZ = 800

/**
 * Downloads and decodes an audio URL to extract a 3-band (low/mid/high)
 * waveform for the Rekordbox-style colored display, plus BPM. Only usable
 * for sources the app can actually fetch raw bytes for (local files /
 * Dropbox direct links) — streaming platforms (SoundCloud, Spotify) never
 * expose decodable audio to the page, by design of their respective terms
 * of service and DRM.
 */
export async function analyzeAudio(url: string): Promise<TrackAnalysis> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const offlineCtx = new OfflineAudioContext(1, 1, 44100)
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0))

  const [lowData, midData, highData] = await Promise.all([
    renderBand(audioBuffer, 'lowpass', LOW_CUTOFF_HZ),
    renderBand(audioBuffer, 'bandpass', MID_CENTER_HZ),
    renderBand(audioBuffer, 'highpass', HIGH_CUTOFF_HZ),
  ])

  const peaks = computeBandPeaks(lowData, midData, highData, PEAK_BUCKETS)

  let bpm: number | undefined
  try {
    bpm = await analyze(audioBuffer)
  } catch {
    bpm = undefined
  }

  return { bpm, peaks, durationSec: audioBuffer.duration }
}

/** Renders the buffer through a single Biquad filter (real Web Audio DSP, not a hand-rolled approximation) to isolate one frequency band. */
async function renderBand(buffer: AudioBuffer, type: BiquadFilterType, frequency: number): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate)
  const source = offline.createBufferSource()
  source.buffer = buffer
  const filter = offline.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  if (type === 'bandpass') filter.Q.value = 0.7
  source.connect(filter)
  filter.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

function computeBandPeaks(low: Float32Array, mid: Float32Array, high: Float32Array, bucketCount: number): WaveformBand[] {
  const length = low.length
  const bucketSize = Math.max(1, Math.floor(length / bucketCount))
  const raw: WaveformBand[] = []
  let maxLow = 0
  let maxMid = 0
  let maxHigh = 0

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * bucketSize
    const end = Math.min(start + bucketSize, length)
    let peakLow = 0
    let peakMid = 0
    let peakHigh = 0
    for (let i = start; i < end; i++) {
      const l = Math.abs(low[i])
      const m = Math.abs(mid[i])
      const h = Math.abs(high[i])
      if (l > peakLow) peakLow = l
      if (m > peakMid) peakMid = m
      if (h > peakHigh) peakHigh = h
    }
    raw.push({ low: peakLow, mid: peakMid, high: peakHigh })
    if (peakLow > maxLow) maxLow = peakLow
    if (peakMid > maxMid) maxMid = peakMid
    if (peakHigh > maxHigh) maxHigh = peakHigh
  }

  return raw.map((b) => ({
    low: maxLow > 0 ? b.low / maxLow : 0,
    mid: maxMid > 0 ? b.mid / maxMid : 0,
    high: maxHigh > 0 ? b.high / maxHigh : 0,
  }))
}
