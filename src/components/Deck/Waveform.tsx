import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import styles from './Waveform.module.css'

const WAVEFORM_HEIGHT = 72
const FALLBACK_WAVEFORM_COLOR = '#ff5a5f'
const FALLBACK_PLAYED_COLOR = '#5a5e6b'

interface Props {
  deckId: DeckId
}

/** Front-and-center per-deck waveform: real peaks on a canvas, or a plain progress bar fallback. */
export default function Waveform({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const seek = useDjStore((s) => s.seek)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ width: 0, height: WAVEFORM_HEIGHT })
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
    if (width <= 0) return

    const dpr = window.devicePixelRatio || 1
    const targetW = Math.round(width * dpr)
    const targetH = Math.round(height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx2d.clearRect(0, 0, width, height)

    const currentPeaks = peaks
    if (!currentPeaks || currentPeaks.length === 0) return

    const live = useDjStore.getState().decks[deckId]
    const liveDuration = live.durationSec
    const playedFraction = liveDuration > 0 ? Math.min(1, Math.max(0, live.currentTime / liveDuration)) : 0

    const computed = getComputedStyle(canvas)
    const upcomingColor = computed.getPropertyValue('--color-waveform').trim() || FALLBACK_WAVEFORM_COLOR
    const playedColor = computed.getPropertyValue('--color-waveform-played').trim() || FALLBACK_PLAYED_COLOR

    const barCount = currentPeaks.length
    const barWidth = width / barCount
    const playedBars = Math.floor(playedFraction * barCount)
    const centerY = height / 2

    for (let i = 0; i < barCount; i++) {
      const amplitude = Math.max(0.03, Math.min(1, currentPeaks[i]))
      const barHeight = amplitude * height
      const x = i * barWidth
      ctx2d.fillStyle = i < playedBars ? playedColor : upcomingColor
      ctx2d.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight)
    }

    const playheadX = Math.min(width - 1.5, playedFraction * width)
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillRect(playheadX, 0, 1.5, height)
  }, [peaks, deckId])

  // Keep the canvas sized to its container.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      sizeRef.current = { width: entry.contentRect.width, height: WAVEFORM_HEIGHT }
      draw()
    })
    observer.observe(el)
    sizeRef.current = { width: el.clientWidth, height: WAVEFORM_HEIGHT }
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
    caption = 'Golfvorm niet beschikbaar voor streaming-bronnen'
  } else if (track && deck.supportsAnalysis) {
    caption = 'Analyseren...'
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
