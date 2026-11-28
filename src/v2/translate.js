// v2 config -> v4 config. Every rename is a warning that names the old and new path,
// so the warnings are the user's migration checklist.
import {
  translateLegend,
  translateMode,
  translatePlugin,
  translateTitle,
  translateTooltip,
  wrapChartHandler,
} from './callbacks.js'
import { translateScale, translateScales } from './scales.js'
import { clone, isPlainObject, merge, move, RAD2DEG, warn } from './util.js'

const deg = (rad) => rad * RAD2DEG
/** Degrees with 0 at the top, from v2 radians with -½π at the top. */
const degFromTop = (rad) => deg(rad + Math.PI / 2)

const PLUGIN_OPTIONS = [
  ['legend', 'legend', translateLegend],
  ['title', 'title', translateTitle],
  ['tooltips', 'tooltip', translateTooltip],
]

/** options.legend / title / tooltips -> options.plugins.* */
function movePluginOptions(o) {
  const plugins = isPlainObject(o.plugins) ? o.plugins : {}
  for (const [from, to, translate] of PLUGIN_OPTIONS) {
    if (o[from] === undefined) continue
    const v = o[from]
    delete o[from]
    warn(`options.${from} is now options.plugins.${to}`)
    if (isPlainObject(v)) translate(v, `options.${from}\u0000options.plugins.${to}`)
    plugins[to] = isPlainObject(v) && isPlainObject(plugins[to]) ? merge(plugins[to], v) : v
  }
  if (Object.keys(plugins).length) o.plugins = plugins
}

/** v2 horizontalBar defaults: index mode on the y axis for hover and tooltips. */
function applyHorizontalBar(o) {
  o.indexAxis = 'y'
  o.hover = { axis: 'y', mode: 'index', ...(o.hover || {}) }
  o.tooltips = { axis: 'y', mode: 'index', ...(o.tooltips || {}) }
}

function setAnimationDuration(o, key, duration) {
  if (o.animation !== false) o.animation = { ...(o.animation || {}), [key]: { duration } }
}

function translateHover(o) {
  const hover = o.hover
  if (!isPlainObject(hover)) return
  translateMode(hover, 'options.hover')
  if ('animationDuration' in hover) {
    setAnimationDuration(o, 'active', hover.animationDuration)
    delete hover.animationDuration
    warn('options.hover.animationDuration is now options.animation.active.duration')
  }
  if (typeof hover.onHover === 'function') {
    o.onHover = hover.onHover
    delete hover.onHover
    warn('options.hover.onHover is now options.onHover')
  }
}

function translateResizeAnimation(o) {
  if (!('responsiveAnimationDuration' in o)) return
  setAnimationDuration(o, 'resize', o.responsiveAnimationDuration)
  delete o.responsiveAnimationDuration
  warn('options.responsiveAnimationDuration is now options.animation.resize.duration')
}

function translateElements(o) {
  if (!isPlainObject(o.elements)) return
  move(o.elements, 'rectangle', 'bar', 'options.elements')
  const arc = o.elements.arc
  if (isPlainObject(arc) && typeof arc.angle === 'number') arc.angle = deg(arc.angle)
}

/** doughnut / pie / polarArea options. */
function translateRoundChart(o, type) {
  if ('cutoutPercentage' in o) {
    o.cutout = `${o.cutoutPercentage}%`
    delete o.cutoutPercentage
    warn("options.cutoutPercentage is now options.cutout (e.g. '50%')")
  }
  if (type !== 'doughnut' && type !== 'pie') return
  if (typeof o.rotation === 'number') {
    o.rotation = degFromTop(o.rotation)
    warn('options.rotation is now in degrees with 0 at the top')
  }
  if (typeof o.circumference === 'number') {
    o.circumference = deg(o.circumference)
    warn('options.circumference is now in degrees')
  }
}

