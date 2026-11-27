import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json' with { type: 'json' }
import zh from './locales/zh-HK.json' with { type: 'json' }
import type { Locale } from './engine/save.ts'

export const resources = { en: { translation: en }, 'zh-HK': { translation: zh } }

export function initLocale(language: Locale) {
  return i18next.use(initReactI18next).init({
    lng: language, supportedLngs: ['en', 'zh-HK'], fallbackLng: 'en', resources,
    interpolation: { escapeValue: false },
  })
}

export default i18next
