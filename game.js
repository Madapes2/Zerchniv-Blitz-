// game.js?v=2 — Phaser HexScene
// Display-only: renders the board from Bridge state, sends all
// game actions through NET. Never mutates game state directly.

// ─── Unit definitions (shared client-side reference for costs/stats) ──────────
const UNIT_DEFS = {
  Warrior:   { cost: 2, atk: 2, hp: 4, spd: 1, icon: "⚔"  },
  Scout:     { cost: 1, atk: 1, hp: 2, spd: 2, icon: "🏃" },
  Berserker: { cost: 3, atk: 4, hp: 3, spd: 1, icon: "🪓" },
  Archer:    { cost: 2, atk: 2, hp: 2, spd: 1, icon: "🏹" },
  Knight:    { cost: 4, atk: 3, hp: 7, spd: 1, icon: "🛡" },
};

const UNIT_DEF_NAMES = ["Warrior", "Scout", "Berserker", "Archer", "Knight"];

// ─── Hex helpers ──────────────────────────────────────────────────────────────
function hexToPixel(q, r, S, ox, oy) {
  return {
    x: ox + S * Math.sqrt(3) * (q + r / 2),
    y: oy + S * 1.5 * r,
  };
}

function pixelToHex(px, py, S, ox, oy) {
  const x = (px - ox) / S;
  const y = (py - oy) / S;
  const q = x * Math.sqrt(3) / 3 - y / 3;
  const r = y * 2 / 3;
  return hexRound(q, r);
}

function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

