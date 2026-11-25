import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const configuredBrowser = process.env.METROLAB_CHROME
const executablePath = [
  configuredBrowser,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path))
assert.ok(executablePath, 'Set METROLAB_CHROME to the path of a Chromium browser.')

const url = process.env.METROLAB_URL ?? 'http://localhost:4173/MetroLab/'
const screenshots = process.env.METROLAB_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })

const browser = await chromium.launch({ executablePath })
const pageErrors = []
const west = [295, 416]
const central = [747, 505]
const east = [1061, 536]
const market = [497, 667]
const control = [520, 540]
const map = (page) => page.getByTestId('city-map')
const stations = (page) => page.getByTestId('map-station')
const exact = (page, name) => page.getByRole('button', { name, exact: true })

async function snap(page, name) {
  if (screenshots) {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(screenshots, name + '.png'), animations: 'disabled' })
  }
}

async function screen(page, [x, y]) {
  return map(page).evaluate((svg, point) => {
    const result = new DOMPoint(...point).matrixTransform(svg.getScreenCTM())
    return { x: result.x, y: result.y }
  }, [x, y])
}

async function mapClick(page, point) {
  const location = await screen(page, point)
  await page.mouse.click(location.x, location.y)
}

async function visible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 8000 })
}

async function open(page) {
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const response = await page.goto(url)
  assert.equal(response?.status(), 200)
}

function nearTrack(page, trackIndex, fraction) {
  return page.getByTestId('committed-track').nth(trackIndex).evaluate((path, position) => {
    const point = path.getPointAtLength(path.getTotalLength() * position)
    return [point.x, point.y]
  }, fraction)
}

async function shiftClick(page, point) {
  await page.keyboard.down('Shift')
  try { await mapClick(page, point) } finally { await page.keyboard.up('Shift') }
}

async function savedState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('metrolab.save')).game)
}

