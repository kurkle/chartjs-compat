// v2 config -> v4 config. Every rename is a warning that names the old and new path,
// so the warnings are the user's migration checklist.

import { toV2Element, toV2TooltipItem, v2TooltipModel } from './adapters.js'
import { clone, isPlainObject, merge, move, np, op, RAD2DEG, sub, warn } from './util.js'

const FONT_PROPS = { Family: 'family', Size: 'size' }

function parseFontStyle(style) {
  const out = {}
  const s = String(style)
  const weight = s.match(/\b(bold|bolder|lighter|[1-9]00)\b/)
  out.weight = weight ? weight[1] : 'normal'
  out.style = /\bitalic\b/.test(s) ? 'italic' : /\boblique\b/.test(s) ? 'oblique' : 'normal'
  return out
}

/**
 * Moves v2 font props (`fontColor`, `fontSize`, ... or `titleFontColor`, ...) of obj
 * into `colorKey` and `fontKey`. prefix '' means plain `fontColor` etc.
 */
export function moveFonts(obj, prefix, colorKey, fontKey, path) {
  if (!obj) return
  const key = (name) => (prefix ? `${prefix}Font${name}` : `font${name}`)
  if (key('Color') in obj) {
    obj[colorKey] = obj[key('Color')]
    delete obj[key('Color')]
    warn(`${op(path)}.${key('Color')} is now ${np(path)}.${colorKey}`)
  }
  const font = {}
  for (const [v2, v4] of Object.entries(FONT_PROPS)) {
    if (key(v2) in obj) {
      font[v4] = obj[key(v2)]
      delete obj[key(v2)]
      warn(`${op(path)}.${key(v2)} is now ${np(path)}.${fontKey}.${v4}`)
    }
  }
  if (key('Style') in obj) {
    Object.assign(font, parseFontStyle(obj[key('Style')]))
    delete obj[key('Style')]
    warn(`${op(path)}.${key('Style')} is now ${np(path)}.${fontKey}.weight / .style`)
  }
  if (!prefix && 'lineHeight' in obj && fontKey) {
    font.lineHeight = obj.lineHeight
    delete obj.lineHeight
  }
  if (Object.keys(font).length) {
    obj[fontKey] = isPlainObject(obj[fontKey]) ? Object.assign(obj[fontKey], font) : font
  }
}

const MODES = {
  label: { mode: 'index' },
  single: { intersect: true, mode: 'nearest' },
  'x-axis': { intersect: false, mode: 'index' },
}
function translateMode(obj, path) {
  if (obj && MODES[obj.mode]) {
    warn(`${op(path)}.mode '${obj.mode}' is now '${MODES[obj.mode].mode}'`)
    const m = MODES[obj.mode]
    obj.mode = m.mode
    if ('intersect' in m && !('intersect' in obj)) obj.intersect = m.intersect
  }
}

/**
 * v2 generated the ticks of vertical numeric scales top-down (and of reversed scales the other way),
 * v4 always bottom-up. Indexable tick and grid options follow the v2 order through this index.
 */
export function v2TickIndex(ctx) {
  const scale = ctx?.scale
  if (
    !scale ||
    typeof ctx.index !== 'number' ||
    scale.type === 'category' ||
    scale.type === 'radialLinear'
  )
    return ctx?.index
  const n = scale.ticks ? scale.ticks.length : 0
  const reversed = !scale.isHorizontal() !== !!scale.options.reverse
  return reversed && n ? n - 1 - ctx.index : ctx.index
}

