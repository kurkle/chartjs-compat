// v2-shaped views over v4 option objects, so v2 code that reads or mutates
// `chart.options.scales.yAxes[0].ticks.max` or `Chart.defaults.global.legend.position` keeps working.
// Reads and writes of v2 paths are translated with the same functions that translate configs:
// a write translates a one-key snippet and merges it; a read finds where a marker value lands.
import { parseGlobalFontStyle } from './fonts.js'
import { translateScale } from './scales.js'
import { translateOptions } from './translate.js'
import { getIn, isPlainObject, merge, setIn, warn } from './util.js'

class Marker {}

function findPath(obj, marker, path = []) {
  if (obj === marker) return path
  if (!obj || typeof obj !== 'object') return null
  for (const k of Object.keys(obj)) {
    const r = findPath(obj[k], marker, [...path, k])
    if (r) return r
  }
  return null
}

const cache = new Map()

/** Where the v2 `path` lands after translation with T, or null when T drops it. */
export function mapPath(T, path) {
  const key = `${T.cacheKey || T.name}:${path.join('\u0000')}`
  if (cache.has(key)) return cache.get(key)
  const marker = new Marker()
  let out
  try {
    out = findPath(T(setIn({}, path, marker)), marker)
  } catch (_e) {
    out = null
  }
  if (cache.size < 5000) cache.set(key, out)
  return out
}

/** The underlying object's own descriptor, made configurable (proxy invariant for a dummy target). */
function ownDescriptor(obj, k) {
  const d = obj ? Reflect.getOwnPropertyDescriptor(obj, k) : undefined
  return d
    ? { configurable: true, enumerable: d.enumerable !== false, value: obj[k], writable: true }
    : undefined
}

/**
 * Proxy traps that answer the structural questions (keys, `in`, descriptors, prototype) from
 * the object getTarget() returns, which may be missing.
 */