/** options.scale (radar, polarArea) -> options.scales.r, and the polar start angle. */
function translateRadial(o, type) {
  if (isPlainObject(o.scale)) {
    const { scale } = translateScale(o.scale, 'options.scale\u0000options.scales.r')
    delete o.scale
    o.scales = { ...(o.scales || {}), r: merge(scale, o.scales?.r || {}) }
    warn('options.scale is now options.scales.r')
  }
  if (type === 'polarArea' && typeof o.startAngle === 'number') {
    o.scales = o.scales || {}
    o.scales.r = o.scales.r || {}
    o.scales.r.startAngle = degFromTop(o.startAngle)
    delete o.startAngle
    warn('options.startAngle is now options.scales.r.startAngle, in degrees with 0 at the top')
  }
}

const hasAxisArrays = (scales) => isPlainObject(scales) && ('xAxes' in scales || 'yAxes' in scales)

/**
 * Translates chart options. type is the v2 chart type; `initial` adds the defaults of v2 chart
 * types that v4 does not have (horizontalBar). Returns {options, ids, barOptsByScale}.
 */
export function translateOptions(v2options, type, ids = {}, initial = false) {
  const o = clone(v2options || {})
  const barOptsByScale = {}
  if (type === 'horizontalBar' && initial) applyHorizontalBar(o)
  movePluginOptions(o)
  translateHover(o)
  translateResizeAnimation(o)
  for (const k of ['onClick', 'onHover']) {
    if (typeof o[k] === 'function') o[k] = wrapChartHandler(o[k])
  }
  move(o, 'showLines', 'showLine', 'options')
  translateElements(o)
  translateRoundChart(o, type)
  translateRadial(o, type)
  if (hasAxisArrays(o.scales)) translateScales(o, ids, barOptsByScale)
  if (Array.isArray(o.plugins)) o.plugins = {}
  return { barOptsByScale, ids, options: o }
}

/** v2 time scales read {t, y} points; v4 reads x unless told otherwise. */
function useTimeParsing(ds, path) {
  if (ds.parsing || !Array.isArray(ds.data)) return
  const first = ds.data.find((p) => p !== null && p !== undefined)
  if (first && typeof first === 'object' && 't' in first && !('x' in first)) {
    ds.parsing = { xAxisKey: 't' }
    warn(`${path}.data uses {t, y} points; v4 reads {x, y} (the shim sets parsing.xAxisKey: 't')`)
  }
}

function applyBarOptions(ds, ids, barOptsByScale) {
  const scaleIds = [
    ds.xAxisID || ids['x-axis-default'] || 'x',
    ds.yAxisID || ids['y-axis-default'] || 'y',
  ]
  for (const id of scaleIds) {
    for (const [k, v] of Object.entries(barOptsByScale[id] || {})) if (!(k in ds)) ds[k] = v
  }
}

/** Translates one dataset in place (keeps object identity, users hold references to it). */
export function translateDataset(ds, ids, barOptsByScale, index) {
  if (!ds || ds._v2Translated) return
  const path = `data.datasets[${index}]`
  move(ds, 'lineTension', 'tension', path)
  move(ds, 'steppedLine', 'stepped', path)
  useTimeParsing(ds, path)
  for (const k of ['xAxisID', 'yAxisID']) {
    // Own keys only, and only to an id that exists: `xAxes: []` leaves no axis to map to.
    const mapped = Object.hasOwn(ids, ds[k] ?? '') ? ids[ds[k]] : undefined
    if (mapped) ds[k] = mapped
  }
  applyBarOptions(ds, ids, barOptsByScale)
  Object.defineProperty(ds, '_v2Translated', { configurable: true, value: true })
}

/**
 * Translates a whole v2 config in place: config.data keeps its identity (v2 code mutates
 * the datasets it passed in), config.options is replaced.
 */
export function upgradeConfig(config) {
  const type = config.type
  if (type === 'horizontalBar') {
    config.type = 'bar'
    warn("type: 'horizontalBar' is now type: 'bar' with options.indexAxis: 'y'")
  }
  const { options, ids, barOptsByScale } = translateOptions(config.options, type, {}, true)
  config.options = options
  if (Array.isArray(config.plugins)) config.plugins = config.plugins.map(translatePlugin)
  if (!config.data) config.data = {}
  const datasets = config.data.datasets || []
  for (let i = 0; i < datasets.length; i++) translateDataset(datasets[i], ids, barOptsByScale, i)
  return { barOptsByScale, config, ids, v2type: type }
}
