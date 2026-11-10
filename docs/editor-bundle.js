"use strict";
(() => {
  // src/core/wrap.ts
  var WORLD_W = 13200;
  var WORLD_H = 4400;
  var SURFACE_Y = 2800;

  // src/core/map.ts
  var CEILING_TOP = 280;
  var CEILING_THICK = 80;
  var WALL_THICK = 60;
  var MAIN_DECK_TOP = 1760;
  var MAIN_DECK_THICK = 40;
  var ARCH_CENTER_TOP = 680;
  var UNIFIED_EDGE_HIGHLIGHT = "#38bdf8";
  function defaultMapData() {
    const solids = [
      // ── 1. 四面封闭边界（顶部完整无入口天花板 + 左右全高封闭墙；底部由世界内置 SURFACE_Y=2800 封闭） ──
      { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: "platform" },
      { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" },
      { x: WORLD_W - WALL_THICK, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" },
      // ── 2. 天空拱形浮空方块群（有上有下高低交错，正中 x=6600 放置复活点与旗帜） ──
      ...SKY_ARCH_BLOCKS(),
      // ── 3. 中层地表主平台（y=1760，出生点所在平面）+ 左翼高掩体柱 ──
      // 左翼出生台与主平台（x=500..680 留 180px 狭窄竖井通往地下地道）
      { x: WALL_THICK, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: "platform" },
      { x: 680, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: "platform" },
      // 左翼出生点旁高耸掩体柱（对应设计图左侧出生点旁高框）
      { x: 740, y: 1440, w: 120, h: 320, kind: "cover" },
      // 右翼主平台与出生台（x=12520..12700 留 180px 狭窄竖井通往地下地道）
      { x: 8e3, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: "platform" },
      { x: 12700, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: "platform" },
      // ── 4. 地下区域（y > 1760）：全部采用实心岩体围合成狭窄地道（高 120~160px，竖井宽 160~260px） ──
      ...UNDERGROUND_NARROW_TUNNEL_SOLIDS()
    ];
    return { name: "\u5C01\u95ED\u62F1\u9876\xB7\u5730\u4E0B\u72ED\u9053\u7ADE\u6280\u573A", solids };
  }
  function SKY_ARCH_BLOCKS() {
    return [
      // 左侧阶梯上升段
      { x: 1200, y: 1280, w: 200, h: 360, kind: "block" },
      { x: 1680, y: 1080, w: 420, h: 240, kind: "block" },
      { x: 2740, y: 700, w: 720, h: 220, kind: "block" },
      // 拱顶左峰（高）
      { x: 3940, y: 560, w: 880, h: 220, kind: "block" },
      // 左中交错块（下沉，体现“有上有下”）
      { x: 5220, y: 760, w: 560, h: 220, kind: "block" },
      // 正中央主方块（x=6200..7000，中心 x=6600，顶面 y=680：放置正中旗帜与复活点）
      { x: 6200, y: ARCH_CENTER_TOP, w: 800, h: 220, kind: "block" },
      // 拱顶右峰（高，体现“有上有下”）
      { x: 7420, y: 560, w: 720, h: 220, kind: "block" },
      // 右中交错块（下沉）
      { x: 8580, y: 740, w: 720, h: 240, kind: "block" },
      // 右侧阶梯下降段
      { x: 9700, y: 920, w: 580, h: 260, kind: "block" },
      { x: 10680, y: 1080, w: 440, h: 280, kind: "block" },
      { x: 11480, y: 1240, w: 200, h: 360, kind: "block" },
      { x: 12020, y: 1320, w: 200, h: 340, kind: "block" }
    ];
  }
  function UNDERGROUND_NARROW_TUNNEL_SOLIDS() {
    return [
      // ── A. 左右浅层狭道顶部悬挂掩体块（对应设计图主平台横线下方的掩体块） ──
      { x: 1800, y: 1800, w: 260, h: 60, kind: "cover" },
      { x: 3e3, y: 1800, w: 260, h: 70, kind: "cover" },
      { x: 4100, y: 1800, w: 220, h: 60, kind: "cover" },
      { x: 9e3, y: 1800, w: 180, h: 60, kind: "cover" },
      { x: 1e4, y: 1800, w: 240, h: 60, kind: "cover" },
      { x: 11100, y: 1800, w: 340, h: 70, kind: "block" },
      // ── B. 左右两侧地下实心岩层（围合出左侧 x=500..680 与右侧 x=12520..12700 的 L 型狭窄地道） ──
      // 左端外侧全高地下实心墙（x=60..500, y=1800..2660，底部预留 y=2660..2800 底层贯通狭道）
      { x: WALL_THICK, y: 1800, w: 440, h: 860, kind: "block" },
      // 左侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=1280..1440 联络竖井）
      { x: 680, y: 2040, w: 600, h: 320, kind: "block" },
      { x: 1440, y: 2040, w: 1060, h: 320, kind: "block" },
      // 左侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
      { x: 680, y: 2500, w: 1820, h: 160, kind: "block" },
      // 右端外侧全高地下实心墙（x=12700..13140, y=1800..2660）
      { x: 12700, y: 1800, w: 440, h: 860, kind: "block" },
      // 右侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=11760..11920 联络竖井）
      { x: 10700, y: 2040, w: 1060, h: 320, kind: "block" },
      { x: 11920, y: 2040, w: 600, h: 320, kind: "block" },
      // 右侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
      { x: 10700, y: 2500, w: 1820, h: 160, kind: "block" },
      // ── C. 中央地下顶盖与中央下沉狭窄井道（y=1800..2160） ──
      // 左中顶盖岩层（x=2500..5200, y=2040..2160，厚 120px，上方为浅层狭道，下方为 y=2160..2280 地下上层狭道）
      { x: 2500, y: 2040, w: 2700, h: 120, kind: "platform" },
      // 右中顶盖岩层（x=8000..10700, y=2040..2160，厚 120px）
      { x: 8e3, y: 2040, w: 2700, h: 120, kind: "platform" },
      // 中央咽喉区左肩巨石（x=5380..6260, y=1800..2160，留出 x=5200..5380 宽 180px 的西侧下沉竖井）
      { x: 5380, y: 1800, w: 880, h: 360, kind: "block" },
      // 中央咽喉区右肩巨石（留出 x=6260..6660 中央竖井、x=7020..7360 东侧竖井及 x=7820..8000 边缘竖井）
      { x: 6660, y: 1800, w: 360, h: 360, kind: "block" },
      { x: 7360, y: 1800, w: 460, h: 360, kind: "block" },
      // ── D. 中央地下迷宫核心岩体群（围合出上 y=2160..2280、中 y=2380..2500、下 y=2660..2800 三层狭窄横道与多条狭窄竖井） ──
      // 1. 左侧竖直巨岩（左留 x=2500..2660 竖井，右留 x=3220..3380 竖井）
      { x: 2660, y: 2280, w: 560, h: 380, kind: "block" },
      // 2. 左中上层横岩（上留 y=2160..2280 狭道，下留 y=2380..2500 狭道）
      { x: 3380, y: 2280, w: 2240, h: 100, kind: "block" },
      // 3. 左中下层横岩（上留 y=2380..2500 狭道，下留 y=2660..2800 底层狭道）
      { x: 3380, y: 2500, w: 2240, h: 160, kind: "block" },
      // 4. 正中竖直巨柱（左留 x=5620..5820 竖井，右留 x=6380..6640 核心中央竖井）
      { x: 5820, y: 2280, w: 560, h: 380, kind: "block" },
      // 5. 右中上层横岩（预留 x=7020..7180 狭窄竖井供垂直机动与射击）
      { x: 6640, y: 2280, w: 380, h: 100, kind: "block" },
      { x: 7180, y: 2280, w: 1920, h: 100, kind: "block" },
      // 6. 右中下层横岩（预留 x=7020..7180 狭窄竖井）
      { x: 6640, y: 2500, w: 380, h: 160, kind: "block" },
      { x: 7180, y: 2500, w: 1920, h: 160, kind: "block" },
      // 7. 右侧竖直巨岩（左留 x=9100..9260 竖井，右留 x=10540..10700 竖井）
      { x: 9260, y: 2280, w: 1280, h: 380, kind: "block" }
    ];
  }
  function carveTunnelInSolids(solids, carve, minSize = 20) {
    const cx0 = carve.x;
    const cy0 = carve.y;
    const cx1 = carve.x + carve.w;
    const cy1 = carve.y + carve.h;
    const out = [];
    for (const s of solids) {
      const sx0 = s.x;
      const sy0 = s.y;
      const sx1 = s.x + s.w;
      const sy1 = s.y + s.h;
      if (sx1 <= cx0 || sx0 >= cx1 || sy1 <= cy0 || sy0 >= cy1) {
        out.push(s);
        continue;
      }
      if (cy0 - sy0 >= minSize) {
        out.push({ x: sx0, y: sy0, w: s.w, h: cy0 - sy0, kind: s.kind });
      }
      if (sy1 - cy1 >= minSize) {
        out.push({ x: sx0, y: cy1, w: s.w, h: sy1 - cy1, kind: s.kind });
      }
      const midY0 = Math.max(sy0, cy0);
      const midY1 = Math.min(sy1, cy1);
      const midH = midY1 - midY0;
      if (midH >= minSize) {
        if (cx0 - sx0 >= minSize) {
          out.push({ x: sx0, y: midY0, w: cx0 - sx0, h: midH, kind: s.kind });
        }
        if (sx1 - cx1 >= minSize) {
          out.push({ x: cx1, y: midY0, w: sx1 - cx1, h: midH, kind: s.kind });
        }
      }
    }
    return out;
  }
  function sanitizeMapData(raw) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw;
    const solidsRaw = Array.isArray(o.solids) ? o.solids : [];
    const solids = [];
    for (const s of solidsRaw) {
      if (!s || typeof s !== "object") continue;
      const r = s;
      const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
      if (![x, y, w, h].every(Number.isFinite)) continue;
      if (w <= 0 || h <= 0) continue;
      const kind = r.kind === "platform" || r.kind === "block" ? r.kind : "cover";
      solids.push({ x, y, w, h, kind });
      if (solids.length >= 2e3) break;
    }
    if (solids.length === 0) return null;
    return { name: typeof o.name === "string" ? o.name : "\u81EA\u5B9A\u4E49\u5730\u56FE", solids };
  }

  // src/core/sim/physics.ts
  var defaults = {
    mass: 1.3,
    // 用户调优值：稍重
    gravity: 1250,
    moveSpeed: 300,
    // 水平极速（无惯性：按下即达，松开即停）
    jumpImpulse: 490,
    // 用户调优值
    maxFall: 1200,
    jetpackAccel: 4200,
    // 更快响应：净加速 (4200-1250)/1.3 ≈ 2269/s → 约 0.12s 到升空极速（原 3000≈0.21s）
    jetpackMaxUp: 280,
    // 用户调优值：升空速度上限（短促小跳手感）
    jetpackFuel: 1,
    // 飞行槽 = 原值 0.5 的两倍：满能量可喷 2s（drain 0.5）
    jetpackDrain: 0.5,
    // 每秒消耗半槽
    jetpackRecharge: 0.7
    // 落地回充：约 1.43s 回满（空中不回充）
  };
  var P = { ...defaults };
  var RECOIL_DECAY = 7;
  var RECOIL_INTEGRAL = (1 - Math.exp(-RECOIL_DECAY * (1 / 60))) / RECOIL_DECAY;

  // src/core/terrain.ts
  var TILE_SIZE = 20;
  var GRID_W = Math.floor(WORLD_W / TILE_SIZE);
  var GRID_H = Math.floor(WORLD_H / TILE_SIZE);

  // src/core/sim/landmarks.ts
  var CEILING_STAND = 264;
  var MAIN_DECK_STAND = MAIN_DECK_TOP - 16;
  var CENTER_RESPAWN_X = 6600;
  var CENTER_RESPAWN_Y = ARCH_CENTER_TOP - 16;
  var CENTER_RESPAWN_POINT = {
    id: "cp_c",
    code: "C",
    name: "\u6B63\u4E2D\u590D\u6D3B\u70B9",
    x: CENTER_RESPAWN_X,
    y: CENTER_RESPAWN_Y
  };
  var FFA_SPAWN_POINTS = [
    { x: 1180, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u897F\u7FFC\u5E73\u53F0" },
    { x: 2400, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E2D\u897F\u5E73\u53F0" },
    { x: 3100, y: 700 - 16, team: "ffa", label: "FFA\xB7\u897F\u62F1\u6D6E\u5C9B" },
    { x: 4380, y: 560 - 16, team: "ffa", label: "FFA\xB7\u5DE6\u5CF0\u62F1\u5C9B" },
    { x: 4500, y: 2500 - 16, team: "ffa", label: "FFA\xB7\u897F\u533A\u5730\u9053" },
    { x: 5500, y: 760 - 16, team: "ffa", label: "FFA\xB7\u4E2D\u897F\u62F1\u5C9B" },
    { x: 7780, y: 560 - 16, team: "ffa", label: "FFA\xB7\u53F3\u5CF0\u62F1\u5C9B" },
    { x: 8500, y: 2500 - 16, team: "ffa", label: "FFA\xB7\u4E1C\u533A\u5730\u9053" },
    { x: 9990, y: 920 - 16, team: "ffa", label: "FFA\xB7\u4E1C\u62F1\u6D6E\u5C9B" },
    { x: 10800, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E2D\u4E1C\u5E73\u53F0" },
    { x: 12020, y: MAIN_DECK_STAND, team: "ffa", label: "FFA\xB7\u4E1C\u7FFC\u5E73\u53F0" }
  ];
  var SPAWN_POINTS = [
    { x: 260, y: MAIN_DECK_STAND, team: "red" },
    { x: 12940, y: MAIN_DECK_STAND, team: "blue" },
    { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, team: "green" },
    ...FFA_SPAWN_POINTS.map(({ x, y, team }) => ({ x, y, team }))
  ];
  var AMMO_SPOTS = [
    { x: 4950, y: MAIN_DECK_STAND, area: "\u4E2D\u5FC3\u897F\xB7\u4E3B\u5E73\u53F0\u5185\u4FA7\u5F39\u836F\u70B9" },
    { x: 5500, y: 760 - 16, area: "\u4E2D\u5FC3\u897F\xB7\u62F1\u6865\u5F39\u836F\u70B9" },
    { x: 6320, y: CENTER_RESPAWN_Y, area: "\u6B63\u4E2D\u62F1\u9876\xB7\u897F\u4FA7\u5F39\u836F\u70B9" },
    { x: 6880, y: CENTER_RESPAWN_Y, area: "\u6B63\u4E2D\u62F1\u9876\xB7\u4E1C\u4FA7\u5F39\u836F\u70B9" },
    { x: 7780, y: 560 - 16, area: "\u4E2D\u5FC3\u4E1C\xB7\u62F1\u6865\u5F39\u836F\u70B9" },
    { x: 8250, y: MAIN_DECK_STAND, area: "\u4E2D\u5FC3\u4E1C\xB7\u4E3B\u5E73\u53F0\u5185\u4FA7\u5F39\u836F\u70B9" },
    { x: 6500, y: 2800 - 16, area: "\u5730\u4E0B\u4E2D\u592E\u72ED\u9053\xB7\u6838\u5FC3\u5F39\u836F\u70B9" }
  ];
  var MORTARS_INIT = [
    { id: "mortar_left", name: "\u897F\u533A\u8FEB\u51FB\u70AE", x: 920, y: CEILING_STAND, angle: -Math.PI * 0.28, power: 24 },
    { id: "mortar_mid_w", name: "\u4E2D\u592E\u897F\u8FEB\u51FB\u70AE", x: 3300, y: CEILING_STAND, angle: -Math.PI * 0.3, power: 23 },
    { id: "mortar_center", name: "\u4E2D\u592E\u8FEB\u51FB\u70AE", x: 5400, y: CEILING_STAND, angle: -Math.PI * 0.35, power: 24.5 },
    { id: "mortar_mid_e", name: "\u4E2D\u592E\u4E1C\u8FEB\u51FB\u70AE", x: 7800, y: CEILING_STAND, angle: -Math.PI * 0.7, power: 23 },
    { id: "mortar_right", name: "\u4E1C\u533A\u8FEB\u51FB\u70AE", x: 12260, y: CEILING_STAND, angle: -Math.PI * 0.72, power: 24 }
  ];
  var RANDOM_SPAWN_CANDIDATES = [
    { x: 1180, y: MAIN_DECK_STAND - 20 },
    { x: 2400, y: MAIN_DECK_STAND - 20 },
    { x: 3600, y: MAIN_DECK_STAND - 20 },
    { x: 4700, y: MAIN_DECK_STAND - 20 },
    { x: 3100, y: 700 - 36 },
    { x: 4380, y: 560 - 36 },
    { x: 5500, y: 760 - 36 },
    { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y - 24 },
    { x: 7780, y: 560 - 36 },
    { x: 8940, y: 740 - 36 },
    { x: 9990, y: 920 - 36 },
    { x: 8500, y: MAIN_DECK_STAND - 20 },
    { x: 9600, y: MAIN_DECK_STAND - 20 },
    { x: 10800, y: MAIN_DECK_STAND - 20 },
    { x: 12020, y: MAIN_DECK_STAND - 20 },
    { x: 4500, y: 2500 - 24 },
    { x: 6500, y: 2800 - 24 },
    { x: 8500, y: 2500 - 24 }
  ];

  // src/core/sim/spatial.ts
  var BUCKET_SIZE = 200;
  var INV_BUCKET_SIZE = 1 / BUCKET_SIZE;
  var NUM_BUCKETS = Math.ceil(WORLD_W / BUCKET_SIZE);

  // src/web/textures.ts
  var cache = /* @__PURE__ */ new Map();
  function makeTex(size, paint) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const c = cv.getContext("2d");
    paint(c);
    return cv;
  }
  function paintUnifiedTechPanel(c) {
    const S = 96;
    const half = S / 2;
    c.fillStyle = "#162032";
    c.fillRect(0, 0, S, S);
    c.fillStyle = "#1b273d";
    c.fillRect(2, 2, half - 4, half - 4);
    c.fillRect(half + 2, half + 2, half - 4, half - 4);
    c.fillStyle = "#182337";
    c.fillRect(half + 2, 2, half - 4, half - 4);
    c.fillRect(2, half + 2, half - 4, half - 4);
    c.strokeStyle = "rgba(10, 15, 26, 0.85)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, half);
    c.lineTo(S, half);
    c.moveTo(half, 0);
    c.lineTo(half, S);
    c.stroke();
    c.strokeStyle = "rgba(56, 189, 248, 0.14)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 1);
    c.lineTo(S, 1);
    c.moveTo(0, half + 1);
    c.lineTo(S, half + 1);
    c.moveTo(1, 0);
    c.lineTo(1, S);
    c.moveTo(half + 1, 0);
    c.lineTo(half + 1, S);
    c.stroke();
    for (const [ox, oy] of [[0, 0], [half, 0], [0, half], [half, half]]) {
      c.strokeStyle = "rgba(56, 189, 248, 0.08)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ox + half / 2 - 5, oy + half / 2);
      c.lineTo(ox + half / 2 + 5, oy + half / 2);
      c.moveTo(ox + half / 2, oy + half / 2 - 5);
      c.lineTo(ox + half / 2, oy + half / 2 + 5);
      c.stroke();
      for (const [rx, ry] of [[7, 7], [half - 7, 7], [7, half - 7], [half - 7, half - 7]]) {
        c.fillStyle = "rgba(8, 13, 23, 0.8)";
        c.beginPath();
        c.arc(ox + rx, oy + ry, 1.8, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "rgba(125, 211, 252, 0.35)";
        c.beginPath();
        c.arc(ox + rx - 0.4, oy + ry - 0.4, 1, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  function paintTunnelBg(c) {
    const S = 96;
    c.fillStyle = "#090e18";
    c.fillRect(0, 0, S, S);
    c.strokeStyle = "rgba(56, 189, 248, 0.06)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, S / 2);
    c.lineTo(S, S / 2);
    c.moveTo(S / 2, 0);
    c.lineTo(S / 2, S);
    c.stroke();
  }
  function texKindOf(kind) {
    if (kind === "tunnel_bg" || kind === "pipe_bg" || kind === "building_bg") return "tunnel";
    return "unifiedPanel";
  }
  function getTerrainPattern(ctx2, kind) {
    const key = texKindOf(kind);
    const hit = cache.get(key);
    if (hit) return hit;
    const cv = key === "tunnel" ? makeTex(96, paintTunnelBg) : makeTex(96, paintUnifiedTechPanel);
    const pat = ctx2.createPattern(cv, "repeat");
    if (pat) cache.set(key, pat);
    return pat;
  }
  function syncTerrainPatterns(camX, camY) {
    if (typeof DOMMatrix === "undefined") return;
    const m = new DOMMatrix().translate(-camX, -camY);
    for (const pat of cache.values()) pat.setTransform(m);
  }

  // src/web/main-editor.ts
  var SNAP = 20;
  var EDITOR_KEY = "pvp-editor-map";
  var GAME_KEY = "pvp-custom-map";
  var canvas = document.getElementById("editorCanvas");
  var ctx = canvas.getContext("2d");
  var statusEl = document.getElementById("status");
  var brushInput = document.getElementById("brushSize");
  var brushLabel = document.getElementById("brushLabel");
  var camera = { x: WORLD_W / 2, y: SURFACE_Y / 2, zoom: 0.11 };
  var brushKind = "platform";
  var brushTiles = 1;
  var map = loadInitial();
  var tool = "draw";
  var snapEnabled = true;
  var showGrid = true;
  var showTexture = true;
  var showLandmarks = true;
  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 80;
  var selected = -1;
  var dragState = null;
  var drawStart = null;
  var drawCur = null;
  var erasing = false;
  var panning = false;
  var spaceDown = false;
  var panLast = { x: 0, y: 0 };
  var mouseWorld = { x: 0, y: 0 };
  var MINIMAP_W = 280;
  var MINIMAP_H = Math.round(MINIMAP_W * (WORLD_H / WORLD_W));
  var MINIMAP_PAD = 16;
  function resize() {
    canvas.width = window.innerWidth || 1280;
    canvas.height = window.innerHeight || 800;
  }
  window.addEventListener("resize", resize);
  resize();
  fitToWindow();
  function loadInitial() {
    try {
      const a = localStorage.getItem(EDITOR_KEY);
      if (a) {
        const m = sanitizeMapData(JSON.parse(a));
        if (m) return m;
      }
      const b = localStorage.getItem(GAME_KEY);
      if (b) {
        const m = sanitizeMapData(JSON.parse(b));
        if (m) return m;
      }
    } catch {
    }
    return defaultMapData();
  }
  function pushHistory() {
    undoStack.push(JSON.stringify(map));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(JSON.stringify(map));
    map = JSON.parse(prev);
    selected = -1;
    updateStatus();
    updateSelectionInfo();
  }
  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(map));
    map = JSON.parse(next);
    selected = -1;
    updateStatus();
    updateSelectionInfo();
  }
  var KIND_LABEL = {
    platform: "\u5E73\u53F0",
    cover: "\u63A9\u4F53",
    block: "\u5CA9\u5757"
  };
  function updateSelectionInfo() {
    const el = document.getElementById("selectionInfo");
    const inspX = document.getElementById("inspX");
    const inspY = document.getElementById("inspY");
    const inspW = document.getElementById("inspW");
    const inspH = document.getElementById("inspH");
    const s = selected >= 0 ? map.solids[selected] : null;
    if (el) {
      el.textContent = s ? `\u5DF2\u9009\u4E2D #${selected} [${KIND_LABEL[s.kind]}] (${Math.round(s.x)}, ${Math.round(s.y)}) ${Math.round(s.w)}\xD7${Math.round(s.h)} \xB7 \u53EF\u62D6\u62FD8\u5411\u624B\u67C4\u7F29\u653E` : "\u672A\u9009\u4E2D\u65B9\u5757\uFF08\u5207\u6362\u201C\u9009\u62E9/\u7F29\u653E\u201D\u70B9\u9009\u65B9\u5757\uFF0C\u53EF\u62D6\u62FD 8 \u4E2A\u8FB9\u7F18\u624B\u67C4\u7F29\u653E\uFF09";
    }
    if (inspX && inspY && inspW && inspH) {
      if (s) {
        inspX.value = String(Math.round(s.x));
        inspY.value = String(Math.round(s.y));
        inspW.value = String(Math.round(s.w));
        inspH.value = String(Math.round(s.h));
        inspX.disabled = inspY.disabled = inspW.disabled = inspH.disabled = false;
      } else {
        inspX.value = inspY.value = inspW.value = inspH.value = "";
        inspX.disabled = inspY.disabled = inspW.disabled = inspH.disabled = true;
      }
    }
  }
  function hitTest(wx, wy) {
    for (let i = map.solids.length - 1; i >= 0; i--) {
      const s = map.solids[i];
      if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i;
    }
    return -1;
  }
  function getResizeHandles(s) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    return [
      { id: "nw", x: s.x, y: s.y },
      { id: "n", x: cx, y: s.y },
      { id: "ne", x: s.x + s.w, y: s.y },
      { id: "e", x: s.x + s.w, y: cy },
      { id: "se", x: s.x + s.w, y: s.y + s.h },
      { id: "s", x: cx, y: s.y + s.h },
      { id: "sw", x: s.x, y: s.y + s.h },
      { id: "w", x: s.x, y: cy }
    ];
  }
  function hitTestHandle(wx, wy) {
    if (selected < 0 || !map.solids[selected]) return null;
    const s = map.solids[selected];
    const tol = Math.max(18, 10 / camera.zoom);
    for (const h of getResizeHandles(s)) {
      if (Math.abs(wx - h.x) <= tol && Math.abs(wy - h.y) <= tol) return h.id;
    }
    if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return "move";
    return null;
  }
  function fitToWindow() {
    const margin = 48;
    const availW = Math.max(400, canvas.width - 420 - margin);
    const availH = Math.max(300, canvas.height - margin * 2);
    camera.zoom = Math.max(0.05, Math.min(availW / WORLD_W, availH / (SURFACE_Y + 300)));
    camera.x = WORLD_W / 2 - 180 / camera.zoom;
    camera.y = (SURFACE_Y + 200) / 2;
  }
  function updateStatus() {
    if (statusEl) statusEl.textContent = `${map.solids.length} \u5757 \xB7 \u7EDF\u4E00\u9AD8\u4EAE ${UNIFIED_EDGE_HIGHLIGHT}`;
  }
  function snap(v) {
    return snapEnabled ? Math.round(v / SNAP) * SNAP : Math.round(v);
  }
  function sx(wx) {
    return canvas.width / 2 + (wx - camera.x) * camera.zoom;
  }
  function sy(wy) {
    return canvas.height / 2 + (wy - camera.y) * camera.zoom;
  }
  function screenToWorld(px, py) {
    return { x: camera.x + (px - canvas.width / 2) / camera.zoom, y: camera.y + (py - canvas.height / 2) / camera.zoom };
  }
  function render() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#040812");
    sky.addColorStop(0.55, "#091326");
    sky.addColorStop(1, "#0e1b33");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ugTop = sy(MAIN_DECK_TOP);
    const gy = sy(SURFACE_Y);
    ctx.fillStyle = "rgba(7, 11, 20, 0.55)";
    ctx.fillRect(sx(0), ugTop, WORLD_W * camera.zoom, gy - ugTop);
    ctx.fillStyle = "#131c2e";
    ctx.fillRect(sx(0), gy, WORLD_W * camera.zoom, (WORLD_H - SURFACE_Y) * camera.zoom);
    ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(0), gy, WORLD_W * camera.zoom, (WORLD_H - SURFACE_Y) * camera.zoom);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(0), sy(0), WORLD_W * camera.zoom, SURFACE_Y * camera.zoom);
    if (showGrid && camera.zoom > 0.08) {
      const step = camera.zoom > 0.22 ? 200 : 400;
      ctx.strokeStyle = "rgba(51, 65, 85, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += step) {
        const px = sx(x);
        ctx.moveTo(px, sy(0));
        ctx.lineTo(px, sy(SURFACE_Y));
      }
      for (let y = 0; y <= SURFACE_Y; y += step) {
        const py = sy(y);
        ctx.moveTo(sx(0), py);
        ctx.lineTo(sx(WORLD_W), py);
      }
      ctx.stroke();
    }
    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(sx(0), ugTop);
    ctx.lineTo(sx(WORLD_W), ugTop);
    ctx.stroke();
    ctx.fillStyle = "rgba(125, 211, 252, 0.78)";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText("\u25BC \u51FA\u751F\u70B9\u5E73\u9762 (y=1760) \u4EE5\u4E0B\uFF1A\u5730\u4E0B\u72ED\u7A84\u5730\u9053\u533A", sx(140), ugTop - 6);
    ctx.restore();
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    syncTerrainPatterns(camera.x, camera.y);
    for (const s of map.solids) {
      const left = s.x - camera.x;
      const top = s.y - camera.y;
      if (showTexture) {
        const pat = getTerrainPattern(ctx, s.kind);
        ctx.fillStyle = pat ?? "#162032";
      } else {
        ctx.fillStyle = "#182438";
      }
      ctx.fillRect(left, top, s.w, s.h);
      ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
      ctx.fillRect(left, top, s.w, 3);
      ctx.fillStyle = "rgba(2, 6, 23, 0.45)";
      ctx.fillRect(left, top + s.h - 3, s.w, 3);
      ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
      ctx.lineWidth = Math.max(1.5, 2 / camera.zoom);
      ctx.strokeRect(left + 1, top + 1, s.w - 2, s.h - 2);
    }
    ctx.restore();
    if (selected >= 0 && map.solids[selected]) {
      const sel = map.solids[selected];
      ctx.save();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx(sel.x), sy(sel.y), sel.w * camera.zoom, sel.h * camera.zoom);
      ctx.setLineDash([]);
      for (const h of getResizeHandles(sel)) {
        const hx = sx(h.x);
        const hy = sy(h.y);
        ctx.fillStyle = "#fbbf24";
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.fillRect(hx - 4.5, hy - 4.5, 9, 9);
        ctx.strokeRect(hx - 4.5, hy - 4.5, 9, 9);
      }
      ctx.restore();
    }
    if (showLandmarks) {
      for (const sp of SPAWN_POINTS) {
        const px = sx(sp.x);
        const py = sy(sp.y);
        ctx.save();
        if (sp.team === "ffa") {
          ctx.fillStyle = "#facc15";
          ctx.strokeStyle = "#0f172a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (camera.zoom >= 0.09) {
            ctx.fillStyle = "#fde047";
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("FFA", px, py - 8);
          }
        } else if (sp.team === "red" || sp.team === "blue") {
          const isLeft = sp.x < WORLD_W / 2;
          ctx.fillStyle = isLeft ? "rgba(14,165,233,0.4)" : "rgba(244,63,94,0.4)";
          ctx.strokeStyle = isLeft ? "#38bdf8" : "#f43f5e";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(px, py - 10, Math.max(8, 34 * camera.zoom), Math.max(12, 50 * camera.zoom), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
      {
        const cx = sx(CENTER_RESPAWN_POINT.x);
        const cy = sy(CENTER_RESPAWN_POINT.y);
        ctx.save();
        ctx.fillStyle = "#10b981";
        ctx.strokeStyle = "#ecfdf5";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#6ee7b7";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("\u{1F6A9} \u6B63\u4E2D\u590D\u6D3B\u70B9 C", cx, cy - 11);
        ctx.restore();
      }
      for (const am of AMMO_SPOTS) {
        const ax = sx(am.x);
        const ay = sy(am.y);
        ctx.save();
        ctx.fillStyle = "#22c55e";
        ctx.strokeStyle = "#052e16";
        ctx.lineWidth = 1.5;
        ctx.fillRect(ax - 5, ay - 5, 10, 10);
        ctx.strokeRect(ax - 5, ay - 5, 10, 10);
        if (camera.zoom >= 0.09) {
          ctx.fillStyle = "#86efac";
          ctx.font = "bold 10px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("\u5F39\u836F", ax, ay - 8);
        }
        ctx.restore();
      }
    }
    if (drawStart && drawCur) {
      const x = Math.min(drawStart.x, drawCur.x);
      const y = Math.min(drawStart.y, drawCur.y);
      const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles;
      const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles;
      ctx.save();
      if (tool === "carve") {
        ctx.fillStyle = "rgba(244, 63, 94, 0.28)";
        ctx.strokeStyle = "#fb7185";
        ctx.setLineDash([6, 4]);
      } else {
        ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
        ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
      }
      ctx.lineWidth = 2;
      ctx.fillRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom);
      ctx.strokeRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.strokeRect(sx(mouseWorld.x), sy(mouseWorld.y), SNAP * camera.zoom, SNAP * camera.zoom);
    renderMinimap();
    ctx.fillStyle = "rgba(226, 232, 240, 0.92)";
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    ctx.fillText(
      `\u5750\u6807 (${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.y)}) \xB7 \u7F29\u653E ${(camera.zoom * 100).toFixed(0)}% \xB7 FFA\u51FA\u751F\u70B9 ${FFA_SPAWN_POINTS.length} \u5904 \xB7 \u4E2D\u5FC3\u5F39\u836F\u70B9 ${AMMO_SPOTS.length} \u5904`,
      420,
      canvas.height - 14
    );
    requestAnimationFrame(render);
  }
  function renderMinimap() {
    const mx = canvas.width - MINIMAP_W - MINIMAP_PAD;
    const my = canvas.height - MINIMAP_H - MINIMAP_PAD;
    ctx.save();
    ctx.fillStyle = "rgba(2, 6, 23, 0.9)";
    ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
    ctx.lineWidth = 1.5;
    ctx.fillRect(mx, my, MINIMAP_W, MINIMAP_H);
    ctx.strokeRect(mx, my, MINIMAP_W, MINIMAP_H);
    const scaleX = MINIMAP_W / WORLD_W;
    const scaleY = MINIMAP_H / WORLD_H;
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
    ctx.lineWidth = 0.6;
    for (const s of map.solids) {
      const rx = mx + s.x * scaleX;
      const ry = my + s.y * scaleY;
      const rw = Math.max(1, s.w * scaleX);
      const rh = Math.max(1, s.h * scaleY);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.fillStyle = "#facc15";
    for (const sp of FFA_SPAWN_POINTS) {
      ctx.fillRect(mx + sp.x * scaleX - 1.5, my + sp.y * scaleY - 1.5, 3, 3);
    }
    ctx.fillStyle = "#22c55e";
    for (const am of AMMO_SPOTS) {
      ctx.fillRect(mx + am.x * scaleX - 1.5, my + am.y * scaleY - 1.5, 3, 3);
    }
    const vw = canvas.width / camera.zoom * scaleX;
    const vh = canvas.height / camera.zoom * scaleY;
    const vx = mx + (camera.x - canvas.width / 2 / camera.zoom) * scaleX;
    const vy = my + (camera.y - canvas.height / 2 / camera.zoom) * scaleY;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.restore();
  }
  function addRect(kind, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    map.solids.push({ x, y, w, h, kind });
    selected = map.solids.length - 1;
    updateStatus();
    updateSelectionInfo();
  }
  function eraseAt(wx, wy) {
    const before = map.solids.length;
    map.solids = map.solids.filter((s) => !(wx >= s.x - SNAP && wx < s.x + s.w + SNAP && wy >= s.y - SNAP && wy < s.y + s.h + SNAP));
    if (map.solids.length !== before) {
      selected = -1;
      updateStatus();
      updateSelectionInfo();
    }
  }
  function clampToWorld(v, max) {
    return Math.max(0, Math.min(max, snap(v)));
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sxPx = e.clientX - rect.left;
    const syPx = e.clientY - rect.top;
    const mx = canvas.width - MINIMAP_W - MINIMAP_PAD;
    const my = canvas.height - MINIMAP_H - MINIMAP_PAD;
    if (sxPx >= mx && sxPx <= mx + MINIMAP_W && syPx >= my && syPx <= my + MINIMAP_H) {
      camera.x = (sxPx - mx) / MINIMAP_W * WORLD_W;
      camera.y = (syPx - my) / MINIMAP_H * WORLD_H;
      return;
    }
    const p = screenToWorld(sxPx, syPx);
    if (e.button === 1 || e.button === 0 && spaceDown) {
      panning = true;
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const wx = clampToWorld(p.x, WORLD_W - SNAP);
    const wy = clampToWorld(p.y, SURFACE_Y - SNAP);
    if (e.button === 2) {
      pushHistory();
      erasing = true;
      eraseAt(wx, wy);
      return;
    }
    if (e.button === 0) {
      if (tool === "erase") {
        pushHistory();
        erasing = true;
        eraseAt(wx, wy);
        return;
      }
      if (tool === "select") {
        const handle = hitTestHandle(p.x, p.y);
        if (handle && selected >= 0 && map.solids[selected]) {
          pushHistory();
          dragState = { mode: handle, startX: wx, startY: wy, orig: { ...map.solids[selected] } };
          return;
        }
        const hit = hitTest(wx, wy);
        selected = hit;
        updateSelectionInfo();
        if (hit >= 0) {
          pushHistory();
          dragState = { mode: "move", startX: wx, startY: wy, orig: { ...map.solids[hit] } };
        }
        return;
      }
      drawStart = { x: wx, y: wy };
      drawCur = { x: wx, y: wy };
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    mouseWorld = { x: clampToWorld(p.x, WORLD_W - SNAP), y: clampToWorld(p.y, SURFACE_Y - SNAP) };
    if (panning) {
      camera.x -= (e.clientX - panLast.x) / camera.zoom;
      camera.y -= (e.clientY - panLast.y) / camera.zoom;
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (erasing) {
      eraseAt(mouseWorld.x, mouseWorld.y);
      return;
    }
    if (dragState && selected >= 0 && map.solids[selected]) {
      const sel = map.solids[selected];
      const dx = mouseWorld.x - dragState.startX;
      const dy = mouseWorld.y - dragState.startY;
      const o = dragState.orig;
      if (dragState.mode === "move") {
        sel.x = Math.max(0, Math.min(WORLD_W - sel.w, snap(o.x + dx)));
        sel.y = Math.max(0, Math.min(SURFACE_Y - sel.h, snap(o.y + dy)));
      } else {
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (dragState.mode.includes("w")) x0 = Math.min(x1 - SNAP, snap(o.x + dx));
        if (dragState.mode.includes("e")) x1 = Math.max(x0 + SNAP, snap(o.x + o.w + dx));
        if (dragState.mode.includes("n")) y0 = Math.min(y1 - SNAP, snap(o.y + dy));
        if (dragState.mode.includes("s")) y1 = Math.max(y0 + SNAP, snap(o.y + o.h + dy));
        sel.x = Math.max(0, x0);
        sel.y = Math.max(0, y0);
        sel.w = Math.max(SNAP, Math.min(WORLD_W - sel.x, x1 - sel.x));
        sel.h = Math.max(SNAP, Math.min(SURFACE_Y - sel.y, y1 - sel.y));
      }
      updateSelectionInfo();
      return;
    }
    if (drawStart) drawCur = { x: mouseWorld.x, y: mouseWorld.y };
  });
  window.addEventListener("mouseup", (e) => {
    if (panning) {
      panning = false;
      return;
    }
    if (dragState) {
      dragState = null;
      return;
    }
    if (erasing) {
      erasing = false;
      return;
    }
    if (e.button === 0 && drawStart && drawCur) {
      pushHistory();
      const x = Math.min(drawStart.x, drawCur.x);
      const y = Math.min(drawStart.y, drawCur.y);
      const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles;
      const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles;
      if (tool === "carve") {
        map.solids = carveTunnelInSolids(map.solids, { x, y, w, h }, SNAP);
        selected = -1;
        updateStatus();
        updateSelectionInfo();
      } else {
        addRect(brushKind, x, y, w, h);
      }
      drawStart = null;
      drawCur = null;
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const factor = Math.exp(-e.deltaY * 12e-4);
    camera.zoom = Math.max(0.05, Math.min(1.6, camera.zoom * factor));
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
  }, { passive: false });
  function duplicateSelected() {
    if (selected < 0 || !map.solids[selected]) return;
    pushHistory();
    const s = map.solids[selected];
    map.solids.push({
      x: Math.min(WORLD_W - s.w, s.x + 80),
      y: Math.min(SURFACE_Y - s.h, s.y + 80),
      w: s.w,
      h: s.h,
      kind: s.kind
    });
    selected = map.solids.length - 1;
    updateStatus();
    updateSelectionInfo();
  }
  function mirrorSelectedAcrossCenter() {
    if (selected < 0 || !map.solids[selected]) return;
    pushHistory();
    const s = map.solids[selected];
    const mx = Math.max(0, Math.min(WORLD_W - s.w, WORLD_W - s.x - s.w));
    map.solids.push({ x: mx, y: s.y, w: s.w, h: s.h, kind: s.kind });
    selected = map.solids.length - 1;
    updateStatus();
    updateSelectionInfo();
  }
  function symmetrizeMapLeftToRight() {
    pushHistory();
    const mid = WORLD_W / 2;
    const kept = [];
    const mirrored = [];
    for (const s of map.solids) {
      if (s.x <= mid && s.x + s.w >= mid) {
        kept.push({ ...s });
      } else if (s.x + s.w <= mid) {
        kept.push({ ...s });
        mirrored.push({
          x: WORLD_W - s.x - s.w,
          y: s.y,
          w: s.w,
          h: s.h,
          kind: s.kind
        });
      }
    }
    map.solids = [...kept, ...mirrored];
    selected = -1;
    updateStatus();
    updateSelectionInfo();
  }
  function exportPanoramaPng() {
    const outW = 3300;
    const outH = 1100;
    const off = document.createElement("canvas");
    off.width = outW;
    off.height = outH;
    const c = off.getContext("2d");
    const scale = outW / WORLD_W;
    const sky = c.createLinearGradient(0, 0, 0, outH);
    sky.addColorStop(0, "#040812");
    sky.addColorStop(0.55, "#091326");
    sky.addColorStop(1, "#0e1b33");
    c.fillStyle = sky;
    c.fillRect(0, 0, outW, outH);
    c.save();
    c.scale(scale, scale);
    c.fillStyle = "rgba(7, 11, 20, 0.72)";
    c.fillRect(0, MAIN_DECK_TOP, WORLD_W, SURFACE_Y - MAIN_DECK_TOP);
    const pat = getTerrainPattern(c, "earth");
    c.fillStyle = pat ?? "#162032";
    c.fillRect(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y);
    c.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
    c.lineWidth = 6;
    c.strokeRect(3, SURFACE_Y + 3, WORLD_W - 6, WORLD_H - SURFACE_Y - 6);
    for (const s of map.solids) {
      c.fillStyle = getTerrainPattern(c, s.kind) ?? "#162032";
      c.fillRect(s.x, s.y, s.w, s.h);
      c.fillStyle = "rgba(56, 189, 248, 0.30)";
      c.fillRect(s.x, s.y, s.w, 6);
      c.strokeStyle = UNIFIED_EDGE_HIGHLIGHT;
      c.lineWidth = 5;
      c.strokeRect(s.x + 2.5, s.y + 2.5, s.w - 5, s.h - 5);
    }
    for (const sp of SPAWN_POINTS) {
      if (sp.team === "ffa") {
        c.fillStyle = "#facc15";
        c.beginPath();
        c.arc(sp.x, sp.y - 12, 26, 0, Math.PI * 2);
        c.fill();
      } else if (sp.team === "red" || sp.team === "blue") {
        const isLeft = sp.x < WORLD_W / 2;
        c.fillStyle = isLeft ? "rgba(14,165,233,0.45)" : "rgba(244,63,94,0.45)";
        c.strokeStyle = isLeft ? "#38bdf8" : "#f43f5e";
        c.lineWidth = 8;
        c.beginPath();
        c.ellipse(sp.x, sp.y - 42, 48, 68, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    for (const am of AMMO_SPOTS) {
      c.fillStyle = "#22c55e";
      c.fillRect(am.x - 22, am.y - 28, 44, 32);
    }
    c.fillStyle = "#10b981";
    c.beginPath();
    c.arc(CENTER_RESPAWN_POINT.x, CENTER_RESPAWN_POINT.y - 24, 36, 0, Math.PI * 2);
    c.fill();
    c.restore();
    const url = off.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "skyblast-2d-panorama.png";
    a.click();
  }
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") spaceDown = true;
    if (e.code === "Digit1") selectKind("platform");
    if (e.code === "Digit2") selectKind("cover");
    if (e.code === "Digit3") selectKind("block");
    if (e.code === "KeyQ") selectTool("draw");
    if (e.code === "KeyW") selectTool("select");
    if (e.code === "KeyT") selectTool("carve");
    if (e.code === "KeyE") selectTool("erase");
    if (e.code === "KeyF") fitToWindow();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.code === "KeyY") {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl && e.code === "KeyD") {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if ((e.code === "Delete" || e.code === "Backspace") && selected >= 0 && map.solids[selected]) {
      e.preventDefault();
      pushHistory();
      map.solids.splice(selected, 1);
      selected = -1;
      updateStatus();
      updateSelectionInfo();
    }
    if (selected >= 0 && map.solids[selected] && e.code.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? SNAP * 5 : SNAP;
      const sel = map.solids[selected];
      if (e.code === "ArrowLeft") sel.x = Math.max(0, sel.x - step);
      if (e.code === "ArrowRight") sel.x = Math.min(WORLD_W - sel.w, sel.x + step);
      if (e.code === "ArrowUp") sel.y = Math.max(0, sel.y - step);
      if (e.code === "ArrowDown") sel.y = Math.min(SURFACE_Y - sel.h, sel.y + step);
      updateSelectionInfo();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });
  function selectKind(kind) {
    brushKind = kind;
    for (const b of document.querySelectorAll("[data-kind]")) {
      b.classList.toggle("active", b.getAttribute("data-kind") === kind);
    }
    if (selected >= 0 && map.solids[selected]) {
      map.solids[selected].kind = kind;
      updateSelectionInfo();
    }
  }
  for (const b of document.querySelectorAll("[data-kind]")) {
    b.addEventListener("click", () => selectKind(b.getAttribute("data-kind")));
  }
  function selectTool(t) {
    tool = t;
    for (const b of document.querySelectorAll("[data-tool]")) {
      b.classList.toggle("active", b.getAttribute("data-tool") === t);
    }
    updateSelectionInfo();
  }
  for (const b of document.querySelectorAll("[data-tool]")) {
    b.addEventListener("click", () => selectTool(b.getAttribute("data-tool")));
  }
  for (const [id, key] of [["inspX", "x"], ["inspY", "y"], ["inspW", "w"], ["inspH", "h"]]) {
    const inp = document.getElementById(id);
    inp?.addEventListener("change", () => {
      if (selected < 0 || !map.solids[selected]) return;
      pushHistory();
      const v = Math.max(key === "w" || key === "h" ? SNAP : 0, Number(inp.value) || 0);
      map.solids[selected][key] = v;
      updateSelectionInfo();
    });
  }
  document.getElementById("stampTunnelH")?.addEventListener("click", () => {
    pushHistory();
    const cx = snap(camera.x - 400);
    const cy = snap(Math.max(MAIN_DECK_TOP + 40, camera.y - 120));
    map.solids.push(
      { x: cx, y: cy, w: 800, h: 60, kind: "block" },
      { x: cx, y: cy + 200, w: 800, h: 60, kind: "block" }
    );
    updateStatus();
  });
  document.getElementById("stampShaftV")?.addEventListener("click", () => {
    pushHistory();
    const cx = snap(camera.x - 140);
    const cy = snap(Math.max(MAIN_DECK_TOP + 40, camera.y - 200));
    map.solids.push(
      { x: cx, y: cy, w: 60, h: 400, kind: "block" },
      { x: cx + 220, y: cy, w: 60, h: 400, kind: "block" }
    );
    updateStatus();
  });
  document.getElementById("stampArchBlock")?.addEventListener("click", () => {
    pushHistory();
    addRect("block", snap(camera.x - 320), snap(Math.min(1400, camera.y - 110)), 640, 220);
  });
  document.getElementById("stampPillar")?.addEventListener("click", () => {
    pushHistory();
    addRect("cover", snap(camera.x - 60), snap(camera.y - 160), 120, 320);
  });
  document.getElementById("btnMirrorSel")?.addEventListener("click", mirrorSelectedAcrossCenter);
  document.getElementById("btnSymmetrize")?.addEventListener("click", symmetrizeMapLeftToRight);
  document.getElementById("btnDuplicate")?.addEventListener("click", duplicateSelected);
  document.getElementById("btnExportPng")?.addEventListener("click", exportPanoramaPng);
  var snapToggle = document.getElementById("snapToggle");
  snapToggle?.addEventListener("change", () => {
    snapEnabled = snapToggle.checked;
  });
  var gridToggle = document.getElementById("gridToggle");
  gridToggle?.addEventListener("change", () => {
    showGrid = gridToggle.checked;
  });
  var texToggle = document.getElementById("texToggle");
  texToggle?.addEventListener("change", () => {
    showTexture = texToggle.checked;
  });
  var landmarkToggle = document.getElementById("landmarkToggle");
  landmarkToggle?.addEventListener("change", () => {
    showLandmarks = landmarkToggle.checked;
  });
  document.getElementById("btnUndo")?.addEventListener("click", undo);
  document.getElementById("btnRedo")?.addEventListener("click", redo);
  document.getElementById("btnFit")?.addEventListener("click", fitToWindow);
  document.getElementById("btnPlay")?.addEventListener("click", () => {
    localStorage.setItem(GAME_KEY, JSON.stringify(map));
    localStorage.setItem(EDITOR_KEY, JSON.stringify(map));
    window.location.href = "./index.html?play=1";
  });
  brushInput?.addEventListener("input", () => {
    brushTiles = Number(brushInput.value);
    if (brushLabel) brushLabel.textContent = `${brushTiles}\xD7${brushTiles * SNAP}px`;
  });
  document.getElementById("btnSave")?.addEventListener("click", () => {
    localStorage.setItem(EDITOR_KEY, JSON.stringify(map));
    statusEl.textContent = `${map.solids.length} \u5757 \xB7 \u5DF2\u4FDD\u5B58`;
  });
  document.getElementById("btnApply")?.addEventListener("click", () => {
    localStorage.setItem(GAME_KEY, JSON.stringify(map));
    localStorage.setItem(EDITOR_KEY, JSON.stringify(map));
    window.location.href = "./index.html";
  });
  document.getElementById("btnReset")?.addEventListener("click", () => {
    pushHistory();
    map = defaultMapData();
    selected = -1;
    updateStatus();
    updateSelectionInfo();
  });
  document.getElementById("btnClear")?.addEventListener("click", () => {
    pushHistory();
    map = {
      name: "\u81EA\u5B9A\u4E49\u5C01\u95ED\u7ADE\u6280\u573A",
      solids: [
        { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: "platform" },
        { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" },
        { x: WORLD_W - WALL_THICK, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: "platform" }
      ]
    };
    selected = -1;
    updateStatus();
    updateSelectionInfo();
  });
  document.getElementById("btnExport")?.addEventListener("click", () => {
    const json = JSON.stringify(map, null, 2);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${map.name || "map"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      statusEl.textContent = `${map.solids.length} \u5757 \xB7 \u5DF2\u5BFC\u51FA`;
    } catch {
      window.prompt("\u590D\u5236\u5730\u56FE JSON\uFF1A", json);
    }
  });
  document.getElementById("btnImport")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) {
        const reader = new FileReader();
        reader.onload = () => importJson(String(reader.result ?? ""));
        reader.readAsText(f);
      } else {
        const raw = window.prompt("\u7C98\u8D34\u5730\u56FE JSON\uFF1A");
        if (raw) importJson(raw);
      }
    });
    input.click();
  });
  function importJson(raw) {
    if (!raw) return;
    try {
      const m = sanitizeMapData(JSON.parse(raw));
      if (!m) {
        window.alert("JSON \u65E0\u6548\uFF08\u6CA1\u6709\u6709\u6548 solids\uFF09");
        return;
      }
      pushHistory();
      map = m;
      selected = -1;
      updateStatus();
      updateSelectionInfo();
    } catch {
      window.alert("JSON \u89E3\u6790\u5931\u8D25");
    }
  }
  updateStatus();
  updateSelectionInfo();
  requestAnimationFrame(render);
})();