/** A scriptable value that draws the v2 zero line on top of the normal grid line value. */
function zeroAware(base, zero) {
  const resolve = (v, ctx) => {
    if (typeof v === 'function') return v(ctx)
    if (Array.isArray(v)) return v[(v2TickIndex(ctx) || 0) % v.length]
    return v
  }
  const fn = (ctx) => {
    if (
      ctx?.tick &&
      ctx.tick.value === 0 &&
      ctx.scale &&
      ctx.scale.type !== 'category' &&
      ctx.scale.type !== 'radialLinear' &&
      !ctx.scale.options.offset
    ) {
      return resolve(zero, ctx)
    }
    return ctx && ctx.type === 'tick'
      ? resolve(base, ctx)
      : resolve(base, { ...ctx, index: 0, scale: undefined })
  }
  fn._v2ZeroAware = true
  return fn
}

export { zeroAware }

function wrapTickCallback(cb) {
  if (cb._v2Wrapped) return cb
  const wrapped = function (value, index, ticks) {
    const scale = this
    if (scale.type === 'category') {
      return cb.call(
        this,
        scale.getLabelForValue(value),
        index,
        ticks.map((t) => scale.getLabelForValue(t.value))
      )
    }
    if (scale.type === 'time' || scale.type === 'timeseries') {
      // v2 passed the formatted label, v4 passes the timestamp.
      const formats = scale.options.time.displayFormats
      const tick = ticks[index]
      const fmt = tick?.major && scale._majorUnit ? formats[scale._majorUnit] : formats[scale._unit]
      return cb.call(this, scale._adapter.format(value, fmt), index, ticks)
    }
    const values = ticks.map((t) => t.value)
    const i = v2TickIndex({ index, scale })
    return cb.call(this, value, i, i === index ? values : values.reverse())
  }
  wrapped._v2Wrapped = true
  return wrapped
}

function translateTicks(t, scale, path) {
  for (const k of ['min', 'max', 'suggestedMin', 'suggestedMax', 'beginAtZero', 'reverse']) {
    if (k in t) {
      scale[k] = t[k]
      delete t[k]
      warn(`${op(path)}.ticks.${k} is now ${np(path)}.${k}`)
    }
  }
  move(t, 'userCallback', 'callback', sub(path, '.ticks'))
  move(t, 'fixedStepSize', 'stepSize', sub(path, '.ticks'))
  move(t, 'unitStepSize', 'stepSize', sub(path, '.ticks'))
  if ('backdropPaddingX' in t || 'backdropPaddingY' in t) {
    t.backdropPadding = { x: t.backdropPaddingX ?? 2, y: t.backdropPaddingY ?? 2 }
    delete t.backdropPaddingX
    delete t.backdropPaddingY
    warn(`${op(path)}.ticks.backdropPaddingX/Y is now ${np(path)}.ticks.backdropPadding`)
  }
  moveFonts(t, '', 'color', 'font', sub(path, '.ticks'))
  if (typeof t.callback === 'function') t.callback = wrapTickCallback(t.callback)
  // ticks.major / ticks.minor font props become scriptable tick fonts.
  const major = isPlainObject(t.major) ? t.major : null
  const minor = isPlainObject(t.minor) ? t.minor : null
  if (major) moveFonts(major, '', 'color', 'font', sub(path, '.ticks.major'))
  if (minor) moveFonts(minor, '', 'color', 'font', sub(path, '.ticks.minor'))
  const styles = {
    major: major ? { color: major.color, font: major.font } : {},
    minor: minor ? { color: minor.color, font: minor.font } : {},
  }
  const baseFont = t.font
  const baseColor = t.color
  if (styles.major.font || styles.major.color || styles.minor.font || styles.minor.color) {
    const pick = (ctx) => styles[ctx.tick?.major ? 'major' : 'minor']
    t.font = (ctx) => ({
      ...(typeof baseFont === 'function' ? baseFont(ctx) : baseFont || {}),
      ...(pick(ctx).font || {}),
    })
    if (styles.major.color || styles.minor.color) {
      t.color = (ctx) =>
        pick(ctx).color ??
        (typeof baseColor === 'function' ? baseColor(ctx) : (baseColor ?? '#666'))
    }
    for (const o of [major, minor]) {
      if (o) {
        delete o.font
        delete o.color
      }
    }
  }
  if (minor && !Object.keys(minor).length) delete t.minor
}

