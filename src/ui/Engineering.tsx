import { Check, Diamond, Route, WandSparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { quoteLine } from '../engine/planning.ts'
import { ENGINEERING, radiusStatus, trackColors, unitsToMeters } from '../engine/track.ts'
import type { GameState } from '../engine/types.ts'
import { lineLabel, money, number } from './format.ts'
import { extensionChoices } from './interaction.ts'
import type { LineDraft } from './interaction.ts'

export function EngineeringLegend() {
  const { t } = useTranslation()
  return <div className="engineering-legend">
    {(['good', 'caution', 'restricted', 'invalid'] as const).map((grade) =>
      <span key={grade}><i style={{ background: trackColors[grade] }}/>{t('engineering.' + grade, {
        min: ENGINEERING.minimumRadius, mid: ENGINEERING.restrictedRadius, high: ENGINEERING.preferredRadius,
      })}</span>)}
  </div>
}

export function DrawControls({ game, draft, quote, preview, choose, commit, cancel, smooth, toggleControl }: {
  game: GameState; draft: LineDraft; quote: ReturnType<typeof quoteLine>; preview?: ReturnType<typeof quoteLine>
  choose: (id: string) => void; commit: () => void; cancel: () => void; smooth: () => void; toggleControl: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const existing = game.lines.find((line) => line.id === draft.id)
  const choices = extensionChoices(game, draft.anchor)
  const value = preview ?? quote
  const radius = value.radius ?? value.totalRadius
  const invalid = value.error === 'curve'
  const warning = invalid ? t('engineering.invalidRadius', { minimum: ENGINEERING.minimumRadius }) :
    value.error && value.error !== 'needsStops' ? t('error.' + value.error) :
    draft.control ? t('engineering.moveControl') :
    draft.pending.length ? t('engineering.finishControl') : undefined
  const label = draft.name || (existing ? lineLabel(existing, t, false, game) :
    t('line.defaultName', { number: Math.max(0, ...game.lines.map((line) => line.number)) + 1 }))
  const metric = [
    ['length', t('common.metros', { value: number(unitsToMeters(value.length) / 1000, locale) })],
    ['radius', radius === null ? t('engineering.straight') : t('map.meters', { value: number(radius, locale) })],
    ['design', t('train.kmh', { value: number(ENGINEERING.designSpeedKmh, locale) })],
    ['limit', invalid ? '—' : t('train.kmh', { value: number(value.limit, locale) })],
    ['travel', invalid ? '—' : t('common.minutes', { value: number(value.travel, locale) })],
    ['cost', money(value.cost, locale)],
  ]
  const mode = draft.kind === 'edit' ? t('line.edit') : existing ? t('engineering.extend', { line: label }) : t('engineering.create')
  return <section className={'draw-controls' + (invalid ? ' invalid' : '')} aria-label={t('engineering.planning')} data-testid="draw-controls">
    <div className="draw-controls-heading">
      <div className="draw-title"><Route size={17}/><div><strong>{mode}</strong><span className="draw-line-name">
        <i style={{ background: draft.color }}/>{label}</span></div></div>
      {draft.kind === 'draw' && choices.length > 0 && <select value={draft.id ?? ''} onChange={(event) => choose(event.target.value)}
        aria-label={t('engineering.mode')}>
        <option value="">{t('engineering.create')}</option>
        {choices.map((line) => <option key={line.id} value={line.id}>{t('engineering.extend', { line: lineLabel(line, t, false, game) })}</option>)}
      </select>}
      <div className="draw-buttons">
        {draft.stops.length > 0 && !draft.control && <button type="button" className="draw-control"
          onClick={toggleControl} aria-pressed={Boolean(draft.placingControl)}
          aria-label={t(draft.placingControl ? 'engineering.cancelControl' : 'engineering.placeControl')}
          title={t(draft.placingControl ? 'engineering.cancelControl' : 'engineering.placeControl')}><Diamond size={15}/></button>}
        <button type="button" title={t('common.cancel')} aria-label={t('common.cancel')} className="draw-cancel" onClick={cancel}><X size={17}/><span>{t('common.cancel')}</span></button>
        <button type="button" className="draw-finish" onClick={commit} disabled={Boolean(quote.error || draft.stops.length < 2 || draft.pending.length || draft.control)}>
          <Check size={17}/>{t('engineering.finish')}</button>
      </div>
    </div>
    {value.rows.length > 0 && <dl className="draw-metrics">
      {metric.map(([key, text]) => <div key={key}><dt>{t('engineering.' + key)}</dt>
        <dd style={key === 'radius' && radius !== null ? { color: trackColors[radiusStatus(radius)] } : undefined}>{text}</dd></div>)}
    </dl>}
    <div className={'draw-tip' + (warning ? ' draw-warning' : '')}>
      <span>{warning ?? (draft.stops.length ? t('engineering.nextPoint') : t('engineering.startAtStation'))}</span>
      {quote.error === 'curve' && quote.rows.some((row) => row.added && row.section.controls.length > 0) &&
        <button type="button" className="text-button" onClick={smooth}><WandSparkles size={15}/>{t('engineering.smooth')}</button>}
    </div>
  </section>
}