async function save(page) {
  await exact(page, 'Settings').click()
  await exact(page, 'Save game').click()
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  page.setDefaultTimeout(8000)
  await open(page)
  await visible(page.getByRole('heading', { name: 'Plan a metro for Marlow' }))
  assert.equal(await stations(page).count(), 11)
  assert.equal(await page.getByTestId('map-train').count(), 7)
  await visible(page.getByTestId('raised-cityscape'))
  await snap(page, 'marlow-example')
  const mapView = await map(page).getAttribute('viewBox')
  const planTrack = await page.getByTestId('committed-track').first().getAttribute('d')
  await exact(page, 'Show plan view').click()
  await visible(page.getByTestId('flat-cityscape'))
  assert.equal(await map(page).getAttribute('viewBox'), mapView)
  assert.equal(await page.getByTestId('committed-track').first().getAttribute('d'), planTrack)
  await exact(page, 'Show 2.5D city').click()
  await page.mouse.move(600, 380)
  await page.mouse.wheel(0, -250)
  await page.waitForFunction((value) => document.querySelector('[data-testid=city-map]').getAttribute('viewBox') !== value, mapView)
  const zoomedView = await map(page).getAttribute('viewBox')
  await page.mouse.move(600, 380)
  await page.mouse.down()
  await page.mouse.move(675, 425, { steps: 8 })
  await page.mouse.up()
  assert.notEqual(await map(page).getAttribute('viewBox'), zoomedView)
  await exact(page, 'Reset map view').click()
  await page.waitForFunction((value) => document.querySelector('[data-testid=city-map]').getAttribute('viewBox') === value, mapView)
  console.log('2.5D, plan view geometry, example, zoom, pan and reset passed')

  await page.getByRole('button', { name: /^Career/ }).click()
  await visible(page.getByRole('heading', { name: 'Transit network' }))
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('metric-budget').textContent(), '$20M')
  await exact(page, 'Draw line').click()
  await mapClick(page, [280, 250])
  await shiftClick(page, [307.5, 280])
  await mapClick(page, [335, 250])
  await visible(page.getByTestId('draw-controls').getByText(/The minimum is 250 m/))
  assert.ok(await page.locator('[data-testid="planned-track"][stroke="#c3333d"]').count() > 0)
  assert.ok(await exact(page, 'Finish construction').isDisabled())
  await page.keyboard.press('Escape')
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('metric-budget').textContent(), '$20M')
  console.log('A tight alignment is blocked and cancelling its draft preserves the budget')

  await exact(page, 'Draw line').click()
  await mapClick(page, west)
  await shiftClick(page, control)
  await mapClick(page, central)
  assert.equal(await page.getByTestId('proposed-station').count(), 2)
  assert.equal(await page.getByTestId('track-control').count(), 1)
  assert.equal(await stations(page).count(), 0)
  assert.match(await page.getByTestId('planned-track').first().getAttribute('d'), /A/)
  await page.getByRole('textbox', { name: 'Line name' }).fill('West Link')
  await exact(page, '简中').click()
  await visible(page.getByRole('button', { name: '完成建设', exact: true }))
  assert.equal(await page.getByTestId('proposed-station').count(), 2)
  assert.equal(await page.getByRole('textbox', { name: '线路名称' }).inputValue(), 'West Link')
  await exact(page, 'English').click()
  await snap(page, 'engineering-planning')
  await map(page).focus()
  await page.keyboard.press('Enter')
  await visible(page.getByRole('heading', { name: 'West Link' }))
  assert.equal(await stations(page).count(), 2)
  await exact(page, 'Edit line').click()
  await page.getByLabel('Custom color').fill('#3666bf')
  await mapClick(page, control)
  await visible(exact(page, 'Remove control point'))
  await mapClick(page, [525, 523])
  await exact(page, 'Apply changes').click()
  const originalTrack = await page.getByTestId('committed-track').first().getAttribute('d')
  assert.match(originalTrack, /A/)
  assert.equal(await page.getByTestId('committed-track').first().getAttribute('stroke'), '#3666bf')
  await page.getByRole('button', { name: /^Buy a train/ }).click()
  await page.getByRole('combobox', { name: 'Terminal dispatch interval' }).selectOption('3')

  await exact(page, 'Draw line').click()
  await mapClick(page, central)
  await visible(page.getByTestId('draw-controls').getByText('Extend West Link', { exact: true }).first())
  await mapClick(page, east)
  await exact(page, 'Finish construction').click()
  await visible(page.getByRole('heading', { name: 'West Link' }))
  assert.equal(await stations(page).count(), 3)
  const extendedTrack = await page.getByTestId('committed-track').first().getAttribute('d')
  assert.ok(extendedTrack.startsWith(originalTrack))
  assert.equal(await page.getByTestId('map-train').count(), 1)
  console.log('Direct line drawing, bilingual draft, geometric editing, terminal extension and fleet preservation passed')

  await exact(page, 'Draw line').click()
  await mapClick(page, central)
  await mapClick(page, market)
  await page.getByRole('textbox', { name: 'Line name' }).fill('Market Link')
  await exact(page, 'Finish construction').click()
  await visible(page.getByRole('heading', { name: 'Market Link' }))
  await page.getByRole('button', { name: /^Buy a train/ }).click()
  await exact(page, 'Inspect').click()
  await mapClick(page, central)
  await visible(page.locator('.secondary-status').getByText('Interchange'))
  await exact(page, 'Draw line').click()
  await mapClick(page, central)
  const mode = page.getByRole('combobox', { name: 'Drawing mode' })
  await visible(mode)
  assert.notEqual(await mode.inputValue(), '')
  await mode.selectOption('')
  await mapClick(page, market)
  await page.getByRole('textbox', { name: 'Line name' }).fill('Market Local')
  await exact(page, 'Finish construction').click()
  await visible(page.getByRole('heading', { name: 'Market Local' }))
  assert.equal(await page.getByTestId('committed-track').count(), 3)
  const sharedPoint = await nearTrack(page, 1, 0.52)
  await exact(page, 'Build station').click()
  await mapClick(page, sharedPoint)
  await visible(page.getByRole('heading', { name: 'Insert station' }))
  await page.getByRole('checkbox', { name: /Market Local/ }).check()
  await exact(page, 'Insert station').click()
  assert.equal(await stations(page).count(), 5)
  await visible(page.locator('.secondary-status').getByText('Interchange'))
  console.log('Automatic interchange, shared-terminal choice and overlapping line insertion passed')

  await mapClick(page, west)
  await page.getByRole('textbox', { name: 'Station name' }).fill('West Exchange')
  await exact(page, 'Apply station name').click()
  await visible(page.getByRole('heading', { name: 'West Exchange' }))
  await page.getByRole('button', { name: /Upgrade station/ }).click()
  await visible(page.getByText('Station · Level 2'))
  await exact(page, 'Relocate station').click()
  await mapClick(page, [284, 435])
  await visible(page.getByRole('status').getByText('Station relocated.'))
  await exact(page, 'Undo').click()
  assert.equal(await stations(page).count(), 5)
  const insertionPoint = await nearTrack(page, 0, 0.30)
  await exact(page, '4× speed').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=metric-ridership]').textContent.replace(/,/g, '')) > 0,
    null, { timeout: 26000 })
  const liveTrains = await page.getByTestId('map-train').evaluateAll((entries) => entries.map((entry) => entry.dataset.train).sort())
  await exact(page, 'Build station').click()
  await mapClick(page, insertionPoint)
  await visible(page.getByRole('status').getByText('Station inserted on the selected tracks.'))
  assert.equal(await stations(page).count(), 6)
  assert.deepEqual(await page.getByTestId('map-train').evaluateAll((entries) => entries.map((entry) => entry.dataset.train).sort()), liveTrains)
  await page.waitForFunction(() => document.querySelector('[data-testid=game-clock]').textContent >= '08:05',
    null, { timeout: 45000 })
  await exact(page, 'Pause').click()
  await save(page)
  const saveBeforeLanguage = await savedState(page)
  assert.equal(saveBeforeLanguage.version, 3)
  assert.ok(saveBeforeLanguage.today.arrived > 0)
  assert.equal(saveBeforeLanguage.trains.length, 2)
  assert.equal(saveBeforeLanguage.lines[0].stops.length, 4)
  assert.ok(saveBeforeLanguage.stations.some((station) => station.name === 'West Exchange'))
  console.log('Naming, upgrading, relocation, undo, live insertion, trains and actual ridership passed')

  const clock = await page.getByTestId('game-clock').textContent()
  const layer = page.getByRole('combobox', { name: 'Map layer' })
  for (const key of ['population', 'demand', 'coverage', 'congestion', 'accessibility', 'engineering']) {
    await layer.selectOption(key)
    assert.equal(await layer.inputValue(), key)
  }
  await visible(page.locator('.engineering-legend').getByText(/250–400 m/))
  await exact(page, 'Analysis').click()
  await visible(page.getByRole('heading', { name: 'Operations analysis' }))
  assert.ok(await page.locator('.trend-bar').count() >= 2)
  await snap(page, 'career-operations')
  await exact(page, '简中').click()
  await visible(page.getByRole('heading', { name: '运营分析' }))
  assert.equal(await page.getByTestId('game-clock').textContent(), clock)
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
  await snap(page, 'career-operations-zh')
  await page.reload()
  await visible(page.getByRole('heading', { name: '为马洛市规划地铁' }))
  await page.getByRole('button', { name: /^继续游戏/ }).click()
  await visible(page.getByRole('heading', { name: '轨道交通网络' }))
  assert.equal(await stations(page).count(), 6)
  assert.equal(await page.getByTestId('game-clock').textContent(), clock)
  await visible(page.getByRole('button', { name: 'West Exchange', exact: true }).first())
  await exact(page, '设置').click()
  await exact(page, '读取存档').click()
  await visible(page.getByRole('status').getByText('已读取本地存档。'))
  await exact(page, '主菜单').click()
  await page.getByRole('button', { name: /^沙盒模式/ }).click()
  await exact(page, '确认').click()
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('metric-budget').textContent(), '不限')
  await exact(page, '设置').click()
  await exact(page, '重置游戏').click()
  await exact(page, '确认').click()
  await visible(page.getByRole('heading', { name: '为马洛市规划地铁' }))
  assert.equal(await page.getByRole('button', { name: /^继续游戏/ }).count(), 0)
  console.log('Engineering layer, hourly metrics, bilingual state, autosave restoration, Sandbox and reset passed')

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true })
  await open(mobile)
  await visible(mobile.getByRole('heading', { name: '为马洛市规划地铁' }))
  assert.equal(await mobile.locator('html').getAttribute('lang'), 'zh-CN')
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390)
  await exact(mobile, 'English').click()
  await visible(mobile.getByRole('heading', { name: 'Plan a metro for Marlow' }))
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390)
  await mobile.getByRole('button', { name: /^Sandbox/ }).click()
  await exact(mobile, 'Draw line').click()
  await visible(mobile.getByTestId('draw-controls'))
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390)
  assert.deepEqual(pageErrors, [])
  console.log('Narrow 390 px viewport and both interface languages passed')
} finally {
  await browser.close()
}
