// Installs the v2 API on top of a v4 Chart: a Chart subclass that translates configs,
// the v2 instance methods, and the v2 statics (Chart.defaults.global, Chart.plugins, Chart.Line, ...).
import { env, toV2Element } from './adapters.js'
import { translatePlugin } from './callbacks.js'
import { applyV2Defaults } from './defaults.js'
import { translateScale } from './scales.js'
import { translateDataset, upgradeConfig } from './translate.js'
import { isPlainObject, merge, setIn, warn } from './util.js'
import { globalDefaultsView, optionsView, typeDefaultsView } from './views.js'

const V2_TYPES = [
  'line',
  'bar',
  'horizontalBar',
  'radar',
  'doughnut',
  'pie',
  'polarArea',
  'bubble',
  'scatter',
]
const ROUND_TYPES = ['doughnut', 'pie', 'polarArea']

/** The v4 scale ids of the v2 xAxes / yAxes arrays, in array order. */
function axisIdsOf(v2options, ids) {
  const out = {}
  for (const key of ['xAxes', 'yAxes']) {
    const list = v2options?.scales?.[key]
    if (Array.isArray(list))
      out[key] = list.map((a, i) => ids[a?.id || `${key[0]}-axis-${i}`] || key[0])
  }
  return out
}

function legendItems(chart) {
  const { datasets = [], labels = [] } = chart.data
  if (!ROUND_TYPES.includes(chart.config.type)) {
    return datasets.map((ds) => ({ color: ds.backgroundColor, label: ds.label }))
  }
  const first = datasets[0]
  if (!first) return []
  const colors = [].concat(first.backgroundColor)
  return first.data.map((_, i) => ({ color: colors[i], label: labels[i] }))
}

/** The HTML legend of v2's default legendCallback. */
function defaultLegendHtml(chart) {
  const ul = document.createElement('ul')
  ul.setAttribute('class', `${chart.id}-legend`)
  for (const item of legendItems(chart)) {
    const li = ul.appendChild(document.createElement('li'))
    const span = li.appendChild(document.createElement('span'))
    span.style.backgroundColor = item.color
    if (item.label) li.appendChild(document.createTextNode(item.label))
  }
  return ul.outerHTML
}

/** An accessor that reads from the v4 element and becomes a plain property when written. */
const ownAccessor = (name, get) => ({
  configurable: true,
  get,
  set(v) {
    Object.defineProperty(this, name, {
      configurable: true,
      enumerable: true,
      value: v,
      writable: true,
    })
  },
})

/** v2 elements carried their drawn state in _model / _view; v4 keeps it on the element and its options. */
function modelView() {
  return new Proxy(
    {},
    {
      get: (_, k) => (k in this ? this[k] : this.options?.[k]),
      set: (_, k, v) => {
        this[k] = v
        return true
      },
    }
  )
}

const fromContext = (key) =>
  function () {
    return this.$context?.[key]
  }

/** v2 doughnut legends toggled meta.data[i].hidden. */
const arcHidden = {
  configurable: true,
  get() {
    const c = this.$context
    return c ? !c.chart.getDataVisibility(c.dataIndex) : false
  },
  set(v) {
    const c = this.$context
    if (c && !!v !== !c.chart.getDataVisibility(c.dataIndex))
      c.chart.toggleDataVisibility(c.dataIndex)
  },
}

function patchElements(Chart) {
  // The registry has the element classes in the UMD and the ESM build alike.
  const Arc = Chart.registry.getElement('arc')
  const Element = Arc && Object.getPrototypeOf(Arc)
  if (!Element || Object.hasOwn(Element.prototype, '_model')) return
  Object.defineProperties(Element.prototype, {
    _chart: ownAccessor('_chart', fromContext('chart')),
    _datasetIndex: ownAccessor('_datasetIndex', fromContext('datasetIndex')),
    _index: ownAccessor('_index', fromContext('dataIndex')),
    _model: ownAccessor('_model', modelView),
    _view: ownAccessor('_view', modelView),
  })
  Object.defineProperty(Arc.prototype, 'hidden', arcHidden)
}

function valueAtIndexOrDefault(value, index, defaultValue) {
  if (value === undefined) return defaultValue
  if (!Array.isArray(value)) return value
  return value[index] === undefined ? defaultValue : value[index]
}

