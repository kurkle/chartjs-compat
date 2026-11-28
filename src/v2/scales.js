// v2 scale options -> v4: the xAxes / yAxes arrays, ticks, gridLines, scaleLabel and time.
import { moveFonts, moveObjectFonts } from './fonts.js'
import { v2TickIndex, zeroAware } from './ticks.js'
import { clone, hoist, isPlainObject, move, np, op, sub, warn, wrapOnce } from './util.js'

const resolve = (value, ctx) => (typeof value === 'function' ? value(ctx) : value)
const isTimeScale = (scale) => scale.type === 'time' || scale.type === 'timeseries'

function formatTimeTick(scale, value, tick) {
  const unit = tick?.major && scale._majorUnit ? scale._majorUnit : scale._unit
  return scale._adapter.format(value, scale.options.time.displayFormats[unit])
}

/** The arguments a v2 tick callback got: the label for category and time scales, v2 tick order. */
function v2TickArgs(scale, value, index, ticks) {
  if (scale.type === 'category') {
    return [scale.getLabelForValue(value), index, ticks.map((t) => scale.getLabelForValue(t.value))]
  }
  if (isTimeScale(scale)) return [formatTimeTick(scale, value, ticks[index]), index, ticks]
  const values = ticks.map((t) => t.value)
  const i = v2TickIndex({ index, scale })
  return [value, i, i === index ? values : values.reverse()]
}

function tickCallback(cb) {
  return function (value, index, ticks) {
    return cb.apply(this, v2TickArgs(this, value, index, ticks))
  }
}

function afterBuildTicks(cb) {
  return function (scale) {
    // v2.9 passed tick objects for time scales and numbers for the others
    const r = cb.call(
      this,
      scale,
      isTimeScale(scale) ? scale.ticks : scale.ticks.map((t) => t.value)
    )
    if (Array.isArray(r)) scale.ticks = r.map((v) => (typeof v === 'object' ? v : { value: v }))
  }
}

const TICKS_TO_SCALE = ['min', 'max', 'suggestedMin', 'suggestedMax', 'beginAtZero', 'reverse']

function translateBackdropPadding(t, path) {
  if (!('backdropPaddingX' in t || 'backdropPaddingY' in t)) return
  t.backdropPadding = { x: t.backdropPaddingX ?? 2, y: t.backdropPaddingY ?? 2 }
  delete t.backdropPaddingX
  delete t.backdropPaddingY
  warn(`${op(path)}.ticks.backdropPaddingX/Y is now ${np(path)}.ticks.backdropPadding`)
}

/** The font and color of ticks.major / ticks.minor, taken out of the object. */
function takeTickStyle(o, path) {
  if (!isPlainObject(o)) return {}
  moveFonts(o, '', 'color', 'font', path)
  const style = { color: o.color, font: o.font }
  delete o.color
  delete o.font
  return style
}

/** ticks.major / ticks.minor font props become scriptable tick fonts. */
function translateMajorMinor(t, path) {
  const styles = {
    major: takeTickStyle(t.major, sub(path, '.ticks.major')),
    minor: takeTickStyle(t.minor, sub(path, '.ticks.minor')),
  }
  const hasColor = !!(styles.major.color || styles.minor.color)
  const pick = (ctx) => styles[ctx.tick?.major ? 'major' : 'minor']
  if (hasColor || styles.major.font || styles.minor.font) {
    const baseFont = t.font
    t.font = (ctx) => ({ ...(resolve(baseFont, ctx) || {}), ...(pick(ctx).font || {}) })
  }
  if (hasColor) {
    const baseColor = t.color
    t.color = (ctx) =>
      pick(ctx).color ?? (typeof baseColor === 'function' ? baseColor(ctx) : (baseColor ?? '#666'))
  }
  if (isPlainObject(t.minor) && !Object.keys(t.minor).length) delete t.minor
}

