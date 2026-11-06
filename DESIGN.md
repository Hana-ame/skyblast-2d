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

### 10.8 接缝修复、地形丰富与世界锚定背景（2026-11-07 追加）

- **接缝**：渲染地形/阴影/装饰时按 `±WORLD_W`、`±WORLD_H` 复制绘制（相机居中坐标 + wrapDelta 选最近象限，再叠加周期副本），
  修复左右/上下循环边界处缺块；跨缝的大矩形（地表岩体/贯通地道）也能正确覆盖接缝两侧。
- **地形丰富**：新增连桥/高空平台/集装箱/据点掩体/地下立柱（碰撞网格同步更新），
  以及 `deco_*` 装饰层（只进渲染列表不参与碰撞）：窗户灯/路灯/缆线/天线/蒸汽口/警示条/油桶/管道/梯子/标牌。
  `Terrain.addDeco()` 与 `buildExtraStructures()`/`buildDecorations()` 分工。
- **背景世界锚定**：星空按世界坐标生成并随地形移动（消除相对滑动眩晕），环境光晕固定在掩体/浮岛世界坐标，
  天幕颜色随相机深度渐变。

### 10.9 2026-11-07 第二轮玩法重构：对战模式 / 光束武器 / 武器差异 / 防卡死

- **对战模式**：`GameConfig.randomSpawn` + 候选出生点表（地表/平台/基地/据点）；`World.deploy()` 统一出生入口；
  UI 提供 自由混战 / 双队对抗按钮组（2 队红蓝均衡、队友免伤），bot 队伍随模式重排；**每次出生随机安全点**。
- **激光（hitscan beam）**：`WeaponDef.beam` → `World.fireBeam()` 射线步进（10px/步）+ 反射（3 次）+
  沿路径穿透伤害；产出 `WorldEvent{kind:'laser', segments, duration:0.14}`（按秒存在），浏览器渲染为分段光束；
  不再生成飞行弹丸（非"棍子弹道"）。
- **狙击/火箭无限射程**：`WeaponDef.lifeSeconds=999`；狙击 4000px/s / 100 伤害（命中即死）；
  火箭 `gravityScale=0`、520px/s、`rocket` sprite、命中爆炸。
- **手枪升主武器**：id 7、`moveSpeedMult=1.30`（移速最快）、`fuelMult=1.15`。
- **副武器只留手雷**：`SECONDARIES` 仅 `frag`（2 充能、6s/枚自然回复）与 `doll`（补给专属）；
  `PlayerState.fragCharges/fragRechargeTimer`；UI 同步（HUD 充能显示、大厅仅两枚副武器按钮）。
- **武器差异**：每把武器 `moveSpeedMult`/`fuelMult`，`apply()` 用当前武器计算移动速度与燃料上限。
- **飞行**（与原来机制一致，只提响应速度）：燃料槽加倍（1.0s）、仅落地回充；上升加速=喷气推力渐变（accel 3000→4200，约 0.12s 到极速，极速不变）；
  下降加速=按住下键重力×1.55（原版数值）；水平零惯性（撞墙即停，不滑）。
- **防卡死**：大楼碰撞重做（墙体与楼板搭接、窗口 90px/门洞 110px、无 20px 夹缝）；
  `torsoBlockedAt()` + `ensureFreePosition()`（出生校验/每 tick 卡死计数 12 tick 自动推出/兜底主基地）。
- **表现层补充**：火箭弹 sprite、激光分段光束渲染。
- **瞭望塔（2026-11-07 二次调整）**：按 E 上塔后**锁定在塔顶、不能移动**，视野 **200%**（下塔即失效，无计时）；
  塔上可瞄准/射击/互动；`Watchtower.operatorId` + `PlayerState.mountedTowerId` 表达；塔 sprite 显示观测状态。
- **视野加成**：狙击与三把补给武器（激光/M249/引力枪）统一 `fovMult=1.30`（+30%）。
- **缩放居中 + 主武器显示修复（2026-11-07）**：① 渲染变换顺序写成了先 `scale(zoom)` 再 `translate(W/2)`，导致 zoom≠1（+30% 视野武器）时世界被缩到偏左上、视角不居中；
  改为**先 translate 再 scale**（屏幕 = 中心 + zoom × 世界相对量），并用跳台像素验证：正确坐标采样到 `#22d3ee` 跳台色、旧公式位置是背景色。
  ② 底部「当前主武器」只读牌原先只在特定事件刷新，拾取激光/M249 后仍显示旧武器；改为 `updateHUD` **每帧按权威 `weaponIndex` 刷新**（实测拾取后牌变「激光」）。
