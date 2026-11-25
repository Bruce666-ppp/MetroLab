import { memo, useMemo } from 'react'
import type { TFunction } from 'i18next'
import { cityscape } from '../engine/cityscape.ts'
import type { City } from '../engine/types.ts'
import { buildingPaint } from './cityRendering.ts'

interface Props {
  city: City
  development: Record<string, number>
  detail: boolean
  flat: boolean
  landmarks: boolean
  t: TFunction
}

export const BuildingLayer = memo(function BuildingLayer({ city, development, detail, flat, landmarks, t }: Props) {
  const paint = useMemo(() => buildingPaint(city, development, detail, flat), [city, development, detail, flat])
  const locations = cityscape(city).landmarks.filter((place) => development[place.district] > 0)
  return <g data-testid={flat ? 'flat-cityscape' : 'raised-cityscape'} pointerEvents="none">
    {locations.filter((place) => place.type === 'square').map((place) => <g key={place.id} transform={'translate(' + place.point.x + ' ' + place.point.y + ') rotate(-8)'}>
      <rect x="-15" y="-10" width="30" height="20" rx="2" fill="#e2ded0" stroke="#c9c6b5" strokeWidth="1.2"/>
      <path d="M-12-4H12M-12 4H12M-5-7V7M5-7V7" stroke="#f5f2e7" strokeWidth="1" fill="none"/>
      <circle r="3.8" fill="#abd0cc" stroke="#8fb6af" strokeWidth="1"/>
    </g>)}
    {paint.shadows && <path d={paint.shadows} fill="#4b655e" opacity="0.18"/>}
    {paint.batches.map(({ pass, color, path }, index) => {
      if (pass === 'line' || pass === 'accent') {
        return <path key={index} d={path} fill="none" stroke={color} opacity={pass === 'line' ? 0.26 : 0.8}
          strokeWidth={pass === 'line' ? 0.52 : 0.95}/>
      }
      return <path key={index} d={path} fill={color} stroke={pass === 'roof' ? '#eff0e7' : 'none'} strokeWidth="0.35"/>
    })}
    {landmarks && locations.filter((place) => place.type !== 'street').map((place) => <text key={place.id}
      x={place.point.x + 9} y={place.point.y + 7} className="landmark-label">{t('landmark.' + place.id)}</text>)}
  </g>
})
