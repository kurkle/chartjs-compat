// v2 callback signatures on v4: tooltip, legend and chart handlers, and plugin hooks.
import { toV2Element, toV2TooltipItem, v2TooltipModel } from './adapters.js'
import { moveFonts, moveObjectFonts } from './fonts.js'
import { isPlainObject, move, np, op, sub, warn } from './util.js'

const marked = (fn) => {
  fn._v2Wrapped = true
  return fn
}

/** Tooltip callbacks that receive one item: v2 passed (tooltipItem, data) or (tooltipItem, chart). */
const ITEM_CALLBACKS = new Set([
  'label',
  'labelColor',
  'labelTextColor',
  'labelPointStyle',
  'beforeLabel',
  'afterLabel',
])
const CHART_ARGUMENT = new Set(['labelColor', 'labelTextColor'])
/** Tooltip callbacks that receive all items: v2 passed (tooltipItems, data). */
const ITEMS_CALLBACKS = new Set([
  'beforeTitle',
  'title',
  'afterTitle',
  'beforeBody',
  'afterBody',
  'beforeFooter',
  'footer',
  'afterFooter',
])

function wrapTooltipCallback(name, cb) {
  if (ITEM_CALLBACKS.has(name)) {
    return marked(function (item) {
      return cb.call(
        this,
        toV2TooltipItem(item),
        CHART_ARGUMENT.has(name) ? item.chart : item.chart.data
      )
    })
  }
  return marked(function (items) {
    const chart = items.length ? items[0].chart : this.chart
    return cb.call(this, items.map(toV2TooltipItem), chart.data)
  })
}

function wrapTooltipCallbacks(cbs, path) {
  for (const [name, cb] of Object.entries(cbs)) {
    const known = ITEM_CALLBACKS.has(name) || ITEMS_CALLBACKS.has(name)
    if (known && typeof cb === 'function' && !cb._v2Wrapped)
      cbs[name] = wrapTooltipCallback(name, cb)
  }
  warn(
    `${op(path)}.callbacks now receive (context) instead of (tooltipItem, data); the shim adapts them`
  )
}

function translatePadding(t, path) {
  if (!('xPadding' in t || 'yPadding' in t)) return
  t.padding = { x: t.xPadding ?? 6, y: t.yPadding ?? 6 }
  delete t.xPadding
  delete t.yPadding
  warn(`${op(path)}.xPadding / yPadding are now ${np(path)}.padding`)
}

function translateCustom(t, path) {
  const custom = t.custom
  if (typeof custom !== 'function') return
  delete t.custom
  t.external = (context) => {
    const model = v2TooltipModel(context.tooltip, context.chart)
    return custom.call(model, model)
  }
  warn(`${op(path)}.custom is now ${np(path)}.external and receives {chart, tooltip}`)
}

function wrapItemSort(cb) {
  return marked(function (a, b) {
    return cb.call(this, toV2TooltipItem(a), toV2TooltipItem(b), a.chart.data)
  })
}

function wrapFilter(cb) {
  return marked(function (item) {
    return cb.call(this, toV2TooltipItem(item), item.chart.data)
  })
}

const MODES = {
  label: { mode: 'index' },
  single: { intersect: true, mode: 'nearest' },
  'x-axis': { intersect: false, mode: 'index' },
}

/** The v2 interaction modes label, single and x-axis. */
export function translateMode(obj, path) {
  const m = obj && MODES[obj.mode]
  if (!m) return
  warn(`${op(path)}.mode '${obj.mode}' is now '${m.mode}'`)
  obj.mode = m.mode
  if ('intersect' in m && !('intersect' in obj)) obj.intersect = m.intersect
}

export function translateTooltip(t, path) {
  translateMode(t, path)
  moveFonts(t, 'title', 'titleColor', 'titleFont', path)
  moveFonts(t, 'body', 'bodyColor', 'bodyFont', path)
  moveFonts(t, 'footer', 'footerColor', 'footerFont', path)
  translatePadding(t, path)
  move(t, 'legendColorBackground', 'multiKeyBackground', path)
  translateCustom(t, path)
  if (isPlainObject(t.callbacks)) wrapTooltipCallbacks(t.callbacks, path)
  if (typeof t.itemSort === 'function' && !t.itemSort._v2Wrapped)
    t.itemSort = wrapItemSort(t.itemSort)
  if (typeof t.filter === 'function' && !t.filter._v2Wrapped) t.filter = wrapFilter(t.filter)
}

function wrapLegendHandler(fn) {
  if (fn._v2Wrapped) return fn
  return marked(function (e, item, legend) {
    return fn.call(legend || this, e?.native ? e.native : e, item)
  })
}

export function translateLegend(l, path) {
  moveObjectFonts(l, 'labels', sub(path, '.labels'))
  move(l, 'fullWidth', 'fullSize', path)
  for (const k of ['onClick', 'onHover', 'onLeave']) {
    if (typeof l[k] === 'function') l[k] = wrapLegendHandler(l[k])
  }
}

export function translateTitle(t, path) {
  moveFonts(t, '', 'color', 'font', path)
  move(t, 'fullWidth', 'fullSize', path)
}

/** v2: (nativeEvent, activeElements) with this = chart. v4: (event, elements, chart). */
export function wrapChartHandler(fn) {
  if (fn._v2Wrapped) return fn
  return marked((e, elements, chart) =>
    fn.call(
      chart,
      e?.native ? e.native : e,
      elements.map((el) => toV2Element(el, chart))
    )
  )
}

// v2 plugin hooks got (chart, options), (chart, easing, options) or (chart, event, options);
// v4 hooks always get (chart, args, options).
const optionsLast = (fn) =>
  function (chart, _args, options) {
    return fn.call(this, chart, options)
  }
const easing = (fn) =>
  function (chart, _args, options) {
    return fn.call(this, chart, 1, options)
  }
const event = (fn) =>
  function (chart, args, options) {
    return fn.call(this, chart, args.event, options)
  }
const resize = (fn) =>
  function (chart, args, options) {
    return fn.call(this, chart, args.size, options)
  }

const HOOKS = {
  afterDatasetsDraw: easing,
  afterDatasetsUpdate: optionsLast,
  afterDraw: easing,
  afterEvent: event,
  afterInit: optionsLast,
  afterLayout: optionsLast,
  afterRender: optionsLast,
  afterScaleUpdate: optionsLast,
  afterUpdate: optionsLast,
  beforeDatasetsDraw: easing,
  beforeDatasetsUpdate: optionsLast,
  beforeDraw: easing,
  beforeEvent: event,
  beforeInit: optionsLast,
  beforeLayout: optionsLast,
  beforeRender: optionsLast,
  beforeUpdate: optionsLast,
  destroy: optionsLast,
  reset: optionsLast,
  resize,
}
const RENAMED_HOOKS = { afterScaleUpdate: 'afterLayout', destroy: 'afterDestroy' }

let pluginCount = 0

/** A v4 plugin with the v2 hooks of `p` adapted to the v4 signatures. */
export function translatePlugin(p) {
  if (!p || p._v2Translated) return p
  const out = Object.create(Object.getPrototypeOf(p))
  for (const [name, value] of Object.entries(p)) {
    const wrap = typeof value === 'function' && HOOKS[name]
    if (wrap) out[RENAMED_HOOKS[name] || name] = wrap(value)
    else out[name] = value
  }
  if (!out.id) {
    pluginCount++
    out.id = `chartjs-compat-v2-plugin-${pluginCount}`
  }
  Object.defineProperty(out, '_v2Translated', { value: true })
  return out
}
