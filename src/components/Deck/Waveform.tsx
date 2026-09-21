import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import styles from './Waveform.module.css'

const DEFAULT_CANVAS_HEIGHT = 72

// Fallback colors used only if the CSS custom properties can't be read (e.g. in a
// detached/test DOM). Kept in sync with the token values in src/styles/theme.css.
const FALLBACK_TRACK_COLOR = '#1a1d26'
const FALLBACK_LOW_COLOR = '#ff5f4a'
const FALLBACK_MID_COLOR = '#ffd23f'
const FALLBACK_HIGH_COLOR = '#4fd8ff'
const FALLBACK_PLAYHEAD_COLOR = '#ffffff'

// Per-band opacity for the upcoming (not-yet-played) portion: low is a wide,
// low-opacity base, mid a medium layer, high a bright thin spike on top.
const LOW_ALPHA = 0.55
const MID_ALPHA = 0.85
const HIGH_ALPHA = 1
// Flat reduced alpha for all three bands once they're behind the playhead.
const PLAYED_ALPHA = 0.4
// Never draw a fully-zero-height bar so the waveform reads as continuous.
const MIN_AMPLITUDE = 0.02

interface Props {
  deckId: DeckId
}

/** Front-and-center per-deck waveform: real 3-band peaks on a canvas, or a plain progress bar fallback. */
export default function Waveform({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const seek = useDjStore((s) => s.seek)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ width: 0, height: DEFAULT_CANVAS_HEIGHT })
  const draggingRef = useRef(false)

  const track = deck.track
  const peaks = track?.peaks
  const hasPeaks = !!peaks && peaks.length > 0
  const durationSec = deck.durationSec

  // Reads the freshest store state directly so the rAF loop below doesn't need
  // to re-subscribe on every tick; regular (non-playing) redraws use `deck` as normal.
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    const { width, height } = sizeRef.current
    if (width <= 0 || height <= 0) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(width * dpr)
    const targetH = Math.round(height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)

    const computed = getComputedStyle(canvas)
    const trackColor = computed.getPropertyValue('--color-wave-track').trim() || FALLBACK_TRACK_COLOR
    const lowColor = computed.getPropertyValue('--color-wave-low').trim() || FALLBACK_LOW_COLOR
    const midColor = computed.getPropertyValue('--color-wave-mid').trim() || FALLBACK_MID_COLOR
    const highColor = computed.getPropertyValue('--color-wave-high').trim() || FALLBACK_HIGH_COLOR
    const playheadColor = computed.getPropertyValue('--color-wave-playhead').trim() || FALLBACK_PLAYHEAD_COLOR

    ctx2d.clearRect(0, 0, width, height)
    ctx2d.fillStyle = trackColor
    ctx2d.fillRect(0, 0, width, height)

    const currentPeaks = peaks
    if (!currentPeaks || currentPeaks.length === 0) return

    const live = useDjStore.getState().decks[deckId]
    const liveDuration = live.durationSec
    const playedFraction = liveDuration > 0 ? Math.min(1, Math.max(0, live.currentTime / liveDuration)) : 0

    const barCount = currentPeaks.length
    const slotWidth = width / barCount
    const playedBars = Math.floor(playedFraction * barCount)
    const centerY = height / 2
    const maxBarHeight = height * 0.92

    for (let i = 0; i < barCount; i++) {
      const band = currentPeaks[i]
      const played = i < playedBars
      const x = i * slotWidth

      // Low: widest bar, drawn first (behind everything else).
      const lowW = Math.max(1, slotWidth - 0.5)
      const lowH = Math.max(MIN_AMPLITUDE, Math.min(1, band.low)) * maxBarHeight
      ctx2d.globalAlpha = played ? PLAYED_ALPHA : LOW_ALPHA
      ctx2d.fillStyle = lowColor
      ctx2d.fillRect(x, centerY - lowH / 2, lowW, lowH)

      // Mid: narrower, centered on top of low.
      const midW = Math.max(1, lowW * 0.62)
      const midH = Math.max(MIN_AMPLITUDE, Math.min(1, band.mid)) * maxBarHeight
      ctx2d.globalAlpha = played ? PLAYED_ALPHA : MID_ALPHA
      ctx2d.fillStyle = midColor
      ctx2d.fillRect(x + (lowW - midW) / 2, centerY - midH / 2, midW, midH)

      // High: thinnest, brightest, frontmost spike.
      const highW = Math.max(1, lowW * 0.3)
      const highH = Math.max(MIN_AMPLITUDE, Math.min(1, band.high)) * maxBarHeight
      ctx2d.globalAlpha = played ? PLAYED_ALPHA : HIGH_ALPHA
      ctx2d.fillStyle = highColor
      ctx2d.fillRect(x + (lowW - highW) / 2, centerY - highH / 2, highW, highH)
    }

    ctx2d.globalAlpha = 1
    const playheadX = Math.min(width - 1.5, playedFraction * width)
    ctx2d.fillStyle = playheadColor
    ctx2d.fillRect(playheadX, 0, 1.5, height)
  }, [peaks, deckId])

  // Keep the canvas sized to its container. Height (not just width) is read from
  // the container's actual box so the compact/phone-landscape CSS breakpoint can
  // shrink the waveform just by changing its CSS height — no JS constant to update.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height || DEFAULT_CANVAS_HEIGHT }
      draw()
    })
    observer.observe(el)
    sizeRef.current = { width: el.clientWidth, height: el.clientHeight || DEFAULT_CANVAS_HEIGHT }
    draw()
    return () => observer.disconnect()
  }, [draw])

  // Paused (or no-peaks-yet) redraws happen only when something relevant actually changed.
  useEffect(() => {
    if (!deck.isPlaying) draw()
  }, [draw, deck.isPlaying, deck.currentTime, deck.durationSec, hasPeaks])

  // While playing, animate the playhead smoothly via rAF instead of on every store tick.
  useEffect(() => {
    if (!deck.isPlaying || !hasPeaks) return
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [deck.isPlaying, hasPeaks, draw])

  const handleSeek = useCallback(
    (clientX: number) => {
      const el = containerRef.current
      if (!el || durationSec <= 0) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      seek(deckId, fraction * durationSec)
    },
    [deckId, durationSec, seek],
  )

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    handleSeek(e.clientX)
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    handleSeek(e.clientX)
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  if (hasPeaks) {
    return (
      <div
        ref={containerRef}
        className={styles.waveform}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    )
  }

  const progressPercent = durationSec > 0 ? Math.min(100, Math.max(0, (deck.currentTime / durationSec) * 100)) : 0

  let caption: string | null = null
  if (track && !deck.supportsAnalysis) {
    caption = 'Waveform unavailable for streaming sources'
  } else if (track && deck.supportsAnalysis) {
    caption = 'Analyzing...'
  }

  return (
    <div className={styles.wrapper}>
      <div
        ref={containerRef}
        className={styles.fallback}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.fallbackFill} style={{ width: `${progressPercent}%` }} />
      </div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  )
}
