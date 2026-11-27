import { afterEach, describe, expect, it } from 'vitest'

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

const data = () => ({ datasets: [{ data: [1, 2] }], labels: ['a', 'b'] })

describe('v2 option views', () => {
  it('reads v2 paths of a translated config', () => {
    const config = {
      data: data(),
      options: {
        scales: { yAxes: [{ gridLines: { color: 'red' }, ticks: { max: 9 } }] },
        title: { text: 'T' },
      },
      type: 'line',
    }
    create(config)
    expect(config.options.title.text).toBe('T')
    expect(config.options.scales.yAxes[0].ticks.max).toBe(9)
    expect('plugins' in config.options).toBe(true)
    expect(Object.keys(config.options.scales)).toContain('y')
  })

  it('writes v2 title, tooltips and font options through chart.options', () => {
    const chart = create({ data: data(), type: 'line' })
    chart.options.title.display = true
    chart.options.title.text = 'New'
    chart.options.title.fontSize = 20
    chart.options.tooltips.mode = 'label'
    chart.update()
    expect(chart.titleBlock.options.text).toBe('New')
    expect(chart.titleBlock.options.font.size).toBe(20)
    expect(chart.options.plugins.tooltip.mode).toBe('index')
  })

  it('replaces the whole v2 scales object', () => {
    const chart = create({ data: data(), type: 'line' })
    chart.options.scales = { yAxes: [{ ticks: { min: -5 } }] }
    chart.update()
    expect(chart.scales.y.min).toBe(-5)
  })

  it('writes the radial scale through options.scale', () => {
    const chart = create({ data: data(), type: 'radar' })
    chart.options.scale.ticks.max = 10
    chart.update()
    expect(chart.scales.r.max).toBe(10)
    chart.options.scale = { ticks: { min: 1 } }
    chart.update()
    expect(chart.scales.r.min).toBe(1)
  })

  it('translates a replaced options object', () => {
    const chart = create({ data: data(), type: 'line' })
    chart.options = { legend: { display: false }, scales: { yAxes: [{ ticks: { max: 7 } }] } }
    chart.update()
    expect(chart.legend.options.display).toBe(false)
    expect(chart.scales.y.max).toBe(7)
  })

  it('aliases v2 scale defaults', () => {
    const before = Chart.defaults.scale.beginAtZero
    Chart.defaults.scale.ticks.beginAtZero = true
    expect(Chart.defaults.scale.beginAtZero).toBe(true)
    Chart.defaults.scale.beginAtZero = before

    Chart.scaleService.updateScaleDefaults('linear', { ticks: { suggestedMax: 50 } })
    expect(Chart.scaleService.getScaleDefaults('linear').suggestedMax).toBe(50)
    delete Chart.defaults.scales.linear.suggestedMax
  })

  it('reads functions and colors through Chart.defaults.global', () => {
    const color = Chart.defaults.color
    Chart.defaults.global.defaultFontColor = '#123'
    expect(Chart.defaults.color).toBe('#123')
    Chart.defaults.color = color

    Chart.defaults.global.defaultColor = 'rgba(1,2,3,0.5)'
    expect(Chart.defaults.backgroundColor).toBe('rgba(1,2,3,0.5)')
    Chart.defaults.backgroundColor = 'rgba(0,0,0,0.1)'
    Chart.defaults.borderColor = 'rgba(0,0,0,0.1)'

    Chart.defaults.global.elements.rectangle.borderWidth = 3
    expect(Chart.defaults.elements.bar.borderWidth).toBe(3)
    Chart.defaults.elements.bar.borderWidth = 0
    expect(typeof Chart.defaults.global.tooltips.callbacks.label).toBe('function')
  })

  it('removes options through delete on a view', () => {
    const config = { data: data(), options: { legend: { position: 'left' } }, type: 'line' }
    create(config)
    delete config.options.legend.position
    expect(config.options.plugins.legend.position).toBeUndefined()
  })

  it('exposes the v2 helper names', () => {
    const h = Chart.helpers
    expect(h.extend({}, { a: 1 })).toEqual({ a: 1 })
    expect(h.getValueAtIndexOrDefault([1, 2], 1, 0)).toBe(2)
    expect(h.getValueAtIndexOrDefault(undefined, 1, 5)).toBe(5)
    expect(h.where([1, 2, 3], (v) => v > 1)).toEqual([2, 3])
    expect(h.max([1, 5, 2])).toBe(5)
    expect(h.color('red').alpha(0.5).rgbString()).toBe('rgba(255, 0, 0, 0.5)')
  })
})
