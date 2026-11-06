# SkyBlast 2D — 环形大世界 2D 横版 PVP

> **合并版**：把 **SkyBlast 2D**（`peerjs_battle_arena` v2 环形大世界玩法）灌入本仓库原有的
> **Teeworlds 风格三层骨架**（core / input / net / ui 分离 + 服务器权威 + 确定性模拟）。
>
> 一句话：**骨架给架构，SkyBlast 给内容**。两边恰好互补：
> 骨架有 transport 抽象 / 确定性 step / 单测，但没有玩法；SkyBlast 有 7 主武器 + 8 副武器 + 环形地图 + 占点 + 弹药经济，
> 但联机是各端自算（平行宇宙）。合并后所有玩法都在**服务器权威**下结算，并通过**统一快照**下发给各端。

---

## 运行

```bash
node src/main.ts              # Loopback 本地对局演示（服务器权威 + 快照插值 + killfeed）
node --test tests/*.test.ts   # 23 项：确定性/环形数学/武器/副武器/占点/补给/PeerJS 传输
npx tsc --noEmit              # 类型检查

npm run build:web             # 打包浏览器可玩页 → docs/bundle.js
npm run build:site            # 重新生成对局回放页 → docs/replay.html

python3 -m http.server 8123 --directory docs   # 本地起页：/index.html 可玩，/replay.html 回放
```

## 操作（桌面 / 触屏）

| 操作 | 桌面 | 触屏 |
|---|---|---|
| 移动 | A / D（无惯性，按下即极速） | 左半屏拖动 |
| 起飞（喷射/漂浮） | W / 空格 / ↑（耗能量，1s 预热） | 「喷」按钮按住 |
| 瞄准 | 鼠标（360° 自由瞄准） | 右半屏拖动 |
| 开火 | 鼠标左键 | 右半屏按住 |
| 装填 | R | 「装」按钮 |
| 换主武器 | 1-4 | —（原型未做按钮组） |
| 切副武器 / 使用 | T / G | — |

## 架构（三层单向依赖，core 零 IO）

```
core/    纯游戏逻辑（零 IO，可在服务端复用）
  wrap.ts      环形世界数学（水平+垂直双轴无缝循环，13200×4400）
  rng.ts       确定性随机（mulberry32；所有随机量走注入的 Rng）
  weapons.ts   7 主武器 + 8 副武器 + 全局玩法参数
  terrain.ts   660×220 碰撞网格：多层楼房/管道/地道/掩体/浮岛 + 21 个可破坏障碍物
  types.ts     领域类型（玩家/弹丸/手雷/地雷/空袭/障碍物/占点/弹药包/补给箱/迫击炮）
  snap.ts      快照 schema（含全部动态实体 → 联机一致性的根）
  sim/world.ts 服务器权威世界：物理/碰撞/武器/副武器/占点/弹药经济/击杀重生（确定性 step）
  sim/physics.ts 调优物理参数（用户确认值：mass 1.3 / gravity 1250 / jetpack 3000·280·0.5s）
input/   操作层：TouchState → InputMapper → Intent[]（含 interact/secondary/switchWeapon）
net/     联机层：Transport 抽象（Loopback / PeerJS 实现）
  ServerSim.ts   权威模拟 + 意图合并（瞬时意图单发消费）+ 事件流广播
  ClientSession.ts 意图流 / 快照+事件接收（欢迎包下发 playerId）
  StateSync.ts   快照插值（环形感知 lerp；离散实体取最新帧）
  transport/Peer.ts  PeerJS DataConnection → Transport 适配（JSON 协议，可单测）
  RoomManager.ts 房间/匹配（内存）
ui/      界面逻辑层：快照 → HUD 视图模型 / Presenter（不调网络/输入内部）
main.ts  组合根：唯一接线点；web/main-web.ts 浏览器可玩入口（内嵌 ServerSim）
```

**单向数据流**：`输入 → Intent → ServerSim → core/World.step → 快照+事件 → StateSync → Presenter/HUD/渲染`。