- **弹射跳台修复（2026-11-07）**：此前 `JUMP_PADS` **完全没有渲染**（玩家看不到），其中 2 个在竖井洞里、1 个埋在台地内，导致「有的地方莫名其妙自动弹起」。
  现在：4 个跳台全部重定位到可站立地表（1000 / 4300 / 8450 / 13050），新增 `drawJumpPad`（底座/箭头/呼吸光晕/「弹射」标签）；
  触发条件收紧为 **onGround && vel.y >= -20 && 半径 34**（空中/坠落不再误触）。
- **死亡界面重做（2026-11-07）**：底部 HUD 的武器槽位/副武器按钮全部移除（只读显示当前武器与副武器）；
  新增 `#deathScreen` 全屏死亡界面（阵亡才出现）：击杀者信息 + 重生倒计时 + 6 主武器选择 + 副武器（手雷/人偶）+ 选中态；
  选择写入 `pendingLoadout`，重生时由 `onLocalRespawn` 套用。换枪唯一入口 = 死亡界面 + 待机大厅。
- **霰弹重置（2026-11-07）**：单丸 `16→13`（8 丸全中 104 ≥100 致死；7 丸 91 不死）、`headshotMult 1.8→1.0`（取消爆头加成，保证「只有全中才一发致命」）、`fireDelay 0.50→0.95`（射速降低）。测试：贴脸 60px 全中必杀；600px 散布 ±84px 不可能全中 → 必不死。
- **2D 过关式地图重建（2026-11-07）**：`buildExtraStructures` 重写为空洞骑士式布局——地表台地/断崖（`addHill`，13 处过滤后 11 处）、
  低/中/高三层交错平台链（`addPlatformIfClear`：安全区/重叠过滤）、可穿行废墟拱门（柱+梁）、遗迹塔阶；
  新增地表下上层洞窟三层（苔藓洞窟/中央水晶洞窟/东区水晶洞窟，带 `cave_floor`/`cave_shelf` 与竖井入口）；
  `buildNatureDeco`：平台吊藤（deco_vine 24）/洞窟钟乳石（deco_stalactite 21）/岩壁苔藓（deco_moss）/远景废墟拱剪影；
  新 kind 贴图映射 cliff→brick、ledge/ruin→brick、cave_floor/shelf→plate。保留全部地标（出生点/据点/炮/塔/传送门/补给）与测试敏感坐标。
- **贴图世界锚定（2026-11-07）**：CanvasPattern 默认取样锚点固定在画布原点 → 花纹与方块/物体相对滑动。`syncTerrainPatterns(camX,camY)` 每帧对缓存的 pattern `setTransform(translate(-camX,-camY))`，把贴图锚回世界坐标（用户空间 = 世界 - 相机）。隔离实验已验证矩阵方向：texture sample = user − t，故 t=−camera 即世界锚定。
- **玩家间碰撞（2026-11-07）**：`playerHitsPoint`（6 采样点 vs 其他玩家 AABB，用于站立/阻挡）+ `playerBlockingAt`（整身体 AABB，用于水平阻挡）+ `tryNudge`（顶着人：被挡时轻推对方 1.4px/帧，避让地形/障碍/他人）+ `separatePlayers`（每 tick 两两重叠分离 0.6px）。注意脚底采样 y+16 贴地时不能当墙（nudge 用 y+15）。
- **引力弹牵引（2026-11-07）**：位移式牵引（物理移动之后逐轴施加、碰撞安全），半径 260px、最大 240px/s（< 玩家 300px/s 移动 → **可被反向移动抵抗**）；
  同时 `passWalls` 穿墙、`dragPerSecond=0.45` 逐渐减速、`lifeSeconds=2.2` 限射程。旧实现把牵引加速度加在速度上、且每帧被输入覆盖 → 实际拉不动，已废弃。

### 10.10 工程化拆分：web 端模块化（2026-11-07，commit TBD）

把 1407 行的 `src/web/main-web.ts` 拆成「共享上下文 + 表现层模块 + 组合根」：

```
src/web/
├── main-web.ts       组合根：事件绑定 / 大厅 / 参数台 / AI 输入 / 主循环 / 启动（~640 行）
├── context.ts→app/context.ts  单一状态源：canvas/ctx/camera/screenFx/world/localPlayer/
│                              bots/pendingLoadout/mode/keys/mouse/touchState/inputQueue/
│                              effects/beams/worldStars/worldGlows/FIXED
├── app/toast.ts      showToast / addKillFeed / escapeHtml（纯 DOM）
├── app/hud.ts        updateHUD / 武器牌 / 大厅与死亡界面配装按钮状态 / 记分板
├── app/events.ts     WorldEvent → 表现层（killfeed/特效/震颤/激光束/死亡信息）
└── render.ts         renderScene：地形/精灵/背景/光束/粒子（只读上下文）
```

