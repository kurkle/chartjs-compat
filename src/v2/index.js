// chartjs-compat/v2 for bundlers: Chart.js v4 with every component registered and the v2 API on top.
import { Chart, registerables } from 'chart.js'
import * as chartHelpers from 'chart.js/helpers'

import { install } from './runtime.js'
import { upgradeConfig } from './translate.js'
import { warnings } from './util.js'

Chart.register(...registerables)
// A module namespace is frozen; v2 helper names are added to a copy.
const ChartV2 = install(Chart, { helpers: { ...chartHelpers } })

export default ChartV2
export { ChartV2 as Chart, install, upgradeConfig, warnings }
