// core/rng.ts —— 确定性随机（移植 SkyBlast 时的关键改造：Math.random → seeded）
// mulberry32：快、小、可复现；全图所有随机量（弹药点刷新、霰弹散射、AI 抖动）都走这里。
// 服务器持有权威 RNG；seed 在房间创建时定死，随 hello/config 同步给客户端 → 多端一致。
export class Rng {
  private s: number

  constructor(seed: number) {
    // 避免种子 0 退化
    this.s = (seed >>> 0) || 0x9e3779b9
  }

  /** [0,1) 均匀分布 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min,max) 浮点 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** [0,n) 整数（均匀，无取模偏置） */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** 从数组均匀取一个 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
}

/** 房间默认种子（每房间一个，服务器在 hello 里下发） */
export function makeSeed(): number {
  // 联机层/组合根用真随机开局，core 内部只用注入的 Rng，保证可重放
  return (Math.random() * 0xffffffff) >>> 0
}
