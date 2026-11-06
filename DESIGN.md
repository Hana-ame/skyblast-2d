# 横版射击 PVP 手游设计 —— Teeworlds 风格

> 目标：手机端 2D 横版射击 PVP，带重力、实时自由瞄准（Noita/Teeworlds 的鼠标转向），
> 架构上把 **联机 / 操作 / 界面逻辑** 三层彻底分离。

---

## 1. 玩法定义

| 维度 | 设定 |
|---|---|
| 视角 | 横版侧视（side-view），2D 物理平面 |
| 物理 | 重力 g；可左右移动、跳跃（含二段跳）、喷气背包（jetpack，Teeworlds 招牌） |
| 瞄准 | **实时自由 360°**——右摇杆/拖动实时改变射击仰角，像 Noita 鼠标转向 |
| 武器 | 弹道可受重力影响（抛物线）；弹速、弹道类型可配；切枪 + 装填 |
| 模式 | PVP：个人死斗 / 团队死斗；击杀计分，回合制或限时 |
| 环境 | 静态地形（可碰撞）+ 平台；可选可破坏地形/道具 |
| 匹配 | 房间制：创建/加入房间，2–N 人，主机迁移 |

**核心手感对标**：Teeworlds 的"移动+喷射器+自由瞄准对枪" + Noita 的"自由转向射击"。

---

## 2. 三层架构（核心）

三层是**并列的独立子系统**，彼此**不持有实现、只依赖抽象接口**，靠组合根（composition root）依赖注入组装。共享的只有 `core/`（纯逻辑）与事件总线。

```
┌─────────────────────────────────────────────────────────────┐
│  core/   纯游戏逻辑（零 IO 依赖，可单测、可在服务端复用）        │
│  物理 / 弹道 / 实体 / 伤害 / 回合规则                          │
└─────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │ 只调纯函数           │ 只调纯函数           │ 只读领域事件
┌───────┴───────┐    ┌────────┴────────┐    ┌───────┴───────┐
│  input/ 操作层 │    │   net/  联机层   │    │   ui/ 界面逻辑层│
│ 采集触摸→意图   │    │ 权威模拟+状态同步 │    │ 快照→视图模型→UI │
│ 不碰网络/渲染   │    │ 不碰输入/UI 实现  │    │ 不调输入/网络内部 │
└───────────────┘    └─────────────────┘    └───────────────┘
        │ intent 事件           │ 快照/消息             │ 渲染指令
        └──────────┬───────────┴───────────┬───────────┘
                    ▼                       ▼
              [IntentBus 事件总线]    [Presenter 接口]
```

### 2.1 单向数据流（解耦的钥匙）

所有信息**单向流动**，无循环依赖：

```
[触摸事件]
   → TouchSource        (操作层：采集原始输入)
   → InputMapper        (操作层：触摸 → Intent)
   → IntentBus          (操作层：发布意图)
   → ClientSession.send (联机层：带时间戳+序列号发往服务器)
   → [Server] ServerSim (联机层：服务器权威模拟 gravity/弹道/碰撞/伤害)
   → Snapshot(tick)     (联机层：广播世界状态)
   → StateSync          (联机层：客户端预测 + 快照插值 + 服务器纠错)
   → Presenter.render   (界面层：快照 → 视图模型)
   → HUDViewModel       (界面层：血条/弹药/准星/比分)
   → UI 渲染
```

### 2.2 各层职责与边界

#### 操作层 `input/` —— 只负责"输入 → 意图"

- **`TouchSource`**：采集触摸/指针原始事件，输出归一化触控数据（位置、相位、压力）。
- **`InputMapper`**：把触控手势映射为领域意图。左摇杆→移动方向；右摇杆拖动→瞄准角；按键→跳跃/喷射/射击/切枪/钩索。
- **`IntentBus`**：把意图推给（a）本地预测模拟、（b）网络发送。
- **禁止**：不 import `net/*` 实现、不 import `ui/*` 实现、不触碰渲染。只产出 `Intent` 数据。

```ts
// intent.ts —— 操作层唯一对外数据类型
type Intent =
  | { t: 'move';  dir: -1 | 0 | 1 }
  | { t: 'jump' }
  | { t: 'jetpack'; on: boolean }
  | { t: 'aim';   angle: number }      // 弧度，360° 自由
  | { t: 'fire';  on: boolean }
  | { t: 'hook' }
  | { t: 'reload' };
```

#### 联机层 `net/` —— 只负责"权威模拟 + 状态同步"

