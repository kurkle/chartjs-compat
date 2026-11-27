// CommonJS entry: module.exports is the Chart, carrying the named exports as members.
import ChartV2, { install, upgradeConfig, warnings } from './index.js'

Object.assign(ChartV2, { Chart: ChartV2, default: ChartV2, install, upgradeConfig, warnings })

export default ChartV2
