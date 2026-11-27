// v2-shaped views over v4 option objects, so v2 code that reads or mutates
// `chart.options.scales.yAxes[0].ticks.max` or `Chart.defaults.global.legend.position` keeps working.
// Reads and writes of v2 paths are translated with the same functions that translate configs:
// a write translates a one-key snippet and merges it; a read finds where a marker value lands.

import { translateOptions, translateScale } from './translate.js'
import { getIn, isPlainObject, merge, setIn, warn } from './util.js'

class Marker {}

function findPath(obj, marker, path = []) {
  if (obj === marker) return path
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const r = findPath(obj[k], marker, [...path, k])
      if (r) return r
    }
  }
  return null
}

const cache = new Map()
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
  if (!obj) return undefined
  const d = Reflect.getOwnPropertyDescriptor(obj, k)
  return d
    ? { configurable: true, enumerable: d.enumerable !== false, value: obj[k], writable: true }
    : undefined
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * A view of getRoot() as seen through v2 paths below prefix. Every key is translated with T,
 * which maps a v2 snippet (relative to the root) to a v4 snippet.
 */
export function makeView(getRoot, T, prefix = [], opts = {}) {
  const v4prefix = () => (prefix.length ? mapPath(T, prefix) : [])
  const current = () => {
    const p = v4prefix()
    return p ? getIn(getRoot(), p) : undefined
  }
  return new Proxy(
    {},
    {
      deleteProperty(_, k) {
        const p = mapPath(T, [...prefix, k])
        if (p) {
          const parent = getIn(getRoot(), p.slice(0, -1))
          if (parent) delete parent[p[p.length - 1]]
        }
        return true
      },
      get(_, k) {
        if (typeof k === 'symbol') {
          const c = current()
          return c ? c[k] : undefined
        }
        const p = [...prefix, k]
        if (opts.special) {
          const r = opts.special(p)
          if (r !== undefined) return r
        }
        const v4p = mapPath(T, p)
        if (!v4p) return undefined
        const value = getIn(getRoot(), v4p)
        if (typeof value === 'function' && opts.wrapFunction) return opts.wrapFunction(p, value)
        if (isObj(value) || (value === undefined && opts.containers && opts.containers.has(k))) {
          return makeView(getRoot, T, p, opts)
        }
        return value
      },
      getOwnPropertyDescriptor(_, k) {
        return ownDescriptor(current(), k)
      },
      getPrototypeOf() {
        const c = current()
        return c && typeof c === 'object' ? Object.getPrototypeOf(c) : Object.prototype
      },
      has(_, k) {
        const c = current()
        return !!c && k in c
      },
      ownKeys() {
        const c = current()
        return c ? Reflect.ownKeys(c).filter((k) => typeof k === 'string') : []
      },
      set(_, k, value) {
        const snippet = T(setIn({}, [...prefix, k], value))
        merge(getRoot(), snippet)
        if (opts.onSet) opts.onSet()
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

const scaleT = function scale(snippet) {
  return translateScale(snippet, 'scale').scale
}

/** A view of one scale's options through v2 scale paths. */
export function scaleView(getScale) {
  return makeView(getScale, scaleT, [], { containers: SCALE_CONTAINERS })
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
  const scalesRoot = () => {
    const r = getRoot()
    if (!r.scales) r.scales = {}
    return r.scales
  }
  const axisArray = (key) => {
    if (!state.axisIds[key]) state.axisIds[key] = [key[0]]
    const ids = state.axisIds[key]
    const viewOf = (id) =>
      scaleView(() => {
        const s = scalesRoot()
        if (!s[id]) s[id] = {}
        return s[id]
      })
    // v2 code assigns whole axes: options.scales.yAxes[0] = {type: 'logarithmic'}
    return new Proxy(ids.map(viewOf), {
      set(arr, k, value) {
        const i = Number(k)
        if (k === 'length' || !Number.isInteger(i)) return Reflect.set(arr, k, value)
        if (!ids[i]) ids[i] = i === 0 ? key[0] : `${key[0]}-axis-${i}`
        const id = ids[i]
        const { scale } = translateScale(value || {}, `options.scales.${key}[${i}]`)
        if (id !== key[0]) scale.axis = key[0]
        scalesRoot()[id] = scale
        arr[i] = viewOf(id)
        return true
      },
    })
  }
  const scales = new Proxy(
    {},
    {
      deleteProperty(_, k) {
        const s = getRoot().scales
        if (s) delete s[k]
        return true
      },
      get(_, k) {
        if (k === 'xAxes' || k === 'yAxes') return axisArray(k)
        const s = getRoot().scales
        return s ? s[k] : undefined
      },
      getOwnPropertyDescriptor(_, k) {
        return ownDescriptor(getRoot().scales, k)
      },
      getPrototypeOf: () =>
        getRoot().scales ? Object.getPrototypeOf(getRoot().scales) : Object.prototype,
      has: (_, k) => !!getRoot().scales && k in getRoot().scales,
      ownKeys: () => (getRoot().scales ? Reflect.ownKeys(getRoot().scales) : []),
      set(_, k, value) {
        if (k === 'xAxes' || k === 'yAxes') {
          const out = translateOptions({ scales: { [k]: value } }, state.v2type, state.ids)
          const s = scalesRoot()
          for (const id of Object.keys(out.options.scales)) s[id] = out.options.scales[id]
          state.axisIds[k] = Object.keys(out.options.scales)
          return true
        }
        scalesRoot()[k] = value
        return true
      },
    }
  )
  const v2keys = makeView(getRoot, T, [], { containers: CONTAINERS })
  const radial = scaleView(() => {
    const s = scalesRoot()
    if (!s.r) s.r = {}
    return s.r
  })

  return new Proxy(
    {},
    {
      deleteProperty(_, k) {
        delete getRoot()[k]
        return true
      },
      get(_, k) {
        if (k === '__v2view') return true
        if (k === 'scales') return getRoot().scales ? scales : undefined
        if (k === 'scale') return getRoot().scales?.r ? radial : undefined
        if (ROOT_V2.has(k)) return v2keys[k]
        return getRoot()[k]
      },
      getOwnPropertyDescriptor(_, k) {
        return ownDescriptor(getRoot(), k)
      },
      getPrototypeOf: () => Object.getPrototypeOf(getRoot()),
      has: (_, k) => k in getRoot(),
      ownKeys: () => Reflect.ownKeys(getRoot()),
      set(_, k, value) {
        if (k === 'scale') {
          merge(scalesRoot(), { r: translateScale(value, 'options.scale').scale })
          return true
        }
        if (k === 'scales' && isPlainObject(value) && ('xAxes' in value || 'yAxes' in value)) {
          const out = translateOptions({ scales: value }, state.v2type, state.ids)
          getRoot().scales = out.options.scales
          for (const key of ['xAxes', 'yAxes'])
            if (key in value)
              state.axisIds[key] = Object.keys(out.options.scales).filter(
                (id) => (out.options.scales[id].axis || id[0]) === key[0]
              )
          return true
        }
        if (ROOT_V2.has(k)) {
          v2keys[k] = value
          return true
        }
        getRoot()[k] = value
        return true
      },
    }
  )
}

/** Chart.defaults.global */
export function globalDefaultsView(Chart) {
  const FONT = {
    defaultFontColor: ['color'],
    defaultFontFamily: ['font', 'family'],
    defaultFontSize: ['font', 'size'],
    defaultLineHeight: ['font', 'lineHeight'],
  }
  const T = function global(snippet) {
    const out = {}
    for (const k of Object.keys(snippet)) {
      if (FONT[k]) {
        setIn(out, FONT[k], snippet[k])
        warn(`Chart.defaults.global.${k} is now Chart.defaults.${FONT[k].join('.')}`)
      } else if (k === 'defaultFontStyle') {
        const s = String(snippet[k])
        out.font = {
          ...(out.font || {}),
          style: /italic/.test(s) ? 'italic' : 'normal',
          weight: /bold|[1-9]00/.test(s) ? 'bold' : 'normal',
        }
      } else if (k === 'defaultColor') {
        out.backgroundColor = out.borderColor = snippet[k]
        warn(
          'Chart.defaults.global.defaultColor is now Chart.defaults.backgroundColor / borderColor'
        )
      }
    }
    const rest = { ...snippet }
    for (const k of [...Object.keys(FONT), 'defaultFontStyle', 'defaultColor']) delete rest[k]
    return merge(out, translateOptions(rest, null).options)
  }
  return makeView(() => Chart.defaults, T, [], {
    containers: CONTAINERS,
    wrapFunction(path, fn) {
      // v2 code calls the default legend handlers as fn.call(legend, e, item); v4 wants legend as 3rd argument.
      if (path[0] === 'legend' && /^on(Click|Hover|Leave)$/.test(path[1])) {
        return function (e, item, legend) {
          return fn.call(this, e, item, legend || this)
        }
      }
      return fn
    },
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
  const getRoot = () => {
    if (!Chart.overrides[v4type]) Chart.overrides[v4type] = {}
    return Chart.overrides[v4type]
  }
  return makeView(getRoot, T, [], {
    containers: CONTAINERS,
  })
}
