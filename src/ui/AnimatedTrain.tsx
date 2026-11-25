import { useLayoutEffect, useRef } from 'react'
import { sectionAt } from '../engine/alignment.ts'
import { trainPosition } from '../engine/trains.ts'
import type { Line, Station, TrackSection, Train } from '../engine/types.ts'

export function AnimatedTrain({ train, line, station, scale }: {
  train: Train; line: Line; station: Station; scale: number
}) {
  const glyph = useRef<SVGGElement>(null)
  const previous = useRef<{ section?: TrackSection; direction: Train['direction']; progress: number }>(undefined)
  const section = train.phase === 'travel' ? sectionAt(line, train.at, train.direction) : undefined
  const progress = section ? 1 - train.remaining / train.duration : 0

  useLayoutEffect(() => {
    const element = glyph.current
    if (!element) return
    const old = previous.current
    previous.current = { section, direction: train.direction, progress }
    const stations = new Map([[station.id, station]])
    const place = (fraction: number) => {
      const point = trainPosition(train, line, stations, fraction)
      if (point) element.setAttribute('transform',
        'translate(' + point.x + ' ' + point.y + ') rotate(' + point.angle + ')')
    }
    if (!section || old?.section !== section || old.direction !== train.direction ||
        old.progress >= progress || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      place(progress)
      return
    }
    const start = performance.now()
    let frame = 0
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / 125)
      place(old.progress + (progress - old.progress) * t)
      if (t < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [section, train.at, train.direction, train.phase, progress, station])

  return <g ref={glyph} data-testid="map-train" data-train={train.id} className="train-dot">
    <rect x={-11 / scale} y={-4 / scale} width={22 / scale} height={8 / scale} rx={3.5 / scale}
      stroke="#f7fff5" fill={line.color} strokeWidth="1.65" vectorEffect="non-scaling-stroke"/>
  </g>
}