- **`Transport`**（抽象）：发送/接收消息。实现：`WebRTCTransport`、`UdpTransport`、`LoopbackTransport`（本地单机测试）。可替换，不污染上层。
- **`ClientSession`**：把意图流打包成 `ClientMsg{ seq, ts, intents[] }` 发送；接收 `ServerMsg{ snapshots[] }`。
- **`ServerSim`**：**服务器权威**——用 `core/sim` 纯函数推进世界（重力、弹道、碰撞、伤害、回合），广播快照。
- **`StateSync`**：**客户端预测 + 插值**。本地立即模拟输入（预测），收到快照后插值渲染；偏差超阈值则回滚重放未确认输入（reconciliation）。
- **`RoomManager`**：房间创建/加入/踢人/主机迁移/匹配。
- **禁止**：不读取 UI 状态、不反向调用操作层；只依赖 `core/sim` 与 `Transport` 抽象。

```ts
// transport.ts —— 联机层对外抽象，可替换实现
interface Transport {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  close(): void;
}
```

#### 界面逻辑层 `ui/` —— 只负责"呈现状态"

- **`ScreenStateMachine`**：`Lobby → InGame → Scoreboard → Result`，纯界面状态机，与玩法解耦。
- **`HUDViewModel`**：血条/弹药/冷却/准星/比分/喷射器燃料。**只读快照派生**，不直接读物理实体。
- **`Presenter`**：实现 `Presenter` 接口，订阅快照 → 生成视图模型 → 触发渲染指令（移动精灵、绘制弹道、更新 HUD）。
- **禁止**：不调用 `net/*` 内部、不采集输入；所有需要"用户又做了什么"的动作通过**意图事件**回抛给操作层（而非直接调用）。

```ts
// presenter.ts —— 界面层对外抽象（联机层/组合根只依赖它）
interface Presenter {
  render(snapshot: WorldSnapshot): void;
  onIntent(intent: Intent): void;   // UI 产生的动作 → 回到意图总线
}
```

---

## 3. 网络模型（服务器权威，低延迟）

| 环节 | 方案 |
|---|---|
| 权威 | **服务器权威**：服务器跑 `core/sim`，是唯一事实源 |
| 输入 | 客户端发**输入流**（带 seq + ts），服务器按 tick 重放 |
| 预测 | 客户端**本地预测**移动+重力+喷射器（低延迟手感） |
| 同步 | 服务器**快照**（20–30 Hz）→ 客户端**插值**渲染 |
| 纠错 | 快照与预测偏差 > 阈值 → 服务器回滚，客户端重放未确认输入 |
| 传输 | **UDP 优先**（WebRTC DataChannel / ENet 封装）；WebSocket 做降级/大厅 |
| 房间 | 房间制，2–N 人；主机迁移（host migration）避免单点 |

**为什么服务器权威**：反作弊 + 一致性；预测+插值保证本地手感，服务器纠错保证公平。

---

## 4. 操作映射（手机触屏，对应 Teeworlds/Noita 键位）

```
┌──────────────────────────────────────┐
│             游戏画面（横版）            │
│                                      │
│   [左摇杆]               [右摇杆]      │
│   移动/喷射方向           360°瞄准      │
│                                      │
│  [跳] [喷] [射击] [切枪] [钩索] [装填] │
└──────────────────────────────────────┘
```

| 手机操作 | 映射意图 | 对标 PC（Teeworlds/Noita） |
|---|---|---|
| 左摇杆左右 | `move(dir)` | A/D |
| 跳跃键 | `jump`（可二段跳） | 空格 |
| 喷射器键（按住） | `jetpack(on)` | 空格/喷射键 |
| **右摇杆拖动** | `aim(angle)` 360° | **鼠标**（自由转向） |
| 射击键（按住） | `fire(on)` | 鼠标左键 |
| 钩索键 | `hook` | 钩索键 |
| 切枪/装填 | `reload` / 切武器 | 数字键/R |

> 右摇杆即"Noita 的鼠标"：拖动改变仰角，松开朝该角射击——这是本作与俯视游戏的核心区别。

---

## 5. 界面状态机（纯逻辑，与玩法解耦）

```
        ┌─────────┐  join   ┌─────────┐  start  ┌─────────┐
        │  Lobby   │────────▶│  InGame  │────────▶│ Scoreboard│
        │ 房间/匹配 │◀────────│  对战中   │  round  │  回合结算  │
        └─────────┘  leave  └─────────┘  end    └─────────┘
                                               │  match over
                                               ▼
                                            ┌─────────┐
                                            │  Result  │
                                            └─────────┘
```

每屏一个 ViewModel，只消费快照/领域事件；切屏由 `ScreenStateMachine` 负责，不感知网络细节。

---

## 6. 目录结构（体现三层分离）

