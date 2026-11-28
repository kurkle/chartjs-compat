import type { Chart as ChartJS } from 'chart.js'

/** A Chart.js v2 configuration. The v2 option shapes are not typed. */
export interface V2ChartConfiguration {
  type?: string
  data?: Record<string, unknown>
  options?: Record<string, unknown>
  plugins?: unknown[]
}

/** The result of `upgradeConfig`. */
export interface UpgradeResult {
  config: V2ChartConfiguration
  ids: Record<string, string>
  v2type: string | undefined
}

/**
 * The v2-compatible Chart: a Chart.js v4 `Chart` that accepts v2 configurations and
 * exposes the v2 instance and static members. The v2 members are not typed.
 */
declare class Chart extends ChartJS {
  constructor(item: any, config: V2ChartConfiguration)
  static [key: string]: any
  /** Chart.js v4 defaults plus the v2 aliases (`global`, `scale.ticks.*`, `line`, `bar`, ...). */
  static readonly defaults: typeof ChartJS.defaults & { [key: string]: any };
  [key: string]: any
}

/** Installs the v2 API on a Chart.js v4 `Chart` and returns the v2-compatible `Chart`. */
export declare function install(chart: typeof ChartJS, options?: { helpers?: object }): typeof Chart

/** Translates a v2 configuration to v4 in place: `config.data` keeps its identity, `config.options` is replaced. */
export declare function upgradeConfig(config: V2ChartConfiguration): UpgradeResult

/** Every distinct migration warning logged so far. */
export declare function warnings(): string[]

export { Chart }
export default Chart