/** Translates one v2 axis (or the radial `scale`) options object. */
export function translateScale(v2, path) {
  const s = clone(v2)
  delete s.id
  const barOpts = {}
  for (const k of [
    'barPercentage',
    'categoryPercentage',
    'barThickness',
    'maxBarThickness',
    'minBarLength',
  ]) {
    if (k in s) {
      barOpts[k] = s[k]
      delete s[k]
      warn(
        `${op(path)}.${k} is now a dataset option (data.datasets[].${k} or options.datasets.bar.${k})`
      )
    }
  }
  if (isPlainObject(s.ticks)) translateTicks(s.ticks, s, path)
  if (isPlainObject(s.gridLines)) {
    const g = s.gridLines
    delete s.gridLines
    warn(`${op(path)}.gridLines is now ${np(path)}.grid`)
    move(g, 'offsetGridLines', 'offset', sub(path, '.gridLines', '.grid'))
    move(g, 'tickMarkLength', 'tickLength', sub(path, '.gridLines', '.grid'))
    const border = {}
    if ('drawBorder' in g) {
      border.display = g.drawBorder
      delete g.drawBorder
      warn(`${op(path)}.gridLines.drawBorder is now ${np(path)}.border.display`)
    }
    for (const k of ['borderColor', 'borderWidth', 'borderDash', 'borderDashOffset']) {
      if (k in g) {
        border[k.replace('border', '').replace(/^./, (c) => c.toLowerCase())] = g[k]
        delete g[k]
      }
    }
    const zeroColor = g.zeroLineColor
    const zeroWidth = g.zeroLineWidth
    const hasZero = 'zeroLineColor' in g || 'zeroLineWidth' in g
    for (const k of Object.keys(g)) if (k.startsWith('zeroLine')) delete g[k]
    if (hasZero)
      warn(
        `${op(path)}.gridLines.zeroLine* options were removed; the shim draws them with scriptable grid.color / grid.lineWidth`
      )
    if ('color' in g || hasZero) {
      // v2 draws the zero line with the axis line's color... unless it is the first line,
      // the border takes the first grid color.
      if ('color' in g && !('color' in border))
        border.color = Array.isArray(g.color) ? g.color[0] : g.color
      g.color = zeroAware(g.color ?? 'rgba(0,0,0,0.1)', zeroColor ?? 'rgba(0,0,0,0.25)')
    }
    if ('lineWidth' in g || hasZero) {
      if ('lineWidth' in g && !('width' in border))
        border.width = Array.isArray(g.lineWidth) ? g.lineWidth[0] : g.lineWidth
      g.lineWidth = zeroAware(g.lineWidth ?? 1, zeroWidth ?? 1)
    }
    s.grid = g
    if (Object.keys(border).length) s.border = border
  }
  if (isPlainObject(s.scaleLabel)) {
    const l = s.scaleLabel
    delete s.scaleLabel
    warn(`${op(path)}.scaleLabel is now ${np(path)}.title`)
    move(l, 'labelString', 'text', null)
    moveFonts(l, '', 'color', 'font', sub(path, '.scaleLabel', '.title'))
    s.title = l
  }
  if (isPlainObject(s.pointLabels))
    moveFonts(s.pointLabels, '', 'color', 'font', sub(path, '.pointLabels'))
  if (isPlainObject(s.time)) {
    const t = s.time
    move(t, 'format', 'parser', sub(path, '.time'))
    for (const k of ['min', 'max']) {
      if (k in t) {
        s[k] = t[k]
        delete t[k]
        warn(`${op(path)}.time.${k} is now ${np(path)}.${k}`)
      }
    }
    for (const k of ['stepSize', 'unitStepSize']) {
      if (k in t) {
        s.ticks = s.ticks || {}
        s.ticks.stepSize = t[k]
        delete t[k]
        warn(`${op(path)}.time.${k} is now ${np(path)}.ticks.stepSize`)
      }
    }
  }
  if (s.distribution === 'series') {
    s.type = 'timeseries'
    warn(`${op(path)}.distribution: 'series' is now type: 'timeseries'`)
  }
  delete s.distribution
  if (isPlainObject(s.ticks) && s.ticks.source === 'labels' && s.type === 'time') {
    // unchanged
  }
  if (typeof s.afterBuildTicks === 'function' && !s.afterBuildTicks._v2Wrapped) {
    const cb = s.afterBuildTicks
    s.afterBuildTicks = function (scale) {
      // v2.9 passed tick objects for time scales and numbers for the others
      const time = scale.type === 'time' || scale.type === 'timeseries'
      const r = cb.call(this, scale, time ? scale.ticks : scale.ticks.map((t) => t.value))
      if (Array.isArray(r)) scale.ticks = r.map((v) => (typeof v === 'object' ? v : { value: v }))
    }
    s.afterBuildTicks._v2Wrapped = true
  }
  return { barOpts, scale: s }
}

