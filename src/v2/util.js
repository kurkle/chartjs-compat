export const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

const seen = new Set()
export function warn(msg) {
  if (seen.has(msg)) return
  seen.add(msg)
  if (typeof console !== 'undefined') console.warn(`[chartjs-compat/v2] ${msg}`)
}
export const warnings = () => [...seen]

/** Copies plain objects and arrays; keeps functions, class instances and data arrays' items by reference. */
export function clone(v) {
  if (Array.isArray(v)) return v.map(clone)
  if (!isPlainObject(v)) return v
  const out = {}
  for (const k of Object.keys(v)) out[k] = clone(v[k])
  return out
}

export function getIn(obj, path) {
  let o = obj
  for (const k of path) {
    if (o == null) return undefined
    o = o[k]
  }
  return o
}

export function setIn(obj, path, value) {
  let o = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof path[i + 1] === 'number' ? [] : {}
    o = o[k]
  }
  o[path[path.length - 1]] = value
  return obj
}

/** Deep merges plain objects from src into target, in place. */
export function merge(target, src) {
  for (const k of Object.keys(src)) {
    const s = src[k]
    const t = target[k]
    if (isPlainObject(s) && t && typeof t === 'object' && !Array.isArray(t)) merge(t, s)
    else target[k] = s
  }
  return target
}

/** Moves obj[from] to obj[to] (to may be a path) when present. Returns true when moved. */
export function move(obj, from, to, path) {
  if (!obj || !(from in obj)) return false
  const value = obj[from]
  delete obj[from]
  const toPath = Array.isArray(to) ? to : [to]
  const existing = getIn(obj, toPath)
  if (isPlainObject(existing) && isPlainObject(value)) merge(existing, value)
  else setIn(obj, toPath, value)
  if (path) warn(`${op(path)}.${from} is now ${np(path)}.${toPath.join('.')}`)
  return true
}

/** Moves obj[k] to target[k] for each key present, warning `${from}.${k} is now ${to}.${k}`. */
export function hoist(obj, keys, target, from, to) {
  for (const k of keys) {
    if (!(k in obj)) continue
    target[k] = obj[k]
    delete obj[k]
    warn(`${from}.${k} is now ${to}.${k}`)
  }
}

/** A scriptable option's value: the function's result, or the value itself. */
export const resolve = (value, ctx) => (typeof value === 'function' ? value(ctx) : value)

/** make(fn), once: a function the shim already wrapped is returned as it is. */
export function wrapOnce(fn, make) {
  if (fn._v2Wrapped) return fn
  const wrapped = make(fn)
  wrapped._v2Wrapped = true
  return wrapped
}

// A warning path can carry both names: 'options.scales.yAxes[0]\u0000options.scales.y'.
export const op = (p) => String(p).split('\u0000')[0]
export const np = (p) => {
  const parts = String(p).split('\u0000')
  return parts[1] || parts[0]
}

export const sub = (p, oldSuffix, newSuffix = oldSuffix) =>
  `${op(p) + oldSuffix}\u0000${np(p)}${newSuffix}`

export const RAD2DEG = 180 / Math.PI
