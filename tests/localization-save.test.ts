import assert from 'node:assert/strict'
import test from 'node:test'
import i18next from 'i18next'
import { exampleGame } from '../src/engine/example.ts'
import { clearGame, getSettings, loadGame, saveGame, saveSettings, SAVE_KEY, SETTINGS_KEY } from '../src/engine/save.ts'
import en from '../src/locales/en.json' with { type: 'json' }
import zh from '../src/locales/zh-HK.json' with { type: 'json' }

function memoryStorage() {
  const memory = new Map<string, string>()
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  }
}

test('a save restores fleets, waiting groups, statistics, day and funds exactly', () => {
  const storage = memoryStorage()
  const game = exampleGame()
  const slot = saveGame(storage, game, new Date('2026-11-24T08:00:00Z'))
  assert.ok(slot)
  assert.deepEqual(loadGame(storage), slot)
  assert.ok(clearGame(storage))
  assert.equal(loadGame(storage), undefined)
})

test('the version-one migration preserves city state and corrupted or future saves are rejected', () => {
  const storage = memoryStorage()
  const game = exampleGame()
  const slot = saveGame(storage, game)!
  storage.setItem(SAVE_KEY, JSON.stringify({ ...slot, game: { ...game, version: 1, districtDemand: undefined, stationActivity: undefined } }))
  assert.deepEqual(loadGame(storage)?.game.stations, game.stations)
  assert.deepEqual(loadGame(storage)?.game.districtDemand, {})
  assert.deepEqual(loadGame(storage)?.game.stationActivity, {})
  storage.setItem(SAVE_KEY, JSON.stringify({ ...slot, game: { ...game, version: 99 } }))
  assert.equal(loadGame(storage), undefined)
  storage.setItem(SAVE_KEY, '{')
  assert.equal(loadGame(storage), undefined)
})

test('preferences select the browser language initially and persist separately', () => {
  const storage = memoryStorage()
  assert.equal(getSettings(storage, 'zh-Hans-CN').language, 'zh-HK')
  assert.equal(getSettings(storage, 'fr-FR').language, 'en')
  const settings = { language: 'en', guides: false, layer: 'congestion' } as const
  assert.ok(saveSettings(storage, settings))
  assert.deepEqual(getSettings(storage, 'zh-TW'), settings)
  storage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'fr', layer: 'garbage' }))
  assert.deepEqual(getSettings(storage, 'fr-FR'), { language: 'en', layer: 'standard', guides: true })
  storage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'zh-CN' }))
  assert.equal(getSettings(storage).language, 'zh-HK')
})

test('English and Hong Kong Traditional Chinese use the same keys and interpolation parameters', async () => {
  const flatten = (data: object, base = ''): Record<string, string[]> => Object.assign({}, ...Object.entries(data).map(([key, value]) =>
    typeof value === 'string' ? { [base + key]: [...value.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort() } : flatten(value, base + key + '.')))
  assert.deepEqual(flatten(en), flatten(zh))
  const translator = i18next.createInstance()
  await translator.init({ lng: 'en', resources: { en: { translation: en }, 'zh-HK': { translation: zh } } })
  const game = exampleGame()
  const snapshot = structuredClone(game)
  assert.equal(translator.t('clock.day', { day: 5 }), 'Day 5')
  await translator.changeLanguage('zh-HK')
  assert.equal(translator.t('clock.day', { day: 5 }), '第 5 天')
  assert.deepEqual(game, snapshot)
})