/** The v2 helper names that v4 dropped or renamed. */
function patchHelpers(h) {
  if (!h) return
  const maximumSize = (el) =>
    h.getMaximumSize ? h.getMaximumSize(el) : { height: el.clientHeight, width: el.clientWidth }
  const added = {
    callCallback: h.callback,
    extend: Object.assign,
    findIndex: (arr, fn, thisArg) => Array.prototype.findIndex.call(arr, fn, thisArg),
    getMaximumHeight: (el) => maximumSize(el).height,
    getMaximumWidth: (el) => maximumSize(el).width,
    getValueAtIndexOrDefault: valueAtIndexOrDefault,
    getValueOrDefault: h.valueOrDefault,
    indexOf: (arr, item) => Array.prototype.indexOf.call(arr, item),
    isArray: Array.isArray,
    max: (arr) => Math.max(...arr),
    min: (arr) => Math.min(...arr),
    toDegrees: h.toDegrees,
    toRadians: h.toRadians,
    valueAtIndexOrDefault,
    where: (arr, fn) => Array.prototype.filter.call(arr, fn),
  }
  for (const [name, fn] of Object.entries(added)) if (!(name in h)) h[name] = fn
  h.canvas = h.canvas || {
    clear: (chart) => chart.clear(),
    clipArea: h.clipArea,
    drawPoint: h.drawPoint,
    roundedRect: h.addRoundedRectPath,
    unclipArea: h.unclipArea,
  }
}

/** v2 drew a new chart over an old one on the same canvas; v4 throws. */
function releaseCanvas(Chart, item) {
  const canvas = item?.length && typeof item !== 'string' ? item[0] : item
  const existing = canvas && Chart.getChart(canvas)
  if (existing) {
    warn(
      'A chart already used this canvas. v2 drew over it; v4 throws. The shim destroys the old chart — call chart.destroy() yourself.'
    )
    existing.destroy()
  }
  return canvas
}

/** Translates the config in place and gives it the v2 view of its options. */
function prepareConfig(config) {
  const v2options = config.options
  const result = upgradeConfig(config)
  const state = {
    axisIds: axisIdsOf(v2options, result.ids),
    barOptsByScale: result.barOptsByScale,
    ids: result.ids,
    legendCallback: config.options.legendCallback,
    v2type: result.v2type,
  }
  const translated = config.options
  config.options = optionsView(() => translated, state)
  state.configOptions = config.options
  return state
}

/** v2 update(duration) / update({duration, lazy, easing}) as a v4 update mode. */
function v4UpdateMode(mode) {
  if (typeof mode === 'number') return mode === 0 ? 'none' : undefined
  if (isPlainObject(mode)) return mode.duration === 0 ? 'none' : undefined
  return mode
}

function elementsAt(chart, e, mode, intersect) {
  return chart
    .getElementsAtEventForMode(e, mode, { intersect }, false)
    .map((el) => toV2Element(el, chart))
}

function createChartClass(Chart) {
  return class ChartV2 extends Chart {
    constructor(item, config = {}) {
      const canvas = releaseCanvas(Chart, item)
      const state = prepareConfig(config)
      super(canvas, config)
      this._v2state = state
      this._aliasScales()
    }

    get options() {
      const resolver = super.options
      const state = this._v2state
      if (!state) return resolver
      if (state.resolver !== resolver) {
        state.resolver = resolver
        state.optionsView = optionsView(() => this._options, state)
      }
      return state.optionsView
    }

    set options(options) {
      const state = this._v2state
      if (state && options && !options.__v2view) {
        const { config } = upgradeConfig({ options, type: state.v2type })
        const translated = config.options
        options = optionsView(() => translated, state)
        state.configOptions = options
      }
      super.options = options
    }

    get chart() {
      return this
    }

    update(mode) {
      const state = this._v2state
      if (state) this._translateChanges(state)
      const r = super.update(v4UpdateMode(mode))
      if (state) this._aliasScales()
      return r
    }

    /** Options replaced and datasets added since the last update. */
    _translateChanges(state) {
      if (this.config.options && !this.config.options.__v2view) this.options = this.config.options
      const datasets = this.data.datasets || []
      for (let i = 0; i < datasets.length; i++)
        translateDataset(datasets[i], state.ids, state.barOptsByScale, i)
    }

    /** v2 code reads chart.scales['x-axis-0']. */
    _aliasScales() {
      for (const [v2id, id] of Object.entries(this._v2state.ids)) {
        if (v2id === id || v2id in this.scales || !this.scales[id]) continue
        Object.defineProperty(this.scales, v2id, {
          configurable: true,
          enumerable: false,
          get: () => this.scales[id],
        })
      }
    }

    generateLegend() {
      const cb = this._v2state?.legendCallback
      return cb ? cb.call(this, this) : defaultLegendHtml(this)
    }

    getElementAtEvent(e) {
      return elementsAt(this, e, 'nearest', true)
    }

    getElementsAtEvent(e) {
      return elementsAt(this, e, 'index', true)
    }

    getElementsAtXAxis(e) {
      return elementsAt(this, e, 'index', false)
    }

    getDatasetAtEvent(e) {
      return elementsAt(this, e, 'dataset', true)
    }
  }
}

