// Installs the v2 API on top of a v4 Chart: a Chart subclass that translates configs,
// the v2 instance methods, and the v2 statics (Chart.defaults.global, Chart.plugins, Chart.Line, ...).

import { env, toV2Element } from './adapters.js'
import { applyV2Defaults } from './defaults.js'
import { translateDataset, translatePlugin, translateScale, upgradeConfig } from './translate.js'
import { isPlainObject, merge, warn } from './util.js'
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

function axisIdsOf(v2options, ids) {
  const out = {}
  const scales = v2options?.scales
  for (const key of ['xAxes', 'yAxes']) {
    const list = scales?.[key]
    if (Array.isArray(list))
      out[key] = list.map((a, i) => ids[a?.id || `${key[0]}-axis-${i}`] || key[0])
  }
  return out
}

function defaultLegendHtml(chart) {
  const ul = document.createElement('ul')
  ul.setAttribute('class', `${chart.id}-legend`)
  const { datasets = [], labels = [] } = chart.data
  const round = ['doughnut', 'pie', 'polarArea'].includes(chart.config.type)
  const items = round
    ? datasets[0]
      ? datasets[0].data.map((_, i) => ({
          color: [].concat(datasets[0].backgroundColor)[i],
          label: labels[i],
        }))
      : []
    : datasets.map((ds) => ({ color: ds.backgroundColor, label: ds.label }))
  for (const it of items) {
    const li = ul.appendChild(document.createElement('li'))
    const span = li.appendChild(document.createElement('span'))
    span.style.backgroundColor = it.color
    if (it.label) li.appendChild(document.createTextNode(it.label))
  }
  return ul.outerHTML
}

