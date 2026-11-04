"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/core/sim/physics.ts
  var GRAVITY = 450;
  var MOVE_SPEED = 360;
  var JUMP_VEL = 520;
  var MAX_FALL = 650;
  var JETPACK_ACCEL = 1500;
  var JETPACK_FUEL = 2.5;
  var JETPACK_DRAIN = 1;
  var JETPACK_RECHARGE = 0.8;
  function integrate(p, v, dt) {
    p.x += v.x * dt;
    p.y += v.y * dt;
  }
  function applyGravity(v, dt) {
    v.y += GRAVITY * dt;
    if (v.y > MAX_FALL) v.y = MAX_FALL;
  }
  function move(v, dir) {
    v.x = dir * MOVE_SPEED;
  }
  function jump(v) {
    v.y = -JUMP_VEL;
  }
  function jetpack(v, _aim, dt) {
    v.y -= JETPACK_ACCEL * dt;
  }
  function updateJetpackFuel(fuel, active, dt) {
    const next = active ? fuel - JETPACK_DRAIN * dt : fuel + JETPACK_RECHARGE * dt;
    return Math.min(JETPACK_FUEL, Math.max(0, next));
  }

  // src/core/sim/projectile.ts
  var PROJECTILE_SPEED = 900;
  var PROJECTILE_LIFE = 2.5;
  var PROJECTILE_R = 5;
  var GROUND_Y = 540;
  function fireProjectile(owner, pos, aim, id) {
    return {
      id,
      owner,
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(aim) * PROJECTILE_SPEED, y: Math.sin(aim) * PROJECTILE_SPEED },
      life: PROJECTILE_LIFE,
      r: PROJECTILE_R
    };
  }
  function stepProjectile(p, dt) {
    applyGravity(p.vel, dt);
    integrate(p.pos, p.vel, dt);
    if (p.pos.y > GROUND_Y + 20) {
      p.life = 0;
      return;
    }
    p.life -= dt;
  }

  // src/core/types.ts
  function defaultWorldInput() {
    return { move: 0, jump: false, jetpack: false, aim: 0, fire: false, reload: false };
  }

  // src/core/sim/world.ts
  var GROUND_Y2 = 540;
  var WALL_L = 40;
  var WALL_R = 920;
  var PLAYER_R = 18;
  var FIRE_COOLDOWN = 0.22;
  var MAG_SIZE = 8;
  var FIRE_DAMAGE = 34;
  var SPAWNS = [
    { x: 200, y: GROUND_Y2 },
    { x: 760, y: GROUND_Y2 }
  ];
  var World = class {
    constructor() {
      __publicField(this, "players", []);
      __publicField(this, "projectiles", []);
      __publicField(this, "terrains", []);
      __publicField(this, "tick", 0);
      __publicField(this, "hits", 0);
      __publicField(this, "pid", 1);
      __publicField(this, "prj", 1);
      __publicField(this, "cooldowns", /* @__PURE__ */ new Map());
      __publicField(this, "fuel", /* @__PURE__ */ new Map());
      __publicField(this, "spawnIndex", 0);
    }
    addTerrain(x, y, w, h) {
      const t = { x, y, w, h };
      this.terrains.push(t);
      return t;
    }
    addPlayer(x, y) {
      const p = {
        id: this.pid++,
        pos: { x, y },
        vel: { x: 0, y: 0 },
        aim: 0,
        hp: 100,
        ammo: MAG_SIZE,
        jetpack: false,
        alive: true,
        kills: 0,
        deaths: 0
      };
      this.players.push(p);
      this.cooldowns.set(p.id, 0);
      this.fuel.set(p.id, JETPACK_FUEL);
      return p;
    }
    step(dt, inputs) {
      this.tick++;
      for (const p of this.players) {
        const w = inputs.get(p.id) ?? defaultWorldInput();
        this.apply(p, w, dt);
        this.physics(p, dt);
      }
      for (const pr of this.projectiles) stepProjectile(pr, dt);
      this.collideProjectileTerrain();
      this.collide();
      this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
    }
    apply(p, w, dt) {
      p.aim = w.aim;
      move(p.vel, w.move);
      if (w.jump && this.onGround(p)) jump(p.vel);
      const fuel = this.fuel.get(p.id) ?? 0;
      const canJet = w.jetpack && fuel > 0;
      if (canJet) jetpack(p.vel, p.aim, dt);
      this.fuel.set(p.id, updateJetpackFuel(fuel, w.jetpack, dt));
      if (w.reload && p.ammo < MAG_SIZE) p.ammo = MAG_SIZE;
      const cd = this.cooldowns.get(p.id) ?? 0;
      this.cooldowns.set(p.id, Math.max(0, cd - dt));
      if (w.fire && cd <= 0 && p.ammo > 0 && p.alive) {
        const muzzle = { x: p.pos.x + Math.cos(p.aim) * 26, y: p.pos.y + Math.sin(p.aim) * 26 };
        this.projectiles.push(fireProjectile(p.id, muzzle, p.aim, this.prj++));
        p.ammo--;
        this.cooldowns.set(p.id, FIRE_COOLDOWN);
      }
    }
    /** 供 UI/HUD 读取玩家燃料 */
    fuelOf(id) {
      return this.fuel.get(id) ?? 0;
    }
    physics(p, dt) {
      applyGravity(p.vel, dt);
      integrate(p.pos, p.vel, dt);
      if (p.pos.y >= GROUND_Y2) {
        p.pos.y = GROUND_Y2;
        if (p.vel.y > 0) p.vel.y = 0;
      }
      if (p.pos.x < WALL_L) {
        p.pos.x = WALL_L;
        p.vel.x = Math.max(0, p.vel.x);
      }
      if (p.pos.x > WALL_R) {
        p.pos.x = WALL_R;
        p.vel.x = Math.min(0, p.vel.x);
      }
      this.collideTerrains(p);
    }
    // 玩家圆(PLAYER_R) vs 平台 AABB：最小穿透轴推出，绝不穿入/穿过平台、绝不瞬移
    collideTerrains(p) {
      for (const t of this.terrains) {
        const nx = Math.max(t.x, Math.min(p.pos.x, t.x + t.w));
        const ny = Math.max(t.y, Math.min(p.pos.y, t.y + t.h));
        const dx = p.pos.x - nx;
        const dy = p.pos.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= PLAYER_R * PLAYER_R) continue;
        if (d2 === 0) {
          const left = p.pos.x - t.x;
          const right = t.x + t.w - p.pos.x;
          const top = p.pos.y - t.y;
          const bottom = t.y + t.h - p.pos.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) {
            p.pos.x = t.x - PLAYER_R;
            p.vel.x = Math.min(0, p.vel.x);
          } else if (m === right) {
            p.pos.x = t.x + t.w + PLAYER_R;
            p.vel.x = Math.max(0, p.vel.x);
          } else if (m === top) {
            p.pos.y = t.y - PLAYER_R;
            p.vel.y = Math.min(0, p.vel.y);
          } else {
            p.pos.y = t.y + t.h + PLAYER_R;
            p.vel.y = Math.max(0, p.vel.y);
          }
        } else {
          const d = Math.sqrt(d2);
          const push = (PLAYER_R - d) / d;
          p.pos.x += dx * push;
          p.pos.y += dy * push;
          if (dy < 0 && p.vel.y > 0) p.vel.y = 0;
          else if (dy > 0 && p.vel.y < 0) p.vel.y = 0;
          else if (Math.abs(dx) > Math.abs(dy)) p.vel.x = 0;
        }
      }
    }
    // 弹丸 vs 地形：进入平台即被挡下（形成掩体）
    collideProjectileTerrain() {
      for (const pr of this.projectiles) {
        if (pr.life <= 0) continue;
        for (const t of this.terrains) {
          if (pr.pos.x > t.x - pr.r && pr.pos.x < t.x + t.w + pr.r && pr.pos.y > t.y - pr.r && pr.pos.y < t.y + t.h + pr.r) {
            pr.life = 0;
            break;
          }
        }
      }
    }
    onGround(p) {
      return p.pos.y >= GROUND_Y2 - 0.5;
    }
    collide() {
      for (const pr of this.projectiles) {
        if (pr.life <= 0) continue;
        for (const p of this.players) {
          if (pr.owner === p.id || !p.alive) continue;
          const dx = pr.pos.x - p.pos.x;
          const dy = pr.pos.y - p.pos.y;
          if (dx * dx + dy * dy < (pr.r + PLAYER_R) ** 2) {
            pr.life = 0;
            this.hits++;
            p.hp -= FIRE_DAMAGE;
            if (p.hp <= 0) this.kill(p, pr.owner);
            break;
          }
        }
      }
    }
    kill(victim, killerId) {
      const killer = this.players.find((x) => x.id === killerId);
      if (killer) killer.kills++;
      victim.deaths++;
      victim.alive = false;
      this.respawn(victim);
    }
    respawn(p) {
      const s = SPAWNS[this.spawnIndex++ % SPAWNS.length];
      p.pos = { x: s.x, y: s.y };
      p.vel = { x: 0, y: 0 };
      p.hp = 100;
      p.ammo = MAG_SIZE;
      p.alive = true;
      this.pushOutOfTerrains(p);
    }
    // 把玩家从地形重叠中推出（重生/卡住兜底）；返回是否曾重叠
    pushOutOfTerrains(p) {
      let moved = false;
      for (let guard = 0; guard < 8; guard++) {
        let overlapped = false;
        for (const t of this.terrains) {
          const nx = Math.max(t.x, Math.min(p.pos.x, t.x + t.w));
          const ny = Math.max(t.y, Math.min(p.pos.y, t.y + t.h));
          const dx = p.pos.x - nx;
          const dy = p.pos.y - ny;
          if (dx * dx + dy * dy < PLAYER_R * PLAYER_R) {
            overlapped = true;
            moved = true;
            if (dx === 0 && dy === 0) {
              p.pos.y = t.y - PLAYER_R;
              p.vel.y = Math.min(0, p.vel.y);
            } else {
              const d = Math.sqrt(dx * dx + dy * dy);
              const push = (PLAYER_R - d) / d;
              p.pos.x += dx * push;
              p.pos.y += dy * push;
            }
          }
        }
        if (!overlapped) break;
      }
      return moved;
    }
    snapshot() {
      return {
        tick: this.tick,
        players: this.players.map((p) => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
        projectiles: this.projectiles.map((pr) => ({ ...pr, pos: { ...pr.pos }, vel: { ...pr.vel } }))
      };
    }
  };

  // src/net/ServerSim.ts
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
      }
    }
    return n;
  }

  // src/web/controls.ts
  var Controls = class {
    constructor(canvas2, logicalW, logicalH, cb = {}) {
      __publicField(this, "keys", /* @__PURE__ */ new Set());
      __publicField(this, "mouse", { x: 0, y: 0 });
      __publicField(this, "mouseDown", false);
      __publicField(this, "playerWorld", { x: 0, y: 0 });
      __publicField(this, "isTouch");
      __publicField(this, "tMoveX", 0);
      __publicField(this, "tAim", 0);
      __publicField(this, "tFire", false);
      __publicField(this, "tJump", false);
      __publicField(this, "tJetpack", false);
      __publicField(this, "tReload", false);
      __publicField(this, "canvas");
      __publicField(this, "logicalW");
      __publicField(this, "logicalH");
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
  var world = new World();
  world.addTerrain(400, 460, 160, 14);
  world.addTerrain(140, 360, 90, 14);
  world.addTerrain(730, 360, 90, 14);
  world.addTerrain(120, 400, 14, 60);
  var player = world.addPlayer(220, GROUND_Y2);
  var enemy = world.addPlayer(740, GROUND_Y2);
  var playerInput = defaultWorldInput();
  var enemyInput = defaultWorldInput();
  document.getElementById("btn-fullscreen")?.addEventListener("click", toggleFullscreen);
  for (const id of ["btn-jump", "btn-jet"]) {
    const b = document.getElementById(id);
    b?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      controls.setJetpack(true);
    });
    b?.addEventListener("touchend", () => controls.setJetpack(false));
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
    if (t.jetpack) out.push({ t: "jetpack", on: true });
    else out.push({ t: "jetpack", on: false });
    if (t.reload) out.push({ t: "reload" });
    return out;
  }
  function aiIntent() {
    const dx = player.pos.x - enemy.pos.x;
    const dy = player.pos.y - enemy.pos.y;
    const aim = Math.atan2(dy, dx);
    const move2 = Math.abs(dx) > 180 ? dx > 0 ? 1 : -1 : 0;
    const fire = world.tick % 18 < 12;
    return { move: move2, jump: false, jetpack: false, aim, fire, reload: enemy.ammo === 0 };
  }
  function drawPlayer(p, color, label) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.pos.x, p.pos.y);
    ctx.lineTo(p.pos.x + Math.cos(p.aim) * 32, p.pos.y + Math.sin(p.aim) * 32);
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.fillRect(p.pos.x - 18, p.pos.y - 32, 36, 5);
    ctx.fillStyle = color;
    ctx.fillRect(p.pos.x - 18, p.pos.y - 32, 36 * Math.max(0, p.hp) / 100, 5);
    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${label} ${p.hp}`, p.pos.x, p.pos.y - 38);
  }
  function render() {
    vp.applyTransform();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2a3340";
    ctx.fillRect(WALL_L - 10, GROUND_Y2, WALL_R - WALL_L + 20, H - GROUND_Y2);
    ctx.fillStyle = "#3a4a5f";
    for (const t of world.terrains) ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = "#ffd166";
    for (const pr of world.projectiles) {
      ctx.beginPath();
      ctx.arc(pr.pos.x, pr.pos.y, pr.r, 0, Math.PI * 2);
      ctx.fill();
    }
    drawPlayer(player, "#4ade80", "YOU");
    drawPlayer(enemy, "#f87171", "AI");
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`\u4F60 K/D=${player.kills}/${player.deaths}   AI K/D=${enemy.kills}/${enemy.deaths}   \u71C3\u6599=${world.fuelOf(player.id).toFixed(1)}   tick=${world.tick}`, 12, 20);
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
      playerInput = applyIntents(playerInput, toIntents(t));
      enemyInput = aiIntent();
      world.step(FIXED, /* @__PURE__ */ new Map([[player.id, playerInput], [enemy.id, enemyInput]]));
      controls.consumeMomentary();
      acc -= FIXED;
      guard++;
    }
    controls.setPlayerScreen(player.pos.x, player.pos.y);
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
    get enemy() {
      return enemy;
    },
    get fuel() {
      return world.fuelOf(player.id);
    },
    get input() {
      return playerInput;
    }
  };
})();
