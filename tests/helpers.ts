// tests/helpers.ts —— 测试公共工具：空地形世界/地面放置/输入构造
// 新测试优先用 emptyWorld()：不依赖默认地图坐标，地图调整不会连带弄红战斗逻辑测试。
import { World } from '../src/core/sim/world.ts'
import { defaultWorldInput } from '../src/core/types.ts'
import type { WorldInput } from '../src/core/types.ts'
import type { MapSolid } from '../src/core/map.ts'

export const DT = 1 / 60
/** 玩家站在地表时的 pos.y（脚底贴地） */
export const GROUND_Y = 2784

export function input(o: Partial<WorldInput> = {}): WorldInput {
  return { ...defaultWorldInput(), ...o }
}

/** 只有平地、没有任何建筑/平台的地图（战斗/物理测试用） */
export function emptyWorld(seed = 1): World {
  return new World(seed, { name: 'test-empty', solids: [] })
}

/** 平地 + 指定矩形（自定义 arena 测试用） */
export function worldWith(seed: number, solids: MapSolid[]): World {
  return new World(seed, { name: 'test-arena', solids })
}