/** v2 `xAxes` / `yAxes` arrays -> keyed scales. Returns the id map for datasets. */
function translateScales(o, _type, ids, barOptsByScale) {
  const v2 = o.scales
  const out = {}
  for (const key of Object.keys(v2)) {
    if (key !== 'xAxes' && key !== 'yAxes') {
      out[key] = v2[key]
      continue
    }
    const axis = key[0]
    const list = Array.isArray(v2[key]) ? v2[key] : [v2[key]]
    warn(`options.scales.${key}[] is now options.scales.<id> — one key per scale`)
    const explicit = new Set(list.map((a) => a?.id).filter(Boolean))
    const positional = {}
    list.forEach((a, i) => {
      const v2id = a?.id
      const isDefaultName = !v2id || new RegExp(`^${axis}-axis-\\d+$`).test(v2id)
      const id = i === 0 && isDefaultName ? axis : v2id || `${axis}-axis-${i}`
      // v2 named unnamed axes 'x-axis-<index>'; explicit ids win over those names.
      if (!explicit.has(`${axis}-axis-${i}`)) positional[`${axis}-axis-${i}`] = id
      if (v2id) ids[v2id] = id
      if (i === 0) ids[`${axis}-axis-default`] = id
      const { scale, barOpts } = translateScale(
        a || {},
        `options.scales.${key}[${i}]\u0000options.scales.${id}`
      )
      if (id !== axis) scale.axis = axis
      out[id] = scale
      if (Object.keys(barOpts).length) barOptsByScale[id] = barOpts
    })
    for (const k of Object.keys(positional)) if (!(k in ids)) ids[k] = positional[k]
    // the v2 default ids of the first axis: 'x-axis-0' (line, bar) and 'x-axis-1' (scatter)
    for (const k of [`${axis}-axis-0`, `${axis}-axis-1`])
      if (!(k in ids)) ids[k] = ids[`${axis}-axis-default`]
  }
  o.scales = out
}

function wrapTooltipCallbacks(cbs, path) {
  const ITEM = [
    'label',
    'labelColor',
    'labelTextColor',
    'labelPointStyle',
    'beforeLabel',
    'afterLabel',
  ]
  const ITEMS = [
    'beforeTitle',
    'title',
    'afterTitle',
    'beforeBody',
    'afterBody',
    'beforeFooter',
    'footer',
    'afterFooter',
  ]
  for (const k of Object.keys(cbs)) {
    const cb = cbs[k]
    if (typeof cb !== 'function' || cb._v2Wrapped) continue
    let w
    if (ITEM.includes(k)) {
      w = function (item) {
        const r = cb.call(
          this,
          toV2TooltipItem(item),
          k === 'labelColor' || k === 'labelTextColor' ? item.chart : item.chart.data
        )
        return r
      }
    } else if (ITEMS.includes(k)) {
      w = function (items) {
        const chart = items.length ? items[0].chart : this.chart
        return cb.call(this, items.map(toV2TooltipItem), chart.data)
      }
    } else continue
    w._v2Wrapped = true
    cbs[k] = w
  }
  warn(
    `${op(path)}.callbacks now receive (context) instead of (tooltipItem, data); the shim adapts them`
  )
}

