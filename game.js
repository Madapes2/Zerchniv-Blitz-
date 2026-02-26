// ============================================================
//  game.js — Zerchniv Blitz  |  Phaser 3 Hex Board
//  Place this file in the SAME folder as index.html
// ============================================================

// ── Hex grid layout ─────────────────────────────────────────
// POINTY-TOP hexes in ROWS forming a sideways diamond.
// Wide at center, tapers to points on left and right.
// Row layout (cols per row), symmetric top/bottom:
//   rows 0,10: 3 cols   rows 1,9: 4 cols   rows 2,8: 5 cols
//   rows 3,7:  6 cols   rows 4,6: 7 cols   row 5:    8 cols (center)
// Total = 3+4+5+6+7+8+7+6+5+4+3 = 58 tiles

const BOARD_ROWS = [
  { cols: 3, colOff: 3 },  // row 0  (3 tiles, starts at col 3)
  { cols: 4, colOff: 2 },  // row 1
  { cols: 5, colOff: 2 },  // row 2
  { cols: 6, colOff: 1 },  // row 3
  { cols: 7, colOff: 1 },  // row 4
  { cols: 8, colOff: 0 },  // row 5  (widest)
  { cols: 7, colOff: 1 },  // row 6
  { cols: 6, colOff: 1 },  // row 7
  { cols: 5, colOff: 2 },  // row 8
  { cols: 4, colOff: 2 },  // row 9
  { cols: 3, colOff: 3 },  // row 10
];

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
  TOKEN_OPP: 0xE84030,  // red          — opponent token
  EMPIRE_PL:0x2060CC,
  EMPIRE_OPP:0xCC2020,
};

// ── Build the tile map ─────────────────────────────────────────────
function buildTileMap() {
  const tiles = [];
  let id = 0;
  BOARD_ROWS.forEach(({ cols, colOff }, row) => {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        id,
        row,
        col: c + colOff,    // absolute column in the full grid
        localCol: c,        // position within this row (0-based)
        type: TILE_TYPE.HIDDEN,
        unit: null,
        highlight: HL.NONE,
      });
      id++;
    }
  });
  return tiles;  // 58 tiles total
}

// ── Hex → pixel (POINTY-TOP) ───────────────────────────────────────
// Pointy-top hexes: rows are horizontal, cols stagger vertically.
// size = hex radius (center to corner)
function hexToPixel(col, row, size) {
  const w = Math.sqrt(3) * size;   // pointy-top hex width
  const h = size * 2;               // pointy-top hex height
  const x = col * w + (row % 2 === 1 ? w / 2 : 0);
  const y = row * h * 0.75;
  return { x, y };
}

// Hex corner points for POINTY-TOP hexagon (30° start)
function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const deg = 60 * i + 30;       // pointy-top: start at 30°
    const rad = (Math.PI / 180) * deg;
    pts.push(cx + size * Math.cos(rad), cy + size * Math.sin(rad));
  }
  return pts;
}

