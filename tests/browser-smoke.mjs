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
const east = [1288, 475]
const market = [506, 613]
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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  page.setDefaultTimeout(7000)
  await open(page)
  await visible(page.getByRole('heading', { name: 'Plan a metro for Marlow' }))
  assert.equal(await stations(page).count(), 11)
  assert.equal(await page.getByTestId('map-train').count(), 7)
  await snap(page, 'marlow-example')
  const mapView = await map(page).getAttribute('viewBox')
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
  console.log('Example network, zoom, pan and view reset passed')

  await page.getByRole('button', { name: /^Career/ }).click()
  await visible(page.getByRole('heading', { name: 'Transit network' }))
  assert.equal(await stations(page).count(), 0)
  assert.equal(await page.getByTestId('metric-budget').textContent(), '$20M')
  await exact(page, 'Station').click()
  await mapClick(page, [943, 507])
  await visible(page.getByRole('status').getByText('Stations must be built on land.'))
  for (const point of [west, central, east, market]) await mapClick(page, point)
  assert.equal(await stations(page).count(), 4)
  await exact(page, 'Inspect').click()
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
  assert.equal(await stations(page).count(), 4)
  console.log('Career start, geographic rejection, placement, naming, upgrading, relocation and undo passed')

  await exact(page, 'Line').click()
  await page.getByRole('textbox', { name: 'Line name' }).fill('West Link')
  const from = await screen(page, west)
  const to = await screen(page, central)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 25 })
  await page.mouse.up()
  assert.equal(await page.locator('.draft-stops li').count(), 2)
  await exact(page, 'Build line').click()
  await visible(page.getByRole('heading', { name: 'West Link' }))
  await page.getByRole('button', { name: /^Buy a train/ }).click()
  await page.getByRole('combobox', { name: 'Terminal dispatch interval' }).selectOption('3')
  await exact(page, 'Network').click()
  await exact(page, 'New line').click()
  await page.getByRole('textbox', { name: 'Line name' }).fill('East Link')
  await mapClick(page, central)
  await mapClick(page, east)
  await exact(page, 'Build line').click()
  await page.getByRole('button', { name: /^Buy a train/ }).click()
  await exact(page, 'Edit line').click()
  await page.getByRole('button', { name: 'Insert after this stop' }).first().click()
  await mapClick(page, market)
  assert.equal(await page.locator('.draft-stops li').count(), 3)
  await page.getByRole('checkbox', { name: /Circular service/ }).check()
  await exact(page, 'Apply changes').click()
  await visible(page.getByText('Line · Circular service'))
  await exact(page, 'Edit line').click()
  await page.getByRole('button', { name: 'Move stop down' }).first().click()
  await exact(page, 'Undo').click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
  await exact(page, 'Inspect').click()
  await mapClick(page, central)
  await visible(page.getByText('Shared stop · no transfer'))
  await page.getByRole('button', { name: /^Build interchange/ }).click()
  await visible(page.locator('.secondary-status').getByText('Interchange'))
  console.log('Drag-to-route, line editing, loop, edit undo, fleet purchase and interchange passed')

  const firstClock = await page.getByTestId('game-clock').textContent()
  await exact(page, '4× speed').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=metric-ridership]').textContent.replace(/,/g, '')) > 0,
    null, { timeout: 26000 })
  await page.waitForFunction(() => document.querySelector('[data-testid=game-clock]').textContent >= '08:05',
    null, { timeout: 45000 })
  await exact(page, 'Pause').click()
  assert.notEqual(await page.getByTestId('game-clock').textContent(), firstClock)
  assert.equal(await page.getByTestId('map-train').count(), 2)
  const ridership = await page.getByTestId('metric-ridership').textContent()
  const clock = await page.getByTestId('game-clock').textContent()
  await exact(page, 'Analysis').click()
  await visible(page.getByRole('heading', { name: 'Operations analysis' }))
  assert.ok(await page.locator('.trend-bar').count() >= 2)
  const layerSelect = page.getByRole('combobox', { name: 'Map layer' })
  for (const layer of ['population', 'demand', 'coverage', 'congestion', 'accessibility']) {
    await layerSelect.selectOption(layer)
    assert.equal(await layerSelect.inputValue(), layer)
  }
  await layerSelect.selectOption('standard')
  await snap(page, 'career-operations')
  await exact(page, '简中').click()
  await visible(page.getByRole('heading', { name: '运营分析' }))
  assert.equal(await page.getByTestId('game-clock').textContent(), clock)
  assert.equal(await page.getByTestId('metric-ridership').textContent(), ridership)
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
  await snap(page, 'career-operations-zh')
  console.log('Running trains, trip arrivals, 4× clock, pause, analysis, six layers and language switching passed')

  await exact(page, '设置').click()
  await exact(page, '保存游戏').click()
  await page.reload()
  await visible(page.getByRole('heading', { name: '为马洛市规划地铁' }))
  await page.getByRole('button', { name: /^继续游戏/ }).click()
  await visible(page.getByRole('heading', { name: '轨道交通网络' }))
  assert.equal(await stations(page).count(), 4)
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
  console.log('Local save, reload, preference recovery and blank Sandbox mode passed')

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true })
  await open(mobile)
  await visible(mobile.getByRole('heading', { name: '为马洛市规划地铁' }))
  assert.equal(await mobile.locator('html').getAttribute('lang'), 'zh-CN')
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390)
  await exact(mobile, 'English').click()
  await visible(mobile.getByRole('heading', { name: 'Plan a metro for Marlow' }))
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390)
  assert.deepEqual(pageErrors, [])
  console.log('Simplified Chinese browser detection and mobile layout passed')
} finally {
  await browser.close()
}
