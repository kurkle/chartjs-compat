// Runs every Chart.js v2.9.4 sample (test/corpus/v2/samples) on Chart.js v4 with the built shim.
//
//   node scripts/samples.mjs [filter]            test: no errors on load, hover and every button,
//                                                 and each canvas matches its reference image
//   node scripts/samples.mjs --update [filter]   write the reference images
//   node scripts/samples.mjs --compare [filter]  render with Chart.js v2 as well, real fonts, and write
//                                                 test/output/compare/index.html to review side by side
//
// References use the sprite text of chartjs-test-utils, so they do not depend on the system fonts.
// They are produced with Chromium; a reference is only as good as the v2 comparison that approved it.

import pixelmatch from 'pixelmatch'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NM = path.join(ROOT, 'node_modules')
const SAMPLES = path.join(ROOT, 'test/corpus/v2/samples')
const REFS = path.join(ROOT, 'test/references/v2')
const OUT = path.join(ROOT, 'test/output')

const args = process.argv.slice(2)
const mode = args.includes('--update') ? 'update' : args.includes('--compare') ? 'compare' : 'test'
const filter = args.find((a) => !a.startsWith('--')) || ''

// Share of differing pixels a canvas may have, after pixelmatch's per-pixel threshold.
const TOLERANCE = 0.001
const THRESHOLD = 0.1

const read = (p) => fs.readFileSync(path.join(NM, p), 'utf8')
const moment = read('moment/min/moment.min.js')
const shim = fs.readFileSync(path.join(ROOT, 'dist/chartjs-compat-v2.min.js'), 'utf8')
const libraries = {
  shim: [
    moment,
    read('chart.js/dist/chart.umd.min.js'),
    read('chartjs-adapter-moment/dist/chartjs-adapter-moment.js'),
    shim,
    'Chart.defaults.animation = false;',
  ].join('\n;\n'),
  v2: `${read('chart.js-v2/dist/Chart.js')}
Chart.defaults.global.animation.duration = 0;
Chart.defaults.global.hover.animationDuration = 0;
Chart.defaults.global.responsiveAnimationDuration = 0;`,
}

// Deterministic data: the samples call Math.random and new Date().
const DETERMINISM = `(() => {
  let s = 42;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const T = Date.UTC(2020, 0, 15, 12);
  const D = Date;
  window.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
})();`

const SPRITES = `${read('chartjs-test-utils/src/spriting.js').replace(/^export /gm, '')}
(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (type === '2d' && ctx && !ctx.__sprites) { ctx.__sprites = true; spritingOn(ctx); }
    return ctx;
  };
})();`

function listSamples(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = path.posix.join(rel, e.name)
    if (e.isDirectory()) return listSamples(dir, r)
    return e.name.endsWith('.html') && r !== 'index.html' ? [r] : []
  })
}

const idle = () => {
  const C = window.Chart
  const charts = Object.values(C.instances || {})
  if (C.animationService) return C.animationService.animations.length === 0
  return charts.every((c) => !C.animator.running(c))
}

async function run(browser, library, sample, sprites) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 900, width: 1024 },
  })
  const steps = []
  let errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !String(m.location()?.url).includes('fonts.googleapis'))
      errors.push(m.text())
  })
  await page.addInitScript(DETERMINISM)
  if (sprites) await page.addInitScript(SPRITES)
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (/\/dist\/Chart(\.min|\.bundle)?\.js$/.test(url)) {
      return route.fulfill({ body: libraries[library], contentType: 'application/javascript' })
    }
    if (url.includes('moment.min.js'))
      return route.fulfill({ body: moment, contentType: 'application/javascript' })
    if (url.includes('jquery'))
      return route.fulfill({ path: path.join(NM, 'jquery/dist/jquery.min.js') })
    if (/\/dist\/Chart(\.min)?\.css$/.test(url))
      return route.fulfill({ body: '', contentType: 'text/css' })
    if (url.startsWith('file://')) return route.continue()
    return route.abort()
  })
  const settle = async () => {
    await page
      .waitForFunction(idle, null, { timeout: 5000 })
      .catch(() => errors.push('animations did not finish'))
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    )
  }
  const capture = async (name) => {
    await settle()
    const canvases = await page.$$eval('canvas', (els) => els.map((c) => c.toDataURL('image/png')))
    steps.push({ canvases, errors, name })
    errors = []
  }

  await page.goto(`file://${path.join(SAMPLES, sample)}`)
  await page
    .waitForFunction(
      () => window.Chart && Object.keys(window.Chart.instances || {}).length > 0,
      null,
      { timeout: 5000 }
    )
    .catch(() => errors.push('no chart was created'))
  await capture('load')

  // Hover a data point of the first chart. _model.skip works with v2 and with the shim.
  const pos = await page.evaluate(() => {
    const chart = Object.values(window.Chart.instances)[0]
    const meta = chart?.getDatasetMeta(0)
    for (const i of [2, 1, 3, 0, 4, 5, 6]) {
      const el = meta?.data[i]
      const p = el && !el._model?.skip && el.tooltipPosition()
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        const r = chart.canvas.getBoundingClientRect()
        return { x: r.left + p.x, y: r.top + p.y }
      }
    }
    return null
  })
  if (pos) {
    await page.mouse.move(pos.x, pos.y)
    await capture('hover')
    await page.mouse.move(1, 1)
  }

  const buttons = await page.$$eval('button', (bs) => bs.map((b) => b.id || b.textContent.trim()))
  for (let i = 0; i < buttons.length; i++) {
    await page
      .locator('button')
      .nth(i)
      .click({ timeout: 2000 })
      .catch((e) => errors.push(`click failed: ${e.message.split('\n')[0]}`))
    await capture(`${i}-${buttons[i].replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`)
  }
  await page.close()
  return steps
}

