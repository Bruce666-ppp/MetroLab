import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, RotateCcw, Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../engine/save.ts'
import { LanguageSwitch } from './Chrome.tsx'

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
    return () => node?.close()
  }, [])
  return <dialog className="game-dialog" ref={dialog} aria-labelledby="dialog-title"
    onCancel={(event) => { event.preventDefault(); close() }}
    onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-inner">
      <header><h2 id="dialog-title">{title}</h2>
        <button type="button" aria-label={t('common.close')} title={t('common.close')} onClick={close}><X size={20}/></button>
      </header>
      {children}
    </div>
  </dialog>
}

export function SettingsDialog({ settings, canSave, canLoad, language, hints, save, load, reset, menu, close }: {
  settings: Settings; canSave: boolean; canLoad: boolean; language: (value: Settings['language']) => void; hints: () => void
  save: () => void; load: () => void; reset: () => void; menu: () => void; close: () => void
}) {
  const { t } = useTranslation()
  return <Dialog title={t('settings.title')} close={close}>
    <section className="dialog-settings">
      <div><span>{t('settings.language')}</span><LanguageSwitch language={settings.language} change={language}/></div>
      <label><span>{t('settings.guide')}</span><input type="checkbox" checked={settings.guides} onChange={hints}/></label>
    </section>
    <div className="detail-actions">
      <button type="button" className="action-button" onClick={save} disabled={!canSave}><Save size={17}/>{t('settings.save')}</button>
      <button type="button" className="action-button" onClick={load} disabled={!canLoad}><BookOpen size={17}/>{t('settings.load')}</button>
      {canSave && <button type="button" className="action-button" onClick={menu}>{t('settings.menu')}</button>}
      <button type="button" className="action-button danger" onClick={reset} disabled={!canSave && !canLoad}><RotateCcw size={17}/>{t('settings.reset')}</button>
    </div>
  </Dialog>
}

export function HelpDialog({ close, hongKong }: { close: () => void; hongKong: boolean }) {
  const { t } = useTranslation()
  const shortcuts = [
    [t('help.select'), 'V'], [t('help.station'), 'S'], [t('help.line'), 'L'],
    [t('help.pause'), 'Space'], [t('help.undo'), 'Ctrl / ⌘ + Z'], [t('service.redo'), 'Ctrl / ⌘ + Shift + Z'],
    [t('help.cancel'), 'Esc'], [t('help.navigate'), t('help.navigateKeys')],
    [t('help.finish'), 'Enter'], [t(hongKong ? 'hk.addDraftStation' : 'help.control'), 'Shift + click'],
  ]
  return <Dialog title={t('help.title')} close={close}>
    <p className="dialog-copy">{t(hongKong ? 'hk.helpIntro' : 'help.intro')}</p>
    <h3>{t('help.engineering')}</h3><p className="dialog-copy">{t(hongKong ? 'hk.helpEngineering' : 'help.engineeringInfo')}</p>
    <dl className="shortcut-list">{shortcuts.map(([label, key]) => <div key={key}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl>
    <h3>{t('help.transfer')}</h3><p className="dialog-copy">{t('help.transferInfo')}</p>
    <h3>{t('help.accessibility')}</h3><p className="dialog-copy">{t('help.accessibilityInfo')}</p>
  </Dialog>
}

export function ConfirmDialog({ title, body, close, onConfirm, destructive, confirmLabel, alternative }: {
  title: string; body: string; close: () => void; onConfirm: () => void; destructive?: boolean
  confirmLabel?: string; alternative?: { label: string; action: () => void }
}) {
  const { t } = useTranslation()
  return <Dialog title={title} close={close}>
    <p className="dialog-copy">{body}</p>
    <div className="dialog-actions">
      <button type="button" className="action-button" onClick={close}>{t('common.cancel')}</button>
      {alternative && <button type="button" className="action-button" onClick={alternative.action}>{alternative.label}</button>}
      <button type="button" className={'action-button ' + (destructive ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel ?? t('common.confirm')}</button>
    </div>
  </Dialog>
}
