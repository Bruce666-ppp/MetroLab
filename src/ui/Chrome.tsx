import { useTranslation } from 'react-i18next'
import { Activity, Banknote, Building2, ChevronRight, CircleHelp, Clock3, Compass, Flag, Globe2,
  Heart, MapPin, MapPinPlus, Moon, MousePointer2, Pause, Play, Route, Settings2, Sun, TrainFront, Undo2, Users } from 'lucide-react'
import { minuteOfDay } from '../engine/city.ts'
import { demandPeriod } from '../engine/hongKongDemand.ts'
import type { gameMetrics } from '../engine/analytics.ts'
import type { SaveSlot, Locale } from '../engine/save.ts'
import type { GameState, Line, Mode, Speed } from '../engine/types.ts'
import { dayLabel, gameMoney, lineCode, lineLabel, number, percent, timeLabel, weekdayLabel } from './format.ts'
import type { Tool } from './interaction.ts'

export function LanguageSwitch({ language, change }: { language: Locale; change: (language: Locale) => void }) {
  const { t } = useTranslation()
  return <div className="language-switch" role="group" aria-label={t('app.language')}>
    <button type="button" lang="en" aria-label={t('app.english')} aria-pressed={language === 'en'}
      onClick={() => change('en')}>EN</button>
    <button type="button" lang="zh-HK" aria-label={t('app.chinese')} aria-pressed={language === 'zh-HK'}
      onClick={() => change('zh-HK')}>{t('app.chinese')}</button>
  </div>
}

export function Header({ game, playing, language, change, menu, settings, help }: {
  game: GameState; playing: boolean; language: Locale; change: (language: Locale) => void
  menu: () => void; settings: () => void; help: () => void
}) {
  const { t } = useTranslation()
  const hour = minuteOfDay(game.minute) / 60
  const daylight = hour >= 6 && hour < 20
  return <header className="app-header">
    <button type="button" className="brand" onClick={menu} title={t('app.openMenu')} aria-label={t('app.openMenu')}>
      <img src={import.meta.env.BASE_URL + 'mark.svg'} alt="" width="37" height="37" />
      <span><strong>{t('app.name')}</strong><small>{t('app.subtitle')}</small></span>
    </button>
    <div className="header-city">
      <MapPin size={17} />
      <strong>{t(game.hongKong ? 'hk.city' : 'app.city')}</strong>
      <span className="mode-label">{playing ? t('app.' + game.mode) : t(game.hongKong ? 'hk.cityOverview' : 'app.example')}</span>
    </div>
    <div className="header-actions">
      <div className="header-time" title={t(game.hongKong ? 'hk.period.' + demandPeriod(game.minute) : 'map.' + (daylight ? 'daylight' : 'night'))}>
        {daylight ? <Sun size={17} /> : <Moon size={17} />}
        <span>{dayLabel(game.minute, t)}<i />{weekdayLabel(game.minute, t)}</span>
        <time data-testid="game-clock">{timeLabel(game.minute)}</time>
      </div>
      <LanguageSwitch language={language} change={change} />
      <button type="button" className="header-icon" title={t('app.help')} aria-label={t('app.help')} onClick={help}><CircleHelp size={20} /></button>
      <button type="button" className="header-icon" title={t('app.settings')} aria-label={t('app.settings')} onClick={settings}><Settings2 size={20} /></button>
    </div>
  </header>
}

export function Indicators({ game, metrics }: { game: GameState; metrics: ReturnType<typeof gameMetrics> }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const indicators = [
    { key: 'budget', value: game.mode === 'sandbox' ? t('common.infinity') : gameMoney(game, game.funds, locale), icon: Banknote, color: 'money' },
    { key: 'population', value: number(metrics.population, locale), icon: Users, color: 'people' },
    { key: 'coverage', value: percent(metrics.coverage, locale), icon: Compass, color: 'reach' },
    { key: 'ridership', value: number(metrics.ridership, locale), icon: TrainFront, color: 'trips' },
    { key: game.hongKong ? 'jobsCoverage' : 'satisfaction', value: percent(game.hongKong ? metrics.jobCoverage : metrics.satisfaction, locale), icon: Heart, color: 'satisfaction' },
    { key: 'balance', value: gameMoney(game, metrics.operating, locale), icon: Activity, color: 'balance' },
  ]
  return <section className="indicator-strip" aria-label={t('panel.overview')}>
    {indicators.map(({ key, value, icon: Icon, color }) => <div className="indicator" key={key}>
      <span className={'indicator-icon ' + color}><Icon size={19} strokeWidth={1.8} /></span>
      <div>
        <span className="indicator-label">{t(key === 'jobsCoverage' ? 'hk.jobsCoverage' : 'metric.' + key)}</span>
        <strong data-testid={'metric-' + key} className={key === 'budget' && game.funds < 0 && game.mode === 'career' ? 'negative' : undefined}>{value}</strong>
      </div>
    </div>)}
  </section>
}