依赖方向单一：`main-web → app/* → context`，`render → context + sprites/textures`，`app/events → toast + context`；
不再有全局可变 `screenShake/pendingInteract/pendingSecondary` 散落——统一收敛到 `screenFx.shake` 与 `inputQueue`。
验证：`tsc` 0 错、41/41 测试、`build:web` 195KB、浏览器冒烟（渲染采样/拾取激光→HUD 牌「激光」/死亡界面选狙→重生 weaponIndex=2/鼠标瞄准 0 与 -1.57/跳台 vy=-586）。

**分类完成版（main-web 1407 → 52 行，仅装配）**：

```
src/web/
├── main-web.ts          入口/组合根（52 行：装配 + 启动 + __dbg/__tune）
├── app/                 应用状态与 UI 逻辑
│   ├── context.ts       单一共享状态源
│   ├── hud.ts           HUD / 只读武器牌 / 配装按钮态 / 记分板
│   ├── toast.ts         Toast / Killfeed
│   ├── events.ts        WorldEvent → 表现层
│   └── params.ts        参数调校台（滑块绑定/回显）
├── game/                游戏玩法编排
│   ├── bots.ts          AI 数量/目标/输入
│   ├── loop.ts          固定步长主循环 / 本机输入 / 阵亡重生
│   └── loadout.ts       待部署配装 / 部署
├── input/               输入层
│   ├── bindings.ts      全部 DOM 事件绑定（键鼠/触屏/大厅/死亡界面）
│   └── device.ts        设备检测 / 触屏层 / 设备徽章
└── render/
    └── scene.ts         场景渲染
```

新增架构测试（第 42 个）：入口 ≤120 行且装配 bindings+loop、11 个分类文件存在、app/game/input/render 任何文件不得反向 import 入口。

### 10.11 对射平衡（2026-11-07）

新增 `src/balance/duelSim.ts`（权威 World 内 AI 对射，多距离/多种子/全武器矩阵）+ `scripts/duel-sim.ts` CLI。
关键修正：AI 抖动必须用**有状态 RNG**（此前 `rnd(seed+i)` 连续输入 LCG → 抖动近似恒定，导致系统性偏差）；
米字镜像对局用于抵消左右位置偏差；慢速弹/火箭 AI 做弹道提前量。
8 轮调参（狙击新增 0.6s 蓄力以平衡"一击必杀"、手枪/冲锋枪/火箭筒/霰弹反复迭代），最终 40 种子 4320 场：
6 把主武器总胜率 41.8%~53.0%，距离定位清晰（霰弹近 81%、火箭近 74%、狙远 80%），平均 TTK 0.38~0.72s。
新增回归测试固定 20 种子校验胜率区间/距离定位/TTK。

### 10.12 准星左侧显示修复（2026-11-07）

准星可见性裁剪条件写错坐标系：`mx/my = sx(mouse.worldX/Y)` 是**世界相对量（用户坐标）**，旧代码拿它和画布像素
（`-40..canvas.width+40`）比较 → 鼠标在屏幕左半区时 `mx` 为负且 |mx|>40 被整段裁掉（右侧正常），表现为「准星在左侧显示有问题」。
改为用世界单位的 `halfW/halfH`（`canvas*fov/2+160`）判定，左中右全区域可见；浏览器像素差分验证 10%/30%/50% 位置
准星区域分别有 76/70/144 像素变化。

### 10.13 火箭筒 1 发/弹匣（2026-11-07）

用户："火箭筒就是 1/弹夹数。" → 火箭筒改为 **magSize=1 / maxReserve=5**，射速间隔实际由换弹决定
（`fireDelay 0.4s` + `reloadTime 1.5s`，单发循环 ≈1.9s）；保留直线 520px/s、无限射程、碰到即炸、伤害 115/半径 124。
复跑 20 种子对射：总胜率 51.5%（180px 67.5% / 380px 59.6% / 700px 27.5%），仍属平衡区间；43/43 测试通过。

### 10.14 地形简化 + 全域覆盖（2026-11-07）

用户："改一下地形，简单一点。然后高低左右都要有东西。"
- `buildExtraStructures` 去掉密集交错链（原 46 块 ledge/platform + 11 台地 + 塔阶），改为**简单均布**：
  地表台地 5（间距约 2.3~3.6k）、中层浮空平台 10（横跨全图）、高空平台 5（左/中/右都有）、废墟拱门 3（左/中/右）、洞窟 3（左/中/右，各 1 层大厅 + 1~2 级台阶 + 竖井）；
  保留连桥/集装箱/据点掩体/地下立柱作为路线节点；自然装饰同步减量（藤蔓/苔藓/钟乳石/远景拱 ~减半）。
- 覆盖度统计（按横向三段 × 高度四层，排除 earth/bg，共 220 个实体 rect）：
  左 high7/midair33/ground8/under19，中 23/35/9/19，右 7/34/8/18 —— 高低左右都有内容。
