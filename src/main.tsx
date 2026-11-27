import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './style.css'
import { initLocale } from './i18n.ts'

const node = document.getElementById('root')!
const zh = navigator.language.toLowerCase().startsWith('zh')
try {
  const [{ App }, { getSettings, readBrowserStorage }] = await Promise.all([import('./ui/App.tsx'), import('./engine/save.ts')])
  const storage = readBrowserStorage()
  const settings = getSettings(storage, navigator.language)
  await initLocale(settings.language)
  document.documentElement.lang = settings.language
  createRoot(node).render(<App storage={storage} initialSettings={settings} />)
} catch (error) {
  console.error(error)
  node.textContent = zh ? '香港地圖載入失敗。請重新整理頁面。' : 'The Hong Kong map could not load. Refresh the page to try again.'
}
