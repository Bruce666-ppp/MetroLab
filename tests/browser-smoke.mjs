import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { applyAction } from '../src/engine/actions.ts'
import { exampleGame } from '../src/engine/example.ts'
import { quoteLine } from '../src/engine/planning.ts'
import { newGame } from '../src/engine/simulation.ts'

const executablePath = [process.env.METROLAB_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path))
assert.ok(executablePath, 'Set METROLAB_CHROME to a Chromium executable.')

const url = process.env.METROLAB_URL ?? 'http://localhost:4173/MetroLab/'
const screenshots = process.env.METROLAB_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })

const browser = await chromium.launch({ executablePath })
const errors = []
const workers = []
const map = (page) => page.getByTestId('city-map')
const stations = (page) => page.getByTestId('map-station')
const exact = (page, name) => page.getByRole('button', { name, exact: true })
const dock = (page) => page.getByTestId('draw-controls')
const hoverName = (page) => page.getByTestId('draft-station-preview-name')
const central = [635.2, 911.6]
const tsimShaTsui = [798.4, 722.9]
const kennedyTown = [303.5, 907.4]
const hku = [400.5, 887.8]
const shekTongTsui = [407.3, 870.4]
const peakGarden = [490.6, 1001]
const westShore = [325, 898], harbourBend = [415, 754], offshoreEnd = [575, 789], kowloonShore = [799, 720]
const harbourWarning = 'Place both ends of the alignment on land.'
const start = [944, 407], finish = [1004, 234]

async function screen(page, point) {
  return map(page).evaluate((svg, point) => {
    const result = new DOMPoint(...point).matrixTransform(svg.getScreenCTM())
    return { x: result.x, y: result.y }
  }, point)
}

async function clickMap(page, point, shift = false) {
  const xy = await screen(page, point)
  if (shift) await page.keyboard.down('Shift')
  try { await page.mouse.click(xy.x, xy.y) } finally { if (shift) await page.keyboard.up('Shift') }
}

async function moveMap(page, point) {
  const xy = await screen(page, point)
  await page.mouse.move(xy.x, xy.y)
}

async function ready(page) {
  await page.locator('[data-testid="hk-map-canvas"][data-assets="ready"]').waitFor({ timeout: 15000 })
}

async function screenshot(page, name) {
  if (!screenshots) return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(screenshots, name + '.png'), animations: 'disabled' })
}

async function open(page) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) errors.push(request.url() + ': ' + request.failure()?.errorText) })
  page.on('worker', (worker) => workers.push(worker.url()))
  const response = await page.goto(url)
  assert.equal(response?.status(), 200)
}