export function Tools({ tool, playing, select, undo, canUndo, canCancel, cancel }: {
  tool: Tool; playing: boolean; select: (tool: Tool) => void; undo: () => void
  canUndo: boolean; canCancel: boolean; cancel: () => void
}) {
  const { t } = useTranslation()
  const tools = [
    { key: 'select' as const, icon: MousePointer2, shortcut: 'V' },
    { key: 'station' as const, icon: MapPinPlus, shortcut: 'S' },
    { key: 'line' as const, icon: Route, shortcut: 'L' },
  ]
  return <nav className="tool-rail" aria-label={t('tool.heading')}>
    <span className="tools-title">{t('tool.heading')}</span>
    {tools.map(({ key, icon: Icon, shortcut }) => <button key={key} type="button"
      className={'tool-button' + (tool === key || tool === 'move' && key === 'station' ? ' selected' : '')}
      aria-label={t('tool.' + key)} title={t('tool.' + key) + ' (' + shortcut + ')'}
      aria-pressed={tool === key} disabled={!playing && key !== 'select'} onClick={() => select(key)}>
      <Icon size={22} strokeWidth={1.8} /><span>{t('tool.' + key)}</span>
    </button>)}
    <hr />
    <button type="button" className="tool-button" disabled={!canUndo} title={t('common.undo')} onClick={undo}>
      <Undo2 size={19} /><span>{t('common.undo')}</span>
    </button>
    {canCancel && <button type="button" className="rail-cancel" onClick={cancel}>{t('common.cancel')}</button>}
  </nav>
}

export function LineBadge({ line }: { line: Pick<Line, 'number' | 'color'> }) {
  return <span className="line-badge" style={{ '--line-color': line.color } as React.CSSProperties}>{lineCode(line)}</span>
}

export function MapLegend() {
  const { t } = useTranslation()
  return <div className="map-legend" aria-label={t('panel.legend')}>
    <span><i className="legend-node" />{t('panel.station')}</span>
    <span><i className="legend-node shared" />{t('panel.shared')}</span>
    <span><i className="legend-node transfer" />{t('panel.transfer')}</span>
  </div>
}

export function Footer({ playing, speed, setSpeed, game, selectLine }: {
  playing: boolean; speed: Speed; setSpeed: (speed: Speed) => void; game: GameState; selectLine: (id: string) => void
}) {
  const { t } = useTranslation()
  const speeds = [1, 2, 4] as const
  return <footer className="app-footer">
    <div className="footer-clock">
      {playing ? <>
        <div className="time-controls">
          <button type="button" onClick={() => setSpeed(speed ? 0 : 1)} aria-label={t(speed ? 'clock.pause' : 'clock.resume')}
            title={t(speed ? 'clock.pause' : 'clock.resume')} className="toggle-speed">
            {speed ? <Pause size={17} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          {speeds.map((rate) => <button key={rate} type="button" onClick={() => setSpeed(rate)}
            aria-label={t('clock.speed', { speed: rate })} aria-pressed={rate === speed}>{rate}×</button>)}
        </div>
          <span className="clock-status"><span className={speed ? 'active-dot' : 'paused-dot'} />{t(speed ? 'clock.running' : 'clock.paused')}</span>
          {game.hongKong && <span className="demand-period">{t('hk.period.' + demandPeriod(game.minute))}</span>}
      </> : <span className="clock-status"><Clock3 size={16}/>{t(game.hongKong ? 'hk.cityOverview' : 'clock.example')}</span>}
    </div>
    <div className="footer-lines" aria-label={t('panel.lines')}>
      {playing && game.lines.slice(0, 8).map((line) =>
        <button type="button" onClick={() => selectLine(line.id)} key={line.id} title={lineLabel(line, t, false, game)}><LineBadge line={line}/></button>)}
    </div>
    <MapLegend />
  </footer>
}

export function ModeMenu({ save, choose, resume, game, selectLine }: {
  save?: SaveSlot; choose: (mode: Mode) => void; resume: () => void; game: GameState; selectLine: (line: Line) => void
}) {
  const { t, i18n } = useTranslation()
  const date = save && new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(save.savedAt))
  return <div className="menu-panel">
    <div className="menu-intro">
      <p className="section-label"><Globe2 size={14} />{t(game.hongKong ? 'hk.edition' : 'menu.eyebrow')}</p>
      <h1>{t(game.hongKong ? 'hk.city' : 'menu.title')}</h1>
      <p>{t(game.hongKong ? 'hk.menuIntro' : 'menu.intro')}</p>
    </div>
    {save && <button type="button" className="mode-choice resume-choice" onClick={resume}>
      <span className="mode-icon"><Play size={18}/></span>
      <span><strong>{t('menu.continue')}</strong><small>{t('menu.saved', { date })}</small></span><ChevronRight size={17}/>
    </button>}
    <div className="mode-choices">
      <button type="button" className="mode-choice career-choice" onClick={() => choose('career')}>
        <span className="mode-icon"><Flag size={19}/></span>
        <span><strong>{t('menu.career')}</strong><small>{t(game.hongKong ? 'hk.careerDetail' : 'menu.careerDetail')}</small></span><ChevronRight size={17}/>
      </button>
      <button type="button" className="mode-choice" onClick={() => choose('sandbox')}>
        <span className="mode-icon"><Building2 size={19}/></span>
        <span><strong>{t('menu.sandbox')}</strong><small>{t('menu.sandboxDetail')}</small></span><ChevronRight size={17}/>
      </button>
    </div>
    {!game.hongKong && <section className="sample-section">
      <h2>{t('menu.preview')}</h2>
      <p>{t('menu.previewNote')}</p>
      {game.lines.map((line) => <button type="button" key={line.id} className="example-line" onClick={() => selectLine(line)}>
        <LineBadge line={line}/><span>{lineLabel(line, t, true)}</span><ChevronRight size={14}/>
      </button>)}
    </section>}
  </div>
}
