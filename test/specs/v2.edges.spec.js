import { afterEach, describe, expect, it, vi } from 'vitest'

import { translatePlugin } from '../../src/v2/callbacks.js'
import { parseFontStyle } from '../../src/v2/fonts.js'
import Chart, { upgradeConfig } from '../../src/v2/index.js'

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

const data = () => ({ datasets: [{ data: [1, 2, 3] }], labels: ['a', 'b', 'c'] })

describe('v2 edge cases', () => {
  it('keeps plugin methods named like Object.prototype members', () => {
    const ownValueOf = () => 7
    const ownToString = () => 'mine'
    const out = translatePlugin({ id: 'p', toString: ownToString, valueOf: ownValueOf })
    expect(out.valueOf).toBe(ownValueOf)
    expect(out.toString).toBe(ownToString)
  })

  it('gives the v2 resize hook the new size', () => {
    const resize = vi.fn()
    const chart = create({ data: data(), plugins: [{ id: 'r', resize }], type: 'line' })
    chart.resize(300, 150)
    expect(resize.mock.calls.at(-1)[1]).toMatchObject({ height: 150, width: 300 })
  })

  it('maps Chart.defaults.global.defaultFontStyle as v2 did', () => {
    const font = { ...Chart.defaults.font }
    Chart.defaults.global.defaultFontStyle = '600'
    expect(Chart.defaults.font).toMatchObject({ style: 'normal', weight: 'bold' })
    Chart.defaults.global.defaultFontStyle = 'oblique'
    expect(Chart.defaults.font).toMatchObject({ style: 'normal', weight: 'normal' })
    Chart.defaults.global.defaultFontStyle = 'bold italic'
    expect(Chart.defaults.font).toMatchObject({ style: 'italic', weight: 'bold' })
    Object.assign(Chart.defaults.font, font)
  })

  it('parses the font style of v2 element options', () => {
    expect(parseFontStyle('600')).toEqual({ style: 'normal', weight: '600' })
    expect(parseFontStyle('oblique lighter')).toEqual({ style: 'oblique', weight: 'lighter' })
  })

  it('leaves a dataset axis id alone when no axis is configured for it', () => {
    const { config } = upgradeConfig({
      data: { datasets: [{ xAxisID: 'x-axis-0' }, { xAxisID: 'constructor' }] },
      options: { scales: { xAxes: [] } },
      type: 'line',
    })
    expect(config.data.datasets.map((d) => d.xAxisID)).toEqual(['x-axis-0', 'constructor'])
  })

  it('returns what a scriptable tick color returns for ticks without a major/minor color', () => {
    const chart = create({
      data: data(),
      options: {
        scales: { xAxes: [{ ticks: { fontColor: () => undefined, major: { fontColor: 'red' } } }] },
      },
      type: 'line',
    })
    const x = chart.scales.x
    expect(x.options.ticks.setContext(x.getContext(0)).color).toBeUndefined()
  })

  it('maps update({duration: 0}) to an update without animation', () => {
    const chart = create({ data: data(), type: 'line' })
    const update = vi.spyOn(Object.getPrototypeOf(Chart.prototype), 'update')
    chart.update({ duration: 0 })
    expect(update.mock.calls[0][0]).toBe('none')
    update.mockRestore()
  })

  it('returns every element at the x position from getElementsAtXAxis', async () => {
    const chart = create({
      data: { datasets: [{ data: [1, 2] }, { data: [10, 20] }], labels: ['a', 'b'] },
      type: 'bar',
    })
    const bar = chart.getDatasetMeta(0).data[1]
    const rect = chart.canvas.getBoundingClientRect()
    const elements = await new Promise((resolve) => {
      chart.canvas.addEventListener('click', (event) => resolve(chart.getElementsAtXAxis(event)), {
        once: true,
      })
      chart.canvas.dispatchEvent(
        new MouseEvent('click', {
          clientX: rect.left + bar.x,
          clientY: rect.top + chart.chartArea.top + 5,
        })
      )
    })
    expect(elements.map((el) => [el._datasetIndex, el._index])).toEqual([
      [0, 1],
      [1, 1],
    ])
  })

  it('gives radial tooltip items the value as yLabel', () => {
    const label = vi.fn(() => '')
    const chart = create({
      data: { datasets: [{ data: [3, 4] }], labels: ['a', 'b'] },
      options: { tooltips: { callbacks: { label } } },
      type: 'polarArea',
    })
    chart.tooltip.setActiveElements([{ datasetIndex: 0, index: 1 }], { x: 0, y: 0 })
    chart.update()
    expect(label.mock.calls[0][0]).toMatchObject({ value: '4', xLabel: 'b', yLabel: 4 })
  })

  it('labels 5eN log ticks', () => {
    const chart = create({
      data: { datasets: [{ data: [1, 100000] }], labels: ['a', 'b'] },
      options: { scales: { yAxes: [{ type: 'logarithmic' }] } },
      type: 'line',
    })
    // the formatter decides per tick: 50 is labelled, 60 is not
    const fmt = chart.scales.y.options.ticks.callback
    const ticks = [10, 50, 60, 100].map((value) => ({ value }))
    expect(
      ticks.map((t, i) => fmt(t.value, i + 1, [{ value: 1 }, ...ticks, { value: 1000 }]))
    ).toEqual(['1e+1', '5e+1', '', '1e+2'])
  })
})
