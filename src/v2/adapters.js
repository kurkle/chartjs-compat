// Builds the v2-shaped objects that v2 callbacks expect from their v4 counterparts.
export const env = { toFont: (f) => f || {} }

const isLabelScale = (s) =>
  s && (s.type === 'category' || s.type === 'time' || s.type === 'timeseries')

/** v4 TooltipItem -> v2 tooltipItem {xLabel, yLabel, label, value, index, datasetIndex, x, y}. */
export function toV2TooltipItem(item) {
  if (!item || item._v2) return item
  const { chart, datasetIndex, dataIndex, element } = item
  const parsed = item.parsed ?? {}
  const meta = chart.getDatasetMeta(datasetIndex)
  const label = (id, axis) => {
    const s = id && chart.scales[id]
    if (!s) return ''
    return isLabelScale(s) ? s.getLabelForValue(parsed[axis]) : parsed[axis]
  }
  let xLabel
  let yLabel
  if (meta.rAxisID || (parsed && typeof parsed === 'object' && 'r' in parsed && !('x' in parsed))) {
    xLabel = item.label
    yLabel = parsed.r
  } else if (typeof parsed === 'number') {
    xLabel = ''
    yLabel = ''
  } else {
    xLabel = label(meta.xAxisID, 'x')
    yLabel = label(meta.yAxisID, 'y')
  }
  const pos = element?.tooltipPosition ? element.tooltipPosition(true) : {}
  // v2 value: the value axis label, unformatted for numbers ("2000", not "2,000")
  let value
  if (typeof parsed === 'number') value = String(item.raw)
  else if (meta.rAxisID || ('r' in parsed && !('x' in parsed))) value = String(parsed.r)
  else value = String(meta.indexAxis === 'y' ? xLabel : yLabel)
  const v2 = Object.create(item)
  Object.assign(v2, {
    _v2: true,
    datasetIndex,
    index: dataIndex,
    label: item.label,
    value,
    x: pos.x,
    xLabel,
    y: pos.y,
    yLabel,
  })
  return v2
}

/** v4 {element, datasetIndex, index} -> v2 element with _index / _datasetIndex / _chart / _model. */
export function toV2Element(el, chart) {
  if (!el?.element) return el
  const v2 = Object.create(el.element)
  Object.defineProperties(v2, {
    _chart: { value: chart },
    _datasetIndex: { value: el.datasetIndex },
    _index: { value: el.index },
  })
  return v2
}

function v2FontStyle(f) {
  const parts = []
  if (f.style && f.style !== 'normal') parts.push(f.style)
  if (f.weight && f.weight !== 'normal') parts.push(f.weight)
  return parts.join(' ') || 'normal'
}

/** The v2 tooltip model: v4 tooltip state plus the v2 option fields custom tooltips read. */
export function v2TooltipModel(tooltip, chart) {
  const o = tooltip.options || {}
  const m = Object.create(tooltip)
  const pad = typeof o.padding === 'number' ? { left: o.padding, top: o.padding } : o.padding || {}
  const fonts = {}
  for (const k of ['title', 'body', 'footer']) {
    const f = env.toFont(o[`${k}Font`])
    fonts[`${k}FontColor`] = o[`${k}Color`]
    fonts[`_${k}FontFamily`] = f.family
    fonts[`${k}FontSize`] = f.size
    fonts[`_${k}FontStyle`] = v2FontStyle(f)
    fonts[`_${k}Align`] = o[`${k}Align`]
  }
  Object.assign(m, fonts, {
    _chart: chart,
    backgroundColor: o.backgroundColor,
    bodySpacing: o.bodySpacing,
    borderColor: o.borderColor,
    borderWidth: o.borderWidth,
    caretPadding: o.caretPadding,
    caretSize: o.caretSize,
    cornerRadius: o.cornerRadius,
    dataPoints: (tooltip.dataPoints || []).map(toV2TooltipItem),
    displayColors: o.displayColors,
    footerMarginTop: o.footerMarginTop,
    footerSpacing: o.footerSpacing,
    legendColorBackground: o.multiKeyBackground,
    titleMarginBottom: o.titleMarginBottom,
    titleSpacing: o.titleSpacing,
    xPadding: pad.left ?? pad.x ?? 6,
    yPadding: pad.top ?? pad.y ?? 6,
  })
  return m
}
