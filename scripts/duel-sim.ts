// scripts/duel-sim.ts —— 1v1 对射平衡模拟 CLI（核心实现见 src/balance/duelSim.ts）
// 用法：node scripts/duel-sim.ts [--seeds=40] [--json|--sides|--matrix]
import { runDuelSim } from '../src/balance/duelSim.ts'
import { WEAPONS } from '../src/core/weapons.ts'
import { MAIN_WEAPONS, DISTANCES } from '../src/balance/duelSim.ts'

const args = process.argv.slice(2)
const seeds = Number((args.find(a => a.startsWith('--seeds=')) ?? '--seeds=40').split('=')[1])
const res = runDuelSim({ seeds })

if (args.includes('--json')) {
  console.log(JSON.stringify({ seeds, rows: res.rows.length, side: res.side, table: res.table }, null, 2))
  process.exit(0)
}
if (args.includes('--sides')) {
  console.log(`rows=${res.rows.length} a_wins=${res.side.aWins} b_wins=${res.side.bWins} draws=${res.side.draws}`)
  for (const d of DISTANCES) {
    const rs = res.rows.filter(r => r.dist === d)
    console.log(`dist ${d}: a=${rs.filter(r => r.winner === 'a').length} b=${rs.filter(r => r.winner === 'b').length} draw=${rs.filter(r => r.winner === 'draw').length}`)
  }
  process.exit(0)
}
if (args.includes('--matrix')) {
  const names = MAIN_WEAPONS.map(i => WEAPONS[i].shortName)
  for (const d of DISTANCES) {
    console.log(`\n--- 距离 ${d}px（行=左方胜率 vs 列；左右各半所以只列左方）`)
    console.log('        ' + names.map(n => n.slice(0, 4).padEnd(6)).join(''))
    for (const ai of MAIN_WEAPONS) {
      let row = WEAPONS[ai].shortName.padEnd(6, '　') + '  '
      for (const bi of MAIN_WEAPONS) {
        const fwd = res.rows.filter(r => r.dist === d && r.a === ai && r.b === bi)
        const rev = res.rows.filter(r => r.dist === d && r.a === bi && r.b === ai)
        const winA = fwd.filter(r => r.winner === 'a').length
        const winB = rev.filter(r => r.winner === 'a').length
        const n = fwd.length + rev.length
        // 双向平均（抵消左右位置偏差）
        const pct = n ? ((winA + (rev.length - winB)) / n) * 100 : 0
        row += String(Math.round(pct)).padStart(4) + '%  '
      }
      console.log(row)
    }
  }
  process.exit(0)
}

console.log(`duels=${res.rows.length} seeds=${seeds} dist=${DISTANCES.join('/')} side(a/b/draw)=${res.side.aWins}/${res.side.bWins}/${res.side.draws}`)
console.log('武器            总胜率  平局  平均TTK  180px  380px  700px')
for (const r of res.table) {
  console.log(
    r.name.padEnd(12, '　') +
    String(r.winRate).padStart(6) + '%' +
    String(r.drawRate).padStart(6) + '%' +
    String(r.avgTTK ?? '-').padStart(8) +
    String(r.byDist['180'] ?? '-').padStart(7) + '%' +
    String(r.byDist['380'] ?? '-').padStart(7) + '%' +
    String(r.byDist['700'] ?? '-').padStart(7) + '%'
  )
}