// Hex distance (offset "even-r" coords → cube coords)
// For pointy-top hexes staggered by row (even-r offset)
function hexDistance(t1, t2) {
  const toAxial = (col, row) => {
    const q = col - (row - (row & 1)) / 2;
    const r = row;
    return { q, r, s: -q - r };
  };
  const a1 = toAxial(t1.col, t1.row);
  const a2 = toAxial(t2.col, t2.row);
  return Math.max(
    Math.abs(a1.q - a2.q),
    Math.abs(a1.r - a2.r),
    Math.abs(a1.s - a2.s)
  );
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
    this.isMyTurn    = false;                 // set by server on game_start/phase_change
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

    // Board starts fully hidden — server state will reveal tiles
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

    // Pointy-top hex dimensions:
    //   width  = sqrt(3) * size
    //   height = 2 * size
    //   row pitch (vertical) = size * 1.5
    //   col pitch (horizontal) = sqrt(3) * size
    //   widest row has 8 cols + 0.5 stagger = 8.5 widths
    //   11 rows tall = 10 * 1.5 * size + size = 16 * size

    const maxCols = 8.5;   // widest row (row 5) with stagger offset
    const numRows = 11;

    const sizeByW = (W * 0.88) / (maxCols * Math.sqrt(3));
    const sizeByH = (H * 0.88) / (numRows * 1.5 + 0.5);
    this.hexSize  = Math.floor(Math.min(sizeByW, sizeByH));

    const s = this.hexSize;
    const hexW = Math.sqrt(3) * s;
    const hexH = 2 * s;

    // Total board pixel size
    const bw = maxCols * hexW;
    const bh = (numRows - 1) * hexH * 0.75 + hexH;

    this.originX = (W - bw) / 2;
    this.originY = (H - bh) / 2;
  }

  // ══════════════════════════════════════════════════════════
  //  BOARD BUILDING
  // ══════════════════════════════════════════════════════════

  _buildBoard() {
    // Clear any previous graphics
    this.tileGfx.forEach(g => g.destroy());
    this.tileGfx = [];
    if (this._borderGfx) { this._borderGfx.destroy(); this._borderGfx = null; }

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

    // Border — always draw grid lines so the diamond shape is visible
    const borderAlpha = tile.type === TILE_TYPE.HIDDEN ? 0.35 : 0.85;
    const borderColor = tile.type === TILE_TYPE.HIDDEN ? 0x555566 : 0x000000;
    gfx.lineStyle(1, borderColor, borderAlpha);
    gfx.strokePoints(this._pts(pts), true);

    // Hover glow
    if (tile._hovered && tile.highlight === HL.NONE) {
      gfx.lineStyle(2, 0xFFFFFF, 0.25);
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

    if (action === 'deploy' && tile.highlight === HL.PLACEMENT) {
      this._doDeploy(tile);
    } else if (action === 'move' && tile.highlight === HL.MOVE) {
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
    if (!this.isMyTurn) return;   // hard block — not your turn
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

  _doDeploy(targetTile) {
    const card = this.pendingDeployCard;
    if (!card) return;

    // Send to server
    if (typeof NET !== 'undefined') {
      NET.deployUnit(card.id, targetTile.id);
    } else if (window.networkModule && window.networkModule.isConnected()) {
      window.networkModule.deployUnit(card.id, targetTile.id);
    }

    // Optimistic local preview — server will confirm via state update
    const previewUnit = {
      id: 'pending_' + card.id + '_' + Date.now(),
      tileId: targetTile.id,
      owner: 'player',
      name: card.name,
      hp: card.hp,
      maxHp: card.hp,
      speed: card.speed || 1,
      deployRest: true,   // just deployed — can't act this turn
      hasMoved: true,
      hasActed: true,
    };
    this.gameState.units.push(previewUnit);
    this._spawnToken(previewUnit);

    this.pendingDeployCard = null;
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
    const color = unit.owner === 'player' ? COLOR.TOKEN_PL : COLOR.TOKEN_OPP;
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
    // playerSide: 'right' or 'left' (which half of the board)
    // In a sideways diamond, cols 0-3 = left side, cols 4-7 = right side
    const midRow = 5;
    this.tiles.forEach(t => {
      const onSide = playerSide === 'right' ? t.col >= midRow : t.col < midRow;
      if (t.type === TILE_TYPE.HIDDEN) {
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

  // Show valid deployment tiles around the player's empire
  showDeployHighlights(empireTileId) {
    this._clearHighlights();
    const empireTile = this.tiles.find(t => t.id === empireTileId);
    if (!empireTile) return;
    this.tiles.forEach(t => {
      if (
        hexDistance(empireTile, t) <= 2 &&  // within 2 of empire
        t.id !== empireTileId &&             // not the empire itself
        !this._unitAt(t.id) &&              // not already occupied
        t.type !== TILE_TYPE.HIDDEN          // must be a revealed tile
      ) {
        t.highlight = HL.PLACEMENT;
      }
    });
    this._refreshAll();
  }

  // Called when player clicks "Deploy Unit" — awaits tile selection
  beginDeploy(card) {
    if (!this.isMyTurn) return;
    this.pendingDeployCard = card;
    this.currentAction = 'deploy';
    // Find our empire tile
    const empire = this.gameState.empires.find(e => e.owner === 'player');
    if (empire) {
      this.showDeployHighlights(empire.tileId);
    } else {
      // Fallback: highlight all empty revealed tiles
      this.tiles.forEach(t => {
        if (!this._unitAt(t.id) && t.type !== TILE_TYPE.HIDDEN) t.highlight = HL.PLACEMENT;
      });
      this._refreshAll();
    }
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
          // Unit moved or changed — update token position
          if (existing.tileId !== su.tileId) {
            // Clear old tile occupancy
            const oldTile = this.tiles.find(t => t.id === existing.tileId);
            if (oldTile) oldTile.unit = null;
            const newTile = this.tiles.find(t => t.id === su.tileId);
            if (newTile) {
              newTile.unit = su.id;
              this._moveToken(su.id, newTile);
            }
          }
          Object.assign(existing, su);
        }
        // Always ensure the tile knows who is on it (survives board rebuilds)
        const occupiedTile = this.tiles.find(t => t.id === su.tileId);
        if (occupiedTile) occupiedTile.unit = su.id;
      });

      this.gameState.units = this.gameState.units.filter(u => serverIds.has(u.id));
    }

    // 3. Whose turn
    if (state.currentPlayer !== undefined) {
      const wasMyTurn = this.isMyTurn;
      this.isMyTurn = state.currentPlayer === 'player';
      // When turn changes away from us, clear any pending selection/action
      if (wasMyTurn && !this.isMyTurn) {
        this._clearSelection();
      }
      // Update the "Opponent" label to show whose turn it is
      const oppLabel = document.getElementById('m-ai-name');
      if (oppLabel) oppLabel.textContent = this.isMyTurn ? 'Opponent' : 'Opponent ◀ TURN';
    }

    // 4. Phase
    if (state.phase !== undefined) {
      this.gameState.phase = state.phase;
      // On new turn start, reset hasMoved/hasActed flags on our units
      if (state.phase === 'main') {
        this.gameState.units.forEach(u => {
          if (u.owner === 'player') {
            u.hasMoved  = false;
            u.hasActed  = false;
            u.deployRest = false;
          }
        });
      }
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
      this._resyncTokenPositions();
    });
  }

  // Re-draw all tokens at correct positions (after resize or board rebuild)
  _resyncTokenPositions() {
    for (const [unitId, gfx] of this.tokenGfx) {
      const unit = this.gameState.units.find(u => u.id === unitId);
      if (!unit) continue;
      const tile = this.tiles.find(t => t.id === unit.tileId);
      if (tile) {
        const { x, y } = this._tileCenter(tile);
        gfx.setPosition(x, y);
        // Re-sync tile occupancy after board rebuild
        tile.unit = unitId;
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  _tileCenter(tile) {
    const s   = this.hexSize;
    const hexW = Math.sqrt(3) * s;
    const hexH = 2 * s;

    // Pointy-top even-r offset:
    // x = col * hexW + (row is odd ? hexW/2 : 0)
    // y = row * hexH * 0.75
    const x = this.originX + tile.col * hexW + (tile.row % 2 === 1 ? hexW / 2 : 0);
    const y = this.originY + tile.row * hexH * 0.75;
    return { x, y };
  }

  _cornersFlat(tile) {
    const { x, y } = this._tileCenter(tile);
    // Use hexSize - 1 for a 1px gap between tiles
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

