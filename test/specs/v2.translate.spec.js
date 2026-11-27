import { describe, expect, it } from 'vitest'

import { upgradeConfig, warnings } from '../../src/v2/index.js'

const upgrade = (config) => upgradeConfig(config).config

describe('v2 config translation', () => {
  it('turns xAxes / yAxes arrays into keyed scales', () => {
    const { options } = upgrade({
      options: {
        scales: {
          xAxes: [
            { gridLines: { display: false }, scaleLabel: { display: true, labelString: 'Month' } },
          ],
          yAxes: [{ ticks: { beginAtZero: true, fontColor: 'red', max: 100, stepSize: 10 } }],
        },
      },
      type: 'line',
    })
    expect(Object.keys(options.scales)).toEqual(['x', 'y'])
    expect(options.scales.x.grid.display).toBe(false)
    expect(options.scales.x.title).toEqual({ display: true, text: 'Month' })
    expect(options.scales.y).toMatchObject({
      beginAtZero: true,
      max: 100,
      ticks: { color: 'red', stepSize: 10 },
    })
  })

  it('keeps explicit axis ids and links datasets to them', () => {
    const { data, options } = upgrade({
      data: { datasets: [{ yAxisID: 'y-axis-1' }, { yAxisID: 'y-axis-2' }, {}] },
      options: { scales: { yAxes: [{ id: 'y-axis-1' }, { id: 'y-axis-2', position: 'right' }] } },
      type: 'bar',
    })
    expect(Object.keys(options.scales)).toEqual(['y', 'y-axis-2'])
    expect(options.scales['y-axis-2'].axis).toBe('y')
    expect(data.datasets.map((d) => d.yAxisID)).toEqual(['y', 'y-axis-2', undefined])
  })

  it('names unnamed axes after their v2 default ids', () => {
    const { data, options } = upgrade({
      data: { datasets: [{ xAxisID: 'x-axis-0' }, { xAxisID: 'x-axis-1' }] },
      options: { scales: { xAxes: [{}, { position: 'top' }] } },
      type: 'line',
    })
    expect(Object.keys(options.scales)).toEqual(['x', 'x-axis-1'])
    expect(data.datasets.map((d) => d.xAxisID)).toEqual(['x', 'x-axis-1'])
  })

  it('moves bar sizing options from the scale to the datasets', () => {
    const { data } = upgrade({
      data: { datasets: [{}, { barPercentage: 0.5 }] },
      options: { scales: { xAxes: [{ barPercentage: 0.8, categoryPercentage: 0.6 }] } },
      type: 'bar',
    })
    expect(data.datasets[0]).toMatchObject({ barPercentage: 0.8, categoryPercentage: 0.6 })
    expect(data.datasets[1]).toMatchObject({ barPercentage: 0.5, categoryPercentage: 0.6 })
  })

  it('moves legend, title and tooltips under plugins', () => {
    const { options } = upgrade({
      options: {
        legend: {
          fullWidth: false,
          labels: { fontSize: 14, fontStyle: 'bold italic' },
          position: 'bottom',
        },
        title: { display: true, fontColor: 'blue', text: 'T' },
        tooltips: {
          legendColorBackground: 'pink',
          mode: 'label',
          titleFontColor: 'red',
          xPadding: 10,
          yPadding: 4,
        },
      },
      type: 'line',
    })
    expect(options.legend).toBeUndefined()
    expect(options.plugins.legend).toMatchObject({
      fullSize: false,
      labels: { font: { size: 14, style: 'italic', weight: 'bold' } },
      position: 'bottom',
    })
    expect(options.plugins.title).toMatchObject({ color: 'blue', display: true, text: 'T' })
    expect(options.plugins.tooltip).toMatchObject({
      mode: 'index',
      multiKeyBackground: 'pink',
      padding: { x: 10, y: 4 },
      titleColor: 'red',
    })
  })

  it('translates the v2 interaction modes', () => {
    const single = upgrade({ options: { hover: { mode: 'single' } }, type: 'line' }).options.hover
    const xAxis = upgrade({ options: { hover: { mode: 'x-axis' } }, type: 'line' }).options.hover
    expect(single).toEqual({ intersect: true, mode: 'nearest' })
    expect(xAxis).toEqual({ intersect: false, mode: 'index' })
  })

  it('turns horizontalBar into an y-indexed bar chart', () => {
    const config = upgrade({ options: {}, type: 'horizontalBar' })
    expect(config.type).toBe('bar')
    expect(config.options.indexAxis).toBe('y')
  })

  it('converts round chart angles from radians to degrees with 0 at the top', () => {
    const { options } = upgrade({
      options: { circumference: Math.PI, cutoutPercentage: 60, rotation: Math.PI },
      type: 'doughnut',
    })
    expect(options.rotation).toBeCloseTo(270)
    expect(options.circumference).toBeCloseTo(180)
    expect(options.cutout).toBe('60%')
    const polar = upgrade({ options: { startAngle: 0 }, type: 'polarArea' }).options
    expect(polar.scales.r.startAngle).toBeCloseTo(90)
  })

  it('moves the radial scale and its v2 tick options', () => {
    const { options } = upgrade({
      options: {
        scale: { pointLabels: { fontSize: 14 }, ticks: { backdropPaddingX: 4, beginAtZero: true } },
      },
      type: 'radar',
    })
    expect(options.scales.r).toMatchObject({
      beginAtZero: true,
      pointLabels: { font: { size: 14 } },
      ticks: { backdropPadding: { x: 4, y: 2 } },
    })
  })

  it('renames dataset options in place, keeping the dataset objects', () => {
    const dataset = { data: [{ t: 1, y: 2 }], lineTension: 0, steppedLine: 'before' }
    const data = { datasets: [dataset] }
    const config = upgrade({ data, type: 'line' })
    expect(config.data).toBe(data)
    expect(config.data.datasets[0]).toBe(dataset)
    expect(dataset).toMatchObject({ parsing: { xAxisKey: 't' }, stepped: 'before', tension: 0 })
    expect(dataset.lineTension).toBeUndefined()
  })

  it('translates time scale options', () => {
    const { options } = upgrade({
      options: {
        scales: {
          xAxes: [
            { distribution: 'series', time: { format: 'YYYY', min: 1, stepSize: 2 }, type: 'time' },
          ],
        },
      },
      type: 'line',
    })
    expect(options.scales.x).toMatchObject({
      min: 1,
      ticks: { stepSize: 2 },
      time: { parser: 'YYYY' },
      type: 'timeseries',
    })
  })

  it('logs each rename once with the old and the new path', () => {
    upgrade({ options: { scales: { yAxes: [{ ticks: { min: 5 } }] } }, type: 'line' })
    upgrade({ options: { scales: { yAxes: [{ ticks: { min: 6 } }] } }, type: 'line' })
    const list = warnings().filter((w) => w.includes('ticks.min'))
    expect(list).toEqual(['options.scales.yAxes[0].ticks.min is now options.scales.y.min'])
  })
})
