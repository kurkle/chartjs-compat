// v2 tick behaviour that v4 dropped: the tick order of vertical scales and the darker zero line.
import { resolve } from './util.js'

const isIndexScale = (scale) => scale.type === 'category' || scale.type === 'radialLinear'

/**
 * v2 generated the ticks of vertical numeric scales top-down (and of reversed scales the other way),
 * v4 always bottom-up. Indexable tick and grid options follow the v2 order through this index.
 */
export function v2TickIndex(ctx) {
  const scale = ctx?.scale
  if (!scale || typeof ctx.index !== 'number' || isIndexScale(scale)) return ctx?.index
  const n = scale.ticks ? scale.ticks.length : 0
  const reversed = !scale.isHorizontal() !== !!scale.options.reverse
  return reversed && n ? n - 1 - ctx.index : ctx.index
}

function isZeroLine(ctx) {
  const scale = ctx?.scale
  return !!scale && ctx.tick?.value === 0 && !isIndexScale(scale) && !scale.options.offset
}

/** A scriptable value that draws the v2 zero line on top of the normal grid line value. */
export function zeroAware(base, zero) {
  const pick = (value, ctx) => {
    if (Array.isArray(value)) return value[(v2TickIndex(ctx) || 0) % value.length]
    return resolve(value, ctx)
  }
  const fn = (ctx) => {
    if (isZeroLine(ctx)) return pick(zero, ctx)
    // Outside a tick (the border), v2 used the first grid line's value.
    return ctx && ctx.type === 'tick'
      ? pick(base, ctx)
      : pick(base, { ...ctx, index: 0, scale: undefined })
  }
  fn._v2ZeroAware = true
  return fn
}