function patchElements(Chart) {
  // The registry has the element classes in the UMD and the ESM build alike.
  const Arc = Chart.registry.getElement('arc')
  const Element = Arc && Object.getPrototypeOf(Arc)
  if (!Element || Object.hasOwn(Element.prototype, '_model')) return
  // v2 elements carried their drawn state in _model / _view; v4 keeps it on the element and its options.
  const model = function () {
    return new Proxy(
      {},
      {
        get: (_, k) => (k in this ? this[k] : this.options ? this.options[k] : undefined),
        set: (_, k, v) => {
          this[k] = v
          return true
        },
      }
    )
  }
  const own = (name, get) => ({
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
  Object.defineProperties(Element.prototype, {
    _chart: own('_chart', function () {
      return this.$context ? this.$context.chart : undefined
    }),
    _datasetIndex: own('_datasetIndex', function () {
      return this.$context ? this.$context.datasetIndex : undefined
    }),
    _index: own('_index', function () {
      return this.$context ? this.$context.dataIndex : undefined
    }),
    _model: own('_model', model),
    _view: own('_view', model),
  })
  // v2 doughnut legends toggled meta.data[i].hidden
  Object.defineProperty(Arc.prototype, 'hidden', {
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
  })
}

function patchHelpers(h) {
  if (!h) return
  const add = (name, fn) => {
    if (!(name in h)) h[name] = fn
  }
  add('extend', Object.assign)
  add('getValueOrDefault', h.valueOrDefault)
  add('getValueAtIndexOrDefault', (v, i, d) =>
    v === undefined ? d : Array.isArray(v) ? (v[i] === undefined ? d : v[i]) : v
  )
  add('valueAtIndexOrDefault', h.getValueAtIndexOrDefault)
  add('callCallback', h.callback)
  add('isArray', Array.isArray)
  add('indexOf', (arr, item) => Array.prototype.indexOf.call(arr, item))
  add('where', (arr, fn) => Array.prototype.filter.call(arr, fn))
  add('findIndex', (arr, fn, thisArg) => Array.prototype.findIndex.call(arr, fn, thisArg))
  add('min', (arr) => Math.min(...arr))
  add('max', (arr) => Math.max(...arr))
  add('toRadians', h.toRadians)
  add('toDegrees', h.toDegrees)
  add('getMaximumWidth', (el) => (h.getMaximumSize ? h.getMaximumSize(el).width : el.clientWidth))
  add('getMaximumHeight', (el) =>
    h.getMaximumSize ? h.getMaximumSize(el).height : el.clientHeight
  )
  if (!h.canvas) {
    h.canvas = {
      clear: (chart) => chart.clear(),
      clipArea: h.clipArea,
      drawPoint: h.drawPoint,
      roundedRect: h.addRoundedRectPath,
      unclipArea: h.unclipArea,
    }
  }
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

  const states = new WeakMap()

  class ChartV2 extends Chart {
    constructor(item, config = {}) {
      const canvas = item?.length && !(typeof item === 'string') ? item[0] : item
      const existing = canvas && Chart.getChart(canvas)
      if (existing) {
        warn(
          'A chart already used this canvas. v2 drew over it; v4 throws. The shim destroys the old chart — call chart.destroy() yourself.'
        )
        existing.destroy()
      }
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
      super(canvas, config)
      states.set(this, state)
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
        const tmp = { options, type: state.v2type }
        upgradeConfig(tmp)
        const translated = tmp.options
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
      if (state) {
        if (this.config.options && !this.config.options.__v2view) this.options = this.config.options
        const datasets = this.data.datasets || []
        for (let i = 0; i < datasets.length; i++)
          translateDataset(datasets[i], state.ids, state.barOptsByScale, i)
      }
      if (typeof mode === 'number' || isPlainObject(mode)) {
        const duration = typeof mode === 'number' ? mode : mode.duration
        mode = duration === 0 ? 'none' : undefined
      }
      const r = super.update(mode)
      if (state) this._aliasScales()
      return r
    }

    render() {
      return super.render()
    }

    _aliasScales() {
      // v2 code reads chart.scales['x-axis-0']
      const ids = this._v2state.ids
      for (const v2id of Object.keys(ids)) {
        const id = ids[v2id]
        if (v2id !== id && !(v2id in this.scales) && this.scales[id]) {
          Object.defineProperty(this.scales, v2id, {
            configurable: true,
            enumerable: false,
            get: () => this.scales[id],
          })
        }
      }
    }

    generateLegend() {
      const cb = this._v2state?.legendCallback
      return cb ? cb.call(this, this) : defaultLegendHtml(this)
    }

    getElementAtEvent(e) {
      return this.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false).map((el) =>
        toV2Element(el, this)
      )
    }

    getElementsAtEvent(e) {
      return this.getElementsAtEventForMode(e, 'index', { intersect: true }, false).map((el) =>
        toV2Element(el, this)
      )
    }

    getElementsAtXAxis(e) {
      return this.getElementsAtEventForMode(e, 'index', { intersect: false }, false).map((el) =>
        toV2Element(el, this)
      )
    }

    getDatasetAtEvent(e) {
      return this.getElementsAtEventForMode(e, 'dataset', { intersect: true }, false).map((el) =>
        toV2Element(el, this)
      )
    }
  }

  // ---- statics ----
  const defaults = Chart.defaults
  const globalView = globalDefaultsView(Chart)
  Object.defineProperty(defaults, 'global', {
    configurable: true,
    enumerable: false,
    get: () => globalView,
  })
  for (const type of V2_TYPES) {
    if (type in defaults) continue
    const view = typeDefaultsView(Chart, type)
    Object.defineProperty(defaults, type, {
      configurable: true,
      enumerable: false,
      get: () => view,
    })
  }
  // Chart.defaults.scale.ticks.beginAtZero and friends
  const scaleAlias = (obj, keys, prefix) => {
    for (const k of keys) {
      if (k in obj) continue
      Object.defineProperty(obj, k, {
        configurable: true,
        enumerable: false,
        get: () => undefined,
        set: (v) => {
          const snippet = {}
          let o = snippet
          for (const p of prefix) o = o[p] = {}
          o[k] = v
          merge(defaults.scale, translateScale(snippet, 'Chart.defaults.scale').scale)
        },
      })
    }
  }
  scaleAlias(defaults.scale, ['gridLines', 'scaleLabel'], [])
  scaleAlias(
    defaults.scale.ticks,
    [
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
    ],
    ['ticks']
  )

  const register = (p) => {
    for (const plugin of [].concat(p)) Chart.register(translatePlugin(plugin))
  }
  const pluginService = {
    clear: () => warn('Chart.plugins.clear() has no v4 equivalent'),
    count: () => Object.keys(Chart.registry.plugins.items).length,
    getAll: () => Object.values(Chart.registry.plugins.items),
    register,
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

  for (const type of V2_TYPES) {
    const name = type[0].toUpperCase() + type.slice(1)
    ChartV2[name] = (ctx, config) => {
      warn(`new Chart.${name}(ctx, config) is now new Chart(ctx, {type: '${type}', ...})`)
      config.type = type
      return new ChartV2(ctx, config)
    }
  }

  if (!Chart.helpers && helpers) ChartV2.helpers = helpers
  ChartV2.platform = { disableCSSInjection: true }
  const tooltipPlugin = Chart.registry.plugins.get('tooltip')
  if (tooltipPlugin && !Chart.Tooltip) {
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

  Chart.__v2compat = ChartV2
  ChartV2.__v2compat = ChartV2
  return ChartV2
}