const png = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
const fileName = (sample, step, i) =>
  `${sample.replace(/\.html$/, '').replace(/\//g, '__')}__${step}__${i}.png`

function compare(actual, expected) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      ratio: 1,
      reason: `size ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`,
    }
  }
  const diff = new PNG({ height: actual.height, width: actual.width })
  const n = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: THRESHOLD,
  })
  return { diff, ratio: n / (actual.width * actual.height) }
}

async function pool(items, size, fn) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) await fn(queue.shift())
    })
  )
}

const samples = listSamples(SAMPLES)
  .filter((s) => s.includes(filter))
  .sort()
const browser = await chromium.launch({
  args: ['--disable-accelerated-2d-canvas', '--disable-gpu'],
})
const failures = []
const compared = []
let checked = 0

function checkReference(label, file, url) {
  checked++
  const ref = path.join(REFS, file)
  if (!fs.existsSync(ref)) {
    failures.push(`${label}: no reference ${file}`)
    return
  }
  const result = compare(png(url), PNG.sync.read(fs.readFileSync(ref)))
  if (result.ratio <= TOLERANCE) return
  failures.push(`${label}: ${result.reason || `${(result.ratio * 100).toFixed(3)}% pixels differ`}`)
  fs.mkdirSync(path.join(OUT, 'failures'), { recursive: true })
  fs.writeFileSync(path.join(OUT, 'failures', file), PNG.sync.write(png(url)))
  if (result.diff) {
    fs.writeFileSync(
      path.join(OUT, 'failures', file.replace('.png', '.diff.png')),
      PNG.sync.write(result.diff)
    )
  }
}

function handleCanvas(sample, step, i, url, v2step) {
  const file = fileName(sample, step.name, i)
  if (mode === 'update') {
    fs.mkdirSync(REFS, { recursive: true })
    fs.writeFileSync(path.join(REFS, file), PNG.sync.write(png(url)))
  } else if (mode === 'test') {
    checkReference(`${sample} [${step.name}] canvas ${i}`, file, url)
  } else {
    compared.push({ i, sample, shim: url, step: step.name, v2: v2step?.canvases[i] })
  }
}

await pool(samples, 4, async (sample) => {
  const steps = await run(browser, 'shim', sample, mode !== 'compare')
  const reference = mode === 'compare' ? await run(browser, 'v2', sample, false) : null
  for (const [s, step] of steps.entries()) {
    const v2step = reference?.[s]
    // An error the v2 run also shows (a sample bug) is not a shim failure.
    const own = step.errors.filter((e) => !v2step?.errors.includes(e))
    if (own.length) failures.push(`${sample} [${step.name}]: ${own.join(' | ')}`)
    for (const [i, url] of step.canvases.entries()) handleCanvas(sample, step, i, url, v2step)
  }
})
await browser.close()

if (mode === 'compare') {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  compared.sort((a, b) => `${a.sample}${a.step}${a.i}`.localeCompare(`${b.sample}${b.step}${b.i}`))
  const rows = compared.map(
    (c) => `<tr><td>${esc(c.sample)}<br>${esc(c.step)} #${c.i}</td>
<td>${c.v2 ? `<img src="${c.v2}">` : 'missing'}</td><td><img src="${c.shim}"></td></tr>`
  )
  fs.mkdirSync(path.join(OUT, 'compare'), { recursive: true })
  fs.writeFileSync(
    path.join(OUT, 'compare/index.html'),
    `<!doctype html><meta charset="utf-8"><title>v2 vs v4 + chartjs-compat</title>
<style>body{font:13px sans-serif}img{max-width:480px;border:1px solid #ddd}td{vertical-align:top;padding:4px}</style>
<table><tr><th>sample</th><th>Chart.js 2.9.4</th><th>Chart.js 4 + chartjs-compat/v2</th></tr>${rows.join('\n')}</table>`
  )
  console.log(`${compared.length} canvases: ${path.join(OUT, 'compare/index.html')}`)
}

if (mode === 'update') console.log(`references written for ${samples.length} samples`)
if (mode === 'test') console.log(`${samples.length} samples, ${checked} canvases checked`)
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`)
  process.exit(1)
}
