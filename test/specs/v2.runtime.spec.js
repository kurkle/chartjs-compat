import { afterEach, describe, expect, it, vi } from 'vitest'

import Chart from '../../src/v2/index.js'

Chart.defaults.animation = false

const charts = []
function create(config) {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 200
  document.body.appendChild(canvas)
  config.options = config.options || {}
  config.options.responsive = false
  const chart = new Chart(canvas, config)
  charts.push(chart)
  return chart
}

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const canvas = chart.canvas
    chart.destroy()
    canvas?.remove()
  }
})

const lineConfig = () => ({
  data: { datasets: [{ data: [1, 2000, 3], label: 'D' }], labels: ['a', 'b', 'c'] },
  options: { scales: { yAxes: [{ ticks: { beginAtZero: true } }] } },
  type: 'line',
})

describe('v2 runtime', () => {
  it('draws a v2 config with its scales and the v2 scale ids', () => {
    const chart = create(lineConfig())
    expect(chart.scales.y.min).toBe(0)
    expect(chart.scales['y-axis-0']).toBe(chart.scales.y)
    expect(chart.chart).toBe(chart)
  })

  it('applies writes through the v2 option paths of chart.options and the user config', () => {
    const config = lineConfig()
    const chart = create(config)
    chart.options.scales.yAxes[0].ticks.max = 5000
    config.options.legend.position = 'left'
    chart.update()
    expect(chart.scales.y.max).toBe(5000)
    expect(chart.legend.position).toBe('left')
    expect(chart.options.scales.yAxes[0].ticks.max).toBe(5000)
  })

  it('replaces a whole axis assigned into the v2 array', () => {
    const chart = create(lineConfig())
    chart.options.scales.yAxes[0] = { type: 'logarithmic' }
    chart.update()
    expect(chart.scales.y.type).toBe('logarithmic')
  })

  it('translates datasets added after creation', () => {
    const chart = create(lineConfig())
    chart.data.datasets.push({ data: [3, 2, 1], lineTension: 0 })
    chart.update()
    expect(chart.getDatasetMeta(1).dataset.options.tension).toBe(0)
  })

  it('maps update(duration) to an update mode', () => {
    const chart = create(lineConfig())
    const update = vi.spyOn(Object.getPrototypeOf(Chart.prototype), 'update')
    chart.update(0)
    chart.update({ duration: 400 })
    expect(update.mock.calls.map((c) => c[0])).toEqual(['none', undefined])
    update.mockRestore()
  })

  it('restores the v2 look: curved lines, unformatted numbers', () => {
    const chart = create(lineConfig())
    expect(chart.getDatasetMeta(0).dataset.options.tension).toBe(0.4)
    expect(chart.scales.y.ticks.some((t) => t.label === '2000')).toBe(true)
  })

  it('passes v2 tooltip items and data to tooltip callbacks', () => {
    const label = vi.fn(() => 'L')
    const config = lineConfig()
    config.options.tooltips = { callbacks: { label } }
    const chart = create(config)
    chart.tooltip.setActiveElements([{ datasetIndex: 0, index: 1 }], { x: 0, y: 0 })
    chart.update()
    const [item, data] = label.mock.calls[0]
    expect(item).toMatchObject({
      datasetIndex: 0,
      index: 1,
      label: 'b',
      value: '2000',
      xLabel: 'b',
      yLabel: 2000,
    })
    expect(data).toBe(chart.data)
    expect(chart.tooltip.body[0].lines).toEqual(['L'])
  })

  it('gives the default v2 tooltip label with the unformatted value', () => {
    const chart = create(lineConfig())
    chart.tooltip.setActiveElements([{ datasetIndex: 0, index: 1 }], { x: 0, y: 0 })
    chart.update()
    expect(chart.tooltip.body[0].lines).toEqual(['D: 2000'])
  })

  it('calls inline plugins with the v2 hook signatures', () => {
    const calls = []
    const config = lineConfig()
    config.options.plugins = { probe: { a: 1 } }
    config.plugins = [
      {
        afterDraw: (_chart, easing, options) => calls.push(['afterDraw', easing, options.a]),
        afterInit: (_chart, options) => calls.push(['afterInit', options.a]),
        id: 'probe',
      },
    ]
    create(config)
    expect(calls[0]).toEqual(['afterInit', 1])
    expect(calls).toContainEqual(['afterDraw', 1, 1])
  })

  it('returns v2 elements from getElementAtEvent', () => {
    const chart = create(lineConfig())
    const point = chart.getDatasetMeta(0).data[1]
    const rect = chart.canvas.getBoundingClientRect()
    let el
    chart.canvas.addEventListener('click', (event) => {
      el = chart.getElementAtEvent(event)[0]
    })
    chart.canvas.dispatchEvent(
      new MouseEvent('click', { clientX: rect.left + point.x, clientY: rect.top + point.y })
    )
    expect(el._index).toBe(1)
    expect(el._datasetIndex).toBe(0)
    expect(el._model.x).toBe(point.x)
    expect(el._chart).toBe(chart)
  })

  it('generates the v2 HTML legend', () => {
    const chart = create(lineConfig())
    expect(chart.generateLegend()).toMatch(
      /^<ul class="\d+-legend"><li><span[^>]*><\/span>D<\/li><\/ul>$/
    )
  })

  it('destroys a chart that already used the canvas, as v2 code expects to reuse it', () => {
    const first = create(lineConfig())
    const second = new Chart(first.canvas, lineConfig())
    charts.push(second)
    expect(first.canvas).toBeNull()
    expect(Chart.getChart(second.canvas)).toBe(second)
  })

  it('supports the v2 chart constructors', () => {
    const canvas = document.createElement('canvas')
    const chart = Chart.Line(canvas, {
      data: { datasets: [], labels: [] },
      options: { responsive: false },
    })
    charts.push(chart)
    expect(chart.config.type).toBe('line')
  })

  it('aliases Chart.defaults.global and the type defaults', () => {
    const legend = Chart.defaults.plugins.legend
    const before = legend.position
    Chart.defaults.global.legend.position = 'right'
    expect(legend.position).toBe('right')
    expect(Chart.defaults.global.legend.position).toBe('right')
    legend.position = before

    const size = Chart.defaults.font.size
    Chart.defaults.global.defaultFontSize = 15
    expect(Chart.defaults.font.size).toBe(15)
    Chart.defaults.font.size = size

    Chart.defaults.line.spanGaps = true
    expect(Chart.overrides.line.spanGaps).toBe(true)
    delete Chart.overrides.line.spanGaps
  })

  it('wraps the default legend click handler for v2 callers', () => {
    const chart = create(lineConfig())
    Chart.defaults.global.legend.onClick.call(
      chart.legend,
      new MouseEvent('click'),
      chart.legend.legendItems[0]
    )
    expect(chart.isDatasetVisible(0)).toBe(false)
  })

  it('registers v2 plugins through Chart.plugins', () => {
    const seen = []
    const plugin = { beforeInit: (_chart, options) => seen.push(options) }
    Chart.plugins.register(plugin)
    create(lineConfig())
    Chart.plugins.unregister(Chart.plugins.getAll().find((p) => p.beforeInit && seen.length))
    expect(seen).toHaveLength(1)
  })

  it('toggles doughnut arcs through meta.data[i].hidden', () => {
    const chart = create({
      data: { datasets: [{ data: [1, 2] }], labels: ['a', 'b'] },
      type: 'doughnut',
    })
    const meta = chart.getDatasetMeta(0)
    meta.data[0].hidden = true
    chart.update()
    expect(chart.getDataVisibility(0)).toBe(false)
    expect(meta.data[0].hidden).toBe(true)
  })
})
