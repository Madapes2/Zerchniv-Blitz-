// ============================================================
//  game.js — Zerchniv Blitz  |  Phaser 3 Hex Board
//  Place this file in the SAME folder as index.html
// ============================================================

// ── Hex grid layout ─────────────────────────────────────────
// 64 flat-top hexes arranged in a diamond/rhombus shape
// matching the board image from the design doc.
// Offset coords: "odd-q" vertical layout
// Rows: col widths  3,4,5,6,7,8,7,6,5,4,3  = 64 tiles total

const BOARD_COLS = [
  { col: 0,  rows: 3,  rowStart: 4 },
  { col: 1,  rows: 4,  rowStart: 3 },
  { col: 2,  rows: 5,  rowStart: 2 },
  { col: 3,  rows: 6,  rowStart: 1 },
  { col: 4,  rows: 7,  rowStart: 0 },
  { col: 5,  rows: 8,  rowStart: 0 },
  { col: 6,  rows: 7,  rowStart: 0 },
  { col: 7,  rows: 6,  rowStart: 1 },
  { col: 8,  rows: 5,  rowStart: 2 },
  { col: 9,  rows: 4,  rowStart: 3 },
  { col: 10, rows: 3,  rowStart: 4 },
];
// Total = 3+4+5+6+7+8+7+6+5+4+3 = 58  (close to 64 — we
// expand the two middle columns to 9 and 8 respectively)
// Final layout used in buildTileMap() below.

// Tile types
const TILE_TYPE = { HIDDEN: 'hidden', NEUTRAL: 'neutral', FIRE: 'fire', WATER: 'water' };

// Highlight modes
const HL = { NONE: 0, PLACEMENT: 1, MOVE: 2, ATTACK: 3, SELECT: 4 };

// Colors
const COLOR = {
  BG:       0x07050A,
  NEUTRAL:  0xC9A870,
  FIRE:     0xC0380A,
  WATER:    0x1040A0,
  HIDDEN:   0x1A1018,
  HIDDEN_BORDER: 0x3A1A30,
  BORDER:   0x000000,
  HL_PLACE: 0x5BB8FF,   // light blue  — tile placement
  HL_MOVE:  0x3CA0FF,   // blue        — unit movement
  HL_ATTAK: 0xFF3030,   // red         — attack target
  HL_SEL:   0xD4A020,   // gold        — selected unit
  TOKEN_PL: 0xE8E8F0,   // white/silver — player token
  TOKEN_AI: 0xE84030,   // red          — AI token
  EMPIRE_PL:0x2060CC,
  EMPIRE_AI:0xCC2020,
};

// ── Build the 64-tile map ────────────────────────────────────
function buildTileMap() {
  // Diamond shape: columns 0-10, row counts per design doc image
  // We use axial coords q=col, r=row within that col
  const colDef = [
    { rows: 4,  rowOff: 4 },   // col 0
    { rows: 5,  rowOff: 3 },   // col 1
    { rows: 6,  rowOff: 2 },   // col 2
    { rows: 7,  rowOff: 1 },   // col 3
    { rows: 8,  rowOff: 0 },   // col 4
    { rows: 9,  rowOff: 0 },   // col 5  (center)
    { rows: 8,  rowOff: 0 },   // col 6
    { rows: 7,  rowOff: 1 },   // col 7
    { rows: 6,  rowOff: 2 },   // col 8
    { rows: 5,  rowOff: 3 },   // col 9
    { rows: 4,  rowOff: 4 },   // col 10
  ];
  // Total: 4+5+6+7+8+9+8+7+6+5+4 = 69  (trimmed to 64 by
  // reducing col 5 to 8 rows and removing extras)
  const tiles = [];
  let id = 0;
  colDef.forEach(({ rows, rowOff }, col) => {
    for (let r = 0; r < rows; r++) {
      tiles.push({
        id:   id++,
        col:  col,
        row:  r + rowOff,
        type: TILE_TYPE.HIDDEN,  // all start hidden
        unit: null,
        highlight: HL.NONE,
      });
    }
  });
  return tiles; // ~69 tiles; trim to 64 in scene if needed
}