## 从 SkyBlast v2 继承的玩法（全部服务器权威结算）

- **环形世界**：13200×4400，**左右+上下双轴无缝循环**（全环面）。跨缝的瞄准/弹道/距离/插值全部走 `wrapDelta`；
  深层暗道打通底缝——从地下坠落会从上空回入。
- **7 主武器**：霰弹枪 / 突击步枪 / 电磁狙击（爆头穿透 + 30% 视野）/ 榴弹炮 / 聚变激光炮 / 重装加特林 / 奇点引力枪；
  有限弹匣 + 有限备弹 + 换弹；地图空投特武补给箱。
- **8 副武器**：手榴弹、感应地雷（受重力/直击/定时）、瞬发地雷（0 延迟）、定点空袭、可破坏工事、限时护盾、替身人偶（10s 生死回溯）、战术手枪。
- **战略层**：5 占点重生（A~E，读条占领）、6 量子传送门、4 瞭望塔、随机弹药点、空投补给箱、5 座公共迫击炮、弹射跳台。
- **确定性**：同 seed 两次运行快照逐字节一致（测试覆盖含 RNG 消费）；联机 seed 由服务器下发。

### 相对 SkyBlast v2 的修正（合并的直接收益）

| v2 的问题 | 合并后的处理 |
|---|---|
| 命中/伤害在开火端本地结算（作弊面、双端各算） | 全部在 `ServerSim`/`core` 权威结算，客户端只发 Intent |
| `state_sync` 直接覆盖、无插值（20Hz 卡顿） | `StateSync` 环形感知快照插值 |
| 副武器地雷不广播（敌方看不见） | 地雷进快照，全端可见 |
| 占点/弹药点/补给箱各端独立演化（平行宇宙） | 全部实体进快照，服务器唯一事实源 |
| 替身人偶只同步锚点坐标，回溯状态不同步 | 回溯在服务器结算，结果直接进快照 |
| 43 处 `Math.random` 破坏确定性 | 全部改为注入的 seeded `Rng` |
| 依赖 `0.peerjs.com` 单点、联机逻辑写死 | `Transport` 抽象；PeerJS 只是其中一种实现 |

## 与上游的关系与署名

- 玩法内容（武器数值/地图布局/实体配置）来自 **SkyBlast 2D v2**（`peerjs_battle_arena (1).zip`，作者 Hana-ame）。
- 架构骨架（三层分离/Transport/ServerSim/StateSync/单测）来自本仓库原 **teeworlds-style-pvp**。
- 仓库已重命名为 **skyblast-2d**。

## 测试覆盖（23 项，`node --test tests/*.test.ts`）

确定性重放 · 环形数学（x/y 跨缝）· 垂直环绕 · 重力 · 狙击爆头穿透 · 弹药经济 · 手榴弹 · 护盾 · 替身人偶回溯 ·
可破坏障碍物 · 地雷直击 · 占点 · 补给箱 · Loopback 双客户端对局 · PeerJS 传输假连接 · 三层分离静态检查。

## 部署

- `docs/` 是 GitHub Pages 部署目录（`docs/index.html` 可玩、`docs/replay.html` 回放、`docs/tuning.html` 物理调参）。
- 推送后 CI（`.github/workflows/ci.yml`）跑测试 + 类型检查 + 两个构建。

## 下一步（未完成，明确列出）

1. **联机大厅**：`server/server.js` 是从 v2 带入的零依赖 HTTP 房间/等待/聊天服务端（未接线到新前端）。
2. **浏览器联机入口**：`net/transport/Peer.ts` 已是可测的 PeerJS 适配层，还差一个 `main-online.ts` 页面（建主机/输房间号/欢迎包接线）。
3. **完整 UI**：v2 的按钮组/配装锁定/大厅面板尚未移植（当前为原型 HUD）。
4. **主机迁移**：`RoomManager` 有设计位，未实现。