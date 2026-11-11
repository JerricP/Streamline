import { useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { FanCurvePoint } from '@shared/types'

/**
 * Draggable fan curve: temperature across, fan duty up. Drag a point to move
 * it, double-click empty space to add one, double-click a point (or focus it
 * and press Delete) to remove it. Arrow keys nudge the focused point.
 */

const WIDTH = 640
const HEIGHT = 320
const PAD = { left: 46, right: 18, top: 14, bottom: 34 }
const TEMP_MIN = 20
const TEMP_MAX = 100
const MAX_POINTS = 8
const MIN_POINTS = 2

const plotWidth = WIDTH - PAD.left - PAD.right
const plotHeight = HEIGHT - PAD.top - PAD.bottom

const xFor = (temp: number) => PAD.left + ((temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * plotWidth
const yFor = (duty: number) => PAD.top + (1 - duty / 100) * plotHeight
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function curveDuty(points: FanCurvePoint[], temp: number): number {
  if (points.length === 0) return 0
  if (temp <= points[0].temp) return points[0].duty
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]
    if (temp <= right.temp) {
      const left = points[index - 1]
      return left.duty + ((temp - left.temp) / (right.temp - left.temp)) * (right.duty - left.duty)
    }
  }
  return points[points.length - 1].duty
}

export function FanCurveEditor({
  points,
  onChange,
  currentTemp,
  currentDuty
}: {
  points: FanCurvePoint[]
  onChange: (points: FanCurvePoint[]) => void
  /** Live temperature of the curve's source, drawn as a marker. */
  currentTemp: number | null
  /** Duty the fan runs at now. */
  currentDuty: number | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)

  const toCurve = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return {
      temp: Math.round(TEMP_MIN + ((point.x - PAD.left) / plotWidth) * (TEMP_MAX - TEMP_MIN)),
      duty: Math.round((1 - (point.y - PAD.top) / plotHeight) * 100)
    }
  }

  /** Move one point, keeping it between its neighbours so the curve never folds back. */
  const movePoint = (index: number, temp: number, duty: number) => {
    const low = index > 0 ? points[index - 1].temp + 1 : TEMP_MIN
    const high = index < points.length - 1 ? points[index + 1].temp - 1 : TEMP_MAX
    const next = points.map((point, i) => (i === index ? { temp: clamp(temp, low, high), duty: clamp(duty, 0, 100) } : point))
    onChange(next)
  }

  const removePoint = (index: number) => {
    if (points.length <= MIN_POINTS) return
    onChange(points.filter((_, i) => i !== index))
    setFocused(null)
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (dragging === null) return
    const target = toCurve(event)
    if (target) movePoint(dragging, target.temp, target.duty)
  }

  const onBackgroundDoubleClick = (event: MouseEvent<SVGSVGElement>) => {
    if ((event.target as Element).tagName === 'circle' || points.length >= MAX_POINTS) return
    const target = toCurve(event)
    if (!target || target.temp < TEMP_MIN || target.temp > TEMP_MAX) return
    if (points.some((point) => point.temp === target.temp)) return
    const next = [...points, { temp: target.temp, duty: clamp(target.duty, 0, 100) }].sort((a, b) => a.temp - b.temp)
    onChange(next)
  }

  const onPointKey = (index: number) => (event: KeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? 5 : 1
    const point = points[index]
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    }
    if (moves[event.key]) {
      event.preventDefault()
      movePoint(index, point.temp + moves[event.key][0], point.duty + moves[event.key][1])
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removePoint(index)
    }
  }

  // Extend the line flat to both edges, as the fan behaves outside the points.
  const linePoints = [
    { temp: TEMP_MIN, duty: points[0]?.duty ?? 0 },
    ...points,
    { temp: TEMP_MAX, duty: points[points.length - 1]?.duty ?? 0 }
  ]
    .map((point) => `${xFor(clamp(point.temp, TEMP_MIN, TEMP_MAX))},${yFor(point.duty)}`)
    .join(' ')
  const area = `${xFor(TEMP_MIN)},${yFor(0)} ${linePoints} ${xFor(TEMP_MAX)},${yFor(0)}`

  const active = dragging ?? focused
  const liveTemp = currentTemp === null ? null : clamp(currentTemp, TEMP_MIN, TEMP_MAX)

  return (
    <div className="curve">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`curve__svg${dragging !== null ? ' curve__svg--dragging' : ''}`}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        onDoubleClick={onBackgroundDoubleClick}
        role="group"
        aria-label="Fan curve editor"
      >
        <defs>
          <linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 20, 40, 60, 80, 100].map((duty) => (
          <g key={`d${duty}`}>
            <line className="curve__grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(duty)} y2={yFor(duty)} />
            <text className="curve__axis" x={PAD.left - 8} y={yFor(duty) + 4} textAnchor="end">
              {duty}%
            </text>
          </g>
        ))}
        {[20, 30, 40, 50, 60, 70, 80, 90, 100].map((temp) => (
          <g key={`t${temp}`}>
            <line className="curve__grid" x1={xFor(temp)} x2={xFor(temp)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <text className="curve__axis" x={xFor(temp)} y={HEIGHT - PAD.bottom + 18} textAnchor="middle">
              {temp}°
            </text>
          </g>
        ))}

        <polygon points={area} fill="url(#curve-fill)" />
        <polyline points={linePoints} className="curve__line" />

        {liveTemp !== null && (
          <g className="curve__live">
            <line x1={xFor(liveTemp)} x2={xFor(liveTemp)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <circle cx={xFor(liveTemp)} cy={yFor(currentDuty ?? curveDuty(points, liveTemp))} r={5} />
            <text x={xFor(liveTemp) + 6} y={PAD.top + 12}>
              {currentTemp?.toFixed(1)}°C now
            </text>
          </g>
        )}

        {points.map((point, index) => (
          <circle
            key={index}
            className={`curve__point${active === index ? ' curve__point--active' : ''}`}
            cx={xFor(point.temp)}
            cy={yFor(point.duty)}
            r={8}
            tabIndex={0}
            aria-label={`Point ${index + 1}: ${point.temp}°C, ${point.duty}%`}
            onPointerDown={(event) => {
              event.preventDefault()
              svgRef.current?.setPointerCapture(event.pointerId)
              setDragging(index)
              setFocused(index)
            }}
            onDoubleClick={() => removePoint(index)}
            onFocus={() => setFocused(index)}
            onBlur={() => setFocused((current) => (current === index ? null : current))}
            onKeyDown={onPointKey(index)}
          />
        ))}

        {active !== null && points[active] && (
          <g className="curve__tip" transform={`translate(${clamp(xFor(points[active].temp), PAD.left + 40, WIDTH - PAD.right - 40)}, ${Math.max(yFor(points[active].duty) - 18, PAD.top + 10)})`}>
            <rect x={-40} y={-14} width={80} height={22} rx={6} />
            <text y={2} textAnchor="middle">
              {points[active].temp}°C · {points[active].duty}%
            </text>
          </g>
        )}
      </svg>
      <div className="curve__help">
        Drag a point to change it. Double-click empty space to add a point (up to {MAX_POINTS}), double-click a point to
        remove it. Arrow keys nudge the selected point.
      </div>
    </div>
  )
}
