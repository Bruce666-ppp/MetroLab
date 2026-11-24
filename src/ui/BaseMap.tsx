import { memo } from 'react'
import type { TFunction } from 'i18next'
import type { City, Layer, Zone } from '../engine/types.ts'
import { backgroundGreens, cartography, lake, mainRoads, parkLand, parkTrails } from './cartography.ts'

export const zoneColors: Record<Zone, string> = {
  residential: '#eae8dc', office: '#e7e2e7', commercial: '#eee2d9', industrial: '#e6e1d2',
  civic: '#e4e7de', park: '#dce7d1', waterfront: '#e2e7de',
}

const buildings: Record<Zone, [string, string, string]> = {
  residential: ['#d7d4c7', '#dfdbcd', '#d9d6c9'],
  office: ['#cfc8d0', '#dcd5dd', '#d6cdd6'],
  commercial: ['#dbc9be', '#e2d1c4', '#d9c7ba'],
  industrial: ['#d1cab8', '#d8cfbb', '#d4cbb8'],
  civic: ['#cdd5c5', '#d8dfd1', '#ced8ca'],
  park: ['#c1cbb7', '#ced8c6', '#cbd4bf'],
  waterfront: ['#cbd5ca', '#d2dcd0', '#c6cfc3'],
}

export const layerColors: Record<Layer, string> = {
  standard: '#087e69', population: '#9f6eb7', demand: '#d68043',
  coverage: '#258b78', congestion: '#cc5c51', accessibility: '#4279c4',
}

interface Props {
  city: City
  development: Record<string, number>
  detail: boolean
  labels: boolean
  t: TFunction
}

export const BaseMap = memo(function BaseMap({ city, development, detail, labels, t }: Props) {
  const map = cartography(city)
  return <g className="base-map" pointerEvents="none">
    <defs>
      <clipPath id="marlow-boundary"><rect width={city.width} height={city.height} /></clipPath>
    </defs>
    <rect x="-3800" y="-2400" width="9600" height="6500" fill="#efeee5" />
    <g clipPath="url(#marlow-boundary)">
      <rect width={city.width} height={city.height} fill="#efede4" />
      {backgroundGreens.map((path, i) => <path d={path} key={i} fill={i % 2 ? '#e5ebd9' : '#e4e8d7'} />)}
      {map.districtDrawings.map((drawing, i) =>
        <path key={drawing.id} d={drawing.land} fill={development[drawing.id] ? zoneColors[city.districts[i].zone] : '#e6e9d9'}
          stroke="#e0dfd2" strokeWidth="1.4" />)}
      <g fill="none" strokeLinecap="round">
        {map.districtDrawings.map((drawing, i) => {
          const active = development[drawing.id] > 0
          const park = city.districts[i].zone === 'park'
          return <g key={drawing.id} opacity={active ? park ? 0.55 : 1 : 0.37}>
            {detail && <path d={drawing.lanes} stroke="#faf8ef" strokeWidth="3" />}
            <path d={drawing.roads} stroke="#dedacc" strokeWidth="6.3" />
            <path d={drawing.roads} stroke="#fbf9f0" strokeWidth="4.1" />
          </g>
        })}
      </g>
      {detail && map.districtDrawings.map((drawing, i) => {
        const factor = development[drawing.id] ?? 0
        if (!factor) return null
        const tones = buildings[city.districts[i].zone]
        return <g key={drawing.id}>
          {drawing.buildings.map((path, index) => <path key={index} d={path} fill={tones[index]} />)}
          {factor > 1.025 && <path d={drawing.expansion[0]} fill={tones[1]} />}
          {factor > 1.075 && <path d={drawing.expansion[1]} fill={tones[0]} />}
        </g>
      })}
      {parkLand.map((path, i) => <path d={path} key={i} fill={i === 0 ? '#d7e5ce' : '#dce7d3'} stroke="#cedcc5" strokeWidth="1.2" />)}
      {detail && <g fill="#b8cdae" opacity="0.57">{map.trees.map((point, i) =>
        <circle key={i} cx={point.x} cy={point.y} r={point.r} />)}</g>}
      {parkTrails.map((path, index) => <path key={index} d={path} fill="none" stroke="#f3f3e5" strokeWidth="2.8" />)}
      <path d={lake} fill="#b9d6d6" stroke="#aaccce" strokeWidth="1.4" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="#cfc9b9" strokeWidth="9">{mainRoads.map((path, i) => <path key={i} d={path} />)}</g>
        <g stroke="#fbfaf1" strokeWidth="6.5">{mainRoads.map((path, i) => <path key={i} d={path} />)}</g>
        <path d={map.river} fill="#b6d6dd" />
        <path d={map.banks} stroke="#a7c8cd" strokeWidth="3.3" />
        <path d={map.boardwalk} stroke="#c0ceba" strokeWidth="4" />
        <path d={map.boardwalk} stroke="#fbf8ea" strokeWidth="1.4" strokeDasharray="6 3" />
        <g stroke="#9fade0" strokeOpacity="0.43" strokeWidth="13">
          {map.bridges.map((d, i) => <path d={d} key={i} transform="translate(1 3)" />)}
        </g>
        <g stroke="#b5b6a8" strokeWidth="10">{map.bridges.map((path, i) => <path key={i} d={path} />)}</g>
        <g stroke="#fffbef" strokeWidth="6.8">{map.bridges.map((path, i) => <path key={i} d={path} />)}</g>
      </g>
      <text x="910" y="677" textAnchor="middle" transform="rotate(-74 910 677)" className="river-label">{t('map.river')}</text>
      <text x="1035" y="113" textAnchor="middle" transform="rotate(-41 1035 113)" className="river-label secondary">{t('map.river')}</text>
      {labels && city.districts.map((area) => {
        const point = area.label ?? area.center
        return <text key={area.id} x={point.x} y={point.y} textAnchor="middle"
          className={'district-label' + (development[area.id] ? '' : ' future')}>
          {t('district.' + area.id)}
        </text>
      })}
    </g>
  </g>
})
