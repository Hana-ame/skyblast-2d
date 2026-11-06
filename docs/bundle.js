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
    // 满能量只够喷 1s（drain 0.5）
    jetpackDrain: 0.5,
    // 满槽 1s 用尽
    jetpackRecharge: 0.35
    // 落地回充：约 1.43s 回满（空中不回充）
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
  function updateJetpackFuel(fuel, active, onGround, dt) {
    const next = active ? fuel - P.jetpackDrain * dt : onGround ? fuel + P.jetpackRecharge * dt : fuel;
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
      damage: 16,
      headshotMult: 1.8,
      pellets: 8,
      spread: 0.28,
      speed: 1e3,
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
      damage: 19,
      headshotMult: 2.2,
      pellets: 1,
      spread: 0.045,
      speed: 1250,
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
      damage: 68,
      headshotMult: 2.5,
      pellets: 1,
      spread: 3e-3,
      speed: 2e3,
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
      damage: 68,
      headshotMult: 1.5,
      pellets: 1,
      spread: 0.025,
      speed: 950,
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
      damage: 50,
      headshotMult: 2,
      pellets: 1,
      spread: 1e-3,
      speed: 3e3,
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
      bounces: 2,
      beam: true,
      fovMult: 1.15,
      color: "#22d3ee"
    },
    {
      id: 5,
      name: "\u{1F525} \u91CD\u88C5\u52A0\u7279\u6797",
      shortName: "\u52A0\u7279\u6797",
      isSupplyOnly: true,
      damage: 14,
      headshotMult: 1.8,
      pellets: 1,
      spread: 0.11,
      speed: 1300,
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
      damage: 52,
      headshotMult: 1.6,
      pellets: 1,
      spread: 0.01,
      speed: 900,
      recoil: 240,
      magSize: 6,
      maxReserve: 18,
      reloadTime: 2.2,
      fireDelay: 0.68,
      terrainRadius: 95,
      explosive: true,
      isGravityOrb: true,
      gravityScale: 0.08,
      passWalls: true,
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
  var WATCHTOWERS = [
    { id: "tower_1", name: "\u897F\u90E8\u9AD8\u7A7A\u77AD\u671B\u5854", x: 2580, y: 1620 },
    { id: "tower_2", name: "\u4E2D\u592E\u5317\u5854\u77AD\u671B\u53F0", x: 5840, y: 1600 },
    { id: "tower_3", name: "\u4E2D\u592E\u5357\u5854\u77AD\u671B\u53F0", x: 7360, y: 1600 },
    { id: "tower_4", name: "\u4E1C\u90E8\u9AD8\u7A7A\u77AD\u671B\u5854", x: 10580, y: 1620 }
  ];
  var WARP_PORTALS = [
    { id: "warp_1", name: "W1 \u897F\u7FFC\u5730\u8868\u4F20\u9001\u95E8", x: 880, y: 2760, targetId: "warp_2", color: "#06b6d4" },
    { id: "warp_2", name: "W2 \u4E2D\u592E\u9AD8\u7A7A\u6D6E\u5C9B\u95E8", x: 6320, y: 1040, targetId: "warp_1", color: "#06b6d4" },
    { id: "warp_3", name: "W3 \u897F\u533A\u6DF1\u5C42\u5730\u9053\u95E8", x: 2980, y: 3680, targetId: "warp_4", color: "#a855f7" },
    { id: "warp_4", name: "W4 \u4E1C\u533A\u901A\u4FE1\u697C\u9876\u95E8", x: 9580, y: 2040, targetId: "warp_3", color: "#a855f7" },
    { id: "warp_5", name: "W5 \u4E2D\u592E\u5730\u4E0B\u63A9\u4F53\u95E8", x: 6880, y: 3500, targetId: "warp_6", color: "#10b981" },
    { id: "warp_6", name: "W6 \u6781\u4E1C\u8FB9\u5883\u9AD8\u53F0\u95E8", x: 12280, y: 2140, targetId: "warp_5", color: "#10b981" }
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
    watchtowers = WATCHTOWERS;
    warpPortals = WARP_PORTALS;
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
        warpCooldown: 0,
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
      p.warpCooldown = 0;
      p.doll = null;
      p.dollCharges = 0;
      p.reloading = false;
      p.fireCooldown = 0;
      p.secondaryCooldown = 0;
      p.deployed = true;
      p.alive = true;
      p.respawnTimer = 0;
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
      p.fuel = updateJetpackFuel(fuel, w.jetpack, !!p.onGround, dt);
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
      if (p.warpCooldown > 0) p.warpCooldown = Math.max(0, p.warpCooldown - dt);
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
      const mountedNow = this.mortars.find((m) => m.operatorId === p.id);
      if (mountedNow) {
        let a = p.aim;
        if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12;
        mountedNow.angle = a;
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
          passWalls: !!wep.passWalls,
          beam: !!wep.beam,
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
        passWalls: !!o.passWalls,
        beam: !!o.beam,
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
      for (const tw of this.watchtowers) {
        if (wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 115) {
          p.watchtowerTimer = this.config.watchtowerDuration;
          this.events.push({ kind: "warp", x: tw.x, y: tw.y, playerId: p.id, weaponName: "\u77AD\u671B\u5854\u89C6\u91CE" });
          return;
        }
      }
      for (const wp of this.warpPortals) {
        if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
          const dest = this.warpPortals.find((w) => w.id === wp.targetId);
          if (!dest) continue;
          p.pos = { x: dest.x, y: dest.y - 60 };
          p.vel = { x: 0, y: 0 };
          p.warpCooldown = 2.5;
          this.events.push({ kind: "warp", x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name });
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
    // 子步进（≤8px/步）：高速弹（激光 3000px/s=50px/帧）不会穿过 20px 墙砖；
    // 引力弹 passWalls=true 忽略原始地形；激光撞墙反弹（bounces 次，每次反弹重置命中列表）。
    stepProjectiles(dt) {
      const g = getPhysicsParams().gravity;
      const SUBSTEP_PX = 8;
      for (const pr of this.projectiles) {
        if (pr.life <= 0) continue;
        if (pr.isGravityOrb) {
          for (const t of this.players) {
            if (t.respawnTimer > 0 || !t.deployed || !t.alive || pr.hitTargets.includes(t.id)) continue;
            const dx2 = wrapDeltaX(t.pos.x, pr.pos.x);
            const dy2 = wrapDeltaY(t.pos.y - 12, pr.pos.y);
            const d = Math.hypot(dx2, dy2);
            if (d < 190 && d > 8) {
              const pull = (1 - d / 190) * 620 * dt;
              t.vel.x += dx2 / d * pull;
              t.vel.y -= dy2 / d * pull;
            }
          }
        }
        pr.vel.y += g * pr.gravityScale * dt;
        pr.life -= dt;
        if (pr.life <= 0) continue;
        const dx = pr.vel.x * dt;
        const dy = pr.vel.y * dt;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / SUBSTEP_PX));
        const sx = dx / steps;
        const sy = dy / steps;
        let dead = false;
        for (let step = 0; step < steps; step++) {
          const prevX = pr.pos.x;
          const prevY = pr.pos.y;
          pr.pos.x = wrapX(pr.pos.x + sx);
          pr.pos.y = wrapY(pr.pos.y + sy);
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
            dead = true;
            break;
          }
          const ob = this.obstacleAt(pr.pos.x, pr.pos.y, pr.r);
          if (ob) {
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
              dead = true;
            } else {
              this.damageObstacle(ob, pr.damage, pr);
              if (!pr.pierceAll) dead = true;
            }
            if (dead) break;
          }
          if (this.terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
            if (pr.passWalls) continue;
            if (pr.explosive) {
              this.explode(pr.pos.x, pr.pos.y, pr.terrainRadius, pr.damage, 960, pr);
              dead = true;
              break;
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
              break;
            }
            dead = true;
            break;
          }
        }
        if (dead) pr.life = 0;
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

  // src/web/main-web.ts
  var canvas = document.getElementById("gameCanvas");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var camera = { x: 6600, y: 2380, fovFactor: 1 };
  var screenShake = 0;
  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth || 1024;
    canvas.height = window.innerHeight || 640;
  }
  var world = new World(20261106);
  var localPlayer = world.addPlayer("SkyHunter", "red");
  localPlayer.deployed = false;
  var botNames = ["AlphaBot-7", "Valkyrie-AI", "Titan-09", "NovaStriker", "ZeroGrav-X", "OmegaHound", "Phantom-AI", "IronClad-8"];
  var botTeams = ["blue", "green", "red", "blue", "green", "blue", "red", "green"];
  var botSecs = ["frag", "mine", "instant_mine", "airstrike", "barricade", "shield", "doll", "pistol"];
  var bots = [];
  function syncBotsCount(target) {
    while (bots.length > target) {
      const b = bots.pop();
      world.players = world.players.filter((p) => p.id !== b.id);
    }
    while (bots.length < target) {
      const idx = bots.length;
      let team = botTeams[idx % botTeams.length];
      if (team === localPlayer.team && localPlayer.team !== "ffa") team = localPlayer.team === "red" ? "blue" : "red";
      const b = world.addPlayer(botNames[idx % botNames.length], team);
      b.weaponIndex = idx % 4;
      b.secondary = botSecs[idx % botSecs.length];
      const cp = world.capturePoints[idx % world.capturePoints.length];
      b.pos = { x: wrapX(cp.x + (idx - 4) * 47), y: cp.y - 50 };
      bots.push(b);
    }
    updateTeamCountUI();
  }
  var pendingLoadout = { weaponIndex: 0, secondaryType: "frag", spawnPointId: "base" };
  function getSpawnCoords() {
    const t = SPAWN_POINTS.find((s) => s.team === localPlayer.team) ?? SPAWN_POINTS[3];
    if (pendingLoadout.spawnPointId !== "base") {
      const cp = world.capturePoints.find((c) => c.id === pendingLoadout.spawnPointId);
      if (cp && (cp.ownerTeam === localPlayer.team || localPlayer.team === "ffa")) {
        return { x: cp.x, y: cp.y - 60, label: cp.name };
      }
    }
    return { x: t.x, y: t.y, label: "\u961F\u4F0D\u4E3B\u57FA\u5730" };
  }
  function applyPendingLoadoutAndSpawn() {
    const wIdx = clamp(Number(pendingLoadout.weaponIndex), 0, 3);
    const sp = getSpawnCoords();
    localPlayer.weaponIndex = wIdx;
    localPlayer.secondary = pendingLoadout.secondaryType;
    localPlayer.ammo = WEAPONS.map((w) => w.magSize);
    localPlayer.reserveAmmo = WEAPONS.map((w) => w.maxReserve);
    localPlayer.pistolAmmo = 12;
    localPlayer.pistolReserve = 48;
    localPlayer.hp = world.config.maxHp;
    localPlayer.maxHp = world.config.maxHp;
    localPlayer.shieldHp = 0;
    localPlayer.shieldTimer = 0;
    localPlayer.doll = null;
    localPlayer.dollCharges = 0;
    localPlayer.fuel = getPhysicsParams().jetpackFuel;
    localPlayer.reloading = false;
    localPlayer.respawnTimer = 0;
    localPlayer.deployed = true;
    localPlayer.alive = true;
    localPlayer.pos = { x: wrapX(sp.x), y: sp.y };
    localPlayer.vel = { x: 0, y: 0 };
    updateHudWeaponButtons();
    showToast(`\u26A1 \u5DF2\u5728\u3010${sp.label}\u3011\u90E8\u7F72\uFF01\u914D\u88C5\u5DF2\u9501\u5B9A\uFF1A${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`);
  }
  var keys = {};
  var mouse = { x: 0, y: 0, worldX: 6600, worldY: 2380, down: false };
  var touchState = {
    enabled: false,
    moveActive: false,
    moveId: -1,
    moveX: 0,
    moveY: 0,
    boostButtonDown: false,
    aimActive: false,
    aimId: -1,
    aimX: 0,
    aimY: 0
  };
  var pendingInteract = false;
  var pendingSecondary = null;
  var pendingReload = false;
  function updateInputModeBadge(isTouchMode, isAuto) {
    const badge = document.getElementById("inputDeviceDetectBadge");
    if (!badge) return;
    const prefix = isAuto ? "\u5DF2\u81EA\u52A8\u8BC6\u522B" : "\u5DF2\u624B\u52A8\u5207\u6362";
    if (isTouchMode) {
      badge.textContent = `\u{1F4F1} ${prefix}\uFF1A\u624B\u673A/\u5E73\u677F\u89E6\u5C4F\u6A21\u5F0F (\u70B9\u51FB\u53EF\u5207\u952E\u9F20)`;
      badge.className = "px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35 transition";
    } else {
      badge.textContent = `\u{1F4BB} ${prefix}\uFF1APC \u952E\u9F20\u64CD\u63A7\u6A21\u5F0F (\u70B9\u51FB\u53EF\u5207\u89E6\u5C4F)`;
      badge.className = "px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition";
    }
  }
  function setTouchLayerVisible(visible, isAuto = false) {
    touchState.enabled = visible;
    const layer = document.getElementById("touchControlsLayer");
    if (layer) layer.classList.toggle("hidden", !visible);
    updateInputModeBadge(visible, isAuto);
  }
  function autoDetectDeviceInput() {
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const touchPoints = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setTouchLayerVisible(Boolean(coarse || touchPoints && window.innerWidth <= 1024), true);
  }
  function escapeHtml(str) {
    return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var toastTimer = 0;
  function showToast(msg) {
    const el = document.getElementById("toastBanner");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.add("hidden"), 3400);
  }
  var TEAM_LIGHT = { red: "#fda4af", blue: "#7dd3fc", green: "#6ee7b7", ffa: "#fde047" };
  function addKillFeed(killerName, killerTeam, victimName, victimTeam, weaponLabel, isHeadshot, isPierced) {
    const feed = document.getElementById("killFeedContainer");
    if (!feed) return;
    const item = document.createElement("div");
    item.className = "kill-item glass-panel px-3 py-1.5 rounded-xl border border-slate-700/90 shadow-lg flex items-center gap-2 text-xs";
    item.innerHTML = `
    <span class="font-extrabold" style="color:${TEAM_LIGHT[killerTeam] ?? "#fda4af"}">${escapeHtml(killerName)}</span>
    <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-200 border border-slate-700">${escapeHtml(weaponLabel)}</span>
    ${isHeadshot ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400 text-amber-300 text-[10px] font-extrabold">\u{1F3AF} \u7206\u5934</span>' : ""}
    ${isPierced ? '<span class="px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-400 text-purple-200 text-[10px] font-extrabold">\u26A1 \u7A7F\u900F</span>' : ""}
    <span class="font-extrabold" style="color:${TEAM_LIGHT[victimTeam] ?? "#7dd3fc"}">${escapeHtml(victimName)}</span>
  `;
    feed.prepend(item);
    while (feed.children.length > 6) feed.removeChild(feed.lastChild);
    window.setTimeout(() => item.remove(), 6500);
  }
  function handleEvents(evs) {
    for (const e of evs) {
      if (e.kind === "kill") addKillFeed(e.killerName ?? "?", e.killerTeam ?? "ffa", e.victimName ?? "?", e.victimTeam ?? "ffa", e.weaponLabel ?? "", e.isHeadshot, e.isPierced);
      else if (e.kind === "explosion") screenShake = Math.max(screenShake, Math.min(14, (e.radius ?? 60) * 0.15));
      else if (e.kind === "capture") showToast(`\u{1F6A9} \u636E\u70B9 ${e.pointCode} \u88AB ${e.team} \u5360\u9886\uFF01`);
      else if (e.kind === "supply_pickup") showToast(`\u{1F4E6} \u62FE\u53D6\u3010${e.weaponName}\u3011`);
      else if (e.kind === "doll_recall") showToast("\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\u751F\u6548\uFF1A\u56DE\u5230\u951A\u70B9\u4F4D\u7F6E\u4E0E\u72B6\u6001\uFF01");
      else if (e.kind === "shield_break") showToast("\u{1F4A5} \u62A4\u76FE\u7834\u788E\uFF01");
      else if (e.kind === "mortar_fire") screenShake = Math.max(screenShake, 9);
      else if (e.kind === "warp") showToast(`\u{1F300} ${e.weaponName ?? "\u4F20\u9001"}\uFF01`);
    }
  }
  function updateHudWeaponButtons() {
    const activeWepIdx = localPlayer.deployed ? localPlayer.weaponIndex : pendingLoadout.weaponIndex;
    const activeSec = localPlayer.deployed ? localPlayer.secondary : pendingLoadout.secondaryType;
    document.querySelectorAll(".weapon-slot-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-slot") || 0);
      btn.className = slot === activeWepIdx ? "weapon-slot-btn glass-panel px-2.5 py-1.5 rounded-lg border-2 border-amber-400 text-left transition flex flex-col min-w-[72px] sm:min-w-[92px]" : "weapon-slot-btn glass-panel px-2.5 py-1.5 rounded-lg border border-slate-700/80 text-left transition flex flex-col min-w-[72px] sm:min-w-[92px] opacity-75";
    });
    document.querySelectorAll(".lobby-wep-btn").forEach((btn) => {
      const slot = Number(btn.getAttribute("data-wep") || 0);
      btn.className = slot === pendingLoadout.weaponIndex ? "lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition" : "lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
    });
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec");
      const def = sec ? SECONDARIES[sec] : void 0;
      if (def?.supplyOnly) {
        btn.className = "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60";
      } else {
        btn.className = sec === pendingLoadout.secondaryType ? "lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition" : "lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500";
      }
    });
    document.querySelectorAll(".hud-sec-btn").forEach((btn) => {
      const sec = btn.getAttribute("data-sec");
      btn.className = sec === activeSec ? "hud-sec-btn px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-extrabold border border-rose-300" : "hud-sec-btn px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px] font-semibold border border-slate-700 opacity-75";
    });
  }
  function updateSpawnPointButtonsUI() {
    const container = document.getElementById("spawnPointBtnGroup");
    if (!container) return;
    container.querySelectorAll(".spawn-select-btn").forEach((btn) => {
      const spId = btn.getAttribute("data-spawn") || "base";
      let unlocked = spId === "base";
      if (spId !== "base") {
        const cp = world.capturePoints.find((c) => c.id === spId);
        unlocked = Boolean(cp && (cp.ownerTeam === localPlayer.team || localPlayer.team === "ffa"));
      }
      const isSelected = pendingLoadout.spawnPointId === spId;
      if (!unlocked) btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/40 text-slate-600 text-[11px] font-semibold cursor-not-allowed";
      else if (isSelected) btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 text-[11px] font-extrabold";
      else btn.className = "spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-[11px] font-semibold hover:border-emerald-400/50";
    });
  }
  function tryChangePrimaryWeapon(slotIdx) {
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast("\u{1F512} \u4E3B\u6B66\u5668\u5728\u91CD\u751F\u524D\u5DF2\u9009\u5B9A\u9501\u5B9A\uFF01\u9635\u4EA1\u91CD\u751F\u524D\u6216\u62FE\u53D6\u7A7A\u6295\u7279\u6B66\u65F6\u65B9\u53EF\u66F4\u6362");
      return;
    }
    pendingLoadout.weaponIndex = clamp(slotIdx, 0, 3);
    localPlayer.weaponIndex = pendingLoadout.weaponIndex;
    updateHudWeaponButtons();
  }
  function tryChangeSecondaryWeapon(secType) {
    const def = SECONDARIES[secType];
    if (def?.supplyOnly) {
      if (localPlayer.dollCharges <= 0) {
        showToast("\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\u53EA\u80FD\u4ECE\u6218\u573A\u7279\u6B8A\u8865\u7ED9\u7BB1\u83B7\u5F97\u5145\u80FD\uFF01");
        return;
      }
      localPlayer.secondary = secType;
      updateHudWeaponButtons();
      showToast(`\u{1F38E} \u5DF2\u5207\u6362\u66FF\u8EAB\u4EBA\u5076\uFF08\u5145\u80FD ${localPlayer.dollCharges}\uFF09`);
      return;
    }
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast("\u{1F512} \u526F\u6B66\u5668\u5728\u91CD\u751F\u524D\u5DF2\u9009\u5B9A\u9501\u5B9A\uFF01\u9635\u4EA1\u91CD\u751F\u524D\u53EF\u91CD\u65B0\u9009\u62E9");
      return;
    }
    pendingLoadout.secondaryType = secType;
    localPlayer.secondary = secType;
    updateHudWeaponButtons();
  }
  var TEAM_BADGE = {
    red: ["\u7EA2\u961F ALPHA", "bg-rose-500/20 text-rose-300 border border-rose-500/40"],
    blue: ["\u84DD\u961F BRAVO", "bg-sky-500/20 text-sky-300 border border-sky-500/40"],
    green: ["\u7EFF\u961F CHARLIE", "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"],
    ffa: ["\u6DF7\u6218 SOLO", "bg-amber-500/20 text-amber-300 border border-amber-500/40"]
  };
  function updateHudUI() {
    const nameEl = document.getElementById("hudPlayerName");
    if (nameEl) nameEl.textContent = localPlayer.name;
    const teamEl = document.getElementById("hudTeamBadge");
    if (teamEl) {
      const [label, cls] = TEAM_BADGE[localPlayer.team] ?? TEAM_BADGE.red;
      teamEl.textContent = label;
      teamEl.className = `px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`;
    }
    const fovBadge = document.getElementById("hudSniperFovBadge");
    if (fovBadge) {
      if (localPlayer.watchtowerTimer > 0) {
        fovBadge.textContent = `\u{1F5FC} \u77AD\u671B\u89C6\u91CE+65% (${localPlayer.watchtowerTimer.toFixed(0)}s)`;
        fovBadge.classList.remove("hidden");
      } else if (localPlayer.weaponIndex === 2) {
        fovBadge.textContent = "\u{1F52D} \u72D9\u51FB\u89C6\u91CE+30%";
        fovBadge.classList.remove("hidden");
      } else fovBadge.classList.add("hidden");
    }
    const hpBar = document.getElementById("hudHpBar");
    if (hpBar) hpBar.style.width = clamp(localPlayer.hp / localPlayer.maxHp * 100, 0, 100) + "%";
    const shieldBar = document.getElementById("hudShieldBar");
    if (shieldBar) shieldBar.style.width = localPlayer.shieldTimer > 0 ? clamp(localPlayer.shieldHp / world.config.shieldHp * 100, 0, 100) + "%" : "0%";
    const hpText = document.getElementById("hudHpText");
    if (hpText) hpText.textContent = `${Math.max(0, Math.round(localPlayer.hp))} / ${localPlayer.maxHp}`;
    const fuelBar = document.getElementById("hudFuelBar");
    if (fuelBar) fuelBar.style.width = clamp(localPlayer.fuel / getPhysicsParams().jetpackFuel * 100, 0, 100) + "%";
    const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0];
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    const wNameEl = document.getElementById("currentWeaponName");
    if (wNameEl) wNameEl.textContent = mounted ? "\u{1F3AF} \u516C\u5171\u8FEB\u51FB\u70AE\u64CD\u63A7\u4E2D" : `${wep.name} ${localPlayer.deployed ? "\u{1F512}" : ""}`;
    const ammoEl = document.getElementById("currentAmmoText");
    if (ammoEl) ammoEl.textContent = mounted ? "\u221E" : `${localPlayer.ammo[localPlayer.weaponIndex] ?? 0} / ${localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0}`;
    const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag;
    const gOverlay = document.getElementById("grenadeCdOverlay");
    const gLabel = document.getElementById("hudGrenadeLabel");
    const gTitle = document.getElementById("hudSecondaryTitle");
    const chargeNote = localPlayer.secondary === "doll" ? ` [\u5145\u80FD${localPlayer.dollCharges}]` : "";
    if (gTitle) gTitle.textContent = localPlayer.secondary === "pistol" ? `[G/\u53F3\u952E] \u624B\u67AA (${localPlayer.pistolAmmo}/${localPlayer.pistolReserve})` : `[G/\u53F3\u952E] ${secDef.name}${chargeNote}`;
    if (gOverlay && gLabel) {
      if (localPlayer.secondaryCooldown > 0) {
        gOverlay.style.height = Math.min(100, localPlayer.secondaryCooldown / (secDef.cd || 1) * 100) + "%";
        gLabel.textContent = `${secDef.icon} ${localPlayer.secondaryCooldown.toFixed(1)}s`;
      } else {
        gOverlay.style.height = "0%";
        gLabel.textContent = `${secDef.icon} \u5C31\u7EEA`;
      }
    }
    const reloadWrap = document.getElementById("reloadProgressWrap");
    const reloadBar = document.getElementById("reloadProgressBar");
    if (reloadWrap && reloadBar) {
      if (localPlayer.reloading) {
        reloadWrap.classList.remove("hidden");
        reloadWrap.classList.add("flex");
        const wep2 = WEAPONS[localPlayer.weaponIndex];
        reloadBar.style.width = clamp(100 * (1 - localPlayer.reloadTimer / wep2.reloadTime), 0, 100) + "%";
      } else {
        reloadWrap.classList.add("hidden");
        reloadWrap.classList.remove("flex");
      }
    }
    const banner = document.getElementById("interactBanner");
    const bannerText = document.getElementById("interactBannerText");
    if (!banner || !bannerText) return;
    let promptMsg = null;
    if (!localPlayer.deployed) {
      promptMsg = "\u{1F3E0} \u5F85\u673A\u6574\u5907\u4E2D\uFF1A\u70B9\u51FB\u6B64\u5904\u6216\u300C\u7ACB\u5373\u8FDB\u5165\u6218\u573A\u300D\u90E8\u7F72\uFF1B\u53EF\u81EA\u7531\u66F4\u6362\u4E3B/\u526F\u6B66\u5668\u4E0E\u961F\u4F0D";
    } else if (localPlayer.respawnTimer > 0) {
      promptMsg = `\u{1F480} \u9635\u4EA1\u5012\u8BA1\u65F6 ${localPlayer.respawnTimer.toFixed(1)}s\uFF1A\u70B9\u51FB\u6B64\u5904\u6253\u5F00\u6574\u5907\u9762\u677F\u66F4\u6362\u914D\u88C5\u4E0E\u91CD\u751F\u70B9`;
    } else if (mounted) {
      promptMsg = "\u{1F3AF} \u8FEB\u51FB\u70AE\u64CD\u63A7\u4E2D\uFF1A\u79FB\u52A8\u9F20\u6807\u8C03\u8282\u843D\u70B9\uFF0C\u6309\u4F4F\u5F00\u706B\u53D1\u5C04 | \u6309 [E] \u6216\u70B9\u51FB\u6B64\u5904\u79BB\u5F00";
    } else {
      for (const m of world.mortars) {
        if (m.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, m.x, m.y) < 115) {
          promptMsg = `\u{1F525} \u6309 [E] \u6216\u70B9\u51FB\u6B64\u5904\u64CD\u63A7\u3010${m.name}\u3011`;
          break;
        }
      }
      if (!promptMsg) {
        for (const tw of world.watchtowers) {
          if (wrapDist(localPlayer.pos.x, localPlayer.pos.y, tw.x, tw.y) < 115) {
            promptMsg = `\u{1F5FC} \u6309 [E] \u767B\u4E0A\u3010${tw.name}\u3011\u83B7\u53D6 +65% \u5168\u666F\u89C6\u91CE`;
            break;
          }
        }
      }
      if (!promptMsg) {
        for (const wp of world.warpPortals) {
          if (wrapDist(localPlayer.pos.x, localPlayer.pos.y, wp.x, wp.y) < 90) {
            promptMsg = `\u{1F300} \u6309 [E] \u542F\u52A8\u3010${wp.name}\u3011\u91CF\u5B50\u4F20\u9001`;
            break;
          }
        }
      }
      if (!promptMsg) {
        const dollCrate = world.supplyCrates.find((c) => c.active && c.kind === "doll" && wrapDist(localPlayer.pos.x, localPlayer.pos.y, c.x, c.y) < 60);
        if (dollCrate) promptMsg = "\u{1F38E} \u9760\u8FD1\u7279\u6B8A\u8865\u7ED9\u7BB1\u81EA\u52A8\u62FE\u53D6\u66FF\u8EAB\u4EBA\u5076\u5145\u80FD";
      }
    }
    if (promptMsg) {
      banner.classList.remove("hidden");
      bannerText.textContent = promptMsg;
    } else banner.classList.add("hidden");
  }
  function updateScoreboardUI() {
    const r = document.getElementById("scoreRed");
    const b = document.getElementById("scoreBlue");
    const g = document.getElementById("scoreGreen");
    if (r) r.textContent = String(world.scores.red ?? 0);
    if (b) b.textContent = String(world.scores.blue ?? 0);
    if (g) g.textContent = String(world.scores.green ?? 0);
  }
  function updateTeamCountUI() {
    const counts = { red: 0, blue: 0, green: 0, ffa: 0 };
    for (const p of world.players) {
      if (counts[p.team] !== void 0) counts[p.team]++;
    }
    for (const key of ["Red", "Blue", "Green", "Ffa"]) {
      const el = document.getElementById("teamCount" + key);
      if (el) el.textContent = counts[key.toLowerCase()] + "\u4EBA";
    }
  }
  var TEAM_COLOR = { red: "#f43f5e", blue: "#0ea5e9", green: "#10b981", ffa: "#eab308" };
  var TEAM_LIGHT2 = { red: "#fda4af", blue: "#7dd3fc", green: "#6ee7b7", ffa: "#fde047" };
  function renderScene() {
    if (!ctx || !canvas) return;
    const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0];
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    const targetFov = localPlayer.watchtowerTimer > 0 ? world.config.watchtowerFovMult || 1.65 : mounted ? 1 : wep.fovMult || 1;
    camera.fovFactor += (targetFov - camera.fovFactor) * 0.12;
    if (localPlayer.deployed) {
      const tx = localPlayer.pos.x + Math.cos(localPlayer.aim) * 80;
      const ty = localPlayer.pos.y - 12 + Math.sin(localPlayer.aim) * 55;
      camera.x = wrapX(camera.x + wrapDeltaX(camera.x, tx) * 0.16);
      camera.y = wrapY(camera.y + wrapDeltaY(camera.y, ty) * 0.16);
    }
    let shakeX = 0, shakeY = 0;
    if (screenShake > 0.2) {
      shakeX = (Math.random() - 0.5) * screenShake * 2;
      shakeY = (Math.random() - 0.5) * screenShake * 2;
      screenShake *= 0.86;
    } else screenShake = 0;
    const zoom = 1 / camera.fovFactor;
    const halfW = canvas.width * camera.fovFactor / 2 + 160;
    const halfH = canvas.height * camera.fovFactor / 2 + 160;
    ctx.save();
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, "#050811");
    skyGrad.addColorStop(0.55, "#0f172a");
    skyGrad.addColorStop(1, "#1e1b4b");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(zoom, zoom);
    ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY);
    const sx = (wx) => wrapDeltaX(camera.x, wx);
    const sy = (wy) => wrapDeltaY(camera.y, wy);
    const inView = (dx, dy, pad = 0) => dx > -halfW - pad && dx < halfW + pad && dy > -halfH - pad && dy < halfH + pad;
    for (const r of world.terrain.rects) {
      const cx = sx(r.x + r.w / 2);
      const cy = sy(r.y + r.h / 2);
      if (!inView(cx, cy, Math.max(r.w, r.h))) continue;
      ctx.fillStyle = r.color;
      ctx.fillRect(cx - r.w / 2, cy - r.h / 2, r.w, r.h);
      if (r.borderColor) {
        ctx.strokeStyle = r.borderColor;
        ctx.lineWidth = r.kind === "pipe_wall" ? 3 : 2;
        ctx.strokeRect(cx - r.w / 2 + 1, cy - r.h / 2 + 1, r.w - 2, r.h - 2);
      }
      if (r.label && (r.kind === "building_roof" || r.kind === "pipe_wall")) {
        ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
        ctx.font = "bold 12px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(r.label, cx, cy - r.h / 2 - 8);
      }
    }
    for (const ob of world.obstacles) {
      const ox = sx(ob.x + ob.w / 2);
      const oy = sy(ob.y + ob.h / 2);
      if (!inView(ox, oy, Math.max(ob.w, ob.h))) continue;
      ctx.fillStyle = ob.color;
      ctx.strokeStyle = ob.borderColor || "#f97316";
      ctx.lineWidth = 2.5;
      ctx.fillRect(ox - ob.w / 2, oy - ob.h / 2, ob.w, ob.h);
      ctx.strokeRect(ox - ob.w / 2 + 1, oy - ob.h / 2 + 1, ob.w - 2, ob.h - 2);
      const ratio = ob.hp / ob.maxHp;
      const barW = Math.max(40, ob.w);
      const barX = ox - barW / 2;
      const barY = oy - ob.h / 2 - 10;
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(barX, barY, barW, 5);
      ctx.fillStyle = ratio > 0.5 ? "#22c55e" : ratio > 0.25 ? "#f59e0b" : "#ef4444";
      ctx.fillRect(barX, barY, barW * ratio, 5);
    }
    for (const cp of world.capturePoints) {
      const cx = sx(cp.x);
      const cy = sy(cp.y);
      if (!inView(cx, cy)) continue;
      const ownerColor = cp.ownerTeam ? TEAM_COLOR[cp.ownerTeam] ?? "#94a3b8" : "#94a3b8";
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -95);
      ctx.stroke();
      ctx.fillStyle = ownerColor;
      ctx.beginPath();
      ctx.moveTo(0, -95);
      ctx.lineTo(54, -76);
      ctx.lineTo(0, -58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`\u{1F6A9} [${cp.code}] ${cp.name} (${Math.round(cp.progress)}%)`, 0, -106);
      ctx.restore();
    }
    for (const wp of world.warpPortals) {
      const wx = sx(wp.x);
      const wy = sy(wp.y);
      if (!inView(wx, wy)) continue;
      ctx.save();
      ctx.translate(wx, wy - 28);
      ctx.strokeStyle = wp.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(6, 182, 212, 0.18)";
      ctx.fill();
      ctx.fillStyle = "#67e8f9";
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`\u{1F300} ${wp.name} [E]`, 0, -42);
      ctx.restore();
    }
    for (const tw of world.watchtowers) {
      const tx = sx(tw.x);
      const ty = sy(tw.y);
      if (!inView(tx, ty)) continue;
      const h = 150;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(-10, -h);
      ctx.lineTo(10, -h);
      ctx.lineTo(22, 0);
      ctx.stroke();
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(-26, -h - 16, 52, 16);
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`\u{1F5FC} ${tw.name} [\u6309E\u83B7\u89C6\u91CE]`, 0, -h - 24);
      ctx.restore();
    }
    for (const pack of world.ammoPacks) {
      const px = sx(pack.x);
      const py = sy(pack.y);
      if (!inView(px, py)) continue;
      ctx.save();
      ctx.translate(px, py - 14);
      ctx.fillStyle = "#15803d";
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.fillRect(-14, -12, 28, 24);
      ctx.strokeRect(-14, -12, 28, 24);
      ctx.fillStyle = "#bbf7d0";
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("\u{1F4E6} \u5355\u4EBA\u5F39\u836F", 0, -18);
      ctx.restore();
    }
    for (const crate of world.supplyCrates) {
      if (!crate.active) continue;
      const cx = sx(crate.x);
      const cy = sy(crate.y);
      if (!inView(cx, cy)) continue;
      ctx.save();
      ctx.translate(cx, cy - 18);
      ctx.fillStyle = crate.kind === "doll" ? "#4a1d3a" : "#1e1b4b";
      ctx.strokeStyle = crate.color;
      ctx.lineWidth = 2.5;
      ctx.fillRect(-18, -16, 36, 32);
      ctx.strokeRect(-18, -16, 36, 32);
      ctx.fillStyle = crate.color;
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(crate.kind === "doll" ? "\u{1F38E} \u66FF\u8EAB\u4EBA\u5076\u8865\u7ED9" : `\u{1F381} ${crate.weaponName}`, 0, -22);
      ctx.restore();
    }
    for (const m of world.mortars) {
      const mx = sx(m.x);
      const my = sy(m.y);
      if (!inView(mx, my)) continue;
      ctx.save();
      ctx.translate(mx, my);
      ctx.save();
      ctx.translate(0, -12);
      ctx.rotate(m.angle);
      ctx.fillStyle = "#475569";
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 2.2;
      ctx.fillRect(0, -7, 38, 14);
      ctx.strokeRect(0, -7, 38, 14);
      ctx.restore();
      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 18, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m.operatorId ? "#fde047" : "#fb923c";
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.operatorId ? "\u{1F3AF} \u8FEB\u51FB\u70AE\u53D1\u5C04\u4E2D" : "\u{1F525} \u516C\u5171\u8FEB\u51FB\u70AE [E]", 0, -32);
      ctx.restore();
    }
    for (const m of world.landmines) {
      if (m.respawnTimer > 0) continue;
      const mx = sx(m.pos.x);
      const my = sy(m.pos.y);
      if (!inView(mx, my)) continue;
      ctx.strokeStyle = m.triggered ? "rgba(244, 63, 94, 0.75)" : m.instant ? "rgba(56, 189, 248, 0.30)" : "rgba(244, 63, 94, 0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, world.config.mineTriggerRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = m.instant ? "#0284c7" : "#334155";
      ctx.beginPath();
      ctx.arc(mx, my, 9, Math.PI, 0);
      ctx.fill();
      const blink = m.triggered || Math.floor(Date.now() / 220) % 2 === 0;
      ctx.fillStyle = blink ? m.instant ? "#38bdf8" : "#f43f5e" : "#fbbf24";
      ctx.beginPath();
      ctx.arc(mx, my - 6, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of world.players) {
      if (p.respawnTimer > 0 || !p.deployed) continue;
      const tColor = TEAM_COLOR[p.team] ?? "#f43f5e";
      const tLight = TEAM_LIGHT2[p.team] ?? "#fda4af";
      const w = WEAPONS[p.weaponIndex] ?? WEAPONS[0];
      const pMounted = world.mortars.some((m) => m.operatorId === p.id);
      if (p.doll) {
        const dx = sx(p.doll.pos.x);
        const dy = sy(p.doll.pos.y);
        if (inView(dx, dy)) {
          ctx.save();
          ctx.translate(dx, dy);
          ctx.globalAlpha = 0.68;
          ctx.strokeStyle = "#f472b6";
          ctx.fillStyle = "rgba(244, 114, 182, 0.25)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-11, -12, 22, 28, 6);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -24, world.config.headRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#f472b6";
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`\u{1F38E} \u66FF\u8EAB\u4EBA\u5076 (${p.doll.timer.toFixed(1)}s)`, 0, -44);
          ctx.restore();
        }
      }
      const px = sx(p.pos.x);
      const py = sy(p.pos.y);
      if (!inView(px, py)) continue;
      ctx.save();
      ctx.translate(px, py);
      const facingRight = Math.cos(p.aim) >= 0;
      ctx.fillStyle = "#475569";
      ctx.fillRect(facingRight ? -15 : 7, -10, 8, 20);
      ctx.fillStyle = tColor;
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-11, -12, 22, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tLight;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, -24, world.config.headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(facingRight ? 4 : -4, -25, world.config.headRadius * 0.42, 0, Math.PI * 2);
      ctx.fill();
      if (p.shieldTimer > 0 && p.shieldHp > 0) {
        ctx.strokeStyle = "#38bdf8";
        ctx.fillStyle = "rgba(56, 189, 248, 0.18)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, -8, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (w.laser && !pMounted) {
        ctx.strokeStyle = w.id === 4 ? "rgba(34, 211, 238, 0.55)" : "rgba(192, 132, 252, 0.48)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(Math.cos(p.aim) * 820, -10 + Math.sin(p.aim) * 820);
        ctx.stroke();
      }
      if (!pMounted) {
        ctx.save();
        ctx.translate(0, -8);
        ctx.rotate(p.aim);
        ctx.fillStyle = "#1e293b";
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 2;
        ctx.fillRect(4, -4, 24, 8);
        ctx.strokeRect(4, -4, 24, 8);
        ctx.restore();
      }
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(p.name + (p.id === localPlayer.id ? " (\u4F60)" : ""), 0, -48);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(-20, -43, 40, 5);
      const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
      ctx.fillStyle = hpRatio > 0.4 ? tColor : "#ef4444";
      ctx.fillRect(-20, -43, 40 * hpRatio, 5);
      ctx.restore();
    }
    const mountedNow = world.mortars.find((m) => m.operatorId === localPlayer.id);
    if (mountedNow) {
      const mx = sx(mountedNow.x);
      const my = sy(mountedNow.y);
      const aimLen = 420;
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = "rgba(251, 146, 60, 0.75)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(mountedNow.angle) * 30, my - 18 + Math.sin(mountedNow.angle) * 30);
      ctx.lineTo(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(251, 146, 60, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    {
      const mx = sx(mouse.worldX);
      const my = sy(mouse.worldY);
      if (mx > -40 && mx < canvas.width + 40 && my > -40 && my < canvas.height + 40) {
        ctx.save();
        ctx.strokeStyle = mountedNow ? "rgba(251, 146, 60, 0.95)" : "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx - 9, my);
        ctx.lineTo(mx - 3, my);
        ctx.moveTo(mx + 3, my);
        ctx.lineTo(mx + 9, my);
        ctx.moveTo(mx, my - 9);
        ctx.lineTo(mx, my - 3);
        ctx.moveTo(mx, my + 3);
        ctx.lineTo(mx, my + 9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (localPlayer.watchtowerTimer <= 0) {
      for (const sz of world.terrain.shadows) {
        const cx = sx(sz.x + sz.w / 2);
        const cy = sy(sz.y + sz.h / 2);
        if (!inView(cx, cy, Math.max(sz.w, sz.h))) continue;
        const inside = localPlayer.deployed && Math.abs(wrapDeltaX(localPlayer.pos.x, sz.x + sz.w / 2)) <= sz.w / 2 + 40 && Math.abs(wrapDeltaY(localPlayer.pos.y, sz.y + sz.h / 2)) <= sz.h / 2 + 40;
        ctx.fillStyle = inside ? "rgba(2, 6, 23, 0.22)" : `rgba(2, 6, 23, ${sz.alpha ?? 0.74})`;
        ctx.fillRect(cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h);
      }
    }
    for (const g of world.grenades) {
      const gx = sx(g.pos.x);
      const gy = sy(g.pos.y);
      if (!inView(gx, gy)) continue;
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(gx, gy, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pr of world.projectiles) {
      const px = sx(pr.pos.x);
      const py = sy(pr.pos.y);
      if (!inView(px, py, 200)) continue;
      if (pr.beam) {
        const spd = Math.hypot(pr.vel.x, pr.vel.y) || 1;
        const len = 150;
        const ex = px - pr.vel.x / spd * len;
        const ey = py - pr.vel.y / spd * len;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = pr.color || "#22d3ee";
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
      } else if (pr.isGravityOrb) {
        ctx.save();
        const grd = ctx.createRadialGradient(px, py, 2, px, py, 22);
        grd.addColorStop(0, "rgba(168, 85, 247, 0.9)");
        grd.addColorStop(1, "rgba(168, 85, 247, 0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e9d5ff";
        ctx.beginPath();
        ctx.arc(px, py, pr.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = pr.color || "#fbbf24";
        ctx.beginPath();
        ctx.arc(px, py, pr.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const st of world.airstrikes) {
      const ax = sx(st.pos.x);
      const ay = sy(st.pos.y);
      if (!inView(ax, ay)) continue;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay, 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  var selectedParamWeaponIdx = 0;
  function syncParamsToUI() {
    const setVal = (inId, vId, val, suf = "") => {
      const iEl = document.getElementById(inId);
      const vEl = document.getElementById(vId);
      if (iEl) iEl.value = String(val);
      if (vEl) vEl.textContent = val + suf;
    };
    const P2 = getPhysicsParams();
    setVal("paramGravity", "valGravity", P2.gravity);
    setVal("paramMoveSpeed", "valMoveSpeed", P2.moveSpeed);
    setVal("paramJetpackAccel", "valJetpackAccel", P2.jetpackAccel);
    setVal("paramJetpackMaxUp", "valJetpackMaxUp", P2.jetpackMaxUp);
    setVal("paramMaxHp", "valMaxHp", world.config.maxHp);
    setVal("paramHeadRadius", "valHeadRadius", world.config.headRadius);
    const w = WEAPONS[selectedParamWeaponIdx] ?? WEAPONS[0];
    setVal("paramWepDamage", "valWepDamage", w.damage);
    setVal("paramWepHeadshot", "valWepHeadshot", w.headshotMult, "x");
    setVal("paramWepSpeed", "valWepSpeed", w.speed);
    setVal("paramWepMag", "valWepMag", w.magSize);
    setVal("paramWepReload", "valWepReload", w.reloadTime, "s");
    setVal("paramGrenadeDmg", "valGrenadeDmg", world.config.grenadeDamage);
    setVal("paramGrenadeRadius", "valGrenadeRadius", world.config.grenadeRadius);
    setVal("paramMineDmg", "valMineDmg", world.config.mineDamage);
    setVal("paramMineRadius", "valMineRadius", world.config.mineTriggerRadius);
    setVal("paramMortarDmg", "valMortarDmg", world.config.mortarDamage);
    setVal("paramMortarRadius", "valMortarRadius", world.config.mortarRadius);
    setVal("paramRespawnDelay", "valRespawnDelay", world.config.respawnDelay, "s");
    setVal("paramDollMax", "valDollMax", world.config.dollMaxCharges);
    document.querySelectorAll(".param-wep-tab").forEach((btn) => {
      const idx = Number(btn.getAttribute("data-pwep") || 0);
      btn.className = idx === selectedParamWeaponIdx ? "param-wep-tab px-2 py-1 rounded bg-amber-500 text-slate-950 font-extrabold text-[11px]" : "param-wep-tab px-2 py-1 rounded bg-slate-950 text-slate-300 font-semibold text-[11px] border border-slate-700";
    });
  }
  function bindRangeParam(inputId, valId, suffix, applyFn) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener("input", () => {
      const v = Number(el.value);
      const vEl = document.getElementById(valId);
      if (vEl) vEl.textContent = v + suffix;
      applyFn(v);
    });
  }
  function bindAllEvents() {
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    window.addEventListener("keydown", (e) => {
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
      keys[e.code] = true;
      if (e.code === "KeyR") pendingReload = true;
      else if (e.code === "KeyG" || e.code === "KeyQ") pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
      else if (e.code === "KeyE") pendingInteract = true;
      else if (e.code === "Digit1") tryChangePrimaryWeapon(0);
      else if (e.code === "Digit2") tryChangePrimaryWeapon(1);
      else if (e.code === "Digit3") tryChangePrimaryWeapon(2);
      else if (e.code === "Digit4") tryChangePrimaryWeapon(3);
    });
    window.addEventListener("keyup", (e) => {
      keys[e.code] = false;
    });
    canvas?.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    canvas?.addEventListener("mousedown", (e) => {
      if (e.button === 0) mouse.down = true;
      else if (e.button === 2) pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    canvas?.addEventListener("mouseup", (e) => {
      if (e.button === 0) mouse.down = false;
    });
    canvas?.addEventListener("contextmenu", (e) => e.preventDefault());
    document.querySelectorAll(".weapon-slot-btn").forEach((btn) => btn.addEventListener("click", () => tryChangePrimaryWeapon(Number(btn.getAttribute("data-slot") || 0))));
    document.querySelectorAll(".lobby-wep-btn").forEach((btn) => btn.addEventListener("click", () => tryChangePrimaryWeapon(Number(btn.getAttribute("data-wep") || 0))));
    document.querySelectorAll(".lobby-sec-btn").forEach((btn) => btn.addEventListener("click", () => tryChangeSecondaryWeapon(btn.getAttribute("data-sec") || "frag")));
    document.querySelectorAll(".hud-sec-btn").forEach((btn) => btn.addEventListener("click", () => tryChangeSecondaryWeapon(btn.getAttribute("data-sec") || "frag")));
    document.querySelectorAll(".spawn-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const spId = btn.getAttribute("data-spawn") || "base";
        if (spId !== "base") {
          const cp = world.capturePoints.find((c) => c.id === spId);
          if (!cp || cp.ownerTeam !== localPlayer.team && localPlayer.team !== "ffa") {
            showToast("\u26A0\uFE0F \u8BE5\u5360\u9886\u70B9\u5C1A\u672A\u88AB\u6211\u65B9\u961F\u4F0D\u5360\u9886\uFF0C\u6682\u4E0D\u53EF\u4F5C\u4E3A\u91CD\u751F\u70B9\uFF01");
            return;
          }
        }
        pendingLoadout.spawnPointId = spId;
        updateSpawnPointButtonsUI();
      });
    });
    document.querySelectorAll(".bot-count-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cnt = Number(btn.getAttribute("data-bots") || 0);
        syncBotsCount(cnt);
        document.querySelectorAll(".bot-count-btn").forEach((b) => {
          b.className = Number(b.getAttribute("data-bots")) === cnt ? "bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs" : "bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700";
        });
      });
    });
    document.querySelectorAll(".param-wep-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedParamWeaponIdx = Number(btn.getAttribute("data-pwep") || 0);
        syncParamsToUI();
      });
    });
    document.getElementById("hudReloadBtn")?.addEventListener("click", () => {
      pendingReload = true;
    });
    document.getElementById("hudGrenadeBtn")?.addEventListener("click", () => {
      pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    document.getElementById("hudQuickMortarBtn")?.addEventListener("click", () => {
      pendingInteract = true;
    });
    document.getElementById("interactBannerBtn")?.addEventListener("click", () => {
      if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
        const lobby = document.getElementById("lobbyModal");
        lobby?.classList.remove("hidden");
        lobby?.classList.add("flex");
        updateSpawnPointButtonsUI();
      } else pendingInteract = true;
    });
    document.querySelectorAll(".team-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chosen = btn.getAttribute("data-team") || "red";
        localPlayer.team = chosen;
        document.querySelectorAll(".team-select-btn").forEach((b) => {
          const sel = b.getAttribute("data-team") === chosen;
          b.className = sel ? "team-select-btn px-3 py-2 rounded-xl border-2 border-indigo-400 bg-indigo-500/20 text-left transition flex items-center justify-between" : "team-select-btn px-3 py-2 rounded-xl border border-slate-700 bg-slate-950/60 text-left transition flex items-center justify-between";
        });
        updateTeamCountUI();
        updateSpawnPointButtonsUI();
      });
    });
    document.getElementById("playerNameInput")?.addEventListener("input", (e) => {
      localPlayer.name = e.target.value.trim() || "SkyHunter";
    });
    const lobbyModal = document.getElementById("lobbyModal");
    document.getElementById("openLobbyBtn")?.addEventListener("click", () => {
      lobbyModal?.classList.remove("hidden");
      lobbyModal?.classList.add("flex");
      updateSpawnPointButtonsUI();
    });
    document.getElementById("startBattleBtn")?.addEventListener("click", () => {
      if (!localPlayer.deployed || localPlayer.respawnTimer > 0) applyPendingLoadoutAndSpawn();
      lobbyModal?.classList.add("hidden");
      lobbyModal?.classList.remove("flex");
    });
    document.getElementById("inputDeviceDetectBadge")?.addEventListener("click", () => setTouchLayerVisible(!touchState.enabled, false));
    document.getElementById("toggleTouchBtn")?.addEventListener("click", () => setTouchLayerVisible(!touchState.enabled, false));
    document.getElementById("resetTerrainBtn")?.addEventListener("click", () => {
      world.resetMatch();
      showToast("\u5168\u56FE\u53EF\u7834\u574F\u969C\u788D\u7269\u3001\u5730\u96F7\u4E0E\u5F39\u836F\u8865\u7ED9\u5DF2\u5168\u90E8\u91CD\u7F6E");
    });
    const paramsModal = document.getElementById("paramsModal");
    const openParams = () => {
      paramsModal?.classList.remove("hidden");
      paramsModal?.classList.add("flex");
      syncParamsToUI();
    };
    const closeParams = () => {
      paramsModal?.classList.add("hidden");
      paramsModal?.classList.remove("flex");
    };
    document.getElementById("openParamsBtn")?.addEventListener("click", openParams);
    document.getElementById("lobbyOpenParamsBtn")?.addEventListener("click", openParams);
    document.getElementById("closeParamsBtn")?.addEventListener("click", closeParams);
    document.getElementById("resetParamsBtn")?.addEventListener("click", () => {
      resetPhysicsParams();
      world.config = { ...DEFAULT_CONFIG };
      syncParamsToUI();
      showToast("\u5DF2\u6062\u590D\u9ED8\u8BA4\u53C2\u6570");
    });
    bindRangeParam("paramGravity", "valGravity", "", (v) => setPhysicsParams({ gravity: v }));
    bindRangeParam("paramMoveSpeed", "valMoveSpeed", "", (v) => setPhysicsParams({ moveSpeed: v }));
    bindRangeParam("paramJetpackAccel", "valJetpackAccel", "", (v) => setPhysicsParams({ jetpackAccel: v }));
    bindRangeParam("paramJetpackMaxUp", "valJetpackMaxUp", "", (v) => setPhysicsParams({ jetpackMaxUp: v }));
    bindRangeParam("paramMaxHp", "valMaxHp", "", (v) => {
      world.config.maxHp = v;
      for (const p of world.players) {
        p.maxHp = v;
        if (p.hp > v) p.hp = v;
      }
    });
    bindRangeParam("paramHeadRadius", "valHeadRadius", "", (v) => {
      world.config.headRadius = v;
    });
    bindRangeParam("paramWepDamage", "valWepDamage", "", (v) => {
      WEAPONS[selectedParamWeaponIdx].damage = v;
    });
    bindRangeParam("paramWepHeadshot", "valWepHeadshot", "x", (v) => {
      WEAPONS[selectedParamWeaponIdx].headshotMult = v;
    });
    bindRangeParam("paramWepSpeed", "valWepSpeed", "", (v) => {
      WEAPONS[selectedParamWeaponIdx].speed = v;
    });
    bindRangeParam("paramWepMag", "valWepMag", "", (v) => {
      WEAPONS[selectedParamWeaponIdx].magSize = v;
    });
    bindRangeParam("paramWepReload", "valWepReload", "s", (v) => {
      WEAPONS[selectedParamWeaponIdx].reloadTime = v;
    });
    bindRangeParam("paramGrenadeDmg", "valGrenadeDmg", "", (v) => {
      world.config.grenadeDamage = v;
    });
    bindRangeParam("paramGrenadeRadius", "valGrenadeRadius", "", (v) => {
      world.config.grenadeRadius = v;
    });
    bindRangeParam("paramMineDmg", "valMineDmg", "", (v) => {
      world.config.mineDamage = v;
    });
    bindRangeParam("paramMineRadius", "valMineRadius", "", (v) => {
      world.config.mineTriggerRadius = v;
    });
    bindRangeParam("paramMortarDmg", "valMortarDmg", "", (v) => {
      world.config.mortarDamage = v;
    });
    bindRangeParam("paramMortarRadius", "valMortarRadius", "", (v) => {
      world.config.mortarRadius = v;
    });
    bindRangeParam("paramRespawnDelay", "valRespawnDelay", "s", (v) => {
      world.config.respawnDelay = v;
    });
    bindRangeParam("paramDollMax", "valDollMax", "", (v) => {
      world.config.dollMaxCharges = v;
    });
    function bindJoystick(zoneEl, stickEl, isAim) {
      if (!zoneEl || !stickEl) return;
      const maxDist = 46;
      const handleMove = (clientX, clientY) => {
        const rect = zoneEl.getBoundingClientRect();
        let dx = clientX - (rect.left + rect.width / 2);
        let dy = clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) {
          dx = dx / dist * maxDist;
          dy = dy / dist * maxDist;
        }
        stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
        if (isAim) {
          touchState.aimX = dx / maxDist;
          touchState.aimY = dy / maxDist;
        } else {
          touchState.moveX = dx / maxDist;
          touchState.moveY = dy / maxDist;
        }
      };
      zoneEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (!touchState.enabled) setTouchLayerVisible(true, true);
        const t = e.changedTouches[0];
        if (isAim) {
          touchState.aimActive = true;
          touchState.aimId = t.identifier;
        } else {
          touchState.moveActive = true;
          touchState.moveId = t.identifier;
        }
        handleMove(t.clientX, t.clientY);
      }, { passive: false });
      zoneEl.addEventListener("touchmove", (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          if (isAim && t.identifier === touchState.aimId || !isAim && t.identifier === touchState.moveId) handleMove(t.clientX, t.clientY);
        }
      }, { passive: false });
      const endTouch = (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (isAim && t.identifier === touchState.aimId) {
            touchState.aimActive = false;
            touchState.aimX = 0;
            touchState.aimY = 0;
            stickEl.style.transform = "translate(0px, 0px)";
          } else if (!isAim && t.identifier === touchState.moveId) {
            touchState.moveActive = false;
            touchState.moveX = 0;
            touchState.moveY = 0;
            stickEl.style.transform = "translate(0px, 0px)";
          }
        }
      };
      zoneEl.addEventListener("touchend", endTouch);
      zoneEl.addEventListener("touchcancel", endTouch);
    }
    bindJoystick(document.getElementById("touchMoveZone"), document.getElementById("touchMoveStick"), false);
    bindJoystick(document.getElementById("touchAimZone"), document.getElementById("touchAimStick"), true);
    const boostBtn = document.getElementById("touchBoostBtn");
    boostBtn?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      touchState.boostButtonDown = true;
    }, { passive: false });
    boostBtn?.addEventListener("touchend", () => {
      touchState.boostButtonDown = false;
    });
    document.getElementById("touchGrenadeBtn")?.addEventListener("click", () => {
      pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY };
    });
    document.getElementById("touchReloadBtn")?.addEventListener("click", () => {
      pendingReload = true;
    });
    document.getElementById("touchInteractBtn")?.addEventListener("click", () => {
      pendingInteract = true;
    });
  }
  function pickBotTarget(bot) {
    const enemies = [localPlayer, ...bots.filter((b) => b !== bot)].filter((e) => e.deployed && e.alive && e.respawnTimer <= 0 && (bot.team === "ffa" || e.team !== bot.team));
    let target = null;
    let best = Infinity;
    for (const e of enemies) {
      const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    return target;
  }
  function botInput(bot) {
    const w = defaultWorldInput();
    const target = pickBotTarget(bot);
    if (!target) return w;
    const dx = wrapDeltaX(bot.pos.x, target.pos.x);
    const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12);
    w.aim = Math.atan2(dy, dx);
    if (Math.abs(dx) > 340) w.move = dx > 0 ? 1 : -1;
    else if (Math.abs(dx) < 150) w.move = dx > 0 ? -1 : 1;
    w.fire = world.tick % 12 < 5 && Math.abs(dx) < 900;
    w.jetpack = target.pos.y + 80 < bot.pos.y;
    return w;
  }
  var playerInput = defaultWorldInput();
  var lastFrame = performance.now();
  var acc = 0;
  var wasDead = false;
  var FIXED = 1 / 60;
  function buildLocalInput() {
    const w = defaultWorldInput();
    if (!localPlayer.deployed) return w;
    if (localPlayer.respawnTimer > 0) {
      if (pendingInteract) {
        pendingInteract = false;
        return w;
      }
      return w;
    }
    const left = !!(keys["KeyA"] || keys["ArrowLeft"]);
    const right = !!(keys["KeyD"] || keys["ArrowRight"]);
    let move2 = left === right ? 0 : left ? -1 : 1;
    if (touchState.moveActive && Math.abs(touchState.moveX) > 0.18) move2 = touchState.moveX > 0 ? 1 : -1;
    w.move = move2;
    w.jetpack = !!(keys["KeyW"] || keys["Space"] || keys["ArrowUp"]) || touchState.boostButtonDown || touchState.moveActive && touchState.moveY < -0.32;
    const mounted = world.mortars.find((m) => m.operatorId === localPlayer.id);
    if (mounted) {
      w.aim = Math.atan2(mouse.worldY - mounted.y, wrapDeltaX(mounted.x, mouse.worldX));
    } else if (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.15) {
      w.aim = Math.atan2(touchState.aimY, touchState.aimX);
    } else {
      const dx = wrapDeltaX(localPlayer.pos.x, mouse.worldX);
      const dy = mouse.worldY - (localPlayer.pos.y - 12);
      w.aim = Math.atan2(dy, dx);
    }
    w.fire = mouse.down || touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.45;
    w.interact = pendingInteract;
    w.reload = pendingReload;
    if (pendingSecondary) w.secondary = { type: pendingSecondary.type, targetX: pendingSecondary.targetX, targetY: pendingSecondary.targetY };
    return w;
  }
  function onLocalDeath() {
    pendingLoadout.weaponIndex = localPlayer.weaponIndex;
    pendingLoadout.secondaryType = localPlayer.secondary;
    updateHudWeaponButtons();
    showToast("\u{1F480} \u5DF2\u9635\u4EA1\uFF01\u91CD\u751F\u524D\u53EF\u66F4\u6362\u4E3B/\u526F\u6B66\u5668\u4E0E\u91CD\u751F\u70B9\uFF08\u70B9\u51FB\u6A2A\u5E45\u6253\u5F00\u6574\u5907\u9762\u677F\uFF09");
  }
  function onLocalRespawn() {
    localPlayer.weaponIndex = clamp(pendingLoadout.weaponIndex, 0, 3);
    localPlayer.secondary = pendingLoadout.secondaryType;
    const sp = getSpawnCoords();
    localPlayer.pos = { x: wrapX(sp.x), y: sp.y };
    localPlayer.vel = { x: 0, y: 0 };
    localPlayer.deployed = true;
    updateHudWeaponButtons();
    showToast(`\u{1F504} \u5DF2\u5728\u3010${sp.label}\u3011\u91CD\u751F`);
  }
  function gameLoop(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1e3);
    lastFrame = now;
    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      playerInput = buildLocalInput();
      pendingInteract = false;
      pendingReload = false;
      pendingSecondary = null;
      const inputs = /* @__PURE__ */ new Map([[localPlayer.id, playerInput]]);
      for (const b of bots) inputs.set(b.id, botInput(b));
      world.step(FIXED, inputs);
      handleEvents(world.drainEvents());
      const dead = localPlayer.respawnTimer > 0;
      if (dead && !wasDead) onLocalDeath();
      if (!dead && wasDead) onLocalRespawn();
      wasDead = dead;
      acc -= FIXED;
      guard++;
    }
    mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) * camera.fovFactor);
    mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) * camera.fovFactor);
    renderScene();
    updateHudUI();
    updateScoreboardUI();
    requestAnimationFrame(gameLoop);
  }
  bindAllEvents();
  autoDetectDeviceInput();
  syncBotsCount(4);
  updateHudWeaponButtons();
  updateSpawnPointButtonsUI();
  updateTeamCountUI();
  syncParamsToUI();
  requestAnimationFrame(gameLoop);
  window.__dbg = {
    world,
    get player() {
      return localPlayer;
    },
    get bots() {
      return bots;
    },
    get camera() {
      return camera;
    },
    get pendingLoadout() {
      return pendingLoadout;
    },
    syncBotsCount,
    applyPendingLoadoutAndSpawn,
    get touch() {
      return touchState;
    },
    botTargets: () => bots.map((b) => ({ bot: b.name, team: b.team, target: pickBotTarget(b)?.name ?? null, targetTeam: pickBotTarget(b)?.team ?? null }))
  };
  window.__tune = {
    set: (p) => setPhysicsParams(p),
    get: () => getPhysicsParams(),
    reset: () => resetPhysicsParams()
  };
  (function loadSavedParams() {
    try {
      const raw = localStorage.getItem("pvp-physics-params");
      if (raw) setPhysicsParams(JSON.parse(raw));
    } catch {
    }
  })();
})();
