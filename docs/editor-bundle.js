"use strict";
(() => {
  // src/core/wrap.ts
  var WORLD_W = 13200;
  var WORLD_H = 4400;
  var SURFACE_Y = 2800;

  // src/core/map.ts
  var CEILING_TOP = 280;
  var CEILING_THICK = 80;
  var CEILING_HOLE_X0 = 5600;
  var CEILING_HOLE_X1 = 7600;
  function defaultMapData() {
    const solids = [
      // 天花板左板（环形 x 0~5600）
      { x: 0, y: CEILING_TOP, w: CEILING_HOLE_X0, h: CEILING_THICK, kind: "platform" },
      // 天花板右板（环形 x 7600~13200）
      { x: CEILING_HOLE_X1, y: CEILING_TOP, w: WORLD_W - CEILING_HOLE_X1, h: CEILING_THICK, kind: "platform" },
      // 空口拱形方块落脚点：正方形 160×160，不可摧毁（block=实心地形），中间高两侧低、相邻一高一低
      ...ARCH_BLOCKS()
    ];
    return { name: "\u5929\u82B1\u677F\u7ADE\u6280\u573A", solids };
  }
  function ARCH_BLOCKS() {
    const SIDE = 160;
    const xs = [5700, 6e3, 6300, 6600, 6900, 7200, 7500];
    const tops = [2700, 2500, 2620, 2400, 2620, 2500, 2700];
    return xs.map((x, i) => ({ x: x - SIDE / 2, y: tops[i], w: SIDE, h: SIDE, kind: "block" }));
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
  var GROUND_STAND = 2740;
  var SPAWN_POINTS = [
    { x: 1100, y: GROUND_STAND, team: "red" },
    { x: 12100, y: GROUND_STAND, team: "blue" },
    { x: 3300, y: GROUND_STAND, team: "green" },
    { x: 9900, y: GROUND_STAND, team: "ffa" }
  ];
  var MORTARS_INIT = [
    { id: "mortar_left", name: "\u897F\u533A\u8FEB\u51FB\u70AE", x: 920, y: CEILING_STAND, angle: -Math.PI * 0.28, power: 24 },
    { id: "mortar_mid_w", name: "\u4E2D\u592E\u897F\u8FEB\u51FB\u70AE", x: 3300, y: CEILING_STAND, angle: -Math.PI * 0.3, power: 23 },
    { id: "mortar_center", name: "\u4E2D\u592E\u8FEB\u51FB\u70AE", x: 5400, y: CEILING_STAND, angle: -Math.PI * 0.35, power: 24.5 },
    { id: "mortar_mid_e", name: "\u4E2D\u592E\u4E1C\u8FEB\u51FB\u70AE", x: 7800, y: CEILING_STAND, angle: -Math.PI * 0.7, power: 23 },
    { id: "mortar_right", name: "\u4E1C\u533A\u8FEB\u51FB\u70AE", x: 12260, y: CEILING_STAND, angle: -Math.PI * 0.72, power: 24 }
  ];
  var RANDOM_SPAWN_CANDIDATES = (() => {
    const out = [];
    for (let x = 400; x < WORLD_W; x += 620) out.push({ x, y: SURFACE_Y - 60 });
    for (const sp of SPAWN_POINTS) out.push({ x: sp.x, y: sp.y - 60 });
    return out;
  })();

  // src/core/sim/spatial.ts
  var BUCKET_SIZE = 200;
  var INV_BUCKET_SIZE = 1 / BUCKET_SIZE;
  var NUM_BUCKETS = Math.ceil(WORLD_W / BUCKET_SIZE);

  // src/web/main-editor.ts
  var SNAP = 20;
  var EDITOR_KEY = "pvp-editor-map";
  var GAME_KEY = "pvp-custom-map";
  var canvas = document.getElementById("editorCanvas");
  var ctx = canvas.getContext("2d");
  var statusEl = document.getElementById("status");
  var brushInput = document.getElementById("brushSize");
  var brushLabel = document.getElementById("brushLabel");
  var camera = { x: WORLD_W / 2, y: SURFACE_Y - 500, zoom: 0.22 };
  var brushKind = "platform";
  var brushTiles = 1;
  var map = loadInitial();
  var tool = "draw";
  var snapEnabled = true;
  var showGrid = true;
  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 80;
  var selected = -1;
  var dragging = null;
  var drawStart = null;
  var drawCur = null;
  var erasing = false;
  var panning = false;
  var spaceDown = false;
  var panLast = { x: 0, y: 0 };
  var mouseWorld = { x: 0, y: 0 };
  function resize() {
    canvas.width = window.innerWidth || 1280;
    canvas.height = window.innerHeight || 800;
  }
  window.addEventListener("resize", resize);
  resize();
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
  function updateSelectionInfo() {
    const el = document.getElementById("selectionInfo");
    if (!el) return;
    const s = selected >= 0 ? map.solids[selected] : null;
    el.textContent = s ? `\u5DF2\u9009\u4E2D #${selected} ${KIND_STYLE[s.kind].label} (${Math.round(s.x)}, ${Math.round(s.y)}) ${Math.round(s.w)}\xD7${Math.round(s.h)} \xB7 Delete \u5220\u9664 \xB7 \u62D6\u62FD\u79FB\u52A8` : "";
  }
  function hitTest(wx, wy) {
    for (let i = map.solids.length - 1; i >= 0; i--) {
      const s = map.solids[i];
      if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i;
    }
    return -1;
  }
  function fitToWindow() {
    const margin = 60;
    const zx = (canvas.width - margin * 2) / WORLD_W;
    const zy = (canvas.height - margin * 2) / SURFACE_Y;
    camera.zoom = Math.max(0.05, Math.min(zx, zy));
    camera.x = WORLD_W / 2;
    camera.y = SURFACE_Y / 2;
  }
  function updateStatus() {
    if (statusEl) statusEl.textContent = `${map.solids.length} \u5757`;
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
  var KIND_STYLE = {
    platform: { fill: "rgba(56,189,248,0.35)", stroke: "#38bdf8", label: "\u5E73\u53F0" },
    cover: { fill: "rgba(249,115,22,0.35)", stroke: "#f97316", label: "\u63A9\u4F53" },
    block: { fill: "rgba(168,85,247,0.35)", stroke: "#a855f7", label: "\u65B9\u5757" }
  };
  function render() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#050914");
    sky.addColorStop(0.6, "#0b1729");
    sky.addColorStop(1, "#122033");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gy = sy(SURFACE_Y);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, gy, canvas.width, canvas.height - gy);
    ctx.strokeStyle = "rgba(100,116,139,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx(0), sy(0), WORLD_W * camera.zoom, SURFACE_Y * camera.zoom);
    if (showGrid && camera.zoom > 0.16) {
      ctx.strokeStyle = "rgba(51,65,85,0.45)";
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 200) {
        const px = sx(x);
        ctx.moveTo(px, sy(0));
        ctx.lineTo(px, sy(SURFACE_Y));
      }
      for (let y = 0; y <= SURFACE_Y; y += 200) {
        const py = sy(y);
        ctx.moveTo(sx(0), py);
        ctx.lineTo(sx(WORLD_W), py);
      }
      ctx.stroke();
    }
    for (const s of map.solids) {
      const st = KIND_STYLE[s.kind];
      ctx.fillStyle = st.fill;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = 1;
      ctx.fillRect(sx(s.x), sy(s.y), s.w * camera.zoom, s.h * camera.zoom);
      ctx.strokeRect(sx(s.x), sy(s.y), s.w * camera.zoom, s.h * camera.zoom);
    }
    if (selected >= 0 && map.solids[selected]) {
      const sel = map.solids[selected];
      ctx.save();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx(sel.x), sy(sel.y), sel.w * camera.zoom, sel.h * camera.zoom);
      ctx.restore();
    }
    for (const sp of SPAWN_POINTS) {
      ctx.fillStyle = sp.team === "ffa" ? "#fde047" : sp.team === "red" ? "#fda4af" : sp.team === "blue" ? "#7dd3fc" : "#6ee7b7";
      ctx.beginPath();
      ctx.arc(sx(sp.x), sy(sp.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (drawStart && drawCur) {
      const x = Math.min(drawStart.x, drawCur.x);
      const y = Math.min(drawStart.y, drawCur.y);
      const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles;
      const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles;
      ctx.fillStyle = "rgba(34,211,238,0.25)";
      ctx.strokeStyle = "#22d3ee";
      ctx.fillRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom);
      ctx.strokeRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom);
    }
    ctx.strokeStyle = "rgba(34,211,238,0.8)";
    ctx.strokeRect(sx(mouseWorld.x), sy(mouseWorld.y), SNAP * camera.zoom, SNAP * camera.zoom);
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(`x=${Math.round(mouseWorld.x)} y=${Math.round(mouseWorld.y)}  zoom=${camera.zoom.toFixed(2)}`, 12, canvas.height - 12);
    requestAnimationFrame(render);
  }
  function addRect(kind, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    map.solids.push({ x, y, w, h, kind });
    updateStatus();
  }
  function eraseAt(wx, wy) {
    const before = map.solids.length;
    map.solids = map.solids.filter((s) => !(wx >= s.x - SNAP && wx < s.x + s.w + SNAP && wy >= s.y - SNAP && wy < s.y + s.h + SNAP));
    if (map.solids.length !== before) updateStatus();
  }
  function clampToWorld(v, max) {
    return Math.max(0, Math.min(max, snap(v)));
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
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
        const hit = hitTest(wx, wy);
        selected = hit;
        updateSelectionInfo();
        if (hit >= 0) {
          const s2 = map.solids[hit];
          dragging = { startX: wx, startY: wy, origX: s2.x, origY: s2.y };
          pushHistory();
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
    if (dragging && selected >= 0 && map.solids[selected]) {
      const sel = map.solids[selected];
      sel.x = Math.max(0, Math.min(WORLD_W - sel.w, dragging.origX + (mouseWorld.x - dragging.startX)));
      sel.y = Math.max(0, Math.min(SURFACE_Y - sel.h, dragging.origY + (mouseWorld.y - dragging.startY)));
      if (snapEnabled) {
        sel.x = snap(sel.x);
        sel.y = snap(sel.y);
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
    if (dragging) {
      dragging = null;
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
      addRect(brushKind, x, y, w, h);
      drawStart = null;
      drawCur = null;
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const factor = Math.exp(-e.deltaY * 12e-4);
    camera.zoom = Math.max(0.1, Math.min(1.6, camera.zoom * factor));
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space") spaceDown = true;
    if (e.code === "Digit1") selectKind("platform");
    if (e.code === "Digit2") selectKind("cover");
    if (e.code === "Digit3") selectKind("block");
    if (e.code === "KeyQ") selectTool("draw");
    if (e.code === "KeyW") selectTool("select");
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
  }
  for (const b of document.querySelectorAll("[data-kind]")) {
    b.addEventListener("click", () => selectKind(b.getAttribute("data-kind")));
  }
  function selectTool(t) {
    tool = t;
    selected = t === "select" ? selected : -1;
    for (const b of document.querySelectorAll("[data-tool]")) {
      b.classList.toggle("active", b.getAttribute("data-tool") === t);
    }
    updateSelectionInfo();
  }
  for (const b of document.querySelectorAll("[data-tool]")) {
    b.addEventListener("click", () => selectTool(b.getAttribute("data-tool")));
  }
  var snapToggle = document.getElementById("snapToggle");
  snapToggle?.addEventListener("change", () => {
    snapEnabled = snapToggle.checked;
  });
  var gridToggle = document.getElementById("gridToggle");
  gridToggle?.addEventListener("change", () => {
    showGrid = gridToggle.checked;
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
    map = { name: "\u81EA\u5B9A\u4E49\u5730\u56FE", solids: [] };
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
  requestAnimationFrame(render);
})();