```
teeworlds-style-pvp/
├─ src/
│  ├─ core/                 # 纯逻辑，零 IO 依赖，可在服务端复用
│  │  ├─ sim/               #   物理/弹道/实体/伤害（确定性，可单测）
│  │  │  ├─ physics.ts
│  │  │  ├─ projectile.ts
│  │  │  ├─ entity.ts
│  │  │  └─ rules.ts
│  │  └─ types.ts
│  ├─ input/                # ── 操作层 ──
│  │  ├─ TouchSource.ts
│  │  ├─ InputMapper.ts
│  │  ├─ IntentBus.ts
│  │  └─ intent.ts
│  ├─ net/                  # ── 联机层 ──
│  │  ├─ transport/         #   WebRTC / UDP / Loopback（可替换）
│  │  ├─ ClientSession.ts
│  │  ├─ ServerSim.ts
│  │  ├─ StateSync.ts
│  │  ├─ Snapshot.ts
│  │  ├─ RoomManager.ts
│  │  └─ protocol.ts        #   ClientMsg / ServerMsg 定义
│  ├─ ui/                   # ── 界面逻辑层 ──
│  │  ├─ ScreenStateMachine.ts
│  │  ├─ HUDViewModel.ts
│  │  ├─ Presenter.ts
│  │  └─ Screens/           #   Lobby / InGame / Scoreboard / Result
│  └─ main.ts               # 组合根：依赖注入，组装三层
└─ tests/                   # core 单测 + 三层集成测试（用 LoopbackTransport）
```

**组合根 `main.ts`**（三层在此碰面，但只通过接口）：

```ts
const input  = new TouchSource();                 // 操作层
const mapper = new InputMapper(input);
const bus    = new IntentBus();
const transport = new WebRTCTransport();          // 联机层（可换）
const client = new ClientSession(transport);
const sync   = new StateSync(client);
const ui     = new HUDViewModel();
const presenter = new Presenter(ui);              // 界面层

// 单向接线的唯一地点：
mapper.onIntent(bus.publish);                     // 操作 → 意图总线
bus.subscribe(client.sendIntents);                // 意图 → 联机发送
sync.onSnapshot(presenter.render);                // 快照 → 界面呈现
presenter.onIntent(bus.publish);                  // UI 动作 → 回抛意图
```

---

## 7. 技术选型

| 项 | 建议 |
|---|---|
| 引擎 | Godot 4（轻量、2D 强、可导手机）或 Cocos Creator（TS，国内手机生态熟） |
| 语言 | GDScript/C# 或 TypeScript |
| 网络 | 自研：WebRTC DataChannel（UDP 低延迟）+ 服务器权威快照；大厅走 WebSocket |
| 服务端 | 独立 headless 权威服务（Node/Go），复用 `core/sim` |
| 测试 | `core/sim` 确定性单测；三层用 `LoopbackTransport` 做集成测试 |

---

## 8. 里程碑（建议顺序）

1. **core**：物理/弹道/实体/规则 → 确定性单测 ✅ 无任何 IO
2. **操作层**：触摸→意图映射，双摇杆手感
3. **联机层**：`Loopback` 先行（本机单测权威模拟），再上 UDP/WebRTC
4. **界面层**：HUD/准星/状态机，消费快照
5. **集成**：组合根接线，2 客户端对局（本机 + 真机）

---

## 9. 设计取舍（明确记下）

- **不做**"每像素物理模拟"（Noita 核心）——手机算不动，只保留**自由瞄准 + 重力弹道 + 喷射器**这些手感点。
- **服务器权威**换一致性与反作弊，牺牲一点实现复杂度；预测+插值补回手感。
- **实时自由瞄准**是卖点，故放弃"角度+力度抛物线"（炮战类）路线。
- 三层强制单向依赖，`core` 零 IO，保证可单测、可服务端复用、可替换传输/输入。

---

## 10. 合并落地：SkyBlast 2D 内容 + 本骨架（2026-11-06）

**来源**：玩法内容来自 SkyBlast 2D v2（`peerjs_battle_arena (1).zip`）；本仓库原为 teeworlds-style-pvp 骨架。

### 10.1 落点对照

| 原骨架 | 合并后 |
|---|---|
| `core/sim/world.ts` 简化世界（960×600 单屏） | 环形大世界 13200×4400（**双轴**无缝循环）+ 全量玩法系统 |
| `core/types.ts` 单武器 | `core/weapons.ts` 7 主武器 + 8 副武器 + GameConfig |
| — | `core/terrain.ts` 660×220 碰撞网格（楼房/管道/地道/掩体/浮岛/障碍物） |
| — | `core/rng.ts` seeded RNG（联机 seed 服务器下发） |
| `net/transport/Loopback.ts` | 增加 `Peer.ts`（PeerJS DataConnection → Transport，可单测） |
| `net/ServerSim.ts` 单武器意图 | 新意图 interact/secondary/switchWeapon + 事件流广播 |
| `net/StateSync.ts` 纯 x/y 插值 | 环形感知插值（跨缝最短位移）+ 离散实体直取最新帧 |
| `ui/HUDViewModel.ts` 简化 HUD | 武器/备弹/护盾/副武器冷却/比分 |