function translateTicks(t, scale, path) {
  const ticksPath = sub(path, '.ticks')
  hoist(t, TICKS_TO_SCALE, scale, `${op(path)}.ticks`, np(path))
  move(t, 'userCallback', 'callback', ticksPath)
  move(t, 'fixedStepSize', 'stepSize', ticksPath)
  move(t, 'unitStepSize', 'stepSize', ticksPath)
  translateBackdropPadding(t, path)
  moveFonts(t, '', 'color', 'font', ticksPath)
  if (typeof t.callback === 'function') t.callback = wrapOnce(t.callback, tickCallback)
  translateMajorMinor(t, path)
}

const BORDER_KEYS = {
  borderColor: 'color',
  borderDash: 'dash',
  borderDashOffset: 'dashOffset',
  borderWidth: 'width',
}
const ZERO_DEFAULTS = { color: ['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.25)'], lineWidth: [1, 1] }

function takeBorder(g, path) {
  const border = {}
  if ('drawBorder' in g) {
    border.display = g.drawBorder
    delete g.drawBorder
    warn(`${op(path)}.gridLines.drawBorder is now ${np(path)}.border.display`)
  }
  for (const [v2, v4] of Object.entries(BORDER_KEYS)) {
    if (v2 in g) {
      border[v4] = g[v2]
      delete g[v2]
    }
  }
  return border
}

/** grid.color / grid.lineWidth with the v2 zero line, and the border that took the first line's value. */
function zeroLineOption(g, border, key, borderKey, zero, hasZero) {
  if (!(key in g || hasZero)) return
  if (key in g && !(borderKey in border))
    border[borderKey] = Array.isArray(g[key]) ? g[key][0] : g[key]
  const [base, zeroBase] = ZERO_DEFAULTS[key]
  g[key] = zeroAware(g[key] ?? base, zero ?? zeroBase)
}

function translateZeroLine(g, border, path) {
  const hasZero = 'zeroLineColor' in g || 'zeroLineWidth' in g
  const zero = { color: g.zeroLineColor, lineWidth: g.zeroLineWidth }
  for (const k of Object.keys(g)) if (k.startsWith('zeroLine')) delete g[k]
  if (hasZero) {
    warn(
      `${op(path)}.gridLines.zeroLine* options were removed; the shim draws them with scriptable grid.color / grid.lineWidth`
    )
  }
  zeroLineOption(g, border, 'color', 'color', zero.color, hasZero)
  zeroLineOption(g, border, 'lineWidth', 'width', zero.lineWidth, hasZero)
}

function translateGridLines(s, path) {
  const g = s.gridLines
  delete s.gridLines
  warn(`${op(path)}.gridLines is now ${np(path)}.grid`)
  const gridPath = sub(path, '.gridLines', '.grid')
  move(g, 'offsetGridLines', 'offset', gridPath)
  move(g, 'tickMarkLength', 'tickLength', gridPath)
  const border = takeBorder(g, path)
  translateZeroLine(g, border, path)
  s.grid = g
  if (Object.keys(border).length) s.border = border
}

function translateScaleLabel(s, path) {
  const l = s.scaleLabel
  delete s.scaleLabel
  warn(`${op(path)}.scaleLabel is now ${np(path)}.title`)
  move(l, 'labelString', 'text', null)
  moveFonts(l, '', 'color', 'font', sub(path, '.scaleLabel', '.title'))
  s.title = l
}

function translateTime(s, path) {
  const t = s.time
  move(t, 'format', 'parser', sub(path, '.time'))
  hoist(t, ['min', 'max'], s, `${op(path)}.time`, np(path))
  for (const k of ['stepSize', 'unitStepSize']) {
    if (k in t) {
      s.ticks = s.ticks || {}
      s.ticks.stepSize = t[k]
      delete t[k]
      warn(`${op(path)}.time.${k} is now ${np(path)}.ticks.stepSize`)
    }
  }
}