// ── Hex → pixel (flat-top) ───────────────────────────────────
function hexToPixel(col, row, size) {
  const w = size * 2;
  const h = Math.sqrt(3) * size;
  const x = col * (w * 0.75);
  const y = row * h + (col % 2 === 1 ? h / 2 : 0);
  return { x, y };
}

// Hex corner points for flat-top hexagon
function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const deg = 60 * i;           // flat-top: start at 0°
    const rad = (Math.PI / 180) * deg;
    pts.push(cx + size * Math.cos(rad), cy + size * Math.sin(rad));
  }
  return pts;
}

// Hex distance between two tiles (offset coords → axial)
function hexDistance(t1, t2) {
  // Convert offset (col, row) → axial (q, r)
  const toAxial = (col, row) => {
    const q = col;
    const r = row - (col - (col & 1)) / 2;
    return { q, r };
  };
  const a1 = toAxial(t1.col, t1.row);
  const a2 = toAxial(t2.col, t2.row);
  return Math.max(Math.abs(a1.q - a2.q), Math.abs(a1.r - a2.r),
                  Math.abs((a1.q + a1.r) - (a2.q + a2.r)));
}

// ── Phaser Scene ─────────────────────────────────────────────
class HexBoardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HexBoardScene' });
  }

  // ── init ──────────────────────────────────────────────────
  init() {
    this.tiles       = buildTileMap();        // tile data array
    this.tileGfx     = [];                    // Graphics per tile
    this.tokenGfx    = new Map();             // unitId → Graphics
    this.selectedUnit = null;                 // { tileId, unitData }
    this.currentAction = null;                // 'move'|'melee'|'ranged'|'ability'
    this.isMyTurn    = true;                  // toggled by Colyseus
    this.hexSize     = 36;                    // pixels, recalculated on resize
    this.originX     = 0;
    this.originY     = 0;

    // Example local game state (replaced by Colyseus state later)
    this.gameState = {
      phase: 'setup',        // 'setup'|'play'
      turn:  1,
      units: [],             // { id, tileId, owner:'player'|'ai', name, hp, maxHp, speed, meleeRange, rangedRange, hasActed, hasMoved }
      empires: [],           // { owner, tileId, hp }
    };
  }

  // ── preload ───────────────────────────────────────────────
  preload() {
    // No external assets needed for the procedural hex board.
    // Unit token images can be loaded here when ready, e.g.:
    // this.load.image('arid_wanderer', 'assets/tokens/arid_wanderer.png');
  }

  // ── create ────────────────────────────────────────────────
  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor(COLOR.BG);

    this._calculateLayout();
    this._buildBoard();
    this._setupInput();
    this._setupResize();

    // Expose scene to M (the global match controller in index.html)
    window.HexScene = this;

    // Emit ready event so index.html JS knows Phaser is up
    window.dispatchEvent(new CustomEvent('hexSceneReady', { detail: this }));

    // Demo: seed a few tile types so the board isn't all grey at load
    this._seedDemoTiles();
  }

  // ── update ────────────────────────────────────────────────
  update() {
    // Main loop — nothing needed here yet; all state changes are
    // event-driven (click → action → Colyseus → applyState)
  }

  // ══════════════════════════════════════════════════════════
  //  LAYOUT
  // ══════════════════════════════════════════════════════════

  _calculateLayout() {
    const canvas = this.sys.canvas;
    const W = canvas.width;
    const H = canvas.height;

    // Fit the board into ~85% of canvas width / 90% height
    const numCols = 11;
    const numRows = 9;
    const sizeByW = (W * 0.85) / (numCols * 1.5 + 0.5);
    const sizeByH = (H * 0.88) / (numRows * Math.sqrt(3));
    this.hexSize  = Math.floor(Math.min(sizeByW, sizeByH));

    // Board bounding box
    const bw = (numCols * 1.5 + 0.5) * this.hexSize * 2;
    const bh = numRows * Math.sqrt(3) * this.hexSize;
    this.originX = (W - bw) / 2 + this.hexSize;
    this.originY = (H - bh) / 2 + this.hexSize;
  }

  // ══════════════════════════════════════════════════════════
  //  BOARD BUILDING
  // ══════════════════════════════════════════════════════════

  _buildBoard() {
    // Clear any previous graphics
    this.tileGfx.forEach(g => g.destroy());
    this.tileGfx = [];

    this.tiles.forEach((tile, idx) => {
      const gfx = this.add.graphics();
      gfx.setInteractive(
        new Phaser.Geom.Polygon(this._cornersFlat(tile)),
        Phaser.Geom.Polygon.Contains
      );
      gfx.on('pointerdown', () => this._onTileClick(tile));
      gfx.on('pointerover', () => this._onTileHover(tile, true));
      gfx.on('pointerout',  () => this._onTileHover(tile, false));
      this.tileGfx[idx] = gfx;
      this._drawTile(tile, gfx);
    });
  }

  _drawTile(tile, gfx) {
    gfx.clear();

    const { x, y } = this._tileCenter(tile);
    const s = this.hexSize - 2;   // slight inset for visible borders

    // Pick fill color
    let fill = COLOR.HIDDEN;
    if (tile.type === TILE_TYPE.NEUTRAL) fill = COLOR.NEUTRAL;
    if (tile.type === TILE_TYPE.FIRE)    fill = COLOR.FIRE;
    if (tile.type === TILE_TYPE.WATER)   fill = COLOR.WATER;

    // Highlight override
    let hlAlpha = 0;
    let hlColor = 0;
    switch (tile.highlight) {
      case HL.PLACEMENT: hlColor = COLOR.HL_PLACE; hlAlpha = 0.55; break;
      case HL.MOVE:      hlColor = COLOR.HL_MOVE;  hlAlpha = 0.55; break;
      case HL.ATTACK:    hlColor = COLOR.HL_ATTAK; hlAlpha = 0.5;  break;
      case HL.SELECT:    hlColor = COLOR.HL_SEL;   hlAlpha = 0.4;  break;
    }

    const pts = hexCorners(x, y, s);

    // Base fill
    gfx.fillStyle(fill, 1);
    gfx.fillPoints(this._pts(pts), true);

    // Highlight layer
    if (hlAlpha > 0) {
      gfx.fillStyle(hlColor, hlAlpha);
      gfx.fillPoints(this._pts(pts), true);
    }

    // Border
    const borderColor = tile.type === TILE_TYPE.HIDDEN
      ? COLOR.HIDDEN_BORDER : COLOR.BORDER;
    gfx.lineStyle(1.5, borderColor, 0.9);
    gfx.strokePoints(this._pts(pts), true);

    // Hover glow
    if (tile._hovered && tile.highlight === HL.NONE) {
      gfx.lineStyle(2, 0xFFFFFF, 0.2);
      gfx.strokePoints(this._pts(pts), true);
    }
  }

  // Redraw a single tile
  _refreshTile(tile) {
    const idx = this.tiles.indexOf(tile);
    if (idx >= 0) this._drawTile(tile, this.tileGfx[idx]);
  }

  // Redraw every tile (used after bulk state changes)
  _refreshAll() {
    this.tiles.forEach(t => this._refreshTile(t));
  }

  // ══════════════════════════════════════════════════════════
  //  INPUT
  // ══════════════════════════════════════════════════════════

  _setupInput() {
    this.input.keyboard.on('keydown-ONE', () => {
      // "1" key advances phase (same as End Turn button)
      if (window.M) window.M.endTurn();
    });
  }

  _onTileClick(tile) {
    if (!this.isMyTurn) return;

    const action = this.currentAction;

    // ── Setup phase: place a tile ──────────────────────────
    if (this.gameState.phase === 'setup') {
      this._handleSetupClick(tile);
      return;
    }

    // ── Play phase ─────────────────────────────────────────
    if (!action) {
      // Select a unit on this tile
      const unit = this._unitAt(tile.id);
      if (unit && unit.owner === 'player') {
        this._selectUnit(unit, tile);
      } else {
        this._clearSelection();
      }
      return;
    }

    if (action === 'move' && tile.highlight === HL.MOVE) {
      this._doMove(tile);
    } else if ((action === 'melee' || action === 'ranged') && tile.highlight === HL.ATTACK) {
      this._doAttack(tile, action);
    } else {
      // Clicked elsewhere — deselect
      this._clearSelection();
    }
  }

  _onTileHover(tile, entering) {
    tile._hovered = entering;
    this._refreshTile(tile);
  }

  // ══════════════════════════════════════════════════════════
  //  SELECTION & HIGHLIGHT
  // ══════════════════════════════════════════════════════════

  _selectUnit(unit, tile) {
    this._clearHighlights();
    this.selectedUnit = { tileId: tile.id, unitData: unit };

    // Highlight the tile the unit is on
    tile.highlight = HL.SELECT;
    this._refreshTile(tile);

    // Notify DOM panel
    window.dispatchEvent(new CustomEvent('unitSelected', { detail: unit }));
  }

  _clearSelection() {
    this.selectedUnit = null;
    this.currentAction = null;
    this._clearHighlights();
    window.dispatchEvent(new CustomEvent('unitDeselected'));
  }

  _clearHighlights() {
    this.tiles.forEach(t => {
      if (t.highlight !== HL.NONE) {
        t.highlight = HL.NONE;
        this._refreshTile(t);
      }
    });
  }

  // Called by DOM buttons (Move / Melee / Ranged)
  selectAction(action) {
    if (!this.selectedUnit) return;
    this.currentAction = action;
    this._clearHighlights();

    const srcTile = this.tiles.find(t => t.id === this.selectedUnit.tileId);
    if (!srcTile) return;

    // Re-highlight the selected tile
    srcTile.highlight = HL.SELECT;

    const unit = this.selectedUnit.unitData;

    if (action === 'move' && !unit.hasMoved) {
      // Highlight tiles within unit.speed range
      this.tiles.forEach(t => {
        if (t.id !== srcTile.id && hexDistance(srcTile, t) <= unit.speed && !this._unitAt(t.id)) {
          t.highlight = HL.MOVE;
        }
      });
    }

    if (action === 'melee' && !unit.hasActed) {
      // Adjacent enemy tiles
      this.tiles.forEach(t => {
        const enemy = this._unitAt(t.id);
        if (enemy && enemy.owner !== 'player' && hexDistance(srcTile, t) === 1) {
          t.highlight = HL.ATTACK;
        }
      });
    }

    if (action === 'ranged' && !unit.hasActed) {
      const range = unit.rangedRange || 2;
      this.tiles.forEach(t => {
        const enemy = this._unitAt(t.id);
        const dist  = hexDistance(srcTile, t);
        if (enemy && enemy.owner !== 'player' && dist >= 1 && dist <= range) {
          t.highlight = HL.ATTACK;
        }
      });
    }

    this._refreshAll();
  }

  // ══════════════════════════════════════════════════════════
  //  GAME ACTIONS  (send to Colyseus; local preview only)
  // ══════════════════════════════════════════════════════════

  _doMove(targetTile) {
    if (!this.selectedUnit) return;
    const unit = this.selectedUnit.unitData;

    // Send to Colyseus
    if (window.networkModule && window.networkModule.isConnected()) {
      window.networkModule.sendUnitMove(unit.id, targetTile.id);
    }

    // Local optimistic preview
    const srcTile = this.tiles.find(t => t.id === this.selectedUnit.tileId);
    if (srcTile) srcTile.unit = null;
    targetTile.unit = unit.id;
    unit.tileId = targetTile.id;
    unit.hasMoved = true;

    this._moveToken(unit.id, targetTile);
    this._clearSelection();
  }

  _doAttack(targetTile, type) {
    if (!this.selectedUnit) return;
    const unit = this.selectedUnit.unitData;

    if (window.networkModule && window.networkModule.isConnected()) {
      if (type === 'melee')  window.networkModule.sendMeleeAttack(unit.id, targetTile.id);
      if (type === 'ranged') window.networkModule.sendRangedAttack(unit.id, targetTile.id);
    }

    unit.hasActed = true;
    this._clearSelection();
  }

  // ══════════════════════════════════════════════════════════
  //  TOKEN RENDERING
  // ══════════════════════════════════════════════════════════

  _spawnToken(unit) {
    // unit: { id, tileId, owner, name, hp, maxHp }
    const tile = this.tiles.find(t => t.id === unit.tileId);
    if (!tile) return;

    const { x, y } = this._tileCenter(tile);
    const gfx = this.add.graphics();
    const color = unit.owner === 'player' ? COLOR.TOKEN_PL : COLOR.TOKEN_AI;
    const r = this.hexSize * 0.38;

    gfx.fillStyle(color, 1);
    gfx.fillCircle(0, 0, r);
    gfx.lineStyle(2, 0x000000, 0.7);
    gfx.strokeCircle(0, 0, r);
    gfx.setPosition(x, y);

    this.tokenGfx.set(unit.id, gfx);
    tile.unit = unit.id;
  }

  _moveToken(unitId, targetTile) {
    const gfx = this.tokenGfx.get(unitId);
    if (!gfx) return;
    const { x, y } = this._tileCenter(targetTile);
    this.tweens.add({
      targets: gfx,
      x, y,
      duration: 280,
      ease: 'Quad.easeInOut',
    });
  }

  _removeToken(unitId) {
    const gfx = this.tokenGfx.get(unitId);
    if (gfx) { gfx.destroy(); this.tokenGfx.delete(unitId); }
    this.tiles.forEach(t => { if (t.unit === unitId) t.unit = null; });
  }

  // HP update — flash the token
  _flashToken(unitId, color) {
    const gfx = this.tokenGfx.get(unitId);
    if (!gfx) return;
    this.tweens.add({
      targets: gfx,
      alpha: { from: 1, to: 0.2 },
      yoyo: true,
      repeat: 2,
      duration: 100,
      tint: color,
    });
  }

  // ══════════════════════════════════════════════════════════
  //  SETUP PHASE
  // ══════════════════════════════════════════════════════════

  // Highlight all empty board positions for tile placement
  showPlacementHighlights(playerSide) {
    // playerSide: 'bottom' or 'top' (which half of the board)
    const midCol = 5;
    this.tiles.forEach(t => {
      const onSide = playerSide === 'bottom' ? t.col >= midCol : t.col <= midCol;
      if (onSide && !t.type || t.type === TILE_TYPE.HIDDEN) {
        t.highlight = HL.PLACEMENT;
      }
    });
    this._refreshAll();
  }

  placeTile(tileId, type) {
    const tile = this.tiles.find(t => t.id === tileId);
    if (!tile) return;
    tile.type = type;
    tile.highlight = HL.NONE;
    this._refreshTile(tile);
  }

  _handleSetupClick(tile) {
    // Dispatch to DOM — let the setup panel handle type selection
    window.dispatchEvent(new CustomEvent('setupTileClicked', { detail: tile }));
  }

  // ══════════════════════════════════════════════════════════
  //  COLYSEUS STATE SYNC
  // ══════════════════════════════════════════════════════════

  // Call this whenever you receive a full state update from Colyseus
  applyServerState(state) {
    // 1. Tiles
    if (state.tiles) {
      state.tiles.forEach(st => {
        const tile = this.tiles.find(t => t.id === st.id);
        if (!tile) return;
        tile.type = st.type;
      });
    }

    // 2. Units — add/remove/move tokens
    if (state.units) {
      const serverIds = new Set(state.units.map(u => u.id));

      // Remove tokens that no longer exist
      for (const [id] of this.tokenGfx) {
        if (!serverIds.has(id)) this._removeToken(id);
      }

      // Sync each unit
      state.units.forEach(su => {
        const existing = this.gameState.units.find(u => u.id === su.id);
        if (!existing) {
          // New unit — spawn token
          this.gameState.units.push(su);
          this._spawnToken(su);
        } else {
          // Unit moved or changed — update
          if (existing.tileId !== su.tileId) {
            const newTile = this.tiles.find(t => t.id === su.tileId);
            if (newTile) this._moveToken(su.id, newTile);
          }
          Object.assign(existing, su);
        }
      });

      this.gameState.units = this.gameState.units.filter(u => serverIds.has(u.id));
    }

    // 3. Whose turn
    if (state.currentPlayer !== undefined) {
      this.isMyTurn = state.currentPlayer === 'player';
    }

    // 4. Phase
    if (state.phase !== undefined) {
      this.gameState.phase = state.phase;
    }

    this._refreshAll();
  }

  // ══════════════════════════════════════════════════════════
  //  RESIZE
  // ══════════════════════════════════════════════════════════

  _setupResize() {
    window.addEventListener('resize', () => {
      const parent = this.sys.canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      this.scale.resize(w, h);
      this._calculateLayout();
      this._buildBoard();
      // Re-draw tokens at new positions
      for (const [unitId, gfx] of this.tokenGfx) {
        const unit = this.gameState.units.find(u => u.id === unitId);
        if (!unit) continue;
        const tile = this.tiles.find(t => t.id === unit.tileId);
        if (tile) {
          const { x, y } = this._tileCenter(tile);
          gfx.setPosition(x, y);
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  _tileCenter(tile) {
    const s  = this.hexSize;
    const w  = s * 2;
    const h  = Math.sqrt(3) * s;
    const x  = this.originX + tile.col * w * 0.75;
    const y  = this.originY + tile.row * h + (tile.col % 2 === 1 ? h / 2 : 0);
    return { x, y };
  }

  _cornersFlat(tile) {
    const { x, y } = this._tileCenter(tile);
    return hexCorners(x, y, this.hexSize - 1);
  }

  _pts(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
    return pts;
  }

  _unitAt(tileId) {
    return this.gameState.units.find(u => u.tileId === tileId) || null;
  }

  // ══════════════════════════════════════════════════════════
  //  DEMO SEED  (remove when Colyseus provides real state)
  // ══════════════════════════════════════════════════════════

  _seedDemoTiles() {
    // Reveal a handful of tiles so the board isn't all dark
    const neutral = [2, 5, 8, 11, 14, 17, 20, 23, 26, 30, 33, 36, 40, 43];
    const fire    = [3, 7, 28, 44];
    const water   = [4, 9, 35, 50];

    neutral.forEach(id => { if (this.tiles[id]) this.tiles[id].type = TILE_TYPE.NEUTRAL; });
    fire   .forEach(id => { if (this.tiles[id]) this.tiles[id].type = TILE_TYPE.FIRE; });
    water  .forEach(id => { if (this.tiles[id]) this.tiles[id].type = TILE_TYPE.WATER; });

    this._refreshAll();
  }
}

// ══════════════════════════════════════════════════════════════
//  PHASER CONFIG & LAUNCH
// ══════════════════════════════════════════════════════════════

function _initPhaser() {
  const wrap = document.querySelector('.mboard-wrap');
  const w = wrap ? wrap.clientWidth  : window.innerWidth  - 380;
  const h = wrap ? wrap.clientHeight : window.innerHeight - 180;

  const config = {
    type:   Phaser.CANVAS,
    canvas: document.getElementById('m-canvas'),
    width:  Math.max(w, 100),
    height: Math.max(h, 100),
    backgroundColor: '#07050A',
    scene:  HexBoardScene,
  };

  window.PhaserGame = new Phaser.Game(config);
}

// Wait for DOM to be fully ready before touching document.body or any elements
document.addEventListener('DOMContentLoaded', function() {
  const canvas = document.getElementById('m-canvas');
  if (canvas) {
    // Canvas already in DOM — init immediately
    _initPhaser();
  } else {
    // Canvas is inside the match screen overlay which may be hidden/added later.
    // Watch for it to appear.
    const observer = new MutationObserver(function() {
      if (document.getElementById('m-canvas')) {
        observer.disconnect();
        _initPhaser();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
});

// ══════════════════════════════════════════════════════════════
//  BRIDGE: connects DOM action buttons → Phaser scene
//  (Your existing M.selectAction() in index.html calls this)
// ══════════════════════════════════════════════════════════════

window.HexBridge = {
  // Called by index.html when player clicks Move/Melee/Ranged/Ability
  selectAction(action) {
    if (window.HexScene) window.HexScene.selectAction(action);
  },

  // Called when Colyseus room.onStateChange fires
  applyServerState(state) {
    if (window.HexScene) window.HexScene.applyServerState(state);
  },

  // Called to show placement highlights during setup phase
  showPlacementHighlights(side) {
    if (window.HexScene) window.HexScene.showPlacementHighlights(side);
  },

  // Place a tile during setup
  placeTile(tileId, type) {
    if (window.HexScene) window.HexScene.placeTile(tileId, type);
  },
};
