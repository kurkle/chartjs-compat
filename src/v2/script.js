// Script-tag build: load after chart.umd.min.js. Replaces window.Chart with the v2-compatible Chart.
import { install } from './runtime.js'
import { upgradeConfig } from './translate.js'
import { warnings } from './util.js'

const g = globalThis
if (g.Chart) {
  const ChartV2 = install(g.Chart)
  ChartV2.upgradeConfig = upgradeConfig
  ChartV2.compatWarnings = warnings
  g.Chart = ChartV2
  // v2 bundled chartjs-color, which set window.Color; v4 ships @kurkle/color as Chart.helpers.color.
  if (!g.Color && ChartV2.helpers?.color) g.Color = ChartV2.helpers.color
} else if (typeof console !== 'undefined') {
  console.error('[chartjs-compat] load Chart.js (chart.umd.min.js) before chartjs-compat-v2.min.js')
}