function translateTooltip(t, path) {
  translateMode(t, path)
  moveFonts(t, 'title', 'titleColor', 'titleFont', path)
  moveFonts(t, 'body', 'bodyColor', 'bodyFont', path)
  moveFonts(t, 'footer', 'footerColor', 'footerFont', path)
  if ('xPadding' in t || 'yPadding' in t) {
    t.padding = { x: t.xPadding ?? 6, y: t.yPadding ?? 6 }
    delete t.xPadding
    delete t.yPadding
    warn(`${op(path)}.xPadding / yPadding are now ${np(path)}.padding`)
  }
  move(t, 'legendColorBackground', 'multiKeyBackground', path)
  if (typeof t.custom === 'function') {
    const custom = t.custom
    delete t.custom
    t.external = (context) => {
      const model = v2TooltipModel(context.tooltip, context.chart)
      return custom.call(model, model)
    }
    warn(`${op(path)}.custom is now ${np(path)}.external and receives {chart, tooltip}`)
  }
  if (isPlainObject(t.callbacks)) wrapTooltipCallbacks(t.callbacks, path)
  for (const k of ['itemSort', 'filter']) {
    const cb = t[k]
    if (typeof cb !== 'function' || cb._v2Wrapped) continue
    t[k] =
      k === 'itemSort'
        ? function (a, b) {
            return cb.call(this, toV2TooltipItem(a), toV2TooltipItem(b), a.chart.data)
          }
        : function (item) {
            return cb.call(this, toV2TooltipItem(item), item.chart.data)
          }
    t[k]._v2Wrapped = true
  }
}

function wrapLegendHandler(fn) {
  if (fn._v2Wrapped) return fn
  const w = function (e, item, legend) {
    return fn.call(legend || this, e?.native ? e.native : e, item)
  }
  w._v2Wrapped = true
  return w
}

function translateLegend(l, path) {
  if (isPlainObject(l.labels)) moveFonts(l.labels, '', 'color', 'font', sub(path, '.labels'))
  move(l, 'fullWidth', 'fullSize', path)
  for (const k of ['onClick', 'onHover', 'onLeave'])
    if (typeof l[k] === 'function') l[k] = wrapLegendHandler(l[k])
}

function translateTitle(t, path) {
  moveFonts(t, '', 'color', 'font', path)
  move(t, 'fullWidth', 'fullSize', path)
}

function wrapChartHandler(fn) {
  if (fn._v2Wrapped) return fn
  // v2: (nativeEvent, activeElements) with this = chart. v4: (event, elements, chart).
  const w = (e, elements, chart) =>
    fn.call(
      chart,
      e?.native ? e.native : e,
      elements.map((el) => toV2Element(el, chart))
    )
  w._v2Wrapped = true
  return w
}

const PLUGIN_HOOKS_OPTIONS_LAST = new Set([
  'beforeInit',
  'afterInit',
  'reset',
  'beforeLayout',
  'afterLayout',
  'beforeRender',
  'afterRender',
  'beforeDatasetsUpdate',
  'afterDatasetsUpdate',
  'beforeUpdate',
  'afterUpdate',
  'resize',
  'destroy',
])
const PLUGIN_HOOKS_EASING = new Set([
  'beforeDraw',
  'afterDraw',
  'beforeDatasetsDraw',
  'afterDatasetsDraw',
  'beforeDatasetDraw',
  'afterDatasetDraw',
  'beforeTooltipDraw',
  'afterTooltipDraw',
])

