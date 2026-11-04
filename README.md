# Teeworlds-style PVP · 可运行骨架

手机端 2D 横版射击 PVP（带重力、实时自由瞄准），**联机 / 操作 / 界面逻辑三层分离**。
本骨架验证三件事：`core` 确定性物理、**Loopback 联机跑通本地对局**、三层互不 import。

## 运行

```bash
node src/main.ts                # Loopback 本地对局演示（服务器权威 + 快照插值）
node --test tests/*.test.ts     # core 确定性 + 三层集成单测
```

## 三层边界

```
core/   纯游戏逻辑（零 IO，可在服务端复用）—— World.step 确定性推进
input/  操作层：TouchState → InputMapper → Intent[]（不碰网络/渲染）
net/    联机层：Transport 抽象(WebRTC/UDP/Loopback) + 服务器权威 + 快照插值 + 房间
ui/     界面逻辑层：快照 → HUDViewModel / Presenter / ScreenStateMachine
main.ts 组合根：唯一依赖注入接线点
```

依赖方向（单向，无环）：

```
input → IntentBus → net(ClientSession) → [Server] ServerSim → core/World
core/World.snapshot() → net(ServerMsg) → StateSync → ui/Presenter → HUDViewModel
```

- `core` **不 import** `input`/`net`/`ui`（core 用 `WorldInput`，Intent 由联机层合并）。
- 传输可替换：`net/transport/Loopback.ts` ↔ `WebRTC`/`UDP`，上层代码不动。
- UI 动作通过意图回抛（`Presenter.onIntent → IntentBus`），不直接调用网络。

## 关键文件

| 文件 | 职责 |
|---|---|
| `core/sim/world.ts` | 服务器权威世界：重力/移动/跳跃/喷射器/弹道/命中/击杀/重生，确定性 `step` |
| `core/sim/physics.ts` | 物理常数 + 积分（重力、移动、跳跃、喷射器） |
| `core/sim/projectile.ts` | 弹道（受重力抛物线） |
| `input/InputMapper.ts` | 触摸状态 → 意图（左摇杆移动、右摇杆 360° 瞄准、射击/跳跃/喷射/装填） |
| `net/ServerSim.ts` | 权威模拟 + 意图合并 + 快照广播 |
| `net/StateSync.ts` | 快照插值（客户端预测+纠错框架点） |
| `net/transport/Loopback.ts` | 本机同步传输（可替换为 WebRTC/UDP） |
| `ui/Presenter.ts` | 快照 → HUD 视图模型 + 可读摘要 |
| `main.ts` | 组合根：组装三层 + 本地对局脚本 |
