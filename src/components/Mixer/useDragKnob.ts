import { useCallback, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

interface UseDragKnobOptions {
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
  /** Vertical drag distance in pixels needed to sweep the full min..max range. */
  sensitivityPx?: number
}

interface DragKnobHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void
}

/**
 * Shared drag-to-adjust behavior for compact rotary knob controls (gain trim, EQ bands).
 * Vertical pointer drag adjusts the value, double-click resets it to the mid point,
 * and arrow/Home/End keys nudge it so the control stays keyboard-accessible.
 */
export function useDragKnob({ value, min, max, disabled, onChange, sensitivityPx = 150 }: UseDragKnobOptions): DragKnobHandlers {
  const dragState = useRef<{ startY: number; startValue: number } | null>(null)

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragState.current = { startY: e.clientY, startValue: value }
      e.preventDefault()
    },
    [disabled, value],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !dragState.current) return
      const deltaY = dragState.current.startY - e.clientY
      const range = max - min
      const next = clamp(dragState.current.startValue + (deltaY / sensitivityPx) * range)
      onChange(next)
    },
    [disabled, max, min, onChange, sensitivityPx, clamp],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const onDoubleClick = useCallback(() => {
    if (disabled) return
    onChange((min + max) / 2)
  }, [disabled, min, max, onChange])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const step = (max - min) / 100
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        onChange(clamp(value + step))
        e.preventDefault()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        onChange(clamp(value - step))
        e.preventDefault()
      } else if (e.key === 'Home') {
        onChange(min)
        e.preventDefault()
      } else if (e.key === 'End') {
        onChange(max)
        e.preventDefault()
      }
    },
    [disabled, max, min, onChange, value, clamp],
  )

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown }
}