let pluginCount = 0

/** v2 plugin hooks got (chart, [easing|args], options); v4 hooks always get (chart, args, options). */
export function translatePlugin(p) {
  if (!p || p._v2Translated) return p
  const out = Object.create(Object.getPrototypeOf(p))
  for (const k of Object.keys(p)) {
    const fn = p[k]
    if (typeof fn !== 'function') {
      out[k] = fn
      continue
    }
    if (PLUGIN_HOOKS_OPTIONS_LAST.has(k)) {
      out[k === 'destroy' ? 'afterDestroy' : k] = function (chart, args, options) {
        if (k === 'resize') return fn.call(this, chart, args.size, options)
        return fn.call(this, chart, options)
      }
    } else if (PLUGIN_HOOKS_EASING.has(k)) {
      out[k] = function (chart, args, options) {
        if (k.endsWith('DatasetDraw') || k.endsWith('TooltipDraw'))
          return fn.call(this, chart, args, options)
        return fn.call(this, chart, 1, options)
      }
    } else if (k === 'beforeEvent' || k === 'afterEvent') {
      out[k] = function (chart, args, options) {
        return fn.call(this, chart, args.event, options)
      }
    } else if (k === 'afterScaleUpdate') {
      out.afterLayout = function (chart, _args, options) {
        return fn.call(this, chart, options)
      }
    } else {
      out[k] = fn
    }
  }
  if (!out.id) {
    pluginCount++
    out.id = `chartjs-compat-v2-plugin-${pluginCount}`
  }
  Object.defineProperty(out, '_v2Translated', { value: true })
  return out
}

const deg = (rad) => rad * RAD2DEG

