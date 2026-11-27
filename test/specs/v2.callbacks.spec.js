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

function hover(chart, datasetIndex, index, more = []) {
  chart.tooltip.setActiveElements([{ datasetIndex, index }, ...more], { x: 0, y: 0 })
  chart.update()
  return chart.tooltip
}

// Chart.js handles DOM events on the next animation frame.
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function click(chart, datasetIndex, index, type = 'click') {
  const el = chart.getDatasetMeta(datasetIndex).data[index]
  const p = el.tooltipPosition()
  const rect = chart.canvas.getBoundingClientRect()
  chart.canvas.dispatchEvent(
    new MouseEvent(type, { clientX: rect.left + p.x, clientY: rect.top + p.y })
  )
}

const data = () => ({ datasets: [{ data: [1, 2, 3], label: 'D' }], labels: ['a', 'b', 'c'] })

describe('v2 callbacks', () => {
  it('calls tooltips.custom with the v2 tooltip model', () => {
    const custom = vi.fn()
    const chart = create({
      data: data(),
      options: {
        tooltips: {
          bodyFontSize: 15,
          custom,
          enabled: false,
          titleFontStyle: 'italic',
          xPadding: 9,
        },
      },
      type: 'line',
    })
    hover(chart, 0, 1)
    const model = custom.mock.calls.at(-1)[0]
    expect(custom.mock.contexts.at(-1)).toBe(model)
    expect(model).toMatchObject({
      _titleFontStyle: 'italic',
      bodyFontSize: 15,
      opacity: 1,
      xPadding: 9,
    })
    expect(model._chart).toBe(chart)
    expect(model.dataPoints[0]).toMatchObject({ index: 1, xLabel: 'b', yLabel: 2 })
    expect(model.body[0].lines).toEqual(['D: 2'])
  })

  it('wraps title, footer, itemSort and filter callbacks', () => {
    const seen = {}
    const chart = create({
      data: { datasets: [{ data: [1, 2] }, { data: [3, 4] }], labels: ['a', 'b'] },
      options: {
        tooltips: {
          callbacks: {
            footer: (items) => items.map((i) => i.value).join('+'),
            labelColor: (item, c) => {
              seen.chart = c
              return { backgroundColor: 'blue', borderColor: 'red' }
            },
            title: (items, d) => `${items.length} ${d.labels[items[0].index]}`,
          },
          filter: (item, d) => d.datasets[item.datasetIndex].data[item.index] > 1,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          mode: 'index',
        },
      },
      type: 'line',
    })
    const tooltip = hover(chart, 0, 1, [{ datasetIndex: 1, index: 1 }])
    expect(tooltip.title).toEqual(['2 b'])
    expect(tooltip.dataPoints.map((p) => p.datasetIndex)).toEqual([1, 0])
    expect(tooltip.footer).toEqual(['4+2'])
    expect(seen.chart).toBe(chart)
  })

  it('passes the native event and v2 elements to onClick, with the chart as this', async () => {
    const onClick = vi.fn()
    const chart = create({ data: data(), options: { onClick }, type: 'bar' })
    click(chart, 0, 2)
    await frame()
    const [event, elements] = onClick.mock.calls[0]
    expect(event).toBeInstanceOf(MouseEvent)
    expect(elements[0]._index).toBe(2)
    expect(onClick.mock.contexts[0]).toBe(chart)
  })

  it('passes the native event to legend onClick, with the legend as this', async () => {
    const onClick = vi.fn()
    const chart = create({ data: data(), options: { legend: { onClick } }, type: 'bar' })
    const item = chart.legend.legendHitBoxes[0]
    const rect = chart.canvas.getBoundingClientRect()
    chart.canvas.dispatchEvent(
      new MouseEvent('click', {
        clientX: rect.left + item.left + 5,
        clientY: rect.top + item.top + 5,
      })
    )
    await frame()
    expect(onClick.mock.calls[0][0]).toBeInstanceOf(MouseEvent)
    expect(onClick.mock.calls[0][1].text).toBe('D')
    expect(onClick.mock.contexts[0]).toBe(chart.legend)
  })

  it('gives tick callbacks the v2 label and the v2 tick order', () => {
    const x = vi.fn((label) => label)
    const y = vi.fn((value) => value)
    create({
      data: data(),
      options: {
        scales: {
          xAxes: [{ ticks: { callback: x } }],
          yAxes: [{ ticks: { max: 4, min: 0, stepSize: 1, userCallback: y } }],
        },
      },
      type: 'bar',
    })
    expect(x.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    // v2 built vertical ticks top-down: index 0 is the maximum
    const first = y.mock.calls.find((c) => c[1] === 0)
    expect(first[0]).toBe(4)
    expect(first[2]).toEqual([4, 3, 2, 1, 0])
  })

  it('gives afterBuildTicks the scale and the tick values, and takes new values back', () => {
    const chart = create({
      data: data(),
      options: {
        scales: {
          yAxes: [{ afterBuildTicks: (scale, ticks) => ticks.filter((t) => t % 1 === 0) }],
        },
      },
      type: 'line',
    })
    expect(chart.scales.y.ticks.every((t) => t.value % 1 === 0)).toBe(true)
  })

  it('draws the v2 zero line and major tick fonts', () => {
    const chart = create({
      data: { datasets: [{ data: [-1, 1] }], labels: ['a', 'b'] },
      options: {
        scales: {
          xAxes: [{ ticks: { fontColor: 'blue', major: { enabled: true, fontStyle: 'bold' } } }],
          yAxes: [
            { gridLines: { color: ['#111', '#222'], drawBorder: false, zeroLineColor: 'red' } },
          ],
        },
      },
      type: 'line',
    })
    const y = chart.scales.y
    const zero = y.ticks.findIndex((t) => t.value === 0)
    expect(y.options.grid.setContext(y.getContext(zero)).color).toBe('red')
    expect(y.options.border.display).toBe(false)
    const x = chart.scales.x
    expect(x.options.ticks.setContext(x.getContext(0)).color).toBe('blue')
  })

  it('wraps tooltip positioners to give v2 elements', () => {
    const positioner = vi.fn((elements) => ({ x: elements[0]._model.x, y: 0 }))
    Chart.Tooltip.positioners.v2test = positioner
    const chart = create({
      data: data(),
      options: { tooltips: { position: 'v2test' } },
      type: 'line',
    })
    hover(chart, 0, 1)
    expect(positioner.mock.calls[0][0][0]._index).toBe(1)
    expect(chart.tooltip.caretX).toBe(chart.getDatasetMeta(0).data[1].x)
  })

  it('keeps the v2 tooltips of round, scatter and bubble charts', () => {
    const pie = create({
      data: { datasets: [{ data: [1, 2000] }], labels: ['a', 'b'] },
      type: 'pie',
    })
    expect(hover(pie, 0, 1).body[0].lines).toEqual(['b: 2000'])
    const polar = create({
      data: { datasets: [{ data: [1, 2] }], labels: ['a', 'b'] },
      type: 'polarArea',
    })
    expect(hover(polar, 0, 1).body[0].lines).toEqual(['b: 2'])
    const scatter = create({ data: { datasets: [{ data: [{ x: 1, y: 2 }] }] }, type: 'scatter' })
    expect(hover(scatter, 0, 0).body[0].lines).toEqual(['(1, 2)'])
    const bubble = create({
      data: { datasets: [{ data: [{ r: 3, x: 1, y: 2 }], label: 'B' }] },
      type: 'bubble',
    })
    expect(hover(bubble, 0, 0).body[0].lines).toEqual(['B: (1, 2, 3)'])
  })

  it('labels log scales with the v2 exponent format', () => {
    const chart = create({
      data: { datasets: [{ data: [10, 1000] }], labels: ['a', 'b'] },
      options: { scales: { yAxes: [{ type: 'logarithmic' }] } },
      type: 'line',
    })
    const labels = chart.scales.y.ticks.map((t) => t.label).filter(Boolean)
    expect(labels).toContain('1e+2')
  })
})