const alias = (obj, key, get, set) =>
  Object.defineProperty(obj, key, { configurable: true, enumerable: false, get, set })

const SCALE_TICK_ALIASES = [
  'beginAtZero',
  'min',
  'max',
  'suggestedMin',
  'suggestedMax',
  'reverse',
  'userCallback',
  'fontColor',
  'fontSize',
  'fontFamily',
  'fontStyle',
]

/** Chart.defaults.global, Chart.defaults.<type> and Chart.defaults.scale.ticks.beginAtZero and friends. */
function installDefaultsAliases(Chart) {
  const defaults = Chart.defaults
  const globalView = globalDefaultsView(Chart)
  alias(defaults, 'global', () => globalView)
  for (const type of V2_TYPES) {
    if (type in defaults) continue
    const view = typeDefaultsView(Chart, type)
    alias(defaults, type, () => view)
  }
  const scaleAlias = (obj, keys, prefix) => {
    for (const k of keys) {
      if (k in obj) continue
      alias(
        obj,
        k,
        () => undefined,
        (v) => {
          const snippet = setIn({}, [...prefix, k], v)
          merge(defaults.scale, translateScale(snippet, 'Chart.defaults.scale').scale)
        }
      )
    }
  }
  scaleAlias(defaults.scale, ['gridLines', 'scaleLabel'], [])
  scaleAlias(defaults.scale.ticks, SCALE_TICK_ALIASES, ['ticks'])
}

/** Chart.plugins / Chart.pluginService and Chart.scaleService. */
function installServices(Chart, ChartV2) {
  const defaults = Chart.defaults
  const pluginService = {
    clear: () => warn('Chart.plugins.clear() has no v4 equivalent'),
    count: () => Object.keys(Chart.registry.plugins.items).length,
    getAll: () => Object.values(Chart.registry.plugins.items),
    register: (p) => {
      for (const plugin of [].concat(p)) Chart.register(translatePlugin(plugin))
    },
    unregister: (p) => {
      for (const plugin of [].concat(p)) Chart.unregister(plugin)
    },
  }
  ChartV2.plugins = pluginService
  ChartV2.pluginService = pluginService
  ChartV2.scaleService = {
    getScaleDefaults: (type) => defaults.scales[type],
    updateScaleDefaults(type, v2) {
      if (!defaults.scales[type]) defaults.scales[type] = {}
      merge(defaults.scales[type], translateScale(v2, `Chart.scaleService(${type})`).scale)
    },
  }
}

/** Chart.Line(ctx, config) and the other v2 chart constructors. */
function installConstructors(ChartV2) {
  for (const type of V2_TYPES) {
    const name = type[0].toUpperCase() + type.slice(1)
    ChartV2[name] = (ctx, config) => {
      warn(`new Chart.${name}(ctx, config) is now new Chart(ctx, {type: '${type}', ...})`)
      config.type = type
      return new ChartV2(ctx, config)
    }
  }
}

/** Chart.Tooltip.positioners, whose functions v2 called with v2 elements. */
function installPositioners(Chart, ChartV2) {
  const tooltipPlugin = Chart.registry.plugins.get('tooltip')
  if (!tooltipPlugin || Chart.Tooltip) return
  const positioners = new Proxy(tooltipPlugin.positioners, {
    set(target, k, fn) {
      target[k] = function (items, pos) {
        return fn.call(
          this,
          items.map((el) => toV2Element(el, this.chart)),
          pos
        )
      }
      return true
    },
  })
  ChartV2.Tooltip = { positioners }
}

/**
 * Installs the v2 API on a Chart.js v4 Chart and returns the v2-compatible Chart.
 * `helpers` is `chart.js/helpers` for the ESM build; the UMD build carries them as Chart.helpers.
 */
export function install(Chart, { helpers = Chart.helpers } = {}) {
  if (Chart.__v2compat) return Chart.__v2compat
  env.toFont = helpers?.toFont || env.toFont
  applyV2Defaults(Chart)
  patchElements(Chart)
  patchHelpers(helpers)
  const ChartV2 = createChartClass(Chart)
  installDefaultsAliases(Chart)
  installServices(Chart, ChartV2)
  installConstructors(ChartV2)
  installPositioners(Chart, ChartV2)
  if (!Chart.helpers && helpers) ChartV2.helpers = helpers
  ChartV2.platform = { disableCSSInjection: true }
  Chart.__v2compat = ChartV2
  ChartV2.__v2compat = ChartV2
  return ChartV2
}
