import type { V2ChartConfiguration } from 'chartjs-compat/v2'

import { Chart as ChartJS } from 'chart.js'
import Chart, { install, upgradeConfig, warnings } from 'chartjs-compat/v2'

const config: V2ChartConfiguration = {
  data: { datasets: [{ data: [1], lineTension: 0 }], labels: ['a'] },
  options: { scales: { yAxes: [{ ticks: { beginAtZero: true } }] } },
  type: 'line',
}

const chart = new Chart(document.createElement('canvas'), config)
chart.update()
chart.generateLegend()
Chart.defaults.global.legend.display = false

const result = upgradeConfig({ options: {}, type: 'bar' })
const ids: Record<string, string> = result.ids
const list: string[] = warnings()
const Installed = install(ChartJS)
new Installed('canvas-id', { type: 'pie' })

export { ids, list }