async function save(page, zh = false) {
  await exact(page, zh ? '設定' : 'Settings').click()
  await page.getByRole('dialog').getByRole('button', { name: zh ? /儲存|保存/ : /Save game/ }).click()
  return page.evaluate(() => JSON.parse(localStorage.getItem('metrolab.save')).game)
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => {
    const paintText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.dataset.testid === 'hk-map-canvas') this.canvas.dataset.paintedLabel = 'true'
      return paintText.apply(this, args)
    }
  })
  await open(page)
  await page.getByRole('heading', { name: 'Hong Kong' }).waitFor()
  await ready(page)
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('committed-track').count(), 0)
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  await screenshot(page, 'hong-kong-city')

  const initialCamera = await map(page).getAttribute('viewBox')
  await exact(page, 'Zoom in').click()
  assert.notEqual(await map(page).getAttribute('viewBox'), initialCamera)
  const cameraPoint = await screen(page, [870, 900])
  const zoomedCamera = await map(page).getAttribute('viewBox')
  await page.mouse.move(cameraPoint.x, cameraPoint.y)
  await page.mouse.down()
  await page.mouse.move(cameraPoint.x + 76, cameraPoint.y + 23, { steps: 8 })
  await page.mouse.up()
  assert.notEqual(await map(page).getAttribute('viewBox'), zoomedCamera)
  await exact(page, 'Reset map view').click()
  assert.equal(await map(page).getAttribute('viewBox'), initialCamera)
  assert.equal(await page.getByTestId('hk-map-canvas').getAttribute('data-painted-label'), null)

  await page.getByRole('button', { name: /Career mode/ }).click()
  const startupBudget = await page.getByTestId('metric-budget').innerText()
  assert.match(startupBudget, /HKD.*38/)
  await exact(page, 'Draw line').click()
  await moveMap(page, hku)
  await hoverName(page).filter({ hasText: /^HKU$/ }).waitFor()
  await clickMap(page, hku, true)
  await moveMap(page, shekTongTsui)
  await hoverName(page).filter({ hasText: /^Shek Tong Tsui$/ }).waitFor()
  await clickMap(page, shekTongTsui, true)
  const localNames = page.getByTestId('draft-station-name')
  assert.deepEqual(await localNames.allTextContents(), ['HKU', 'Shek Tong Tsui'])
  await exact(page, '繁中').click()
  await localNames.filter({ hasText: /^香港大學$/ }).waitFor()
  assert.deepEqual(await localNames.allTextContents(), ['香港大學', '石塘咀'])
  assert.ok(await localNames.evaluateAll(([first, second]) => {
    const a = first.getBoundingClientRect(), b = second.getBoundingClientRect()
    return b.bottom <= a.top
  }))
  await screenshot(page, 'hong-kong-station-names')
  await exact(page, 'English').click()
  await page.keyboard.press('Escape')
  await exact(page, 'Draw line').click()
  for (const point of [westShore, harbourBend, offshoreEnd]) await clickMap(page, point)
  await dock(page).getByText(harbourWarning, { exact: false }).waitFor()
  await page.getByTestId('water-alignment-end').waitFor()
  assert.ok(await dock(page).getByRole('button', { name: 'Build alignment' }).isDisabled())
  assert.equal(await page.getByTestId('committed-track').count(), 0)
  assert.equal(await page.getByTestId('metric-budget').innerText(), startupBudget)
  await screenshot(page, 'hong-kong-water-end')
  await page.keyboard.press('Escape')
  await exact(page, 'Draw line').click()
  await moveMap(page, central)
  await hoverName(page).filter({ hasText: /^Central$/ }).waitFor()
  await moveMap(page, kennedyTown)
  await hoverName(page).filter({ hasText: /^Kennedy Town$/ }).waitFor()
  await moveMap(page, [735, 819])
  await hoverName(page).waitFor({ state: 'hidden' })
  await clickMap(page, [735, 819], true)
  await page.getByRole('status').filter({ hasText: 'Stations must be built on land.' }).waitFor()
  await moveMap(page, peakGarden)
  await hoverName(page).waitFor({ state: 'hidden' })
  await clickMap(page, peakGarden, true)
  const parkNotice = page.getByRole('status').filter({ hasText: 'Stations cannot be built inside parks' })
  await parkNotice.waitFor()
  assert.equal(await page.getByTestId('proposed-station').count(), 0)
  await parkNotice.getByRole('button', { name: 'Close' }).click()
  await clickMap(page, central)
  await clickMap(page, [(central[0] + tsimShaTsui[0]) / 2, (central[1] + tsimShaTsui[1]) / 2])
  assert.equal(await page.getByTestId('proposed-station').count(), 0)
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('metric-budget').innerText(), startupBudget)
  await dock(page).getByLabel('Construction method').selectOption('elevated')
  await clickMap(page, central, true)
  await clickMap(page, tsimShaTsui, true)
  assert.equal(await page.getByTestId('proposed-station').count(), 2)
  assert.deepEqual(await page.getByTestId('draft-station-name').allTextContents(), ['Central', 'Tsim Sha Tsui'])
  assert.ok(await dock(page).getByRole('button', { name: 'Build alignment' }).isDisabled())
  await dock(page).getByLabel('Construction method').selectOption('underground')
  await exact(page, '繁中').click()
  await page.getByTestId('draft-station-name').filter({ hasText: /^中環$/ }).waitFor()
  assert.deepEqual(await page.getByTestId('draft-station-name').allTextContents(), ['中環', '尖沙咀'])
  await moveMap(page, kennedyTown)
  await hoverName(page).filter({ hasText: /^堅尼地城$/ }).waitFor()
  await exact(page, 'English').click()
  const budget = page.getByTestId('construction-budget')
  assert.match(await budget.innerText(), /Marine tunnel supplement/)
  assert.match(await budget.innerText(), /Station works/)
  assert.match(await budget.innerText(), /Budget after confirmation/)
  await ready(page)
  await screenshot(page, 'hong-kong-construction')
  await dock(page).getByRole('button', { name: 'Build alignment' }).click()
  assert.notEqual(await page.getByTestId('metric-budget').innerText(), startupBudget)
  assert.deepEqual(await stations(page).evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))), ['Central', 'Tsim Sha Tsui'])
  assert.equal(await page.getByTestId('committed-track').count(), 1)

  await page.getByRole('button', { name: /Buy a train/ }).click()
  await page.getByRole('button', { name: /Buy a train/ }).click()
  await page.getByLabel('Base fare per line · HKD').fill('14')
  await page.locator('.fare-form').getByRole('button', { name: 'Confirm' }).click()
  await exact(page, 'Suspend service').click()
  assert.equal(await page.getByTestId('map-train').count(), 0)
  await exact(page, 'Resume service').click()
  await exact(page, '4× speed').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="metric-ridership"]')?.textContent?.replace(/\D/g, '')) > 0,
    undefined, { timeout: 22000 })
  await exact(page, 'Pause').click()
  assert.ok(workers.some((worker) => worker.includes('simulation.worker')))
  let stored = await save(page)
  assert.equal(stored.cityId, 'hong-kong')
  assert.equal(stored.version, 4)
  assert.equal(stored.lines[0].fare, 14)
  assert.equal(stored.today.fares, 14 * stored.today.arrived)
  assert.equal(stored.today.subsidy, 0)

  await exact(page, 'Build station').click()
  await moveMap(page, [1020.2, 1193.1])
  await page.locator('.map-build-tip.invalid').getByText('Stations must be built on land.').waitFor()
  await clickMap(page, [1020.2, 1193.1])
  await page.getByRole('status').filter({ hasText: 'Stations must be built on land.' }).waitFor()
  await clickMap(page, kennedyTown)
  await page.getByRole('heading', { name: 'Confirm construction' }).waitFor()
  assert.equal(await stations(page).count(), 2)
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
  await page.getByRole('heading', { name: 'Kennedy Town', exact: true }).waitFor()

  await exact(page, 'Draw line').click()
  await moveMap(page, kennedyTown)
  await page.mouse.down()
  try {
    await moveMap(page, [961.4, 376.5])
    await hoverName(page).filter({ hasText: /^Kowloon City$/ }).waitFor()
    await moveMap(page, [1003.9, 247.8])
    await hoverName(page).filter({ hasText: /^Wong Tai Sin$/ }).waitFor()
    assert.equal(await stations(page).filter({ hasText: 'Kennedy Town' }).locator('.station-name').textContent(), 'Kennedy Town')
  } finally { await page.mouse.up() }
  await page.keyboard.press('Escape')
  await hoverName(page).waitFor({ state: 'hidden' })

  await exact(page, 'Draw line').click()
  await clickMap(page, start)
  await clickMap(page, finish)
  assert.equal(await page.getByTestId('proposed-station').count(), 0)
  await dock(page).getByRole('button', { name: 'Build alignment' }).click()
  assert.equal(await stations(page).count(), 3)
  await page.getByText('Add at least two stations to run trains on this alignment.').waitFor()
  await exact(page, 'Build station').click()
  await clickMap(page, start.map((coordinate, i) => coordinate + (finish[i] - coordinate) * .28))
  await page.getByRole('status').filter({ hasText: 'Stations cannot be built inside parks' }).waitFor()
  assert.equal(await stations(page).count(), 3)
  for (const fraction of [.18, .81]) {
    await exact(page, 'Build station').click()
    await clickMap(page, start.map((coordinate, i) => coordinate + (finish[i] - coordinate) * fraction))
    await page.getByRole('heading', { name: 'Insert station', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Insert station', exact: true }).click()
  }
  assert.equal(await stations(page).count(), 5)
  stored = await save(page)
  assert.deepEqual(stored.lines.map((line) => line.stops.length), [2, 2])
  assert.equal(stored.lines[1].track.length, 1)
  assert.ok(stored.lines[1].openEnds.head && stored.lines[1].openEnds.tail)

  await exact(page, 'Inspect').click()
  await page.getByLabel('Map layer').selectOption('demand')
  await clickMap(page, [478, 1000])
  await page.getByTestId('hk-demand-directions').waitFor()
  await page.getByRole('heading', { name: 'Main destinations · estimated' }).waitFor()
  for (const layer of ['population', 'employment', 'coverage', 'flow']) {
    await page.getByLabel('Map layer').selectOption(layer)
    assert.equal(await page.getByLabel('Map layer').inputValue(), layer)
  }
  await exact(page, '繁中').click()
  await page.waitForFunction(() => document.documentElement.lang === 'zh-HK')
  assert.equal(await stations(page).first().getAttribute('aria-label'), '中環')
  assert.equal(await stations(page).nth(1).getAttribute('aria-label'), '尖沙咀')
  await exact(page, '營運分析').click()
  await page.getByRole('heading', { name: '營運總覽' }).waitFor()
  await screenshot(page, 'hong-kong-operations-zh')
  await exact(page, 'English').click()
  await save(page)
  await page.reload()
  await page.getByRole('button', { name: /Continue/ }).click()
  assert.equal(await stations(page).count(), 5)
  assert.equal(await page.getByTestId('committed-track').count(), 2)

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-HK' })
  await open(mobile)
  await mobile.getByRole('heading', { name: '香港', exact: true }).waitFor()
  await ready(mobile)
  assert.equal(await mobile.locator('html').getAttribute('lang'), 'zh-HK')
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await mobile.getByRole('button', { name: /經營模式/ }).click()
  await exact(mobile, '繪製路線').click()
  await dock(mobile).waitFor({ state: 'visible' })
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))

  const repair = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  const seed = newGame('sandbox', 'hong-kong')
  const alignment = (end) => ({ stops: [], name: 'Harbour survey', color: '#2864d4', circular: false,
    alignmentEnds: { head: [westShore, harbourBend, end].map(([x, y]) => ({ x, y })) } })
  const oldHarbourSave = applyAction(seed, { type: 'saveLine', design: alignment(kowloonShore) }).game
  assert.ok(oldHarbourSave)
  oldHarbourSave.lines[0].openEnds.head = quoteLine(seed, alignment(offshoreEnd)).rows[0].section
  await repair.addInitScript((slot) => localStorage.setItem('metrolab.save', JSON.stringify(slot)),
    { savedAt: new Date().toISOString(), game: oldHarbourSave })
  await open(repair)
  await repair.getByRole('button', { name: /Continue game/ }).click()
  await repair.getByTestId('water-alignment-end').waitFor()
  await clickMap(repair, offshoreEnd)
  await repair.getByText(harbourWarning, { exact: false }).waitFor()
  await exact(repair, 'Edit line').click()
  await clickMap(repair, offshoreEnd)
  await clickMap(repair, kowloonShore)
  await dock(repair).getByRole('button', { name: 'Build alignment' }).click()
  await repair.getByTestId('water-alignment-end').waitFor({ state: 'hidden' })
  assert.equal(await repair.getByTestId('committed-track').count(), 1)
  assert.equal(await stations(repair).count(), 0)

  await exact(repair, 'Draw line').click()
  await clickMap(repair, [346, 865])
  await clickMap(repair, [365, 865])
  await dock(repair).getByRole('button', { name: 'Build alignment' }).click()
  await exact(repair, 'Build station').click()
  await moveMap(repair, [350, 852])
  await repair.locator('.map-build-tip.invalid').getByText('Stations must be built on land.').waitFor()
  await clickMap(repair, [350, 852])
  await repair.getByRole('status').filter({ hasText: 'Stations must be built on land.' }).waitFor()
  assert.equal(await stations(repair).count(), 0)
  await clickMap(repair, [355, 865])
  await repair.getByRole('heading', { name: 'Insert station', exact: true }).waitFor()
  await exact(repair, 'Insert station').click()
  assert.equal(await stations(repair).count(), 1)

  const legacy = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'en-US' })
  const legacyGame = { ...exampleGame(), version: 3 }
  await legacy.addInitScript((slot) => localStorage.setItem('metrolab.save', JSON.stringify(slot)), { savedAt: new Date().toISOString(), game: legacyGame })
  await open(legacy)
  await legacy.getByRole('button', { name: /Continue/ }).click()
  assert.equal(await stations(legacy).count(), legacyGame.stations.length)
  assert.equal(await legacy.getByTestId('committed-track').count(), legacyGame.lines.length)
  await legacy.getByTestId('raised-cityscape').waitFor()
  assert.equal(await legacy.locator('.base-map text').count(), 0)

  assert.deepEqual(errors, [])
  console.log('Station exclusions, water crossing and legacy endpoint repair, station names, construction, operations, languages, mobile layout and Marlow migration passed.')
} finally {
  await browser.close()
}
