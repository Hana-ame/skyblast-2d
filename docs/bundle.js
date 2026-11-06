"use strict";
(() => {
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
    jetpackAccel: 3e3,
    // 用户调优值：净加速 (3000-1250)/1.3 ≈ 1346/s → 约 0.21s 预热到极速
    jetpackMaxUp: 280,
    // 用户调优值：升空速度上限（短促小跳手感）
    jetpackFuel: 0.5,
    // 用户调优值：满能量只够喷 1s（drain 0.5）
    jetpackDrain: 0.5,
    // 用户调优值
    jetpackRecharge: 0.2
    // 用户调优值：回满需 2.5s（短喷长充）
  };
  var P = { ...defaults };
  function getPhysicsParams() {
    return { ...P };
  }
  function setPhysicsParams(overrides) {
    P = { ...P, ...overrides };
    return { ...P };
  }
  function resetPhysicsParams() {
    P = { ...defaults };
    return { ...P };
  }
  function applyGravity(v, dt) {
    v.y += P.gravity / P.mass * dt;
    if (v.y > P.maxFall) v.y = P.maxFall;
  }
  function move(v, dir) {
    v.x = dir * P.moveSpeed;
  }
  function jump(v) {
    v.y = -P.jumpImpulse;
  }
  function jetpack(v, dt) {
    v.y = Math.max(-P.jetpackMaxUp, v.y - P.jetpackAccel / P.mass * dt);
  }
  function updateJetpackFuel(fuel, active, dt) {
    const next = active ? fuel - P.jetpackDrain * dt : fuel + P.jetpackRecharge * dt;
    return Math.min(P.jetpackFuel, Math.max(0, next));
  }

  // src/core/wrap.ts
  var WORLD_W = 13200;
  var WORLD_H = 4400;
  var SURFACE_Y = 2800;
  function wrapX(x) {
    return (x % WORLD_W + WORLD_W) % WORLD_W;
  }
  function wrapY(y) {
    return (y % WORLD_H + WORLD_H) % WORLD_H;
  }
  function wrapDeltaX(fromX, toX) {
    let dx = wrapX(toX) - wrapX(fromX);
    if (dx > WORLD_W * 0.5) dx -= WORLD_W;
    if (dx < -WORLD_W * 0.5) dx += WORLD_W;
    return dx;
  }
  function wrapDeltaY(fromY, toY) {
    let dy = wrapY(toY) - wrapY(fromY);
    if (dy > WORLD_H * 0.5) dy -= WORLD_H;
    if (dy < -WORLD_H * 0.5) dy += WORLD_H;
    return dy;
  }
  function wrapDist(x1, y1, x2, y2) {
    return Math.hypot(wrapDeltaX(x1, x2), wrapDeltaY(y1, y2));
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // src/core/terrain.ts
  var TILE_SIZE = 20;
  var GRID_W = Math.floor(WORLD_W / TILE_SIZE);
  var GRID_H = Math.floor(WORLD_H / TILE_SIZE);
  var Terrain = class {
    grid = new Uint8Array(GRID_W * GRID_H);
    rects = [];
    shadows = [];
    setGridRect(x, y, w, h, val) {
      const gx0 = Math.max(0, Math.floor(x / TILE_SIZE));
      const gy0 = Math.max(0, Math.floor(y / TILE_SIZE));
      const gx1 = Math.min(GRID_W, Math.ceil((x + w) / TILE_SIZE));
      const gy1 = Math.min(GRID_H, Math.ceil((y + h) / TILE_SIZE));
      for (let gy = gy0; gy < gy1; gy++) {
        const row = gy * GRID_W;
        for (let gx = gx0; gx < gx1; gx++) this.grid[row + gx] = val;
      }
    }
    addSolidBlock(x, y, w, h, color, borderColor, kind, label = "") {
      this.setGridRect(x, y, w, h, 2);
      this.rects.push({ x, y, w, h, color, borderColor, kind, label });
    }
    /** 挖空（地道/掩体）：网格清 0 + 背景图元 + 阴影区 */
    carveTunnel(x, y, w, h, label = "\u5730\u4E0B\u5730\u9053") {
      this.setGridRect(x, y, w, h, 0);
      this.rects.push({ x, y, w, h, color: "#090d16", borderColor: "#1e293b", kind: "tunnel_bg", label });
      this.shadows.push({ x, y, w, h, label, alpha: 0.76 });
    }
    /** 多层楼房：楼板/外墙/天井/射击窗（v2 布局原样保留） */
    buildMultiStoryBuilding(bx, groundY, width, floors, floorHeight, name, accent) {
      const totalH = floors * floorHeight;
      const topY = groundY - totalH;
      this.rects.push({ x: bx, y: topY, w: width, h: totalH, color: "#111827", borderColor: accent, kind: "building_bg", label: name });
      this.shadows.push({ x: bx + 20, y: topY + 20, w: width - 40, h: totalH - 20, label: `${name}\u5BA4\u5185`, alpha: 0.62 });
      this.addSolidBlock(bx - 20, topY, width + 40, 24, "#334155", accent, "building_roof", `${name}\u5929\u53F0`);
      for (let f = 0; f < floors; f++) {
        const fy = groundY - f * floorHeight;
        if (f > 0) {
          if (f % 2 === 0) this.addSolidBlock(bx + 120, fy - 20, width - 120, 20, "#475569", "#64748b", "floor_slab");
          else this.addSolidBlock(bx, fy - 20, width - 120, 20, "#475569", "#64748b", "floor_slab");
        }
        const wallTop = fy - floorHeight + 20;
        const wallH = floorHeight - 20;
        if (f === 0) {
          this.addSolidBlock(bx, wallTop, 24, Math.max(20, wallH - 110), "#334155", accent, "wall");
          this.addSolidBlock(bx + width - 24, wallTop, 24, Math.max(20, wallH - 110), "#334155", accent, "wall");
        } else {
          this.addSolidBlock(bx, wallTop, 24, 40, "#334155", accent, "wall");
          this.addSolidBlock(bx, fy - 60, 24, 40, "#334155", accent, "wall");
          this.addSolidBlock(bx + width - 24, wallTop, 24, 40, "#334155", accent, "wall");
          this.addSolidBlock(bx + width - 24, fy - 60, 24, 40, "#334155", accent, "wall");
        }
      }
    }
    buildHollowPipe(px, py, length, height, label) {
      const t = 22;
      this.rects.push({ x: px, y: py, w: length, h: height, color: "#0f172a", borderColor: "#06b6e4", kind: "pipe_bg", label });
      this.shadows.push({ x: px, y: py + t, w: length, h: height - t * 2, label, alpha: 0.68 });
      this.addSolidBlock(px, py, length, t, "#164e63", "#22d3ee", "pipe_wall", label);
      this.addSolidBlock(px, py + height - t, length, t, "#164e63", "#22d3ee", "pipe_wall", label);
    }
    build() {
      this.grid.fill(0);
      this.rects.length = 0;
      this.shadows.length = 0;
      this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, "#1e293b", "#334155", "earth");
      this.carveTunnel(0, 3560, WORLD_W, 160, "\u73AF\u7403\u5730\u4E0B\u4E3B\u5E72\u5730\u9053");
      this.carveTunnel(0, 4020, WORLD_W, 560, "\u6DF1\u5C42\u6697\u5F71\u73AF\u5E26");
      for (const sx of [700, 2900, 5200, 7800, 10100, 12400]) {
        this.carveTunnel(sx, SURFACE_Y, 160, WORLD_H - SURFACE_Y, "\u73AF\u7403\u5782\u76F4\u5347\u964D\u4E95");
        for (let sy = SURFACE_Y + 180; sy < WORLD_H; sy += 220) {
          const off = sy / 220 % 2 === 0 ? 0 : 90;
          this.addSolidBlock(sx + off, sy, 70, 20, "#475569", "#94a3b8", "step");
        }
      }
      this.carveTunnel(3600, 3320, 1100, 460, "\u897F\u533A\u5730\u4E0B\u6218\u7565\u63A9\u4F53");
      this.addSolidBlock(3760, 3560, 780, 24, "#334155", "#38bdf8", "bunker_floor");
      this.carveTunnel(6e3, 3260, 1200, 560, "\u4E2D\u592E\u5730\u4E0B\u6838\u5FC3\u63A9\u4F53");
      this.addSolidBlock(6160, 3540, 880, 24, "#334155", "#10b981", "bunker_floor");
      this.carveTunnel(9600, 3320, 1100, 460, "\u4E1C\u533A\u5730\u4E0B\u88C5\u7532\u63A9\u4F53");
      this.addSolidBlock(9760, 3560, 780, 24, "#334155", "#f43f5e", "bunker_floor");
      this.buildMultiStoryBuilding(1400, SURFACE_Y, 640, 4, 240, "\u897F\u7FFC\u6307\u6325\u5927\u697C", "#f43f5e");
      this.buildMultiStoryBuilding(3200, SURFACE_Y, 560, 3, 240, "\u897F\u533A\u5DE5\u4E1A\u5382\u623F", "#f97316");
      this.buildMultiStoryBuilding(5500, SURFACE_Y, 680, 5, 240, "\u4E2D\u592E\u53CC\u5B50\u5317\u5854", "#38bdf8");
      this.buildMultiStoryBuilding(7020, SURFACE_Y, 680, 5, 240, "\u4E2D\u592E\u53CC\u5B50\u5357\u5854", "#10b981");
      this.buildMultiStoryBuilding(9300, SURFACE_Y, 560, 3, 240, "\u4E1C\u533A\u901A\u4FE1\u5927\u697C", "#a855f7");
      this.buildMultiStoryBuilding(11100, SURFACE_Y, 640, 4, 240, "\u4E1C\u7FFC\u8981\u585E\u5927\u697C", "#0ea5e9");
      this.buildHollowPipe(2180, 2240, 860, 160, "\u897F\u533A\u9AD8\u67B6\u8F93\u9001\u7BA1\u9053");
      this.buildHollowPipe(4100, 2460, 1180, 160, "\u4E2D\u897F\u90E8\u4E3B\u5E72\u5DE5\u4E1A\u7BA1\u9053");
      this.buildHollowPipe(6240, 1820, 720, 160, "\u4E2D\u592E\u53CC\u5854\u7A7A\u4E2D\u8FDE\u5ECA\u7BA1\u9053");
      this.buildHollowPipe(7960, 2460, 1180, 160, "\u4E2D\u4E1C\u90E8\u4E3B\u5E72\u5DE5\u4E1A\u7BA1\u9053");
      this.buildHollowPipe(10040, 2240, 860, 160, "\u4E1C\u533A\u9AD8\u67B6\u8F93\u9001\u7BA1\u9053");
      const sky = [
        { x: 600, y: 2180, w: 620, c: "#f43f5e" },
        { x: 2300, y: 1620, w: 560, c: "#fb923c" },
        { x: 4300, y: 1460, w: 680, c: "#38bdf8" },
        { x: 6150, y: 1080, w: 900, c: "#10b981" },
        { x: 8200, y: 1460, w: 680, c: "#a855f7" },
        { x: 10300, y: 1620, w: 560, c: "#38bdf8" },
        { x: 11980, y: 2180, w: 620, c: "#0ea5e9" }
      ];
      for (const s of sky) this.addSolidBlock(s.x, s.y, s.w, 36, "#334155", s.c, "sky_island");
    }
    /** 点是否被原始地形挡住（双轴环形 x/y） */
    isSolidAt(x, y) {
      const wx = wrapX(x);
      const wy = wrapY(y);
      const gx = Math.floor(wx / TILE_SIZE);
      const gy = Math.floor(wy / TILE_SIZE);
      const gyy = (gy % GRID_H + GRID_H) % GRID_H;
      if (gx >= 0 && gx < GRID_W && gyy >= 0 && gyy < GRID_H) {
        if (this.grid[gyy * GRID_W + gx] !== 0) return true;
      }
      return false;
    }
  };
  var OBSTACLE_PRESETS = [
    { id: "obs_1", x: 1320, y: 2680, w: 48, h: 120, hp: 260, label: "\u5927\u697C\u9632\u7206\u95E8", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_2", x: 2080, y: 2680, w: 48, h: 120, hp: 260, label: "\u5927\u697C\u9632\u7206\u95E8", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_3", x: 3120, y: 2680, w: 48, h: 120, hp: 240, label: "\u5382\u623F\u88C5\u7532\u5899", color: "#78350f", borderColor: "#f59e0b" },
    { id: "obs_4", x: 5420, y: 2680, w: 52, h: 120, hp: 300, label: "\u53CC\u5854\u91CD\u578B\u95F8\u95E8", color: "#7c2d12", borderColor: "#fb923c" },
    { id: "obs_5", x: 7740, y: 2680, w: 52, h: 120, hp: 300, label: "\u53CC\u5854\u91CD\u578B\u95F8\u95E8", color: "#7c2d12", borderColor: "#fb923c" },
    { id: "obs_6", x: 11020, y: 2680, w: 48, h: 120, hp: 260, label: "\u8981\u585E\u9632\u7206\u95E8", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_7", x: 11780, y: 2680, w: 48, h: 120, hp: 260, label: "\u8981\u585E\u9632\u7206\u95E8", color: "#9a3412", borderColor: "#f97316" },
    { id: "obs_8", x: 2600, y: 2264, w: 36, h: 112, hp: 180, label: "\u7BA1\u9053\u5BC6\u5C01\u95F8", color: "#155e75", borderColor: "#22d3ee" },
    { id: "obs_9", x: 4680, y: 2484, w: 36, h: 112, hp: 180, label: "\u7BA1\u9053\u5BC6\u5C01\u95F8", color: "#155e75", borderColor: "#22d3ee" },
    { id: "obs_10", x: 6580, y: 1844, w: 36, h: 112, hp: 180, label: "\u9AD8\u7A7A\u7BA1\u9053\u8DEF\u969C", color: "#155e75", borderColor: "#22d3ee" },
    { id: "obs_11", x: 8540, y: 2484, w: 36, h: 112, hp: 180, label: "\u7BA1\u9053\u5BC6\u5C01\u95F8", color: "#155e75", borderColor: "#22d3ee" },
    { id: "obs_12", x: 10460, y: 2264, w: 36, h: 112, hp: 180, label: "\u7BA1\u9053\u5BC6\u5C01\u95F8", color: "#155e75", borderColor: "#22d3ee" },
    { id: "obs_ug_1", x: 3580, y: 3560, w: 44, h: 160, hp: 320, label: "\u5730\u4E0B\u63A9\u4F53\u897F\u95F8\u95E8", color: "#4c1d95", borderColor: "#a855f7" },
    { id: "obs_ug_2", x: 4700, y: 3560, w: 44, h: 160, hp: 320, label: "\u5730\u4E0B\u63A9\u4F53\u4E1C\u95F8\u95E8", color: "#4c1d95", borderColor: "#a855f7" },
    { id: "obs_ug_3", x: 5980, y: 3560, w: 48, h: 160, hp: 360, label: "\u4E2D\u592E\u5730\u6838\u9632\u7206\u5899", color: "#065f46", borderColor: "#10b981" },
    { id: "obs_ug_4", x: 7200, y: 3560, w: 48, h: 160, hp: 360, label: "\u4E2D\u592E\u5730\u6838\u9632\u7206\u5899", color: "#065f46", borderColor: "#10b981" },
    { id: "obs_ug_5", x: 9580, y: 3560, w: 44, h: 160, hp: 320, label: "\u4E1C\u533A\u5730\u4E0B\u897F\u95F8\u95E8", color: "#881337", borderColor: "#f43f5e" },
    { id: "obs_ug_6", x: 10700, y: 3560, w: 44, h: 160, hp: 320, label: "\u4E1C\u533A\u5730\u4E0B\u4E1C\u95F8\u95E8", color: "#881337", borderColor: "#f43f5e" },
    { id: "obs_box_1", x: 6420, y: 2730, w: 68, h: 70, hp: 170, label: "\u91CD\u88C5\u63A9\u4F53\u7BB1", color: "#365314", borderColor: "#84cc16" },
    { id: "obs_box_2", x: 6720, y: 2730, w: 68, h: 70, hp: 170, label: "\u91CD\u88C5\u63A9\u4F53\u7BB1", color: "#365314", borderColor: "#84cc16" },
    { id: "obs_box_3", x: 6560, y: 1010, w: 80, h: 70, hp: 190, label: "\u6D6E\u5C9B\u6838\u5FC3\u62A4\u76FE\u7BB1", color: "#1e3a8a", borderColor: "#60a5fa" }
  ];

  // src/core/rng.ts
  var Rng = class {
    s;
    constructor(seed) {
      this.s = seed >>> 0 || 2654435769;
    }
    /** [0,1) 均匀分布 */
    next() {
      this.s = this.s + 1831565813 | 0;
      let t = this.s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    /** [min,max) 浮点 */
    range(min, max) {
      return min + this.next() * (max - min);
    }
    /** [0,n) 整数（均匀，无取模偏置） */
    int(n) {
      return Math.floor(this.next() * n);
    }
    /** 从数组均匀取一个 */
    pick(arr) {
      return arr[this.int(arr.length)];
    }
  };

  // src/core/weapons.ts
  var WEAPONS = [
    {
      id: 0,
      name: "\u63A8\u8FDB\u9730\u5F39\u67AA",
      shortName: "\u9730\u5F39\u67AA",
      isSupplyOnly: false,
      damage: 14,
      headshotMult: 1.8,
      pellets: 8,
      spread: 0.28,
      speed: 920,
      recoil: 780,
      magSize: 6,
      maxReserve: 30,
      reloadTime: 1.5,
      fireDelay: 0.5,
      terrainRadius: 12,
      explosive: false,
      pierceOnHeadshot: false,
      fovMult: 1,
      color: "#fbbf24"
    },
    {
      id: 1,
      name: "\u8109\u51B2\u7A81\u51FB\u6B65\u67AA",
      shortName: "\u7A81\u51FB\u6B65\u67AA",
      isSupplyOnly: false,
      damage: 18,
      headshotMult: 2.2,
      pellets: 1,
      spread: 0.045,
      speed: 1160,
      recoil: 84,
      magSize: 28,
      maxReserve: 140,
      reloadTime: 1.7,
      fireDelay: 0.12,
      terrainRadius: 8,
      explosive: false,
      pierceOnHeadshot: false,
      fovMult: 1,
      color: "#38bdf8"
    },
    {
      id: 2,
      name: "\u7535\u78C1\u72D9\u51FB\u6B65\u67AA",
      shortName: "\u7535\u78C1\u72D9\u51FB",
      isSupplyOnly: false,
      damage: 64,
      headshotMult: 2.5,
      pellets: 1,
      spread: 3e-3,
      speed: 1900,
      recoil: 390,
      magSize: 5,
      maxReserve: 25,
      reloadTime: 2.3,
      fireDelay: 0.92,
      terrainRadius: 16,
      explosive: false,
      laser: true,
      pierceOnHeadshot: true,
      fovMult: 1.3,
      color: "#c084fc"
    },
    {
      id: 3,
      name: "\u91CD\u578B\u69B4\u5F39\u70AE",
      shortName: "\u69B4\u5F39\u70AE",
      isSupplyOnly: false,
      damage: 66,
      headshotMult: 1.5,
      pellets: 1,
      spread: 0.025,
      speed: 900,
      recoil: 510,
      magSize: 4,
      maxReserve: 20,
      reloadTime: 2.4,
      fireDelay: 0.75,
      terrainRadius: 72,
      explosive: true,
      gravityScale: 0.45,
      pierceOnHeadshot: false,
      fovMult: 1,
      color: "#fb7185"
    },
    {
      id: 4,
      name: "\u26A1 \u805A\u53D8\u6FC0\u5149\u70AE",
      shortName: "\u6FC0\u5149\u70AE",
      isSupplyOnly: true,
      damage: 38,
      headshotMult: 2,
      pellets: 1,
      spread: 1e-3,
      speed: 2350,
      recoil: 150,
      magSize: 12,
      maxReserve: 24,
      reloadTime: 2,
      fireDelay: 0.26,
      terrainRadius: 18,
      explosive: false,
      laser: true,
      pierceAll: true,
      pierceOnHeadshot: true,
      bounces: 1,
      fovMult: 1.15,
      color: "#22d3ee"
    },
    {
      id: 5,
      name: "\u{1F525} \u91CD\u88C5\u52A0\u7279\u6797",
      shortName: "\u52A0\u7279\u6797",
      isSupplyOnly: true,
      damage: 13,
      headshotMult: 1.8,
      pellets: 1,
      spread: 0.11,
      speed: 1240,
      recoil: 66,
      magSize: 90,
      maxReserve: 180,
      reloadTime: 2.8,
      fireDelay: 0.055,
      terrainRadius: 8,
      explosive: false,
      pierceOnHeadshot: false,
      fovMult: 1,
      color: "#f97316"
    },
    {
      id: 6,
      name: "\u{1F300} \u5947\u70B9\u5F15\u529B\u67AA",
      shortName: "\u5F15\u529B\u67AA",
      isSupplyOnly: true,
      damage: 48,
      headshotMult: 1.6,
      pellets: 1,
      spread: 0.01,
      speed: 780,
      recoil: 240,
      magSize: 6,
      maxReserve: 18,
      reloadTime: 2.2,
      fireDelay: 0.68,
      terrainRadius: 95,
      explosive: true,
      isGravityOrb: true,
      gravityScale: 0.08,
      pierceOnHeadshot: false,
      fovMult: 1.1,
      color: "#a855f7"
    }
  ];
  var SECONDARIES = {
    frag: { id: "frag", name: "\u624B\u69B4\u5F39", icon: "\u{1F4A3}", cd: 10 },
    mine: { id: "mine", name: "\u611F\u5E94\u5730\u96F7", icon: "\u{1F6A8}", cd: 14 },
    instant_mine: { id: "instant_mine", name: "\u77AC\u53D1\u5730\u96F7", icon: "\u26A1", cd: 15 },
    airstrike: { id: "airstrike", name: "\u5B9A\u70B9\u7A7A\u88AD", icon: "\u2708\uFE0F", cd: 20 },
    barricade: { id: "barricade", name: "\u53EF\u7834\u574F\u969C\u788D\u7269", icon: "\u{1F9F1}", cd: 12 },
    shield: { id: "shield", name: "\u4E00\u6B21\u6027\u62A4\u76FE", icon: "\u{1F6E1}\uFE0F", cd: 16 },
    doll: { id: "doll", name: "\u66FF\u8EAB\u4EBA\u5076", icon: "\u{1F38E}", cd: 24, supplyOnly: true },
    pistol: { id: "pistol", name: "\u6218\u672F\u624B\u67AA", icon: "\u{1F52B}", cd: 0.24 }
  };
  var DEFAULT_CONFIG = {
    maxHp: 100,
    headRadius: 13,
    shieldHp: 130,
    shieldDuration: 5,
    dollDuration: 10,
    obstacleDefaultHp: 240,
    grenadeDamage: 105,
    grenadeRadius: 90,
    grenadeFuse: 1.65,
    mineDamage: 110,
    mineTriggerRadius: 48,
    mineRespawnTime: 14,
    airstrikeDamage: 88,
    airstrikeRadius: 80,
    mortarDamage: 130,
    mortarRadius: 105,
    mortarCooldown: 2.2,
    pistolDamage: 25,
    pistolHeadshotMult: 2,
    captureRadius: 135,
    captureRate: 28,
    ammoPackInterval: 7,
    ammoPackMaxActive: 8,
    supplyRespawnTime: 22,
    watchtowerDuration: 20,
    watchtowerFovMult: 1.65,
    respawnDelay: 4,
    loadoutLock: true,
    dollMaxCharges: 2
  };

  // src/core/types.ts
  function defaultWorldInput() {
    return { move: 0, jump: false, jetpack: false, aim: 0, fire: false, reload: false, secondary: null, interact: false, switchWeapon: null };
  }

  // src/core/sim/world.ts
  var BODY_HALF_W = 10;
  var BODY_TOP = 26;
  var BODY_BOTTOM = 16;
  var SPAWN_POINTS = [
    { x: 1100, y: 2740, team: "red" },
    { x: 12100, y: 2740, team: "blue" },
    { x: 6600, y: 1460, team: "green" },
    { x: 6600, y: 2380, team: "ffa" }
  ];
  var AMMO_SPOTS = [
    { x: 1560, y: 2520, area: "\u897F\u7FFC\u5927\u697C\u4E8C\u5C42" },
    { x: 1840, y: 2040, area: "\u897F\u7FFC\u5927\u697C\u56DB\u5C42" },
    { x: 2620, y: 2260, area: "\u897F\u533A\u7BA1\u9053\u5185" },
    { x: 3400, y: 2280, area: "\u897F\u533A\u5382\u623F\u4E09\u5C42" },
    { x: 4450, y: 2420, area: "\u4E2D\u897F\u90E8\u7BA1\u9053\u5185" },
    { x: 4760, y: 1430, area: "\u897F\u90E8\u9AD8\u7A7A\u5E73\u53F0" },
    { x: 5680, y: 2100, area: "\u53CC\u5854\u5317\u5854\u4E09\u5C42" },
    { x: 7250, y: 2100, area: "\u53CC\u5854\u5357\u5854\u4E09\u5C42" },
    { x: 6680, y: 1020, area: "\u4E2D\u592E\u6700\u9AD8\u6D6E\u5C9B" },
    { x: 8420, y: 2560, area: "\u4E2D\u4E1C\u90E8\u7BA1\u9053\u5185" },
    { x: 8520, y: 1420, area: "\u4E2D\u4E1C\u90E8\u9AD8\u7A7A\u6D6E\u5C9B" },
    { x: 9540, y: 2520, area: "\u4E1C\u533A\u901A\u4FE1\u5927\u697C" },
    { x: 10120, y: 3520, area: "\u4E1C\u533A\u5730\u4E0B\u63A9\u4F53" },
    { x: 10380, y: 2340, area: "\u4E1C\u533A\u9AD8\u67B6\u7BA1\u9053\u5185" },
    { x: 11360, y: 2520, area: "\u4E1C\u7FFC\u5927\u697C\u4E8C\u5C42" },
    { x: 12600, y: 2760, area: "\u6781\u4E1C\u8FB9\u5883\u8865\u7ED9\u70B9" }
  ];
  var SUPPLY_SPOTS = [
    { x: 6600, y: 1040, area: "\u4E2D\u592E\u6700\u9AD8\u6D6E\u5C9B" },
    { x: 4150, y: 3520, area: "\u897F\u533A\u5730\u4E0B\u6218\u7565\u63A9\u4F53" },
    { x: 6600, y: 3500, area: "\u4E2D\u592E\u5730\u4E0B\u6838\u5FC3\u63A9\u4F53" },
    { x: 10150, y: 3520, area: "\u4E1C\u533A\u5730\u4E0B\u88C5\u7532\u63A9\u4F53" },
    { x: 2600, y: 1580, area: "\u897F\u90E8\u9AD8\u7A7A\u5E73\u53F0" },
    { x: 10550, y: 1580, area: "\u4E1C\u90E8\u9AD8\u7A7A\u5E73\u53F0" }
  ];
  var DOLL_SUPPLY_SPOTS = [
    { x: 4820, y: 2100, area: "\u4E2D\u897F\u90E8\u9AD8\u7A7A\u8FDE\u5ECA\u65C1" },
    { x: 8560, y: 2740, area: "\u4E1C\u533A\u5730\u8868\u7279\u6B8A\u8865\u7ED9\u70B9" }
  ];
  var MORTARS_INIT = [
    { id: "mortar_left", name: "\u897F\u7FFC\u9AD8\u53F0\u8FEB\u51FB\u70AE", x: 920, y: 2180, angle: -Math.PI * 0.28, power: 24 },
    { id: "mortar_mid_w", name: "\u4E2D\u897F\u6D6E\u5C9B\u8FEB\u51FB\u70AE", x: 4620, y: 1460, angle: -Math.PI * 0.3, power: 23 },
    { id: "mortar_center", name: "\u4E2D\u592E\u5929\u9876\u8FEB\u51FB\u70AE", x: 6600, y: 1080, angle: -Math.PI * 0.35, power: 24.5 },
    { id: "mortar_mid_e", name: "\u4E2D\u4E1C\u6D6E\u5C9B\u8FEB\u51FB\u70AE", x: 8520, y: 1460, angle: -Math.PI * 0.7, power: 23 },
    { id: "mortar_right", name: "\u4E1C\u7FFC\u9AD8\u53F0\u8FEB\u51FB\u70AE", x: 12260, y: 2180, angle: -Math.PI * 0.72, power: 24 }
  ];
  var MINE_PRESETS = [
    { x: 1720, y: 2760 },
    { x: 4150, y: 3520 },
    { x: 6350, y: 2760 },
    { x: 6850, y: 2760 },
    { x: 6600, y: 3500 },
    { x: 11420, y: 2760 }
  ];
  var JUMP_PADS = [
    { x: 1220, y: 2800, vx: 210, vy: -810 },
    { x: 5300, y: 2800, vx: 180, vy: -870 },
    { x: 7880, y: 2800, vx: -180, vy: -870 },
    { x: 11960, y: 2800, vx: -210, vy: -810 }
  ];
  var CP_INITS = [
    { id: "cp_a", code: "A", name: "\u636E\u70B9A\xB7\u897F\u7FFC\u5927\u697C\u5929\u53F0", x: 1720, y: 1840, ownerTeam: "red" },
    { id: "cp_b", code: "B", name: "\u636E\u70B9B\xB7\u897F\u533A\u5730\u4E0B\u63A9\u4F53", x: 4150, y: 3560, ownerTeam: null },
    { id: "cp_c", code: "C", name: "\u636E\u70B9C\xB7\u4E2D\u592E\u6838\u5FC3\u5927\u6865", x: 6600, y: 2800, ownerTeam: "green" },
    { id: "cp_d", code: "D", name: "\u636E\u70B9D\xB7\u4E2D\u592E\u5730\u4E0B\u5730\u6838", x: 6600, y: 3540, ownerTeam: null },
    { id: "cp_e", code: "E", name: "\u636E\u70B9E\xB7\u4E1C\u7FFC\u8981\u585E\u5929\u53F0", x: 11420, y: 1840, ownerTeam: "blue" }
  ];
  var World = class {
    terrain = new Terrain();
    players = [];
    projectiles = [];
    grenades = [];
    landmines = [];
    airstrikes = [];
    obstacles = [];
    capturePoints = [];
    ammoPacks = [];
    supplyCrates = [];
    mortars = [];
    scores = { red: 0, blue: 0, green: 0, ffa: 0 };
    events = [];
    // 每 tick 收集，net/ui 层取走（drainEvents）
    config = { ...DEFAULT_CONFIG };
    rng;
    seed;
    tick = 0;
    hits = 0;
    pid = 1;
    prj = 1;
    gren = 1;
    mine = 1;
    air = 1;
    ammo = 1;
    crate = 1;
    spawnIndex = 0;
    ammoSpawnTimer = 0;
    usedAmmoSpots = /* @__PURE__ */ new Set();
    constructor(seed = 12345) {
      this.seed = seed;
      this.rng = new Rng(seed);
      this.terrain.build();
      this.resetMatch();
    }
    /** 全场重置（对局开始/地形重置按钮） */
    resetMatch() {
      this.obstacles = OBSTACLE_PRESETS.map((o) => ({ ...o, maxHp: o.hp }));
      this.capturePoints = CP_INITS.map((c) => ({ ...c, progress: c.ownerTeam ? 100 : 0, capturingTeam: null }));
      this.mortars = MORTARS_INIT.map((m) => ({ ...m, cooldown: 0, operatorId: null }));
      this.landmines = MINE_PRESETS.map((m, i) => ({
        id: -(i + 1),
        owner: 0,
        pos: { x: m.x, y: m.y },
        vel: { x: 0, y: 0 },
        armed: true,
        armTimer: 0,
        triggered: false,
        fuse: 0,
        instant: false,
        directHit: false,
        preset: true,
        respawnTimer: 0
      }));
      this.supplyCrates = [
        ...SUPPLY_SPOTS.map((spot, idx) => {
          const w = WEAPONS[4 + idx % 3];
          return {
            id: this.crate++,
            x: spot.x,
            y: spot.y,
            area: spot.area,
            kind: "weapon",
            weaponId: w.id,
            weaponName: w.name,
            color: w.color,
            active: true,
            respawnTimer: 0
          };
        }),
        ...DOLL_SUPPLY_SPOTS.map((spot) => ({
          id: this.crate++,
          x: spot.x,
          y: spot.y,
          area: spot.area,
          kind: "doll",
          weaponId: -1,
          weaponName: "\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\uFF08\u7279\u6B8A\u8865\u7ED9\uFF09",
          color: "#f472b6",
          active: true,
          respawnTimer: 0
        }))
      ];
      this.ammoPacks = [];
      this.usedAmmoSpots.clear();
      for (let i = 0; i < this.config.ammoPackMaxActive; i++) this.spawnAmmoPack();
      this.projectiles = [];
      this.grenades = [];
      this.airstrikes = [];
      this.ammoSpawnTimer = 0;
      this.scores = { red: 0, blue: 0, green: 0, ffa: 0 };
    }
    // ── 玩家管理 ──────────────────────────────────────────────
    addPlayer(name = "Player", team = "ffa") {
      const p = {
        id: this.pid++,
        pos: { x: 6600, y: 2380 },
        vel: { x: 0, y: 0 },
        aim: 0,
        team,
        name,
        hp: this.config.maxHp,
        maxHp: this.config.maxHp,
        alive: true,
        deployed: true,
        onGround: true,
        weaponIndex: 1,
        ammo: WEAPONS.map((w) => w.magSize),
        reserveAmmo: WEAPONS.map((w) => w.maxReserve),
        reloading: false,
        reloadTimer: 0,
        fireCooldown: 0,
        secondary: "frag",
        secondaryCooldown: 0,
        pistolAmmo: 12,
        pistolReserve: 48,
        jetpack: false,
        fuel: getPhysicsParams().jetpackFuel,
        shieldHp: 0,
        shieldTimer: 0,
        watchtowerTimer: 0,
        doll: null,
        dollCharges: 0,
        respawnTimer: 0,
        kills: 0,
        deaths: 0
      };
      this.respawnAt(p, team);
      this.players.push(p);
      return p;
    }
    /** 出生点：按队伍；优先已占领点（占点重生机制） */
    respawnAt(p, team) {
      const owned = this.capturePoints.filter((c) => c.ownerTeam === team && c.progress >= 100);
      const cp = owned.length > 0 ? owned[this.rng.int(owned.length)] : null;
      const base = SPAWN_POINTS.find((s) => s.team === team) ?? SPAWN_POINTS[3];
      const sx = cp ? cp.x : base.x;
      const sy = cp ? cp.y - 60 : base.y;
      p.pos = { x: wrapX(sx + this.rng.range(-45, 45)), y: sy };
      p.vel = { x: 0, y: 0 };
      p.hp = this.config.maxHp;
      p.ammo = WEAPONS.map((w) => w.magSize);
      p.reserveAmmo = WEAPONS.map((w) => w.maxReserve);
      p.pistolAmmo = 12;
      p.pistolReserve = 48;
      p.fuel = getPhysicsParams().jetpackFuel;
      p.shieldHp = 0;
      p.shieldTimer = 0;
      p.watchtowerTimer = 0;
      p.doll = null;
      p.dollCharges = 0;
      p.reloading = false;
      p.fireCooldown = 0;
      p.secondaryCooldown = 0;
      p.deployed = true;
      p.alive = true;
    }
    // ── 主 step ──────────────────────────────────────────────
    step(dt, inputs) {
      this.tick++;
      this.events.length = 0;
      for (const p of this.players) {
        const w = inputs.get(p.id) ?? defaultWorldInput();
        this.apply(p, w, dt);
        if (p.deployed) this.physics(p, dt);
      }
      this.stepProjectiles(dt);
      this.stepGrenades(dt);
      this.stepLandmines(dt);
      this.stepAirstrikes(dt);
      this.stepObstaclesOnly();
      this.stepCapturePoints(dt);
      this.stepMortars(dt);
      this.stepSupplyCrates(dt);
      this.tickAmmoSpawner(dt);
      this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
      this.grenades = this.grenades.filter((g) => g.fuse > 0);
    }
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
    // ── 输入应用（武器/副武器/交互） ────────────────────────────
    apply(p, w, dt) {
      if (!p.deployed) return;
      if (p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) this.respawnAt(p, p.team);
        return;
      }
      if (!p.alive) return;
      if (w.switchWeapon !== null && w.switchWeapon !== p.weaponIndex) {
        const wep = WEAPONS[w.switchWeapon];
        const canSwitch = !this.config.loadoutLock || p.respawnTimer > 0 || !p.deployed;
        if (wep && !wep.isSupplyOnly && canSwitch) {
          p.weaponIndex = wep.id;
          p.reloading = false;
          p.fireCooldown = Math.max(p.fireCooldown, 0.3);
        }
      }
      p.aim = w.aim;
      move(p.vel, w.move);
      if (w.jump && this.onGround(p)) jump(p.vel);
      const fuel = p.fuel;
      const canJet = w.jetpack && fuel > 0;
      if (canJet) jetpack(p.vel, dt);
      p.jetpack = canJet;
      p.fuel = updateJetpackFuel(fuel, w.jetpack, dt);
      if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - dt);
      if (p.secondaryCooldown > 0) p.secondaryCooldown = Math.max(0, p.secondaryCooldown - dt);
      if (p.shieldTimer > 0) {
        p.shieldTimer -= dt;
        if (p.shieldTimer <= 0) {
          p.shieldTimer = 0;
          p.shieldHp = 0;
        }
      }
      if (p.watchtowerTimer > 0) p.watchtowerTimer = Math.max(0, p.watchtowerTimer - dt);
      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          p.reloading = false;
          const wep = WEAPONS[p.weaponIndex];
          const needed = wep.magSize - p.ammo[p.weaponIndex];
          const avail = p.reserveAmmo[p.weaponIndex] || 0;
          const transfer = Math.min(needed, avail);
          p.ammo[p.weaponIndex] += transfer;
          p.reserveAmmo[p.weaponIndex] = avail - transfer;
        }
      }
      if (w.reload) this.startReload(p);
      if (p.doll) {
        p.doll.timer -= dt;
        if (p.doll.timer <= 0) this.recallDoll(p, "doll_recall");
      }
      if (w.interact) this.interact(p);
      if (w.secondary) this.useSecondary(p, w.secondary, dt);
      if (w.fire) this.fire(p);
    }
    // ── 开火 ──────────────────────────────────────────────
    fire(p) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const m = this.mortars.find((mm) => mm.operatorId === p.id);
      if (m) {
        if (m.cooldown <= 0) {
          m.cooldown = this.config.mortarCooldown;
          this.projectiles.push(this.makeProjectile(
            p,
            m.x + Math.cos(m.angle) * 34,
            m.y - 18 + Math.sin(m.angle) * 34,
            Math.cos(m.angle) * m.power * 60,
            Math.sin(m.angle) * m.power * 60,
            { damage: this.config.mortarDamage, headshotMult: 1.5, terrainRadius: this.config.mortarRadius, explosive: true, gravityScale: 0.68, weaponLabel: "\u516C\u5171\u8FEB\u51FB\u70AE", color: "#f97316", r: 7.5, life: 175 / 60 }
          ));
          this.events.push({ kind: "mortar_fire", x: m.x, y: m.y, playerId: p.id });
        }
        return;
      }
      const wep = WEAPONS[p.weaponIndex];
      if (p.reloading || p.fireCooldown > 0) return;
      if (p.ammo[p.weaponIndex] <= 0) {
        if ((p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p);
        return;
      }
      p.ammo[p.weaponIndex]--;
      p.fireCooldown = wep.fireDelay;
      if (p.ammo[p.weaponIndex] <= 0 && (p.reserveAmmo[p.weaponIndex] || 0) > 0) this.startReload(p);
      if (wep.recoil > 0) {
        p.vel.x -= Math.cos(p.aim) * wep.recoil * 0.56;
        p.vel.y -= Math.sin(p.aim) * wep.recoil * 0.65;
      }
      const mx = wrapX(p.pos.x + Math.cos(p.aim) * 24);
      const my = p.pos.y - 12 + Math.sin(p.aim) * 24;
      for (let i = 0; i < wep.pellets; i++) {
        const spreadA = p.aim + this.rng.range(-wep.spread / 2, wep.spread / 2);
        const spd = wep.speed * (wep.pellets > 1 ? this.rng.range(0.88, 1.12) : 1);
        this.projectiles.push(this.makeProjectile(p, mx, my, Math.cos(spreadA) * spd, Math.sin(spreadA) * spd, {
          damage: wep.damage,
          headshotMult: wep.headshotMult,
          terrainRadius: wep.terrainRadius,
          explosive: wep.explosive,
          gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0 : 0.04),
          pierceOnHeadshot: !!wep.pierceOnHeadshot,
          pierceAll: !!wep.pierceAll,
          isGravityOrb: !!wep.isGravityOrb,
          bounces: wep.bounces ?? 0,
          weaponLabel: wep.shortName,
          color: wep.color,
          r: wep.isGravityOrb ? 8.5 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2,
          life: (wep.id === 2 || wep.id === 4 ? 175 : 130) / 60
        }));
      }
    }
    makeProjectile(p, x, y, vx, vy, o) {
      return {
        id: this.prj++,
        owner: p.id,
        pos: { x: wrapX(x), y: wrapY(y) },
        vel: { x: vx, y: vy },
        life: o.life,
        r: o.r,
        damage: o.damage,
        headshotMult: o.headshotMult,
        explosive: o.explosive,
        terrainRadius: o.terrainRadius,
        gravityScale: o.gravityScale ?? 0.04,
        pierceOnHeadshot: !!o.pierceOnHeadshot,
        pierceAll: !!o.pierceAll,
        isGravityOrb: !!o.isGravityOrb,
        bounces: o.bounces ?? 0,
        weaponLabel: o.weaponLabel,
        color: o.color,
        hitTargets: [p.id]
        // 发射者自身永远跳过
      };
    }
    startReload(p) {
      const wep = WEAPONS[p.weaponIndex];
      if (!wep || p.reloading || p.ammo[p.weaponIndex] >= wep.magSize) return;
      if ((p.reserveAmmo[p.weaponIndex] || 0) <= 0) return;
      p.reloading = true;
      p.reloadTimer = wep.reloadTime;
    }
    // ── 副武器（8 种，v2 逻辑移植；全部服务器权威结算） ──────────────
    useSecondary(p, s, _dt) {
      if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return;
      const def = SECONDARIES[s.type];
      if (!def) return;
      const tx = wrapX(s.targetX);
      const ty = s.targetY;
      if (s.type === "pistol") {
        if (p.pistolAmmo <= 0) {
          if (p.pistolReserve > 0) {
            const load = Math.min(12, p.pistolReserve);
            p.pistolAmmo = load;
            p.pistolReserve -= load;
            p.secondaryCooldown = 1;
          }
          return;
        }
        p.pistolAmmo--;
        p.secondaryCooldown = def.cd;
        const mx = wrapX(p.pos.x + Math.cos(p.aim) * 22);
        const my = p.pos.y - 12 + Math.sin(p.aim) * 22;
        this.projectiles.push(this.makeProjectile(p, mx, my, Math.cos(p.aim) * 1380, Math.sin(p.aim) * 1380, {
          damage: this.config.pistolDamage,
          headshotMult: this.config.pistolHeadshotMult,
          terrainRadius: 6,
          explosive: false,
          gravityScale: 0.03,
          weaponLabel: "\u6218\u672F\u624B\u67AA",
          color: "#fde047",
          r: 3.2,
          life: 105 / 60
        }));
        return;
      }
      if (s.type === "doll" && p.dollCharges <= 0) return;
      p.secondaryCooldown = def.cd;
      if (s.type === "doll") {
        p.dollCharges--;
        p.doll = {
          pos: { x: p.pos.x, y: p.pos.y },
          hp: p.hp,
          shieldHp: p.shieldHp,
          fuel: p.fuel,
          weaponIndex: p.weaponIndex,
          ammo: [...p.ammo],
          reserveAmmo: [...p.reserveAmmo],
          timer: this.config.dollDuration
        };
        this.events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: "anchor" });
        return;
      }
      if (s.type === "shield") {
        p.shieldHp = this.config.shieldHp;
        p.shieldTimer = this.config.shieldDuration;
        return;
      }
      if (s.type === "barricade") {
        const bx = wrapX(Math.round(p.pos.x + Math.cos(p.aim) * 66 - 22));
        const by = wrapY(Math.round(p.pos.y - 44));
        this.obstacles.push({
          id: `obs_p_${p.id}_${this.tick}`,
          x: bx,
          y: by,
          w: 44,
          h: 88,
          hp: this.config.obstacleDefaultHp,
          maxHp: this.config.obstacleDefaultHp,
          label: `${p.name}\u7684\u63A9\u4F53`,
          color: "#0f766e",
          borderColor: "#2dd4bf"
        });
        return;
      }
      if (s.type === "airstrike") {
        this.airstrikes.push({ id: this.air++, owner: p.id, pos: { x: tx, y: ty }, timer: 1.05, dropped: false });
        return;
      }
      if (s.type === "mine" || s.type === "instant_mine") {
        const isInstant = s.type === "instant_mine";
        const throwSpd = isInstant ? 570 : 480;
        this.landmines.push({
          id: this.mine++,
          owner: p.id,
          pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 26), y: p.pos.y - 10 + Math.sin(p.aim) * 18 },
          vel: { x: Math.cos(p.aim) * throwSpd, y: Math.sin(p.aim) * throwSpd - 132 },
          armed: false,
          armTimer: isInstant ? 0.25 : 0.75,
          triggered: false,
          fuse: 0,
          instant: isInstant,
          directHit: true,
          preset: false,
          respawnTimer: 0
        });
        return;
      }
      const throwSpeed = 810;
      this.grenades.push({
        id: this.gren++,
        owner: p.id,
        pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
        vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
        fuse: this.config.grenadeFuse,
        bounces: 0
      });
    }
    /** 替身人偶回溯（死亡触发 或 10s 到期触发） */
    recallDoll(p, ev) {
      if (!p.doll) return;
      const d = p.doll;
      p.doll = null;
      p.pos = { x: wrapX(d.pos.x), y: d.pos.y };
      p.vel = { x: 0, y: 0 };
      p.hp = Math.max(1, d.hp);
      p.shieldHp = d.shieldHp;
      p.fuel = d.fuel;
      p.weaponIndex = d.weaponIndex;
      p.ammo = [...d.ammo];
      p.reserveAmmo = [...d.reserveAmmo];
      p.respawnTimer = 0;
      p.alive = true;
      this.events.push({ kind: "doll_recall", x: p.pos.x, y: p.pos.y, playerId: p.id });
    }
    // ── 交互（E 键） ──────────────────────────────────────────
    interact(p) {
      if (p.respawnTimer > 0 || !p.alive) return;
      const cur = this.mortars.find((m) => m.operatorId === p.id);
      if (cur) {
        cur.operatorId = null;
        p.vel.y = -270;
        return;
      }
      for (const m of this.mortars) {
        if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
          m.operatorId = p.id;
          p.pos = { x: m.x, y: m.y - 16 };
          p.vel = { x: 0, y: 0 };
          return;
        }
      }
    }
    // ── 物理 ──────────────────────────────────────────────
    physics(p, dt) {
      if (!p.alive || p.respawnTimer > 0) return;
      const m = this.mortars.find((mm) => mm.operatorId === p.id);
      if (m) {
        p.pos = { x: m.x, y: m.y - 16 };
        p.vel = { x: 0, y: 0 };
        return;
      }
      applyGravity(p.vel, dt);
      for (const pad of JUMP_PADS) {
        if (wrapDist(p.pos.x, p.pos.y, pad.x, pad.y) < 42 && p.vel.y >= -120) {
          p.vel.x += pad.vx;
          p.vel.y = pad.vy;
        }
      }
      const hitBody = (x, y) => {
        const wx = wrapX(x);
        if (this.terrain.isSolidAt(wx, y)) return true;
        return this.obstacleAt(wx, y) !== null;
      };
      const pts = (cx, cy) => hitBody(cx - BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx + BODY_HALF_W, cy + BODY_BOTTOM) || hitBody(cx, cy + BODY_BOTTOM) || hitBody(cx - BODY_HALF_W, cy) || hitBody(cx + BODY_HALF_W, cy) || hitBody(cx, cy - BODY_TOP);
      const nx = wrapX(p.pos.x + p.vel.x * dt);
      if (!pts(nx, p.pos.y)) p.pos.x = nx;
      else if (!pts(nx, p.pos.y - 10)) {
        p.pos.x = nx;
        p.pos.y -= 10;
      } else p.vel.x *= -0.2;
      const nyRaw = p.pos.y + p.vel.y * dt;
      const ny = wrapY(nyRaw);
      if (!pts(p.pos.x, ny)) {
        p.pos.y = ny;
        p.onGround = false;
      } else {
        p.onGround = p.vel.y > 0;
        p.vel.y = 0;
      }
      p.pos.x = wrapX(p.pos.x);
      p.pos.y = wrapY(p.pos.y);
    }
    onGround(p) {
      return !!p.onGround;
    }
    // ── 弹道 ──────────────────────────────────────────────
    stepProjectiles(dt) {
      const g = 1250;
      for (const pr of this.projectiles) {
        if (pr.life <= 0) continue;
        if (pr.isGravityOrb) {
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue;
            const dx = wrapDeltaX(t.pos.x, pr.pos.x);
            const dy = wrapDeltaY(t.pos.y - 12, pr.pos.y);
            const d = Math.hypot(dx, dy);
            if (d < 190 && d > 8) {
              const pull = (1 - d / 190) * 620 * dt;
              t.vel.x += dx / d * pull;
              t.vel.y -= dy / d * pull;
            }
          }
        }
        pr.vel.y += g * pr.gravityScale * dt;
        const prevX = pr.pos.x;
        const prevY = pr.pos.y;
        pr.pos.x = wrapX(pr.pos.x + pr.vel.x * dt);
        pr.pos.y = wrapY(pr.pos.y + pr.vel.y * dt);
        pr.life -= dt;
        if (pr.life <= 0) continue;
        let hit = false;
        for (const t of this.players) {
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue;
          if (t.id !== pr.owner && t.team === this.ownerTeamOf(pr.owner) && t.team !== "ffa") continue;
          const dxHead = wrapDeltaX(t.pos.x, pr.pos.x);
          const dyHead = wrapDeltaY(t.pos.y - 24, pr.pos.y);
          if (Math.hypot(dxHead, dyHead) <= this.config.headRadius + pr.r) {
            pr.hitTargets.push(t.id);
            const piercing = pr.pierceOnHeadshot || pr.pierceAll;
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage * pr.headshotMult, 960, pr);
              hit = true;
            } else {
              this.damage(t, Math.round(pr.damage * pr.headshotMult), pr, true, piercing);
              t.vel.x += pr.vel.x * 0.12;
              t.vel.y += pr.vel.y * 0.12 - 72;
              if (!piercing) hit = true;
            }
            if (hit) break;
            continue;
          }
          const dxBody = Math.abs(wrapDeltaX(t.pos.x, pr.pos.x));
          const dyBody = wrapDeltaY(t.pos.y, pr.pos.y);
          if (dxBody <= 13 + pr.r && dyBody >= -12 && dyBody <= 18) {
            pr.hitTargets.push(t.id);
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 900, pr);
              hit = true;
            } else {
              this.damage(t, Math.round(pr.damage), pr, false, false);
              t.vel.x += pr.vel.x * 0.09;
              t.vel.y += pr.vel.y * 0.09;
              if (!pr.pierceAll) hit = true;
            }
            if (hit) break;
          }
        }
        if (hit) {
          pr.life = 0;
          continue;
        }
        const ob = this.obstacleAt(pr.pos.x, pr.pos.y, pr.r);
        if (ob) {
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
            hit = true;
          } else {
            this.damageObstacle(ob, pr.damage, pr);
            if (!pr.pierceAll) hit = true;
          }
          if (hit) {
            pr.life = 0;
            continue;
          }
        }
        if (this.terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
          if (pr.explosive) {
            this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
            pr.life = 0;
            continue;
          }
          if (pr.bounces > 0) {
            const hitX = this.terrain.isSolidAt(pr.pos.x, prevY);
            const hitY = this.terrain.isSolidAt(prevX, pr.pos.y);
            pr.pos = { x: prevX, y: prevY };
            if (hitX) pr.vel.x = -pr.vel.x;
            if (hitY) pr.vel.y = -pr.vel.y;
            if (!hitX && !hitY) {
              pr.vel.x = -pr.vel.x;
              pr.vel.y = -pr.vel.y;
            }
            pr.bounces--;
            pr.hitTargets = [pr.owner];
            continue;
          }
          pr.life = 0;
          continue;
        }
      }
    }
    ownerTeamOf(id) {
      return this.players.find((p) => p.id === id)?.team ?? "ffa";
    }
    // ── 爆炸（对障碍物/玩家/含引力内爆） ──────────────────────
    explode(cx, cy, radius, maxDamage, knockback, pr, ownerId, ownerTeam, weaponLabel, implosion = false) {
      const wCx = wrapX(cx);
      this.events.push({ kind: "explosion", x: wCx, y: cy, radius });
      for (const ob of [...this.obstacles]) {
        const dx = wrapDeltaX(wCx, ob.x + ob.w / 2);
        const dOb = wrapDeltaY(ob.y, cy);
        const nearY = clamp(dOb, 0, ob.h);
        const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY);
        if (dist <= radius * 1.25) this.damageObstacle(ob, maxDamage * (1 - dist / (radius * 1.25)) + 30, pr);
      }
      const hitR = radius * 1.35;
      const atkId = ownerId ?? pr?.owner ?? 0;
      const atkTeam = ownerTeam ?? this.ownerTeamOf(atkId);
      const label = weaponLabel ?? pr?.weaponLabel ?? "\u7206\u70B8";
      for (const t of this.players) {
        if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
        const dx = wrapDeltaX(wCx, t.pos.x);
        const dy = wrapDeltaY(cy, t.pos.y - 12);
        const dist = Math.hypot(dx, dy);
        if (dist > hitR) continue;
        const falloff = Math.max(0.2, 1 - dist / hitR);
        const nx = dist > 0.1 ? dx / dist : 0;
        const ny = dist > 0.1 ? dy / dist : -1;
        const sign = implosion ? -0.85 : 1;
        t.vel.x += nx * knockback * falloff * sign;
        t.vel.y += (ny * knockback - 210) * falloff * sign;
        const isSelf = t.id === atkId;
        const isTeammate = !isSelf && t.team === atkTeam && t.team !== "ffa";
        if (!isTeammate) {
          const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1));
          const headDist = Math.hypot(dx, wrapDeltaY(cy, t.pos.y - 26));
          const isHead = headDist < this.config.headRadius * 1.6 && dist < radius * 0.6;
          this.damage(t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label);
        }
      }
    }
    damage(t, amount, pr, isHead, isPierced, attackerId, attackerTeam, weaponLabel) {
      if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return;
      const atkId = attackerId ?? pr?.owner ?? 0;
      const atkTeam = attackerTeam ?? this.ownerTeamOf(atkId);
      const label = weaponLabel ?? pr?.weaponLabel ?? "\u672A\u77E5";
      let remaining = amount;
      if (t.shieldTimer > 0 && t.shieldHp > 0) {
        const absorbed = Math.min(t.shieldHp, remaining);
        t.shieldHp -= absorbed;
        remaining -= absorbed;
        if (t.shieldHp <= 0) {
          t.shieldHp = 0;
          t.shieldTimer = 0;
          this.events.push({ kind: "shield_break", x: t.pos.x, y: t.pos.y, playerId: t.id });
        }
        if (remaining <= 0) return;
      }
      t.hp -= remaining;
      if (isHead) this.events.push({ kind: "headshot", x: t.pos.x, y: t.pos.y, victimId: t.id, playerId: atkId, isPierced });
      this.hits++;
      if (t.hp > 0) return;
      if (t.doll && t.doll.timer > 0) {
        this.recallDoll(t, "doll_recall");
        return;
      }
      t.hp = 0;
      t.deaths++;
      t.respawnTimer = this.config.respawnDelay;
      t.shieldHp = 0;
      t.shieldTimer = 0;
      t.watchtowerTimer = 0;
      const mk = this.mortars.find((m) => m.operatorId === t.id);
      if (mk) mk.operatorId = null;
      const killer = this.players.find((x) => x.id === atkId);
      if (killer && atkId !== t.id) {
        killer.kills++;
        if (this.scores[atkTeam] !== void 0) this.scores[atkTeam]++;
      }
      this.events.push({
        kind: "kill",
        killerId: atkId,
        victimId: t.id,
        killerName: killer?.name ?? "\u6218\u573A\u73AF\u5883",
        killerTeam: atkTeam,
        victimName: t.name,
        victimTeam: t.team,
        weaponLabel: label,
        isHeadshot: isHead,
        isPierced,
        x: t.pos.x,
        y: t.pos.y
      });
    }
    damageObstacle(ob, dmg, pr) {
      if (ob.hp <= 0 || dmg <= 0) return;
      ob.hp = Math.max(0, ob.hp - Math.round(dmg));
      if (ob.hp <= 0) {
        this.obstacles = this.obstacles.filter((o) => o.id !== ob.id);
        this.events.push({ kind: "obstacle_destroy", obstacleId: ob.id, x: ob.x, y: ob.y });
      }
    }
    obstacleAt(x, y, pad = 0) {
      const wx = wrapX(x);
      for (const ob of this.obstacles) {
        if (ob.hp <= 0) continue;
        const dy = wrapDeltaY(ob.y, y);
        if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob;
      }
      return null;
    }
    // ── 手雷 ──────────────────────────────────────────────
    stepGrenades(dt) {
      const g0 = 1250;
      for (const g of this.grenades) {
        g.vel.y += g0 * 0.88 * dt;
        g.vel.x *= 0.99;
        const nx = wrapX(g.pos.x + g.vel.x * dt);
        if (this.terrain.isSolidAt(nx, g.pos.y) || this.obstacleAt(nx, g.pos.y)) g.vel.x *= -0.35;
        else g.pos.x = nx;
        const ny = g.pos.y + g.vel.y * dt;
        if (this.terrain.isSolidAt(g.pos.x, ny) || this.obstacleAt(g.pos.x, ny)) {
          g.vel.y *= -0.28;
          g.vel.x *= 0.42;
          if (Math.abs(g.vel.y) < 81) {
            g.vel.y = 0;
            g.vel.x *= 0.6;
            if (Math.abs(g.vel.x) < 11) g.vel.x = 0;
          }
        } else g.pos.y = wrapY(ny);
        g.fuse -= dt;
        if (g.fuse <= 0) {
          this.explode(g.pos.x, g.pos.y, this.config.grenadeRadius, this.config.grenadeDamage, 16 * 60, void 0, g.owner, void 0, "\u624B\u69B4\u5F39");
          g.fuse = 0;
        }
      }
    }
    // ── 地雷（受重力 + 直击 + 瞬发 + 定时必爆 + 预设重生） ──────────
    stepLandmines(dt) {
      const g0 = 1250;
      for (let i = this.landmines.length - 1; i >= 0; i--) {
        const m = this.landmines[i];
        if (m.respawnTimer > 0) {
          m.respawnTimer -= dt;
          if (m.respawnTimer <= 0) {
            m.armed = true;
            m.triggered = false;
            m.fuse = 0;
            m.vel = { x: 0, y: 0 };
          }
          continue;
        }
        if (!this.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !this.obstacleAt(m.pos.x, m.pos.y + 8)) {
          m.vel.y += g0 * 0.86 * dt;
          const nx = wrapX(m.pos.x + m.vel.x * dt);
          if (!this.terrain.isSolidAt(nx, m.pos.y) && !this.obstacleAt(nx, m.pos.y)) m.pos.x = nx;
          else m.vel.x = -m.vel.x * 0.35;
          const ny = m.pos.y + m.vel.y * dt;
          if (!this.terrain.isSolidAt(m.pos.x, ny + 8) && !this.obstacleAt(m.pos.x, ny + 8)) m.pos.y = wrapY(ny);
          else {
            m.vel.y = 0;
            m.vel.x *= 0.35;
            if (Math.abs(m.vel.x) < 12) m.vel.x = 0;
          }
        } else {
          m.vel.y = 0;
          m.vel.x *= 0.5;
          if (Math.abs(m.vel.x) < 12) m.vel.x = 0;
        }
        if (m.directHit && !m.triggered) {
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue;
            if (t.team === this.ownerTeamOf(m.owner) && t.team !== "ffa") continue;
            if (wrapDist(m.pos.x, m.pos.y, t.pos.x, t.pos.y - 10) <= 26) {
              m.triggered = true;
              m.fuse = 0.01;
              break;
            }
          }
        }
        if (!m.armed && !m.triggered) {
          m.armTimer -= dt;
          if (m.armTimer <= 0) m.armed = true;
          continue;
        }
        if (!m.triggered) {
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue;
            if (!m.preset && t.id === m.owner) continue;
            if (wrapDist(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= this.config.mineTriggerRadius) {
              m.triggered = true;
              m.fuse = m.instant ? 0.02 : 0.45;
              break;
            }
          }
        } else {
          m.fuse -= dt;
          if (m.fuse <= 0) {
            const label = m.instant ? "\u26A1\u77AC\u53D1\u5730\u96F7" : "\u{1F6A8}\u611F\u5E94\u5730\u96F7";
            const ownTeam = m.owner === 0 ? "ffa" : this.ownerTeamOf(m.owner);
            this.explode(m.pos.x, m.pos.y, 82, this.config.mineDamage, 19 * 60, void 0, m.owner === 0 ? void 0 : m.owner, void 0, label);
            if (m.preset) m.respawnTimer = this.config.mineRespawnTime;
            else this.landmines.splice(i, 1);
          }
        }
      }
    }
    // ── 空袭 ──────────────────────────────────────────────
    stepAirstrikes(dt) {
      for (let i = this.airstrikes.length - 1; i >= 0; i--) {
        const st = this.airstrikes[i];
        st.timer -= dt;
        if (st.timer <= 0 && !st.dropped) {
          st.dropped = true;
          this.events.push({ kind: "airstrike_drop", x: st.pos.x, y: st.pos.y });
          const src = this.players.find((p) => p.id === st.owner);
          for (let b = -2; b <= 2; b++) {
            this.projectiles.push(this.makeProjectile(
              src ?? { id: st.owner, pos: st.pos, vel: { x: 0, y: 0 }, aim: 0, team: "ffa", name: "\u7A7A\u88AD" },
              st.pos.x + b * 44,
              st.pos.y - 420 - Math.abs(b) * 28,
              this.rng.range(-30, 30),
              900 + this.rng.range(0, 120),
              {
                damage: this.config.airstrikeDamage,
                headshotMult: 1.5,
                terrainRadius: this.config.airstrikeRadius,
                explosive: true,
                gravityScale: 0.5,
                weaponLabel: "\u2708\uFE0F\u5B9A\u70B9\u7A7A\u88AD",
                color: "#f43f5e",
                r: 7,
                life: 160 / 60
              }
            ));
          }
        }
        if (st.timer <= -0.6) this.airstrikes.splice(i, 1);
      }
    }
    // ── 占点 ──────────────────────────────────────────────
    stepCapturePoints(dt) {
      for (const cp of this.capturePoints) {
        const presence = {};
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < this.config.captureRadius) {
            presence[p.team] = (presence[p.team] || 0) + 1;
          }
        }
        const teams = Object.keys(presence);
        if (teams.length === 1) {
          const t = teams[0];
          if (cp.ownerTeam !== t) {
            cp.capturingTeam = t;
            cp.progress += this.config.captureRate * dt * (presence[t] || 0);
            if (cp.progress >= 100) {
              cp.progress = 100;
              cp.ownerTeam = t;
              this.events.push({ kind: "capture", pointCode: cp.code, team: t, x: cp.x, y: cp.y });
            }
          }
        }
      }
    }
    // ── 迫击炮冷却 ──────────────────────────────────────────
    stepMortars(dt) {
      for (const m of this.mortars) {
        if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt);
      }
    }
    // ── 补给箱 ──────────────────────────────────────────────
    stepSupplyCrates(dt) {
      for (const crate of this.supplyCrates) {
        if (!crate.active && crate.respawnTimer > 0) {
          crate.respawnTimer -= dt;
          if (crate.respawnTimer <= 0) crate.active = true;
        }
        if (!crate.active) continue;
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 44) {
            crate.active = false;
            crate.respawnTimer = this.config.supplyRespawnTime;
            if (crate.kind === "doll") {
              p.dollCharges = Math.min(this.config.dollMaxCharges, p.dollCharges + 1);
            } else {
              p.weaponIndex = crate.weaponId;
              p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize;
              p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve;
            }
            this.events.push({ kind: "supply_pickup", playerId: p.id, weaponName: crate.weaponName, x: crate.x, y: crate.y });
            break;
          }
        }
      }
    }
    // ── 弹药点（随机刷新走 Rng） ──────────────────────────────
    spawnAmmoPack() {
      if (this.ammoPacks.length >= this.config.ammoPackMaxActive) return;
      const available = [];
      for (let i = 0; i < AMMO_SPOTS.length; i++) {
        if (!this.ammoPacks.some((a) => a.x === AMMO_SPOTS[i].x)) available.push(i);
      }
      if (available.length === 0) return;
      const spot = AMMO_SPOTS[this.rng.pick(available)];
      this.ammoPacks.push({ id: this.ammo++, x: spot.x, y: spot.y, area: spot.area });
    }
    tickAmmoSpawner(dt) {
      this.ammoSpawnTimer += dt;
      if (this.ammoSpawnTimer >= this.config.ammoPackInterval) {
        this.ammoSpawnTimer = 0;
        this.spawnAmmoPack();
      }
      for (let i = this.ammoPacks.length - 1; i >= 0; i--) {
        const pack = this.ammoPacks[i];
        for (const p of this.players) {
          if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue;
          if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 44) {
            const wep = WEAPONS[p.weaponIndex];
            p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve);
            p.pistolReserve = Math.min(96, p.pistolReserve + 24);
            this.ammoPacks.splice(i, 1);
            this.events.push({ kind: "ammo_pickup", playerId: p.id, x: pack.x, y: pack.y });
            break;
          }
        }
      }
    }
    stepObstaclesOnly() {
    }
    // ── 快照 ──────────────────────────────────────────────
    snapshot() {
      return {
        tick: this.tick,
        seed: this.seed,
        players: this.players.map((p) => ({
          ...p,
          pos: { ...p.pos },
          vel: { ...p.vel },
          ammo: [...p.ammo],
          reserveAmmo: [...p.reserveAmmo],
          doll: p.doll ? { ...p.doll, pos: { ...p.doll.pos }, ammo: [...p.doll.ammo], reserveAmmo: [...p.doll.reserveAmmo] } : null
        })),
        projectiles: this.projectiles.map((pr) => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel }, hitTargets: [...pr.hitTargets] })),
        grenades: this.grenades.map((g) => ({ ...g, pos: { ...g.pos }, vel: { ...g.vel } })),
        landmines: this.landmines.map((m) => ({ ...m, pos: { ...m.pos }, vel: { ...m.vel } })),
        airstrikes: this.airstrikes.map((a) => ({ ...a, pos: { ...a.pos } })),
        obstacles: this.obstacles.map((o) => ({ ...o })),
        capturePoints: this.capturePoints.map((c) => ({ ...c })),
        ammoPacks: this.ammoPacks.map((a) => ({ ...a })),
        supplyCrates: this.supplyCrates.map((c) => ({ ...c })),
        mortars: this.mortars.map((m) => ({ ...m })),
        scores: { ...this.scores }
      };
    }
  };

  // src/net/ServerSim.ts
  var ServerSim = class {
    world;
    clients = [];
    events = [];
    constructor(world2) {
      this.world = world2;
    }
    accept(id, transport) {
      const client = { id, transport, input: defaultWorldInput() };
      transport.onClient((msg) => {
        client.input = applyIntents(client.input, msg.intents);
      });
      this.clients.push(client);
    }
    step(dt) {
      const inputs = /* @__PURE__ */ new Map();
      for (const c of this.clients) inputs.set(c.id, c.input);
      this.world.step(dt, inputs);
      for (const c of this.clients) {
        c.input.jump = false;
        c.input.interact = false;
        c.input.secondary = null;
        c.input.switchWeapon = null;
        c.input.reload = false;
      }
      const events = this.world.drainEvents();
      this.events.push(...events);
      const snap = this.world.snapshot();
      const msg = { snap, events };
      for (const c of this.clients) c.transport.send(msg);
    }
    /** 取走累计事件（net/ui 层订阅 killfeed/音效用） */
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
  };
  function applyIntents(cur, intents) {
    const n = { ...cur };
    for (const it of intents) {
      switch (it.t) {
        case "move":
          n.move = it.dir;
          break;
        case "jump":
          n.jump = true;
          break;
        case "jetpack":
          n.jetpack = it.on;
          break;
        case "aim":
          n.aim = it.angle;
          break;
        case "fire":
          n.fire = it.on;
          break;
        case "reload":
          n.reload = true;
          break;
        case "interact":
          n.interact = true;
          break;
        case "secondary":
          n.secondary = { type: it.kind, targetX: it.targetX, targetY: it.targetY };
          break;
        case "switchWeapon":
          n.switchWeapon = it.index;
          break;
      }
    }
    return n;
  }

  // src/web/controls.ts
  var Controls = class {
    keys = /* @__PURE__ */ new Set();
    mouse = { x: 0, y: 0 };
    mouseDown = false;
    playerWorld = { x: 0, y: 0 };
    isTouch;
    tMoveX = 0;
    tAim = 0;
    tFire = false;
    tJump = false;
    tJetpack = false;
    tReload = false;
    canvas;
    logicalW;
    logicalH;
    constructor(canvas2, logicalW, logicalH, cb = {}) {
      this.canvas = canvas2;
      this.logicalW = logicalW;
      this.logicalH = logicalH;
      const forcedTouch = new URLSearchParams(location.search).get("touch") === "1";
      this.isTouch = forcedTouch || "ontouchstart" in window;
      window.addEventListener("keydown", (e) => this.onKey(e, true));
      window.addEventListener("keyup", (e) => this.onKey(e, false));
      window.addEventListener("mousemove", (e) => {
        this.mouse = this.toWorld(e.clientX, e.clientY);
      });
      window.addEventListener("mousedown", (e) => {
        if (e.button === 0) this.mouseDown = true;
      });
      window.addEventListener("mouseup", (e) => {
        if (e.button === 0) this.mouseDown = false;
      });
      canvas2.addEventListener("touchstart", (e) => this.onTouch(e), { passive: false });
      canvas2.addEventListener("touchmove", (e) => this.onTouch(e), { passive: false });
      canvas2.addEventListener("touchend", (e) => this.onTouchEnd(e), { passive: false });
      canvas2.addEventListener("touchcancel", (e) => this.onTouchEnd(e), { passive: false });
    }
    /** 玩家逻辑世界坐标（供瞄准角计算） */
    setPlayerScreen(x, y) {
      this.playerWorld = { x, y };
    }
    pressJump() {
      this.tJump = true;
    }
    setJetpack(on) {
      this.tJetpack = on;
    }
    pressReload() {
      this.tReload = true;
    }
    consumeMomentary() {
      this.tJump = false;
      this.tReload = false;
    }
    getState() {
      if (this.isTouch) {
        return { moveX: this.tMoveX, aimAngle: this.tAim, fire: this.tFire, jump: this.tJump, jetpack: this.tJetpack, reload: this.tReload };
      }
      const k = this.keys;
      let moveX = 0;
      if (k.has("a") || k.has("arrowleft")) moveX -= 1;
      if (k.has("d") || k.has("arrowright")) moveX += 1;
      const jetpack2 = k.has("w") || k.has(" ") || k.has("arrowup") || k.has("e");
      const aim = Math.atan2(this.mouse.y - this.playerWorld.y, this.mouse.x - this.playerWorld.x);
      return {
        moveX,
        aimAngle: aim,
        fire: this.mouseDown,
        jump: false,
        jetpack: jetpack2,
        reload: k.has("r")
      };
    }
    toWorld(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - r.left) / r.width * this.logicalW,
        y: (clientY - r.top) / r.height * this.logicalH
      };
    }
    onKey(e, down) {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright", "e", "r"].includes(k)) e.preventDefault();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
    }
    onTouch(e) {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        const relX = t.clientX - r.left;
        if (relX < r.width / 2) {
          this.tMoveX = Math.max(-1, Math.min(1, (relX / (r.width / 2) - 0.5) * 2));
        } else {
          const w = this.toWorld(t.clientX, t.clientY);
          this.tAim = Math.atan2(w.y - this.playerWorld.y, w.x - this.playerWorld.x);
          this.tFire = true;
        }
      }
    }
    onTouchEnd(e) {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        const relX = t.clientX - r.left;
        if (relX >= r.width / 2) this.tFire = false;
        else this.tMoveX = 0;
      }
    }
  };

  // src/web/fullscreen.ts
  function isFullscreen() {
    const d = document;
    return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
  }
  function toggleFullscreen() {
    const el = document.documentElement;
    const d = document;
    if (isFullscreen()) {
      ;
      d.exitFullscreen?.() ?? d.webkitExitFullscreen?.();
    } else {
      ;
      el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
    }
  }
  function fitCanvas(canvas2, logicalW, logicalH) {
    const ctx2 = canvas2.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas2.width = Math.max(1, Math.round(logicalW * dpr));
      canvas2.height = Math.max(1, Math.round(logicalH * dpr));
      canvas2.style.width = "100%";
      canvas2.style.height = "100%";
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    document.body.style.touchAction = "none";
    document.body.style.overflow = "hidden";
    return {
      toWorld: (clientX, clientY) => {
        const rect = canvas2.getBoundingClientRect();
        return {
          x: (clientX - rect.left) / rect.width * logicalW,
          y: (clientY - rect.top) / rect.height * logicalH
        };
      },
      applyTransform: () => {
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
  }

  // src/web/main-web.ts
  var W = 960;
  var H = 600;
  var canvas = document.getElementById("game");
  var vp = fitCanvas(canvas, W, H);
  var ctx = canvas.getContext("2d");
  var controls = new Controls(canvas, W, H, { onFullscreen: toggleFullscreen });
  var SEED = 20261106;
  var world = new World(SEED);
  world.config.loadoutLock = false;
  var server = new ServerSim(world);
  var player = world.addPlayer("YOU", "red");
  player.pos = { x: 1700, y: 1750 };
  player.weaponIndex = 1;
  var bots = [world.addPlayer("AI-1", "blue"), world.addPlayer("AI-2", "blue")];
  bots[0].pos = { x: 2300, y: 1750 };
  bots[1].pos = { x: 1200, y: 2200 };
  var playerInput = defaultWorldInput();
  var botInputs = /* @__PURE__ */ new Map();
  var weaponKeyMap = { "1": 0, "2": 1, "3": 2, "4": 3 };
  var wantSecondary = null;
  var wantInteract = false;
  var wantSwitch = null;
  var secOrder = Object.keys(SECONDARIES);
  var secIndex = 0;
  function availableSecondaries() {
    return secOrder.filter((id) => !SECONDARIES[id].supplyOnly || player.dollCharges > 0);
  }
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (weaponKeyMap[k] !== void 0) wantSwitch = weaponKeyMap[k];
    if (k === "g") {
      const list = availableSecondaries();
      wantSecondary = list[secIndex % list.length];
    }
    if (k === "t") {
      const list = availableSecondaries();
      secIndex = (secIndex + 1) % list.length;
    }
    if (k === "e") wantInteract = true;
  });
  for (const id of ["btn-jump", "btn-jet"]) {
    document.getElementById(id)?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      controls.setJetpack(true);
    });
    document.getElementById(id)?.addEventListener("touchend", () => controls.setJetpack(false));
  }
  document.getElementById("btn-reload")?.addEventListener("touchstart", (e) => {
    e.preventDefault();
    controls.pressReload();
  });
  function toIntents(t) {
    const out = [];
    let moveDir = 0;
    if (t.moveX > 0.2) moveDir = 1;
    else if (t.moveX < -0.2) moveDir = -1;
    out.push({ t: "move", dir: moveDir });
    out.push({ t: "aim", angle: t.aimAngle });
    out.push({ t: "fire", on: t.fire });
    out.push({ t: "jetpack", on: t.jetpack });
    if (t.reload) out.push({ t: "reload" });
    if (wantInteract) {
      out.push({ t: "interact" });
      wantInteract = false;
    }
    if (wantSecondary) {
      const tx = wrapX(player.pos.x + Math.cos(t.aimAngle) * 240);
      const ty = wrapY(player.pos.y + Math.sin(t.aimAngle) * 240);
      out.push({ t: "secondary", kind: wantSecondary, targetX: tx, targetY: ty });
      wantSecondary = null;
    }
    if (wantSwitch !== null) {
      out.push({ t: "switchWeapon", index: wantSwitch });
      wantSwitch = null;
    }
    return out;
  }
  function botInput(bot) {
    const enemies = [player, ...bots.filter((b) => b !== bot)];
    let target = enemies[0];
    let best = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    const dx = wrapDeltaX(bot.pos.x, target.pos.x);
    const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12);
    const aim = Math.atan2(dy, dx);
    let move2 = 0;
    if (Math.abs(dx) > 320) move2 = dx > 0 ? 1 : -1;
    else if (Math.abs(dx) < 160) move2 = dx > 0 ? -1 : 1;
    return {
      ...defaultWorldInput(),
      move: move2,
      aim,
      fire: world.tick % 10 < 4
    };
  }
  var cam = { x: player.pos.x, y: player.pos.y };
  function updateCamera() {
    const tx = cam.x + wrapDeltaX(cam.x, player.pos.x) * 0.12;
    const ty = cam.y + wrapDeltaY(cam.y, player.pos.y) * 0.12;
    cam.x = wrapX(tx);
    cam.y = wrapY(ty);
  }
  function screenOf(wx, wy) {
    const dx = wrapDeltaX(cam.x, wx);
    const dy = wrapDeltaY(cam.y, wy);
    return { x: W / 2 + dx, y: H / 2 + dy };
  }
  function render() {
    vp.applyTransform();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b0f16";
    ctx.fillRect(0, 0, W, H);
    for (const r of world.terrain.rects) {
      const p = screenOf(r.x + r.w / 2, r.y + r.h / 2);
      const left = p.x - r.w / 2;
      const top = p.y - r.h / 2;
      if (left > W + 40 || left + r.w < -40 || top > H + 40 || top + r.h < -40) continue;
      ctx.fillStyle = r.color;
      ctx.fillRect(left, top, r.w, r.h);
      if (r.borderColor) {
        ctx.strokeStyle = r.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, r.w - 1, r.h - 1);
      }
    }
    for (const s of world.terrain.shadows) {
      const p = screenOf(s.x + s.w / 2, s.y + s.h / 2);
      if (p.x - s.w / 2 > W || p.x + s.w / 2 < 0 || p.y - s.h / 2 > H || p.y + s.h / 2 < 0) continue;
      ctx.fillStyle = `rgba(0,0,0,${s.alpha})`;
      ctx.fillRect(p.x - s.w / 2, p.y - s.h / 2, s.w, s.h);
    }
    for (const ob of world.obstacles) {
      const p = screenOf(ob.x + ob.w / 2, ob.y + ob.h / 2);
      const left = p.x - ob.w / 2, top = p.y - ob.h / 2;
      if (left > W + 40 || left + ob.w < -40 || top > H + 40 || top + ob.h < -40) continue;
      ctx.fillStyle = ob.color;
      ctx.fillRect(left, top, ob.w, ob.h);
      ctx.strokeStyle = ob.borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2);
      ctx.fillStyle = "#000";
      ctx.fillRect(left, top - 6, ob.w, 3);
      ctx.fillStyle = "#5ad37a";
      ctx.fillRect(left, top - 6, ob.w * (ob.hp / ob.maxHp), 3);
    }
    for (const cp of world.capturePoints) {
      const p = screenOf(cp.x, cp.y);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
      const teamColor = cp.ownerTeam === "red" ? "#f43f5e" : cp.ownerTeam === "blue" ? "#0ea5e9" : cp.ownerTeam === "green" ? "#10b981" : cp.ownerTeam === "ffa" ? "#eab308" : "#94a3b8";
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`\u{1F6A9}${cp.code} ${Math.round(cp.progress)}%`, p.x, p.y - 64);
    }
    for (const a of world.ammoPacks) {
      const p = screenOf(a.x, a.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
    }
    for (const c of world.supplyCrates) {
      if (!c.active) continue;
      const p = screenOf(c.x, c.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = c.color;
      ctx.fillRect(p.x - 9, p.y - 9, 18, 18);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
      if (c.kind === "doll") {
        ctx.fillStyle = "#fff";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText("\u{1F38E}", p.x, p.y - 14);
      }
    }
    for (const m of world.mortars) {
      const p = screenOf(m.x, m.y);
      if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
      ctx.fillStyle = m.operatorId ? "#f97316" : "#64748b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of world.landmines) {
      if (m.respawnTimer > 0) continue;
      const p = screenOf(m.pos.x, m.pos.y);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      ctx.fillStyle = m.triggered ? "#ef4444" : m.preset ? "#f59e0b" : "#fb7185";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const g of world.grenades) {
      const p = screenOf(g.pos.x, g.pos.y);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const st of world.airstrikes) {
      const p = screenOf(st.pos.x, st.pos.y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const pr of world.projectiles) {
      const p = screenOf(pr.pos.x, pr.pos.y);
      if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue;
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pr.r, 0, Math.PI * 2);
      ctx.fill();
    }
    drawPlayer(player, "#4ade80", "YOU");
    for (const b of bots) drawPlayer(b, "#f87171", b.name);
    const secList = availableSecondaries();
    const curSec = secList[secIndex % secList.length] ?? "frag";
    const hud = [
      `\u2764 ${player.hp}/${player.maxHp}   ${WEAPONS[player.weaponIndex].shortName} ${player.ammo[player.weaponIndex]}/${player.reserveAmmo[player.weaponIndex]}   \u{1F6E1}${player.shieldTimer > 0 ? player.shieldHp : "-"}   \u{1F38E}${player.dollCharges}`,
      `\u526F\u6B66\u5668: ${SECONDARIES[curSec].icon} ${SECONDARIES[curSec].name} [T\u5207\u6362 G\u4F7F\u7528]   \u{1F6A9} ${world.capturePoints.map((c) => `${c.code}:${Math.round(c.progress)}%`).join(" ")}`,
      `\u6BD4\u5206 R/B/G ${world.scores.red}/${world.scores.blue}/${world.scores.green}   pos=(${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)})   tick=${world.tick}`
    ];
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(8, 8, 680, 62);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    hud.forEach((line, i) => ctx.fillText(line, 14, 24 + i * 18));
    const cross = screenOf(player.pos.x + Math.cos(player.aim) * 240, player.pos.y - 12 + Math.sin(player.aim) * 240);
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cross.x - 6, cross.y);
    ctx.lineTo(cross.x + 6, cross.y);
    ctx.moveTo(cross.x, cross.y - 6);
    ctx.lineTo(cross.x, cross.y + 6);
    ctx.stroke();
  }
  function drawPlayer(p, color, label) {
    const s = screenOf(p.pos.x, p.pos.y);
    ctx.fillStyle = p.alive ? color : "#475569";
    ctx.fillRect(s.x - 10, s.y - 26, 20, 42);
    ctx.beginPath();
    ctx.arc(s.x, s.y - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 12);
    ctx.lineTo(s.x + Math.cos(p.aim) * 34, s.y - 12 + Math.sin(p.aim) * 34);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.fillRect(s.x - 18, s.y - 40, 36, 4);
    ctx.fillStyle = p.hp > 50 ? "#5ad37a" : p.hp > 25 ? "#e0b74d" : "#e05a5a";
    ctx.fillRect(s.x - 18, s.y - 40, 36 * Math.max(0, p.hp) / p.maxHp, 4);
    if (p.shieldTimer > 0) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 12, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${label} ${p.kills}/${p.deaths}`, s.x, s.y - 46);
  }
  var last = performance.now();
  var acc = 0;
  var FIXED = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1e3);
    last = now;
    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      const t = controls.getState();
      controls.setPlayerScreen(W / 2, H / 2);
      playerInput = applyIntents(playerInput, toIntents(t));
      botInputs.clear();
      for (const b of bots) botInputs.set(b.id, botInput(b));
      const inputs = new Map([[player.id, playerInput], ...botInputs]);
      world.step(FIXED, inputs);
      world.drainEvents();
      controls.consumeMomentary();
      acc -= FIXED;
      guard++;
    }
    updateCamera();
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__dbg = {
    world,
    controls,
    get player() {
      return player;
    },
    get bots() {
      return bots;
    },
    get camera() {
      return cam;
    },
    get secIndex() {
      return secIndex;
    },
    get secList() {
      return availableSecondaries();
    },
    get pendingSecondary() {
      return wantSecondary;
    }
  };
  var PARAM_KEY = "pvp-physics-params";
  function persistParams(p) {
    try {
      localStorage.setItem(PARAM_KEY, JSON.stringify(p));
    } catch {
    }
  }
  function clearParams() {
    try {
      localStorage.removeItem(PARAM_KEY);
    } catch {
    }
  }
  (function loadSavedParams() {
    try {
      const raw = localStorage.getItem(PARAM_KEY);
      if (raw) setPhysicsParams(JSON.parse(raw));
    } catch {
    }
  })();
  window.__tune = {
    set: (p) => {
      const cur = setPhysicsParams(p);
      persistParams(cur);
      return cur;
    },
    get: () => getPhysicsParams(),
    reset: () => {
      const cur = resetPhysicsParams();
      clearParams();
      return cur;
    }
  };
})();
