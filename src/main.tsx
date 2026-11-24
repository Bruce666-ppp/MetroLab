import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './style.css'
import { App } from './ui/App.tsx'
import { getSettings, readBrowserStorage } from './engine/save.ts'
import { initLocale } from './i18n.ts'

const storage = readBrowserStorage()
const settings = getSettings(storage, navigator.language)
await initLocale(settings.language)
document.documentElement.lang = settings.language
createRoot(document.getElementById('root')!).render(<App storage={storage} initialSettings={settings} />)
