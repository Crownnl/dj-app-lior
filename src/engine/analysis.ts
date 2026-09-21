import { analyze } from 'web-audio-beat-detector'
import type { TrackAnalysis } from '../types'

const PEAK_BUCKETS = 600

/**
 * Downloads and decodes an audio URL to extract waveform peaks + BPM.
 * Only usable for sources the app can actually fetch raw bytes for
 * (local files / Dropbox direct links) — streaming platforms (SoundCloud,
 * Spotify) never expose decodable audio to the page, by design of their
 * respective terms of service and DRM.
 */
export async function analyzeAudio(url: string): Promise<TrackAnalysis> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const offlineCtx = new OfflineAudioContext(1, 1, 44100)
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0))

  const peaks = computePeaks(audioBuffer, PEAK_BUCKETS)

  let bpm: number | undefined
  try {
    bpm = await analyze(audioBuffer)
  } catch {
    bpm = undefined
  }

  return { bpm, peaks, durationSec: audioBuffer.duration }
}

function computePeaks(buffer: AudioBuffer, bucketCount: number): number[] {
  const channelData = buffer.getChannelData(0)
  const bucketSize = Math.max(1, Math.floor(channelData.length / bucketCount))
  const peaks: number[] = []
  let max = 0
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * bucketSize
    const end = Math.min(start + bucketSize, channelData.length)
    let peak = 0
    for (let i = start; i < end; i++) {
      const abs = Math.abs(channelData[i])
      if (abs > peak) peak = abs
    }
    peaks.push(peak)
    if (peak > max) max = peak
  }
  if (max > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / max
  }
  return peaks
}