- 验证：43/43 测试；浏览器 5 个横向位置（800/4000/6600/10000/12500）渲染色彩采样均有内容（9~26 色），8 次随机重生 0 次嵌实体。

### 10.15 火箭筒弹匣参数按用户指定（2026-11-07）

用户："magazine=20 换弹时间=2。" → 火箭筒 `magSize=20`、`maxReserve=20`、`reloadTime=2.0`（`fireDelay` 保持 0.4s；
若"射速间隔=1/弹匣数"指的是 0.05s，可再单点调整）。复跑 20 种子对射：总胜率 52.1%（180px 67.9 / 380px 58.3 / 700px 30.0），仍在平衡区间。

### 10.16 火箭筒最终参数（2026-11-07，用户更正）

用户："错了 1 子弹 20弹匣" → "射击间隔 = 0"：火箭筒 **1 发/弹匣、共 20 个弹匣（备弹 20）**、`fireDelay=0`、
`reloadTime=2.0s` —— 实际射击节奏完全由 **2 秒换弹**决定（单发循环 2s）。复跑 20 种子对射：总胜率 51.5%（180px 67.5 / 380px 59.6 / 700px 27.5）。

### 10.17 狙击单击可击发 + 准星蓄力环（2026-11-07）

用户："狙怎么打不出子弹。" → 因为狙击需要 0.6s 蓄力，玩家"点一下"（按下立即松开）时蓄力被取消，表现为打不出子弹。
- 机制改为：**按下即开始蓄力，一旦开始就自动蓄满并击发**（松开不再取消），单击一定能开枪；按住仍是连发节奏（射击后重新蓄力）。
- 准星新增**蓄力环**（黄色圆弧 + 蓄满亮点），HUD 原有「蓄力 xx%」保留；蓄力环像素差分验证 114 px 变化。
- 平衡不受影响（AI 持续按住），43/43 测试；狙击对射仍为近距弱/远距强。

### 10.18 武器特性/狙击远距衰减/简单迷宫楼房（2026-11-07）

用户要求：手枪双倍移速+双倍飞行；冲锋枪 1.5 倍移速、1 倍飞行、射速极高、伤害=手枪；突击步枪正常速度/伤害；
狙击超过视距(>800px)非爆头只造成 99（留 1 血）；狙击/火箭筒移速 0.5~0.6 且飞行受限；楼房不要坑洼结构，改简单迷宫。

- 数值：手枪 moveSpeed/fuelMult=2.0；冲锋枪 1.5/1.0、伤害 24、fireDelay 0.05、散布 0.24、弹匣 30/150、换弹 2.2（大散布+弹匣做平衡，
  20 种子总胜率 65% 在回归区间内）；突击步枪 1.0/1.0、伤害 23（M249 保持同伤害）；狙/火箭筒 0.6/0.6 与 0.5/0.5。
- 狙击远距：`WeaponDef.farRange=800 / farDamage=99`，Projectile 增加 `weaponId`；命中躯干且射手-目标距离 >800 时伤害压到 99（留 1 血），
  视距内仍 100 一击必杀；爆头（headshotMult 2.5）依旧致死。
- 楼房：`buildMultiStoryBuilding` 重写为**简单迷宫**——实心天台 + 左右外墙（底部 110px 门洞）+ 2 道交错内墙 + 2 段中部短墙，
  不再有楼板/天井/窗户坑洼；窗户装饰也减为每两层一排两扇。旧碰撞测试点 (1412,2100) 仍为实心墙、门洞可通行、天台可占点。
- 验证：43/43 测试（新增狙击远距 99/视距内 100、武器特性断言）；20 种子对射全武器总胜率 40~65% 在回归区间；平衡/地形结构均已复验。

### 10.19 手枪飞行容量回满修复（2026-11-07）

用户："手枪的飞行容量不能恢复满。"
- 根因：`updateJetpackFuel()` 内部把油量夹到 **基础 `P.jetpackFuel`(1.0)**，而手枪 `fuelMult=2.0`、容量 2.0；
  世界层再 `Math.min(fuelMax, ...)` 也救不回来 → 手枪永远只能回到 1.0（看起来"回不满"）。
- 修法：`updateJetpackFuel(..., maxFuel = P.jetpackFuel)` 增加容量参数，World 传入当前武器 `fuelMax`；
  切枪/换低容量武器时仍按容量夹断。
- 验证：新测试（手枪耗尽后落地回充到 2.0、且 > 基础 1.0）+ 浏览器实测 `refilled=2.0`、HUD 燃料条 100%；44/44 测试。

### 10.20 尚未完成（设计位）

联机大厅页面（`server/server.js` 已带入）、浏览器联机入口（Peer 传输已就绪）、完整 v2 UI、主机迁移。