### 10.2 单位制（合并时统一）

SkyBlast v2 是"每帧像素 @60fps"（隐含 60Hz）。本骨架是秒制：
- 速度 **×60**（px/frame → px/s）：霰弹 16→960、狙击 34→2040、激光 44→2640…
- 后坐力/投掷速度同理 ×60；重力仍用骨架调优值（1250 px/s²，用户确认），弹道重力按 `gravityScale × 1250` 缩放。
- 冷却/换弹/引信本来就是秒，直接沿用。

### 10.3 确定性约束（新增代码必须遵守）

1. `core/` 不 import `input/net/ui`（静态检查测试守门）。
2. **禁止 `Math.random`/`Date.now` 进入 core 逻辑**：随机量一律 `this.rng.*`；id 用自增计数器（不得用时间戳）。
3. `step(dt, inputs)` 必须是纯函数式的：同 seed + 同输入序列 ⇒ 快照逐字节一致（测试覆盖含霰弹 RNG 消费）。

### 10.4 与 v2 的取舍

- v2 的"待机整备/配装锁定/按钮组大厅"是 UI 层规则，本次只保留 `loadoutLock` 开关（默认开；原型页关闭便于试玩）。
- v2 的观战/阴影视野/小地图等纯表现层，未移植；渲染以快照为准。
- v2 的 `0.peerjs.com` 硬编码不在 core/net 内出现，仅由 PeerJS 传输实现负责。

### 10.5 2026-11-06 玩法调整（补给门槛 + 激光反弹 + 数值）

- **补给专属**：`laser/gatling/gravity` 上已带 `isSupplyOnly`（常规 `switchWeapon` 拒绝，测试锁定）；
  **替身人偶**改为 `SECONDARIES.doll.supplyOnly`，只能从新增的 2 个特殊补给位获得充能（`PlayerState.dollCharges`，上限 2），
  无充能使用无效且不进 CD。
- **激光反弹**：`WeaponDef.bounces = 1` → `Projectile.bounces`；命中地形时按轴向反射（`prevX/prevY` 探针判定横/纵撞面），
  反弹后 `hitTargets` 重置为仅排除发射者。
- **数值**：弹速 4–13% 下压、伤害小幅下调（见 README 数值表）；狙击爆头仍一枪。

### 10.6 2026-11-07 操作与平衡修正

- **弹道子步进**：`stepProjectiles` 按 ≤8px 子步推进 + 逐子步碰撞（高速弹不穿 20px 墙砖）；激光 `bounces=2`，每次反弹重置 `hitTargets`。
- **引力弹穿墙**：`WeaponDef.passWalls` → `Projectile.passWalls`，忽略原始地形碰撞（仅玩家/障碍物/寿命）。
- **激光光束**：`weapon.beam` → 渲染为速度方向 150px 光束（非圆点）；数值 3000px/s、50 伤害。
- **迫击炮**：操控时 `mortar.angle = clamp(player.aim, 上半圆)`；渲染加虚线瞄准线 + 落点预示圈。
- **喷射燃料**：`updateJetpackFuel(fuel, active, onGround, dt)`——空中不回充，落地按 recharge 回充（修复断续按 W 永动）。
- **AI 队伍过滤**：`pickBotTarget` 只选不同队伍目标（FFA 除外）。

### 10.7 表现层：程序化贴图 + sprite（2026-11-07）

- `web/textures.ts`：按 terrain kind 生成 96px 可平铺 CanvasPattern（地层/岩石/砖墙/混凝土/金属/管道内壁/地道/浮岛/格栅/钢板），
  缓存复用；地形渲染改为 pattern 填充 + 顶面高光/底面阴影。
- `web/sprites.ts`：玩家（腿步行/护甲渐变/头盔面罩/喷气尾焰/护盾/7 类武器造型）、道具（补给箱/弹药/迫击炮/瞭望塔/传送门/旗帜/地雷/手雷/空袭/弹丸光束）全部矢量 sprite。
- `web/effects.ts`：客户端粒子（爆炸/碎块/击杀/拾取/喷气/枪口），纯表现层不参与权威模拟。
- 背景：渐变天幕 + 视差星空 + 远景光晕；实测 61 FPS。

### 10.8 尚未完成（设计位）

联机大厅页面（`server/server.js` 已带入）、浏览器联机入口（Peer 传输已就绪）、完整 v2 UI、主机迁移。
