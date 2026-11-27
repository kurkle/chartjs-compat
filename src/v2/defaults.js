// Puts back the v2 defaults that v3/v4 changed, so an untouched v2 config draws the same chart.

import { toV2TooltipItem } from './adapters.js'
import { zeroAware } from './translate.js'

const set = (obj, key, value) => {
  if (obj) obj[key] = value
}

export function applyV2Defaults(Chart) {
  const d = Chart.defaults
  const o = Chart.overrides

  // Lines were curved and filled by default.
  d.elements.line.tension = 0.4
  d.elements.line.fill = true
  set(d.datasets.radar, 'tension', 0)

  // v2 drew every fill before any line, so lines stay on top of other datasets' fills.
  if (d.plugins.filler) d.plugins.filler.drawTime = 'beforeDatasetsDraw'

  // v2 legends showed the border color for datasets with fill: false.
  const labels = d.plugins.legend?.labels
  if (labels?.generateLabels && !labels.generateLabels._v2) {
    const generate = labels.generateLabels
    labels.generateLabels = function (chart) {
      const items = generate.call(this, chart)
      for (const item of items) {
        if (item.datasetIndex === undefined) continue
        const meta = chart.getDatasetMeta(item.datasetIndex)
        const fill = meta.dataset?.options ? meta.dataset.options.fill : undefined
        if (meta.dataset && (fill === false || fill === null)) item.fillStyle = item.strokeStyle
      }
      return items
    }
    labels.generateLabels._v2 = true
  }

  // The colors plugin did not exist; uncolored datasets were gray.
  if (d.plugins.colors) d.plugins.colors.enabled = false

  // Scales: 10px tick marks, no tick padding, darker zero line, bar value axes not forced to 0.
  d.scale.grid.tickLength = 10
  d.scale.ticks.padding = 0
  d.scale.grid.color = zeroAware('rgba(0,0,0,0.1)', 'rgba(0,0,0,0.25)')
  if (o.bar?.scales?._value_) o.bar.scales._value_.beginAtZero = false
  // v2 formatted numbers with toFixed (300000), v4 with Intl.NumberFormat (300,000).
  const linear = (value, _index, ticks) => {
    const values = ticks.map((t) => t.value)
    let delta = values.length > 3 ? values[2] - values[1] : values[1] - values[0]
    if (Math.abs(delta) > 1 && value !== Math.floor(value)) delta = value - Math.floor(value)
    if (value === 0) return '0'
    const logDelta = Math.log10(Math.abs(delta))
    const maxTick = Math.max(Math.abs(values[0]), Math.abs(values[values.length - 1]))
    if (maxTick < 1e-4) {
      const n = Math.floor(Math.log10(Math.abs(value))) - Math.floor(logDelta)
      return value.toExponential(Math.max(Math.min(n, 20), 0))
    }
    return value.toFixed(Math.max(Math.min(-1 * Math.floor(logDelta), 20), 0))
  }
  for (const t of ['linear', 'radialLinear']) if (d.scales[t]) d.scales[t].ticks.callback = linear

  // v2 labelled log scales 1e+N, 2e+N, 5e+N and the first and last tick.
  if (d.scales.logarithmic) {
    d.scales.logarithmic.ticks.callback = (value, index, ticks) => {
      if (value === 0) return '0'
      const remain = value / 10 ** Math.floor(Math.log10(value))
      if (remain === 1 || remain === 2 || remain === 5 || index === 0 || index === ticks.length - 1)
        return value.toExponential()
      return ''
    }
  }
  for (const t of ['time', 'timeseries']) if (d.scales[t]) d.scales[t].ticks.autoSkip = false

  // Round charts took the canvas aspect ratio (default 2), not 1.
  for (const t of ['doughnut', 'pie', 'polarArea', 'radar']) if (o[t]) delete o[t].aspectRatio

  // Line and bar hovered all items at the index.
  for (const t of ['line', 'bar']) if (o[t]) o[t].hover = { mode: 'index', ...(o[t].hover || {}) }

  // v2 tooltip label: "<dataset label>: <unformatted value>"
  d.plugins.tooltip.callbacks.label = (item) => {
    let label = item.dataset.label || ''
    if (label) label += ': '
    return label + toV2TooltipItem(item).value
  }

  // Chart type tooltip callbacks that v4 dropped.
  const tooltip = (type, callbacks) => {
    if (!o[type]) return
    o[type].plugins = o[type].plugins || {}
    o[type].plugins.tooltip = o[type].plugins.tooltip || {}
    o[type].plugins.tooltip.callbacks = {
      ...callbacks,
      ...(o[type].plugins.tooltip.callbacks || {}),
    }
  }
  const noTitle = () => ''
  tooltip('scatter', {
    label: (item) => `(${item.parsed.x}, ${item.parsed.y})`,
    title: noTitle,
  })
  tooltip('bubble', {
    label: (item) =>
      (item.dataset.label || '') +
      ': (' +
      item.parsed.x +
      ', ' +
      item.parsed.y +
      ', ' +
      item.raw.r +
      ')',
    title: noTitle,
  })
  const roundLabel = (item) => {
    const label = item.chart.data.labels[item.dataIndex]
    const value = `: ${item.dataset.data[item.dataIndex]}`
    if (Array.isArray(label)) return [label[0] + value, ...label.slice(1)]
    return label + value
  }
  tooltip('doughnut', { label: roundLabel, title: noTitle })
  tooltip('pie', { label: roundLabel, title: noTitle })
  tooltip('polarArea', {
    label: (item) => `${item.chart.data.labels[item.dataIndex]}: ${item.parsed.r}`,
    title: noTitle,
  })
}
