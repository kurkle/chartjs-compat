import resolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'

import { readFileSync } from 'node:fs'

const { name, version, homepage } = JSON.parse(readFileSync('./package.json'))

const year = new Date(
  process.env.SOURCE_DATE_EPOCH ? process.env.SOURCE_DATE_EPOCH * 1000 : Date.now()
).getFullYear()
const banner = (entry) => `/*!
 * ${name}/${entry} v${version}
 * ${homepage}
 * (c) ${year} Jukka Kurkela
 * Released under the MIT License
 */`

const external = ['chart.js', 'chart.js/helpers']

const entry = (v) => [
  {
    external,
    input: `src/${v}/index.js`,
    output: { banner: banner(v), file: `dist/${name}-${v}.esm.js`, format: 'esm', indent: false },
    plugins: [resolve()],
  },
  {
    external,
    input: `src/${v}/cjs.js`,
    output: {
      banner: banner(v),
      exports: 'default',
      file: `dist/${name}-${v}.cjs`,
      format: 'cjs',
      indent: false,
    },
    plugins: [resolve()],
  },
  {
    input: `src/${v}/script.js`,
    output: [
      { banner: banner(v), file: `dist/${name}-${v}.js`, format: 'iife', indent: false },
      {
        file: `dist/${name}-${v}.min.js`,
        format: 'iife',
        indent: false,
        plugins: [terser({ output: { preamble: banner(v) } })],
        sourcemap: true,
      },
    ],
    plugins: [resolve()],
  },
]

export default [...entry('v2')]