function translateDistribution(s, path) {
  if (s.distribution === 'series') {
    s.type = 'timeseries'
    warn(`${op(path)}.distribution: 'series' is now type: 'timeseries'`)
  }
  delete s.distribution
}

const BAR_OPTIONS = [
  'barPercentage',
  'categoryPercentage',
  'barThickness',
  'maxBarThickness',
  'minBarLength',
]

function takeBarOptions(s, path) {
  const barOpts = {}
  for (const k of BAR_OPTIONS) {
    if (k in s) {
      barOpts[k] = s[k]
      delete s[k]
      warn(
        `${op(path)}.${k} is now a dataset option (data.datasets[].${k} or options.datasets.bar.${k})`
      )
    }
  }
  return barOpts
}

/** Translates one v2 axis (or the radial `scale`) options object. */
export function translateScale(v2, path) {
  const s = clone(v2)
  delete s.id
  const barOpts = takeBarOptions(s, path)
  if (isPlainObject(s.ticks)) translateTicks(s.ticks, s, path)
  if (isPlainObject(s.gridLines)) translateGridLines(s, path)
  if (isPlainObject(s.scaleLabel)) translateScaleLabel(s, path)
  moveObjectFonts(s, 'pointLabels', sub(path, '.pointLabels'))
  if (isPlainObject(s.time)) translateTime(s, path)
  translateDistribution(s, path)
  if (typeof s.afterBuildTicks === 'function')
    s.afterBuildTicks = wrapOnce(s.afterBuildTicks, afterBuildTicks)
  return { barOpts, scale: s }
}

/** The v4 id of the i-th v2 axis: the first unnamed (or default-named) axis becomes 'x' / 'y'. */
function v4AxisId(axis, v2id, i) {
  const isDefaultName = !v2id || new RegExp(`^${axis}-axis-\\d+$`).test(v2id)
  if (i === 0 && isDefaultName) return axis
  return v2id || `${axis}-axis-${i}`
}

function addAxis(out, barOptsByScale, v2axis, axis, id, path) {
  const { scale, barOpts } = translateScale(v2axis || {}, path)
  if (id !== axis) scale.axis = axis
  out[id] = scale
  if (Object.keys(barOpts).length) barOptsByScale[id] = barOpts
}

function translateAxisList(key, value, out, ids, barOptsByScale) {
  const axis = key[0]
  const list = Array.isArray(value) ? value : [value]
  warn(`options.scales.${key}[] is now options.scales.<id> — one key per scale`)
  const explicit = new Set(list.map((a) => a?.id).filter(Boolean))
  const positional = {}
  list.forEach((a, i) => {
    const id = v4AxisId(axis, a?.id, i)
    // v2 named unnamed axes 'x-axis-<index>'; explicit ids win over those names.
    if (!explicit.has(`${axis}-axis-${i}`)) positional[`${axis}-axis-${i}`] = id
    if (a?.id) ids[a.id] = id
    if (i === 0) ids[`${axis}-axis-default`] = id
    addAxis(
      out,
      barOptsByScale,
      a,
      axis,
      id,
      `options.scales.${key}[${i}]\u0000options.scales.${id}`
    )
  })
  for (const k of Object.keys(positional)) if (!(k in ids)) ids[k] = positional[k]
  // the v2 default ids of the first axis: 'x-axis-0' (line, bar) and 'x-axis-1' (scatter)
  for (const k of [`${axis}-axis-0`, `${axis}-axis-1`])
    if (!(k in ids)) ids[k] = ids[`${axis}-axis-default`]
}

/** v2 `xAxes` / `yAxes` arrays -> keyed scales. Fills `ids` (v2 id -> v4 id) for the datasets. */
export function translateScales(o, ids, barOptsByScale) {
  const out = {}
  for (const [key, value] of Object.entries(o.scales)) {
    if (key === 'xAxes' || key === 'yAxes') translateAxisList(key, value, out, ids, barOptsByScale)
    else out[key] = value
  }
  o.scales = out
}