function hexDist(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

function hexNeighbors(q, r) {
  return [
    { q: q + 1, r }, { q: q - 1, r },
    { q, r: r + 1 }, { q, r: r - 1 },
    { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 },
  ];
}

// Board hex list
const BOARD_HEXES = [];
const BOARD_SET   = new Set();
(function () {
  const rows = [
    { r: -4, qMin: -1, qMax: 2 }, { r: -3, qMin: -2, qMax: 3 },
    { r: -2, qMin: -3, qMax: 3 }, { r: -1, qMin: -3, qMax: 4 },
    { r:  0, qMin: -4, qMax: 4 }, { r:  1, qMin: -4, qMax: 3 },
    { r:  2, qMin: -3, qMax: 3 }, { r:  3, qMin: -3, qMax: 2 },
    { r:  4, qMin: -2, qMax: 1 },
  ];
  rows.forEach(({ r, qMin, qMax }) => {
    for (let q = qMin; q <= qMax; q++) {
      BOARD_HEXES.push({ q, r });
      BOARD_SET.add(`${q},${r}`);
    }
  });
})();

function isOnBoard(q, r) { return BOARD_SET.has(`${q},${r}`); }

// ─── Phaser Scene ─────────────────────────────────────────────────────────────
class BattleScene extends Phaser.Scene {
  constructor() { super({ key: "BattleScene" }); }

  create() {
    this.S   = 32;     // hex size
    this.OX  = this.cameras.main.width  / 2;
    this.OY  = this.cameras.main.height / 2 - 10;

    this.hexGfx  = this.add.graphics();
    this.unitGfx = this.add.graphics();
    this.fxGfx   = this.add.graphics();
    this.labels  = [];

    // Selection state (local UI only — never authoritative)
    this.selectedCard = null;   // defName string | null
    this.selectedUnit = null;   // unit id | null
    this.highlights   = new Set();

    // Pointer events
    this.input.on("pointermove", (ptr) => this._onHover(ptr));
    this.input.on("pointerdown", (ptr) => this._onClick(ptr));

    // Initial draw (board only, no units yet)
    this.redraw(Bridge.getState());
  }

  // ─── Called by Bridge ─────────────────────────────────────────────────────

  onGameStarted(state) {
    this.redraw(state);
  }

  redraw(state) {
    if (!state) return;
    this._clearLabels();
    this.hexGfx.clear();
    this.unitGfx.clear();

    const S = this.S, OX = this.OX, OY = this.OY;

    // ── Draw hexes ──
    BOARD_HEXES.forEach(({ q, r }) => {
      const { x, y } = hexToPixel(q, r, S, OX, OY);
      const key = `${q},${r}`;
      const isHL  = this.highlights.has(key);
      const isP1E = (q === state.p1EmpireQ && r === state.p1EmpireR);
      const isP2E = (q === state.p2EmpireQ && r === state.p2EmpireR);
      const mySeat = Bridge.getMySeat();
      const isMyEmpire    = (mySeat === "p1" && isP1E) || (mySeat === "p2" && isP2E);
      const isEnemyEmpire = (mySeat === "p1" && isP2E) || (mySeat === "p2" && isP1E);
      const isSelUnit = this.selectedUnit && state.units[this.selectedUnit] &&
                        state.units[this.selectedUnit].q === q &&
                        state.units[this.selectedUnit].r === r;

      this.hexGfx.lineStyle(1, 0x3a1f28, 0.8);

      if      (isMyEmpire)    this.hexGfx.fillStyle(0x3a0a0a, 1);
      else if (isEnemyEmpire) this.hexGfx.fillStyle(0x0a1a3a, 1);
      else if (isSelUnit)     this.hexGfx.fillStyle(0x3a2800, 0.9);
      else if (isHL)          this.hexGfx.fillStyle(0x1e2e10, 0.8);
      else                    this.hexGfx.fillStyle(0x1a0e12, 1);

      this._drawHex(this.hexGfx, x, y, S - 2);

      // Empire markers
      if (isMyEmpire || isEnemyEmpire) {
        const color = isMyEmpire ? 0xcc3344 : 0x3388cc;
        const stroke = isMyEmpire ? 0xff6677 : 0x66aaff;
        this.unitGfx.fillStyle(color, 1);
        this.unitGfx.fillCircle(x, y, S * 0.4);
        this.unitGfx.lineStyle(2, stroke, 1);
        this.unitGfx.strokeCircle(x, y, S * 0.4);
        this._addLabel(x, y, "👑");
      }
    });

    // ── Draw units ──
    for (const id in state.units) {
      const u = state.units[id];
      const { x, y } = hexToPixel(u.q, u.r, S, OX, OY);
      const mySeat    = Bridge.getMySeat();
      const isMine    = u.owner === mySeat;
      const isSelected = this.selectedUnit === id;

      const color  = isMine ? 0x3388cc : 0x888899;
      const stroke = isSelected ? 0xf0c060 : (isMine ? 0x66aaff : 0xaaaacc);

      this.unitGfx.fillStyle(color, 1);
      this.unitGfx.fillCircle(x, y, S * 0.38);
      this.unitGfx.lineStyle(isSelected ? 3 : 2, stroke, 1);
      this.unitGfx.strokeCircle(x, y, S * 0.38);

      // HP bar
      const barW = S * 0.7, barH = 4;
      const barX = x - barW / 2, barY = y - S * 0.5 - barH - 1;
      const frac = u.hp / (u.maxHp || 1);
      this.unitGfx.fillStyle(0x220a08, 1);
      this.unitGfx.fillRect(barX, barY, barW, barH);
      const hpColor = frac > 0.5 ? 0x44cc55 : frac > 0.25 ? 0xddaa22 : 0xcc3322;
      this.unitGfx.fillStyle(hpColor, 1);
      this.unitGfx.fillRect(barX, barY, barW * frac, barH);

      // Exhausted overlay
      if (u.moved && u.attacked) {
        this.unitGfx.fillStyle(0x000000, 0.4);
        this.unitGfx.fillCircle(x, y, S * 0.38);
      }

      const def = UNIT_DEFS[u.defName];
      if (def) this._addLabel(x, y, def.icon);
    }
  }

  clearSelection() {
    this.selectedCard = null;
    this.selectedUnit = null;
    this.highlights.clear();
    document.querySelectorAll(".unit-card").forEach(c => c.classList.remove("selected"));
  }

  // Called by Bridge after an attack — small flash FX
  playAttackFX(attacker, target, state) {
    const { x: ax, y: ay } = hexToPixel(attacker.q, attacker.r, this.S, this.OX, this.OY);
    const { x: tx, y: ty } = hexToPixel(target.q,   target.r,   this.S, this.OX, this.OY);

    this.fxGfx.lineStyle(3, 0xff6633, 1);
    this.fxGfx.lineBetween(ax, ay, tx, ty);
    this.fxGfx.fillStyle(0xff4400, 1);
    this.fxGfx.fillCircle(tx, ty, 8);

    this.time.delayedCall(250, () => {
      this.fxGfx.clear();
      this.redraw(Bridge.getState());
    });
  }

  // ─── Input handlers ───────────────────────────────────────────────────────

  _onHover(ptr) {
    const { q, r } = pixelToHex(ptr.x, ptr.y, this.S, this.OX, this.OY);
    const state = Bridge.getState();
    const tt    = document.getElementById("tooltip");

    // Find unit or empire under cursor
    let hovered = null;
    for (const id in state.units) {
      const u = state.units[id];
      if (u.q === q && u.r === r) { hovered = u; break; }
    }

    if (hovered && isOnBoard(q, r)) {
      const mySeat = Bridge.getMySeat();
      document.getElementById("tt-name").textContent = (hovered.defName || "Unit") + " " + (UNIT_DEFS[hovered.defName]?.icon || "");
      document.getElementById("tt-atk").textContent  = hovered.atk;
      document.getElementById("tt-hp").textContent   = hovered.hp + " / " + hovered.maxHp;
      document.getElementById("tt-spd").textContent  = hovered.spd;
      document.getElementById("tt-own").textContent  = hovered.owner === mySeat ? "Ally" : "Enemy";
      tt.style.display = "block";
      tt.style.left    = (ptr.x + 14) + "px";
      tt.style.top     = (ptr.y - 10) + "px";
    } else {
      tt.style.display = "none";
    }
  }

  _onClick(ptr) {
    if (!Bridge.getMyTurn()) return;

    const { q, r } = pixelToHex(ptr.x, ptr.y, this.S, this.OX, this.OY);
    if (!isOnBoard(q, r)) return;

    const state   = Bridge.getState();
    const mySeat  = Bridge.getMySeat();

    // Which unit (if any) sits on the clicked hex?
    let clickedUnit = null;
    for (const id in state.units) {
      const u = state.units[id];
      if (u.q === q && u.r === r) { clickedUnit = u; break; }
    }

    // ── Placing a unit ──
    if (this.selectedCard) {
      const def = UNIT_DEFS[this.selectedCard];
      if (!def) return;
      if (def.cost > Bridge.getMyMana()) {
        addLog("Not enough mana!", "important"); return;
      }
      if (clickedUnit) { addLog("Hex occupied!"); return; }
      // adjacency check (client-side pre-validation; server validates authoritatively)
      const eq = mySeat === "p1" ? state.p1EmpireQ : state.p2EmpireQ;
      const er = mySeat === "p1" ? state.p1EmpireR : state.p2EmpireR;
      if (hexDist(q, r, eq, er) > 1) { addLog("Must be adjacent to your Empire."); return; }

      NET.sendPlaceUnit(this.selectedCard, q, r);
      this.clearSelection();
      this.highlights.clear();
      return;
    }

    // ── Select own unit ──
    if (clickedUnit && clickedUnit.owner === mySeat) {
      this.selectedUnit = clickedUnit.id;
      this._computeMoveHighlights(clickedUnit, state);
      this.redraw(state);
      return;
    }

    // ── Actions with a selected unit ──
    if (this.selectedUnit) {
      const sel = state.units[this.selectedUnit];
      if (!sel) { this.clearSelection(); return; }

      // Attack an enemy unit
      if (clickedUnit && clickedUnit.owner !== mySeat) {
        if (hexDist(sel.q, sel.r, clickedUnit.q, clickedUnit.r) > 1) {
          addLog("Target out of attack range."); return;
        }
        NET.sendAttackUnit(sel.id, clickedUnit.id);
        this.clearSelection();
        this.highlights.clear();
        return;
      }

      // Attack enemy empire
      const enemySeat = mySeat === "p1" ? "p2" : "p1";
      const eEmpQ = enemySeat === "p1" ? state.p1EmpireQ : state.p2EmpireQ;
      const eEmpR = enemySeat === "p1" ? state.p1EmpireR : state.p2EmpireR;
      if (q === eEmpQ && r === eEmpR) {
        if (hexDist(sel.q, sel.r, eEmpQ, eEmpR) > 1) {
          addLog("Empire out of reach."); return;
        }
        NET.sendAttackEmpire(sel.id);
        this.clearSelection();
        this.highlights.clear();
        return;
      }

      // Move
      if (!clickedUnit) {
        if (hexDist(sel.q, sel.r, q, r) > sel.spd) {
          addLog("Too far to move."); return;
        }
        NET.sendMoveUnit(sel.id, q, r);
        this.clearSelection();
        this.highlights.clear();
        return;
      }
    }

    // Deselect
    this.clearSelection();
    this.redraw(state);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _computeMoveHighlights(unit, state) {
    this.highlights.clear();
    BOARD_HEXES.forEach(({ q, r }) => {
      if (hexDist(unit.q, unit.r, q, r) <= unit.spd) {
        // Don't highlight if occupied
        let occ = false;
        for (const id in state.units) {
          if (state.units[id].q === q && state.units[id].r === r) { occ = true; break; }
        }
        if (!occ) this.highlights.add(`${q},${r}`);
      }
    });
  }

  _drawHex(g, cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  _addLabel(x, y, txt) {
    const t = this.add.text(x, y, txt, { fontSize: "14px", align: "center" }).setOrigin(0.5, 0.5);
    this.labels.push(t);
  }

  _clearLabels() {
    this.labels.forEach(t => t.destroy());
    this.labels = [];
  }
}

// ─── UI: card selection ───────────────────────────────────────────────────────
function selectCard(idx) {
  if (!Bridge.getMyTurn()) return;
  const defName = UNIT_DEF_NAMES[idx];
  if (!defName) return;
  const def = UNIT_DEFS[defName];
  if (def.cost > Bridge.getMyMana()) {
    addLog("Need " + def.cost + " mana. You have " + Bridge.getMyMana() + ".", "important");
    return;
  }

  const scene = window.game.scene.getScene("BattleScene");

  // Toggle off if already selected
  if (scene.selectedCard === defName) {
    scene.clearSelection();
    scene.redraw(Bridge.getState());
    return;
  }

  scene.clearSelection();
  scene.selectedCard = defName;
  document.getElementById("card-" + idx).classList.add("selected");

  // Highlight valid placement hexes (adjacent to own empire, unoccupied)
  const state   = Bridge.getState();
  const mySeat  = Bridge.getMySeat();
  const eq = mySeat === "p1" ? state.p1EmpireQ : state.p2EmpireQ;
  const er = mySeat === "p1" ? state.p1EmpireR : state.p2EmpireR;
  scene.highlights.clear();
  hexNeighbors(eq, er).forEach(({ q, r }) => {
    if (!isOnBoard(q, r)) return;
    let occ = false;
    for (const id in state.units) {
      if (state.units[id].q === q && state.units[id].r === r) { occ = true; break; }
    }
    if (!occ) scene.highlights.add(`${q},${r}`);
  });
  scene.redraw(state);
  addLog("Click a highlighted hex to place " + defName + ".");
}

// ─── UI: end turn ─────────────────────────────────────────────────────────────
function endTurn() {
  if (!Bridge.getMyTurn()) return;
  NET.sendEndTurn();
  const scene = window.game.scene.getScene("BattleScene");
  if (scene) scene.clearSelection();
}

// ─── UI: restart ──────────────────────────────────────────────────────────────
function restartGame() {
  location.reload();
}

// ─── Log helper (global) ─────────────────────────────────────────────────────
function addLog(msg, cls) {
  const log = document.getElementById("log");
  if (!log) return;
  const el = document.createElement("div");
  el.className = "log-entry " + (cls || "");
  el.textContent = msg;
  log.prepend(el);
  while (log.children.length > 12) log.removeChild(log.lastChild);
}

// ─── Phaser boot ─────────────────────────────────────────────────────────────
function getCanvasSize() {
  const wrap = document.getElementById("canvas-wrap");
  return { w: wrap.clientWidth, h: wrap.clientHeight };
}

window.addEventListener("DOMContentLoaded", () => {
  const { w, h } = getCanvasSize();

  window.game = new Phaser.Game({
    type:            Phaser.CANVAS,
    canvas:          document.getElementById("phaser-canvas"),
    width:           w,
    height:          h,
    backgroundColor: "#0a0608",
    scene:           [BattleScene],
  });

  // Resize support
  window.addEventListener("resize", () => {
    const { w: nw, h: nh } = getCanvasSize();
    window.game.scale.resize(nw, nh);
    const scene = window.game.scene.getScene("BattleScene");
    if (scene && scene.sys.isActive()) {
      scene.OX = nw / 2;
      scene.OY = nh / 2 - 10;
      scene.redraw(Bridge.getState());
    }
  });

  // Connect to Colyseus after scripts settle.
  // game.events "ready" can fire before the IIFE in network.js fully evaluates
  // in some browsers, so we use a short setTimeout instead.
  setTimeout(() => {
    if (typeof NET !== "undefined" && typeof NET.connect === "function") {
      NET.connect();
    } else {
      console.error("[game.js] NET.connect not available — check network.js loaded correctly");
      const wm = document.getElementById("waiting-msg");
      if (wm) wm.textContent = "Error: network.js failed to load.";
    }
  }, 100);
});
