// v2 font options (`fontColor`, `fontSize`, `titleFontStyle`, ...) -> v4 `color` + `font` objects.
import { isPlainObject, move, np, op, warn } from './util.js'

const FONT_PROPS = [
  ['Family', 'family'],
  ['Size', 'size'],
]
const FONT_STYLES = ['italic', 'oblique']

/** A v2 CSS-like font style ('bold italic', '600', ...) as v4 `weight` and `style`. */
export function parseFontStyle(value) {
  const s = String(value)
  const weight = s.match(/\b(bold|bolder|lighter|[1-9]00)\b/)
  return {
    style: FONT_STYLES.find((name) => new RegExp(`\\b${name}\\b`).test(s)) ?? 'normal',
    weight: weight ? weight[1] : 'normal',
  }
}

const keyOf = (prefix, name) => (prefix ? `${prefix}Font${name}` : `font${name}`)

function takeFont(obj, prefix, fontKey, path) {
  const font = {}
  for (const [v2, v4] of FONT_PROPS) {
    const key = keyOf(prefix, v2)
    if (key in obj) {
      font[v4] = obj[key]
      delete obj[key]
      warn(`${op(path)}.${key} is now ${np(path)}.${fontKey}.${v4}`)
    }
  }
  const style = keyOf(prefix, 'Style')
  if (style in obj) {
    Object.assign(font, parseFontStyle(obj[style]))
    delete obj[style]
    warn(`${op(path)}.${style} is now ${np(path)}.${fontKey}.weight / .style`)
  }
  if (!prefix && 'lineHeight' in obj) {
    font.lineHeight = obj.lineHeight
    delete obj.lineHeight
  }
  return font
}

/**
 * Moves v2 font props (`fontColor`, `fontSize`, ... or `titleFontColor`, ...) of obj
 * into `colorKey` and `fontKey`. prefix '' means plain `fontColor` etc.
 */
export function moveFonts(obj, prefix, colorKey, fontKey, path) {
  if (!obj) return
  move(obj, keyOf(prefix, 'Color'), colorKey, path)
  const font = takeFont(obj, prefix, fontKey, path)
  if (Object.keys(font).length) {
    obj[fontKey] = isPlainObject(obj[fontKey]) ? Object.assign(obj[fontKey], font) : font
  }
}

/** Moves the plain v2 font props of `parent[key]` when it is an object. */
export function moveObjectFonts(parent, key, path) {
  if (isPlainObject(parent[key])) moveFonts(parent[key], '', 'color', 'font', path)
}