function forwardTo(getTarget) {
  return {
    deleteProperty(_, k) {
      const target = getTarget()
      if (target) delete target[k]
      return true
    },
    getOwnPropertyDescriptor: (_, k) => ownDescriptor(getTarget(), k),
    getPrototypeOf() {
      const target = getTarget()
      return target && typeof target === 'object' ? Object.getPrototypeOf(target) : Object.prototype
    },
    has(_, k) {
      const target = getTarget()
      return !!target && k in target
    },
    ownKeys() {
      const target = getTarget()
      return target ? Reflect.ownKeys(target) : []
    },
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * A view of getRoot() as seen through v2 paths below prefix. Every key is translated with T,
 * which maps a v2 snippet (relative to the root) to a v4 snippet.
 */
export function makeView(getRoot, T, prefix = [], opts = {}) {
  const current = () => {
    const p = prefix.length ? mapPath(T, prefix) : []
    return p ? getIn(getRoot(), p) : undefined
  }
  const read = (k) => {
    const p = [...prefix, k]
    const v4p = mapPath(T, p)
    if (!v4p) return undefined
    const value = getIn(getRoot(), v4p)
    if (typeof value === 'function' && opts.wrapFunction) return opts.wrapFunction(p, value)
    const container = value === undefined && opts.containers?.has(k)
    return isObj(value) || container ? makeView(getRoot, T, p, opts) : value
  }
  return new Proxy(
    {},
    {
      ...forwardTo(current),
      deleteProperty(_, k) {
        const p = mapPath(T, [...prefix, k])
        const parent = p && getIn(getRoot(), p.slice(0, -1))
        if (parent) delete parent[p[p.length - 1]]
        return true
      },
      get: (_, k) => (typeof k === 'symbol' ? current()?.[k] : read(k)),
      ownKeys() {
        const c = current()
        return c ? Reflect.ownKeys(c).filter((k) => typeof k === 'string') : []
      },
      set(_, k, value) {
        merge(getRoot(), T(setIn({}, [...prefix, k], value)))
        return true
      },
    }
  )
}

// Keys that come back as (empty) views when missing, so `x.gridLines.color = ...` can be written.
const CONTAINERS = new Set([
  'legend',
  'title',
  'tooltips',
  'callbacks',
  'gridLines',
  'scaleLabel',
  'rectangle',
])
const SCALE_CONTAINERS = new Set([
  ...CONTAINERS,
  'ticks',
  'time',
  'pointLabels',
  'angleLines',
  'major',
  'minor',
])
const ROOT_V2 = new Set([
  'legend',
  'title',
  'tooltips',
  'scale',
  'cutoutPercentage',
  'showLines',
  'responsiveAnimationDuration',
])
const isAxisKey = (k) => k === 'xAxes' || k === 'yAxes'

const scaleT = function scale(snippet) {
  return translateScale(snippet, 'scale').scale
}

/** A view of one scale's options through v2 scale paths. */
export function scaleView(getScale) {
  return makeView(getScale, scaleT, [], { containers: SCALE_CONTAINERS })
}

/** The object at root[key], created when missing. */
function ensure(root, key) {
  if (!root[key]) root[key] = {}
  return root[key]
}

/**
 * The v2 view of options.scales: `xAxes` / `yAxes` arrays of scale views over the keyed v4 scales.
 * state.axisIds maps 'xAxes' / 'yAxes' to the v4 scale ids, in v2 array order.
 */
function scalesView(getRoot, state) {
  const scalesRoot = () => ensure(getRoot(), 'scales')
  const scaleViewOf = (id) => scaleView(() => ensure(scalesRoot(), id))

  /** Translates v2 scales (with xAxes / yAxes arrays) and records the v4 ids of each array. */
  const translateScalesValue = (value) => {
    const scales = translateOptions({ scales: value }, state.v2type, state.ids).options.scales
    for (const key of ['xAxes', 'yAxes']) {
      if (key in value)
        state.axisIds[key] = Object.keys(scales).filter(
          (id) => (scales[id].axis || id[0]) === key[0]
        )
    }
    return scales
  }

  /** options.scales.yAxes[i] = {...}: v2 code assigns whole axes. */
  const assignAxis = (key, i, value) => {
    const ids = state.axisIds[key]
    if (!ids[i]) ids[i] = i === 0 ? key[0] : `${key[0]}-axis-${i}`
    const id = ids[i]
    const { scale } = translateScale(value || {}, `options.scales.${key}[${i}]`)
    if (id !== key[0]) scale.axis = key[0]
    scalesRoot()[id] = scale
    return scaleViewOf(id)
  }

  const axisArray = (key) => {
    if (!state.axisIds[key]) state.axisIds[key] = [key[0]]
    return new Proxy(state.axisIds[key].map(scaleViewOf), {
      set(arr, k, value) {
        const i = Number(k)
        if (k === 'length' || !Number.isInteger(i)) return Reflect.set(arr, k, value)
        arr[i] = assignAxis(key, i, value)
        return true
      },
    })
  }

  const scales = new Proxy(
    {},
    {
      ...forwardTo(() => getRoot().scales),
      get: (_, k) => (isAxisKey(k) ? axisArray(k) : getRoot().scales?.[k]),
      set(_, k, value) {
        if (isAxisKey(k)) Object.assign(scalesRoot(), translateScalesValue({ [k]: value }))
        else scalesRoot()[k] = value
        return true
      },
    }
  )
  return { scales, scalesRoot, scaleViewOf, translateScalesValue }
}

/**
 * The v2 view of a chart's options object (the user's config.options, or chart.options).
 * state.axisIds maps 'xAxes' / 'yAxes' to the v4 scale ids, in v2 array order.
 */
export function optionsView(getRoot, state) {
  const T = function options(snippet) {
    return translateOptions(snippet, state.v2type, state.ids).options
  }
  T.cacheKey = `options:${state.v2type}`
  const { scales, scalesRoot, scaleViewOf, translateScalesValue } = scalesView(getRoot, state)
  const v2keys = makeView(getRoot, T, [], { containers: CONTAINERS })
  const radial = scaleViewOf('r')

  const special = {
    __v2view: () => true,
    scale: () => (getRoot().scales?.r ? radial : undefined),
    scales: () => (getRoot().scales ? scales : undefined),
  }
  const read = (k) => {
    if (Object.hasOwn(special, k)) return special[k]()
    return ROOT_V2.has(k) ? v2keys[k] : getRoot()[k]
  }
  const write = (k, value) => {
    if (k === 'scale') merge(scalesRoot(), { r: translateScale(value, 'options.scale').scale })
    else if (k === 'scales' && isPlainObject(value) && Object.keys(value).some(isAxisKey)) {
      getRoot().scales = translateScalesValue(value)
    } else if (ROOT_V2.has(k)) v2keys[k] = value
    else getRoot()[k] = value
  }

  return new Proxy(
    {},
    {
      ...forwardTo(getRoot),
      get: (_, k) => read(k),
      set(_, k, value) {
        write(k, value)
        return true
      },
    }
  )
}

const GLOBAL_FONT = {
  defaultFontColor: ['color'],
  defaultFontFamily: ['font', 'family'],
  defaultFontSize: ['font', 'size'],
  defaultLineHeight: ['font', 'lineHeight'],
}

/** Translates a v2-only global key (defaultFont*, defaultColor) into out; false for the others. */
function translateGlobalKey(out, k, value) {
  if (GLOBAL_FONT[k]) {
    setIn(out, GLOBAL_FONT[k], value)
    warn(`Chart.defaults.global.${k} is now Chart.defaults.${GLOBAL_FONT[k].join('.')}`)
  } else if (k === 'defaultFontStyle') {
    out.font = { ...(out.font || {}), ...parseGlobalFontStyle(value) }
  } else if (k === 'defaultColor') {
    out.backgroundColor = value
    out.borderColor = value
    warn('Chart.defaults.global.defaultColor is now Chart.defaults.backgroundColor / borderColor')
  } else {
    return false
  }
  return true
}

/** v2 code calls the default legend handlers as fn.call(legend, e, item); v4 wants legend as 3rd argument. */
function wrapDefaultFunction(path, fn) {
  if (path[0] !== 'legend' || !/^on(Click|Hover|Leave)$/.test(path[1])) return fn
  return function (e, item, legend) {
    return fn.call(this, e, item, legend || this)
  }
}

/** Chart.defaults.global */
export function globalDefaultsView(Chart) {
  const T = function global(snippet) {
    const out = {}
    const rest = {}
    for (const [k, value] of Object.entries(snippet)) {
      if (!translateGlobalKey(out, k, value)) rest[k] = value
    }
    return merge(out, translateOptions(rest, null).options)
  }
  return makeView(() => Chart.defaults, T, [], {
    containers: CONTAINERS,
    wrapFunction: wrapDefaultFunction,
  })
}

/** Chart.defaults.line etc. -> Chart.overrides.line */
export function typeDefaultsView(Chart, type) {
  const v4type = type === 'horizontalBar' ? 'bar' : type
  const T = {
    [type](snippet) {
      return translateOptions(snippet, v4type).options
    },
  }[type]
  return makeView(() => ensure(Chart.overrides, v4type), T, [], { containers: CONTAINERS })
}