/** Translates chart options. type is the v2 chart type. Returns {options, ids, barOptsByScale}. */
export function translateOptions(v2options, type, ids = {}, initial = false) {
  const o = clone(v2options || {})
  const barOptsByScale = {}
  const plugins = isPlainObject(o.plugins) ? o.plugins : {}

  if (type === 'horizontalBar' && initial) {
    o.indexAxis = 'y'
    o.plugins = plugins
    // v2 horizontalBar defaults: index mode on the y axis for hover and tooltips
    o.hover = { axis: 'y', mode: 'index', ...(o.hover || {}) }
    o.tooltips = { axis: 'y', mode: 'index', ...(o.tooltips || {}) }
  }

  for (const [from, to] of [
    ['legend', 'legend'],
    ['title', 'title'],
    ['tooltips', 'tooltip'],
  ]) {
    if (from in o && o[from] !== undefined) {
      const v = o[from]
      delete o[from]
      warn(`options.${from} is now options.plugins.${to}`)
      if (isPlainObject(v)) {
        if (to === 'legend') translateLegend(v, 'options.legend\u0000options.plugins.legend')
        if (to === 'title') translateTitle(v, 'options.title\u0000options.plugins.title')
        if (to === 'tooltip') translateTooltip(v, 'options.tooltips\u0000options.plugins.tooltip')
        plugins[to] = isPlainObject(plugins[to]) ? merge(plugins[to], v) : v
      } else {
        plugins[to] = v
      }
    }
  }
  if (Object.keys(plugins).length) o.plugins = plugins

  if (isPlainObject(o.hover)) {
    translateMode(o.hover, 'options.hover')
    if ('animationDuration' in o.hover) {
      o.animation =
        o.animation === false
          ? false
          : { ...(o.animation || {}), active: { duration: o.hover.animationDuration } }
      delete o.hover.animationDuration
      warn('options.hover.animationDuration is now options.animation.active.duration')
    }
    if (typeof o.hover.onHover === 'function') {
      o.onHover = o.hover.onHover
      delete o.hover.onHover
      warn('options.hover.onHover is now options.onHover')
    }
  }
  if ('responsiveAnimationDuration' in o) {
    if (o.animation !== false)
      o.animation = { ...(o.animation || {}), resize: { duration: o.responsiveAnimationDuration } }
    delete o.responsiveAnimationDuration
    warn('options.responsiveAnimationDuration is now options.animation.resize.duration')
  }
  for (const k of ['onClick', 'onHover'])
    if (typeof o[k] === 'function') o[k] = wrapChartHandler(o[k])
  move(o, 'showLines', 'showLine', 'options')

  if (isPlainObject(o.elements)) {
    move(o.elements, 'rectangle', 'bar', 'options.elements')
    if (isPlainObject(o.elements.arc) && typeof o.elements.arc.angle === 'number')
      o.elements.arc.angle = deg(o.elements.arc.angle)
  }

  // doughnut / pie / polarArea
  if ('cutoutPercentage' in o) {
    o.cutout = `${o.cutoutPercentage}%`
    delete o.cutoutPercentage
    warn("options.cutoutPercentage is now options.cutout (e.g. '50%')")
  }
  if (type === 'doughnut' || type === 'pie') {
    if (typeof o.rotation === 'number') {
      o.rotation = deg(o.rotation + Math.PI / 2)
      warn('options.rotation is now in degrees with 0 at the top')
    }
    if (typeof o.circumference === 'number') {
      o.circumference = deg(o.circumference)
      warn('options.circumference is now in degrees')
    }
  }

  if (isPlainObject(o.scale)) {
    const { scale } = translateScale(o.scale, 'options.scale\u0000options.scales.r')
    delete o.scale
    o.scales = { ...(o.scales || {}), r: merge(scale, o.scales?.r || {}) }
    warn('options.scale is now options.scales.r')
  }
  if (type === 'polarArea' && typeof o.startAngle === 'number') {
    o.scales = o.scales || {}
    o.scales.r = o.scales.r || {}
    o.scales.r.startAngle = deg(o.startAngle + Math.PI / 2)
    delete o.startAngle
    warn('options.startAngle is now options.scales.r.startAngle, in degrees with 0 at the top')
  }
  if (isPlainObject(o.scales) && ('xAxes' in o.scales || 'yAxes' in o.scales))
    translateScales(o, type, ids, barOptsByScale)

  if (Array.isArray(o.plugins)) o.plugins = {}
  if (typeof o.legendCallback === 'function') {
    // kept for chart.generateLegend()
  }
  return { barOptsByScale, ids, options: o }
}

/** Translates one dataset in place (keeps object identity, users hold references to it). */
export function translateDataset(ds, ids, barOptsByScale, index) {
  if (!ds || ds._v2Translated) return
  const path = `data.datasets[${index}]`
  move(ds, 'lineTension', 'tension', path)
  move(ds, 'steppedLine', 'stepped', path)
  // v2 time scales read {t, y} points; v4 reads x unless told otherwise.
  if (!ds.parsing && Array.isArray(ds.data)) {
    const first = ds.data.find((p) => p !== null && p !== undefined)
    if (first && typeof first === 'object' && 't' in first && !('x' in first)) {
      ds.parsing = { xAxisKey: 't' }
      warn(
        `${op(path)}.data uses {t, y} points; v4 reads {x, y} (the shim sets parsing.xAxisKey: 't')`
      )
    }
  }
  for (const k of ['xAxisID', 'yAxisID']) {
    if (ds[k] && ids[ds[k]] && ids[ds[k]] !== ds[k]) ds[k] = ids[ds[k]]
  }
  const scaleIds = [
    ds.xAxisID || ids['x-axis-default'] || 'x',
    ds.yAxisID || ids['y-axis-default'] || 'y',
  ]
  for (const id of scaleIds) {
    const bo = barOptsByScale[id]
    if (bo) for (const k of Object.keys(bo)) if (!(k in ds)) ds[k] = bo[k]
  }
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
