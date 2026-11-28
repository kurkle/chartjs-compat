// Puts back the v2 defaults that v3/v4 changed, so an untouched v2 config draws the same chart.
import { toV2TooltipItem } from './adapters.js'
import { zeroAware } from './ticks.js'

const clamp20 = (n) => Math.max(Math.min(n, 20), 0)

/** v2 formatted numbers with toFixed (300000), v4 with Intl.NumberFormat (300,000). */
function formatLinearTick(value, _index, ticks) {
  if (value === 0) return '0'
  const values = ticks.map((t) => t.value)
  let delta = values.length > 3 ? values[2] - values[1] : values[1] - values[0]
  if (Math.abs(delta) > 1 && value !== Math.floor(value)) delta = value - Math.floor(value)
  const logDelta = Math.log10(Math.abs(delta))
  const maxTick = Math.max(Math.abs(values[0]), Math.abs(values[values.length - 1]))
  if (maxTick < 1e-4) {
    return value.toExponential(
      clamp20(Math.floor(Math.log10(Math.abs(value))) - Math.floor(logDelta))
    )
  }
  return value.toFixed(clamp20(-Math.floor(logDelta)))
}

/** v2 labelled log scales 1e+N, 2e+N, 5e+N and the first and last tick. */
function formatLogTick(value, index, ticks) {
  if (value === 0) return '0'
  const remain = value / 10 ** Math.floor(Math.log10(value))
  const shown = [1, 2, 5].includes(remain) || index === 0 || index === ticks.length - 1
  return shown ? value.toExponential() : ''
}

function isUnfilled(meta) {
  const fill = meta.dataset?.options?.fill
  return !!meta.dataset && (fill === false || fill === null)
}

/** v2 legends showed the border color for datasets with fill: false. */
function wrapGenerateLabels(generate) {
  const wrapped = function (chart) {
    const items = generate.call(this, chart)
    for (const item of items) {
      if (item.datasetIndex !== undefined && isUnfilled(chart.getDatasetMeta(item.datasetIndex))) {
        item.fillStyle = item.strokeStyle
      }
    }
    return items
  }
  wrapped._v2 = true
  return wrapped
}

function restoreElements(d) {
  // Lines were curved and filled by default; radar lines were straight.
  d.elements.line.tension = 0.4
  d.elements.line.fill = true
  if (d.datasets.radar) d.datasets.radar.tension = 0
  // v2 drew every fill before any line, so lines stay on top of other datasets' fills.
  if (d.plugins.filler) d.plugins.filler.drawTime = 'beforeDatasetsDraw'
  // The colors plugin did not exist; uncolored datasets were gray.
  if (d.plugins.colors) d.plugins.colors.enabled = false
  const labels = d.plugins.legend?.labels
  if (labels?.generateLabels && !labels.generateLabels._v2) {
    labels.generateLabels = wrapGenerateLabels(labels.generateLabels)
  }
}

function restoreScales(d, o) {
  // 10px tick marks, no tick padding, darker zero line, bar value axes not forced to 0.
  d.scale.grid.tickLength = 10
  d.scale.ticks.padding = 0
  d.scale.grid.color = zeroAware('rgba(0,0,0,0.1)', 'rgba(0,0,0,0.25)')
  if (o.bar?.scales?._value_) o.bar.scales._value_.beginAtZero = false
  for (const t of ['linear', 'radialLinear']) {
    if (d.scales[t]) d.scales[t].ticks.callback = formatLinearTick
  }
  if (d.scales.logarithmic) d.scales.logarithmic.ticks.callback = formatLogTick
  for (const t of ['time', 'timeseries']) {
    if (d.scales[t]) d.scales[t].ticks.autoSkip = false
  }
}

function restoreChartTypes(o) {
  // Round charts took the canvas aspect ratio (default 2), not 1.
  for (const t of ['doughnut', 'pie', 'polarArea', 'radar']) {
    if (o[t]) delete o[t].aspectRatio
  }
  // Line and bar hovered all items at the index.
  for (const t of ['line', 'bar']) {
    if (o[t]) o[t].hover = { mode: 'index', ...(o[t].hover || {}) }
  }
}

const noTitle = () => ''

function roundLabel(item) {
  const label = item.chart.data.labels[item.dataIndex]
  const value = `: ${item.dataset.data[item.dataIndex]}`
  if (Array.isArray(label)) return [label[0] + value, ...label.slice(1)]
  return label + value
}

/** Chart type tooltip callbacks that v4 dropped. */
const TYPE_TOOLTIPS = {
  bubble: {
    label: (item) =>
      `${item.dataset.label || ''}: (${item.parsed.x}, ${item.parsed.y}, ${item.raw.r})`,
    title: noTitle,
  },
  doughnut: { label: roundLabel, title: noTitle },
  pie: { label: roundLabel, title: noTitle },
  polarArea: {
    label: (item) => `${item.chart.data.labels[item.dataIndex]}: ${item.parsed.r}`,
    title: noTitle,
  },
  scatter: { label: (item) => `(${item.parsed.x}, ${item.parsed.y})`, title: noTitle },
}

/** v2 tooltip label: "<dataset label>: <unformatted value>". */
function defaultLabel(item) {
  const label = item.dataset.label || ''
  return (label ? `${label}: ` : '') + toV2TooltipItem(item).value
}

function restoreTooltips(d, o) {
  d.plugins.tooltip.callbacks.label = defaultLabel
  for (const [type, callbacks] of Object.entries(TYPE_TOOLTIPS)) {
    if (!o[type]) continue
    const plugins = o[type].plugins || {}
    const tooltip = plugins.tooltip || {}
    tooltip.callbacks = { ...callbacks, ...(tooltip.callbacks || {}) }
    plugins.tooltip = tooltip
    o[type].plugins = plugins
  }
}

export function applyV2Defaults(Chart) {
  const d = Chart.defaults
  const o = Chart.overrides
  restoreElements(d)
  restoreScales(d, o)
  restoreChartTypes(o)
  restoreTooltips(d, o)
}
