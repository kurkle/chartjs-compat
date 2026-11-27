# chartjs-compat

Run Chart.js v2 code on Chart.js v4. Keep the v2 code as it is, load the shim next to Chart.js v4,
and migrate one warning at a time.

Every v2 option the shim translates is logged once with its old and new path:

```
[chartjs-compat/v2] options.scales.yAxes[0].ticks.max is now options.scales.y.max
[chartjs-compat/v2] options.tooltips is now options.plugins.tooltip
```

Fix the code the warnings point to, and once no warnings are left, drop the shim.

## Usage

### Script tags

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-compat/dist/chartjs-compat-v2.min.js"></script>
<script>
  new Chart(ctx, v2config) // unchanged v2 code
</script>
```

The shim replaces `window.Chart` with the v2-compatible `Chart`. Chart.js 2 bundled
`chartjs-color`, which defined `window.Color`; the shim points `window.Color` at Chart.js v4's
color helper, unless the page already defines it.

### Bundlers

```js
import Chart from 'chartjs-compat/v2'

new Chart(ctx, v2config)
```

`chartjs-compat/v2` registers every Chart.js component, as Chart.js 2 did, and exports the
v2-compatible `Chart` (also as the named export `Chart`), `install(Chart)` for a `Chart` you set
up yourself, `upgradeConfig(config)` and `warnings()`.

### Time scales

Chart.js 2 bundled moment in `Chart.bundle.js`. Chart.js v4 needs a date adapter: load
`moment` and `chartjs-adapter-moment` (or another adapter) next to the shim.

## What it covers

**Configuration.** `xAxes` / `yAxes` arrays become keyed scales, with the v2 default scale ids
(`x-axis-0`, ...) mapped for datasets and for `chart.scales['x-axis-0']`; `ticks.min/max/
suggestedMin/suggestedMax/beginAtZero/reverse`, `userCallback`, step sizes, `scaleLabel`,
`gridLines` (`offsetGridLines`, `tickMarkLength`, `drawBorder`, `zeroLine*`), the v2 font options
everywhere (`fontColor`, `titleFontSize`, ...), `ticks.major/minor` fonts,
`time.format/min/max/stepSize`, `distribution: 'series'`, the radial `scale`, `horizontalBar`,
`legend` / `title` / `tooltips` under `plugins`, the tooltip modes `label`, `single` and `x-axis`,
`xPadding` / `yPadding`, `cutoutPercentage`, `rotation` / `circumference` / `startAngle` in
radians, `lineTension`, `steppedLine`, `showLines`, `elements.rectangle`,
`responsiveAnimationDuration`, `hover.animationDuration`, `hover.onHover`, `{t, y}` data and bar
sizing options set on scales.

**Callbacks.** Tooltip callbacks get the v2 `tooltipItem` and `data`; `itemSort`, `filter`,
`custom` (with the v2 tooltip model and `this._chart`), tick callbacks (the v2 label for category
and time scales, the v2 tick order), `afterBuildTicks`, legend `onClick` / `onHover` / `onLeave`,
chart `onClick` / `onHover` (native event, v2 elements), inline and registered plugins with the v2
hook signatures, tooltip positioners.

**API.** `Chart.defaults.global.*` (including `defaultFont*`), `Chart.defaults.<type>`,
`Chart.defaults.scale.ticks.*`, `Chart.plugins` / `Chart.pluginService`, `Chart.scaleService`,
`Chart.Line(...)` and the other v2 constructors, `Chart.platform`, the v2 helper names,
`chart.chart`, `generateLegend` / `legendCallback`, `getElementAtEvent` and its siblings,
`update(duration)`, element `_model` / `_view` / `_index` / `_datasetIndex`, doughnut
`meta.data[i].hidden`. Code that reads or writes v2 option paths after the chart is created,
such as `chart.options.scales.yAxes[0].ticks.max = 5`, keeps working. A chart created on a canvas
that already has one destroys the old chart instead of drawing over it.

**Look.** The v2 defaults that v3 and v4 changed are restored: curved and filled lines, the
darker zero line, tick spacing, number formats (`300000`, not `300,000`), the aspect ratio of
round charts, fills drawn below every line, the legend box of unfilled lines, the per-type
tooltips and the log scale labels.

## Known differences

- Chart.js v4 lays out axes once on the final chart area; v2 measured them with more room. Axes
  sit a few pixels apart, a y axis can get fewer ticks and x labels rotate at other widths. Radar
  and polar area charts draw slightly smaller.
- Bars on a time scale are as wide as the spacing of the data; v2 used the tick spacing.
- Log scales generate a different set of ticks; the labels use the v2 format.
- Not translated: custom chart types and scales built on the v2 extension API
  (`Chart.controllers.x.extend`, `Chart.scaleService.registerScaleType`), plugins that use v2
  internals beyond `_model`, and `afterTickToLabelConversion` hooks that rewrite string ticks.
- `window.Color` is `@kurkle/color`. It has `alpha`, `rgbString`, `hexString`, `hslString`, `mix`,
  `lighten` / `darken`, `saturate` / `desaturate`, `greyscale`, `clearer` / `opaquer`, `negate`,
  `rotate` and `clone`, but not the chartjs-color methods `rgbaString`, `hslaString`,
  `percentString`, `keyword`, the channel getters and setters (`red`, `hue`, ...),
  `luminosity`, `contrast`, `dark` / `light` or `whiten` / `blacken`.

## Development

```sh
npm test                  # unit specs (Chromium, Firefox), sample suite, package checks
npm run test:samples      # the Chart.js 2.9.4 samples on v4 + the built shim
npm run compare           # the same samples on v2 and on v4 + shim, side by side:
                          # test/output/compare/index.html
npm run references:update # rewrite the sample reference images
```

The sample suite loads each Chart.js 2.9.4 sample (`test/corpus/v2`, MIT, from the Chart.js
repository), hovers a data point and clicks every button. Each step must run without errors,
and every canvas must match its reference image in `test/references/v2`. References are drawn
with the sprite text of `chartjs-test-utils`, so they do not depend on the system fonts. A
reference is only as good as the comparison against v2 that approved it: run `npm run compare`
and look at the result before running `npm run references:update`.

## License

MIT
