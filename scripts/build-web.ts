// scripts/build-web.ts —— 构建游戏 bundle 并自动刷新 index.html 的缓存版本号
// 随机测试/部署都不再需要手动 bump `bundle.js?v=`；避免用户拿到旧 bundle（此前出过 12/48 显示旧值的问题）。
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outfile = resolve(root, 'docs/bundle.js')
await build({
  entryPoints: [resolve(root, 'src/web/main-web.ts')],
  bundle: true,
  format: 'iife',
  outfile,
  logLevel: 'error',
})
const hash = createHash('sha256').update(readFileSync(outfile)).digest('hex').slice(0, 10)
const htmlPath = resolve(root, 'docs/index.html')
let html = readFileSync(htmlPath, 'utf8')
const next = html.replace(/bundle\.js\?v=[^"'#]*/g, `bundle.js?v=${hash}`)
if (next === html) throw new Error('index.html 未找到 bundle.js?v= 缓存版本引用')
html = next
writeFileSync(htmlPath, html)
console.log(`⚡ bundle 已构建；index.html 缓存版本 ${hash}`)
