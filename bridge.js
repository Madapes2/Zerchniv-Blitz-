/**
 * ═══════════════════════════════════════════════════════════════
 *  bridge.js — Zerchniv Blitz
 *  Place alongside index.html, network.js, and game.js
 *
 *  Load order in index.html <head>:
 *    1. colyseus sdk (unpkg)
 *    2. phaser (cdnjs)
 *    3. network.js
 *    4. bridge.js   ← this file
 *    5. game.js
 *
 *  WHAT THIS DOES
 *  ──────────────
 *  network.js calls M._setEssence, M._setUnits, M._setPhase etc.
 *  game.js (Phaser) needs tile/unit data to render the board.
 *  This file wires them together without touching either file.
 * ═══════════════════════════════════════════════════════════════
 */

document.addEventListener('DOMContentLoaded', function () {

  // ── Wait for M to exist (defined in index.html scripts) ──────
  // M is the match engine object in index.html. We patch it by
  // adding the methods network.js expects, then forwarding to Phaser.

  function patchM() {
    if (typeof M === 'undefined') {
      // M not ready yet — retry in 100ms
      setTimeout(patchM, 100);
      return;
    }

    // ── 1. ESSENCE ────────────────────────────────────────────
    // network.js calls M._setEssence({ n, f, w })
    const _origSetEssence = M._setEssence;
    M._setEssence = function (data) {
      // Update DOM (existing behaviour if it was already defined)
      if (_origSetEssence) _origSetEssence.call(M, data);

      // Update HUD directly as fallback
      const en = document.getElementById('m-ess-n');
      const ef = document.getElementById('m-ess-f');
      const ew = document.getElementById('m-ess-w');
      if (en) en.textContent = data.n ?? 0;
      if (ef) ef.textContent = data.f ?? 0;
      if (ew) ew.textContent = data.w ?? 0;
    };

    // ── 2. EMPIRE HP ─────────────────────────────────────────
    // network.js calls M._setEmpireHP('player'|'opponent', hp)
    const _origSetEmpireHP = M._setEmpireHP;
    M._setEmpireHP = function (side, hp) {
      if (_origSetEmpireHP) _origSetEmpireHP.call(M, side, hp);

      const max = 20;
      if (side === 'player') {
        const bar = document.getElementById('m-pl-bar');
        const num = document.getElementById('m-pl-hp');
        if (bar) bar.style.width = Math.max(0, (hp / max) * 100) + '%';
        if (num) num.textContent = hp;
      } else {
        const bar = document.getElementById('m-ai-bar');
        const num = document.getElementById('m-ai-hp');
        if (bar) bar.style.width = Math.max(0, (hp / max) * 100) + '%';
        if (num) num.textContent = hp;
      }
    };

    // ── 3. UNITS ─────────────────────────────────────────────
    // network.js calls M._setUnits(myUnits[], oppUnits[])
    const _origSetUnits = M._setUnits;
    M._setUnits = function (myUnits, oppUnits) {
      if (_origSetUnits) _origSetUnits.call(M, myUnits, oppUnits);

      // Update sidebar unit lists
      _renderUnitList('m-pl-units', myUnits);
      _renderUnitList('m-ai-units', oppUnits);

      // Forward to Phaser
      if (window.HexScene) {
        const allUnits = [
          ...myUnits.map(u => ({ ...u, owner: 'player' })),
          ...oppUnits.map(u => ({ ...u, owner: 'ai' })),
        ];
        window.HexScene.applyServerState({ units: allUnits });
      }
    };

    // ── 4. TILE STATE ────────────────────────────────────────
    // network.js calls M._applyTileState(tiles[])
    const _origApplyTileState = M._applyTileState;
    M._applyTileState = function (tiles) {
      if (_origApplyTileState) _origApplyTileState.call(M, tiles);

      // Forward to Phaser
      if (window.HexScene) {
        window.HexScene.applyServerState({ tiles });
      }
    };

    // ── 5. VALID MOVES ───────────────────────────────────────
    // network.js calls M._setValidMoves(unitId, tileIds[])
    const _origSetValidMoves = M._setValidMoves;
    M._setValidMoves = function (unitId, tileIds) {
      if (_origSetValidMoves) _origSetValidMoves.call(M, unitId, tileIds);

      if (window.HexScene) {
        window.HexScene._clearHighlights();
        tileIds.forEach(id => {
          const tile = window.HexScene.tiles.find(t => t.id === id);
          if (tile) tile.highlight = 2; // HL.MOVE
        });
        window.HexScene._refreshAll();
      }
    };

    // ── 6. VALID TARGETS ─────────────────────────────────────
    // network.js calls M._setValidTargets(unitId, tileIds[], mode)
    const _origSetValidTargets = M._setValidTargets;
    M._setValidTargets = function (unitId, tileIds, mode) {
      if (_origSetValidTargets) _origSetValidTargets.call(M, unitId, tileIds, mode);

      if (window.HexScene) {
        window.HexScene._clearHighlights();
        tileIds.forEach(id => {
          const tile = window.HexScene.tiles.find(t => t.id === id);
          if (tile) tile.highlight = 3; // HL.ATTACK
        });
        window.HexScene._refreshAll();
      }
    };

    // ── 7. HAND ──────────────────────────────────────────────
    // network.js calls M._setHand(cards[])
    const _origSetHand = M._setHand;
    M._setHand = function (cards) {
      if (_origSetHand) _origSetHand.call(M, cards);
      _renderHand(cards);
    };

    // network.js calls M._addCardToHand(card) for single draw
    const _origAddCardToHand = M._addCardToHand;
    M._addCardToHand = function (card) {
      if (_origAddCardToHand) _origAddCardToHand.call(M, card);

      // Append to existing hand
      const area = document.querySelector('.mhand-area');
      if (!area) return;
      area.appendChild(_makeHandCard(card));
    };

    // ── 8. DECK COUNTS ───────────────────────────────────────
    // network.js calls M._setDeckCounts({ unitDeck, blitzDeck, discard })
    const _origSetDeckCounts = M._setDeckCounts;
    M._setDeckCounts = function (counts) {
      if (_origSetDeckCounts) _origSetDeckCounts.call(M, counts);

      const udk  = document.getElementById('m-pl-udk');
      const bdk  = document.getElementById('m-pl-bdk');
      const disc = document.getElementById('m-pl-disc');
      if (udk)  udk.textContent  = counts.unitDeck  ?? 0;
      if (bdk)  bdk.textContent  = counts.blitzDeck ?? 0;
      if (disc) disc.textContent = counts.discard   ?? 0;
    };

    // ── 9. PHASE ─────────────────────────────────────────────
    // network.js calls M._setPhase(phase, turn, isMyTurn)
    const _origSetPhase = M._setPhase;
    M._setPhase = function (phase, turn, isMyTurn) {
      if (_origSetPhase) _origSetPhase.call(M, phase, turn, isMyTurn);

      // Update phase indicator pills
      ['standby', 'draw', 'main', 'end'].forEach(p => {
        const el = document.getElementById('m-ph-' + p);
        if (el) el.classList.toggle('on', p === phase);
      });

      // Update turn counter
      const turnEl = document.getElementById('m-turn');
      if (turnEl && turn) turnEl.textContent = turn;

      // Tell Phaser whose turn it is
      if (window.HexScene) {
        window.HexScene.isMyTurn = !!isMyTurn;
      }

      // During Draw phase, highlight deck buttons to prompt drawing
      _updateDrawPhaseUI(phase, isMyTurn);
    };

    // ── 10. INIT FROM SERVER ─────────────────────────────────
    // network.js calls M.initFromServer(state, mySeat) on game_start
    const _origInitFromServer = M.initFromServer;
    M.initFromServer = function (state, seat) {
      if (_origInitFromServer) _origInitFromServer.call(M, state, seat);

      // Expose seat to localEngine so turn order is correct per-client
      window._zbMySeat = seat;
      if (window.ZB && window.ZB.GS) window.ZB.GS.mySeat = seat;
      console.log('[BRIDGE] My seat:', seat);

      // Show match screen if not already visible
      const mscr = document.getElementById('mscr');
      if (mscr && !mscr.classList.contains('on')) {
        mscr.classList.add('on');
      }

      // Give Phaser a moment to size itself, then apply state
      setTimeout(() => {
        if (state) {
          // Resize Phaser to fit the now-visible canvas
          _resizePhaser();
          // Apply full initial state
          if (window.HexScene) window.HexScene.applyServerState(state);
        }
      }, 200);
    };

    // ── 11. COMBAT FLASH ─────────────────────────────────────
    // network.js calls M._flashCombat(attackerId, targetId, hit)
    const _origFlashCombat = M._flashCombat;
    M._flashCombat = function (attackerId, targetId, hit) {
      if (_origFlashCombat) _origFlashCombat.call(M, attackerId, targetId, hit);

      if (window.HexScene) {
        const color = hit ? 0xFF3030 : 0x888888;
        window.HexScene._flashToken(targetId, color);
      }
    };

    // ── 12. FOG REVEAL ───────────────────────────────────────
    // network.js calls M._revealTiles(tileIds[])
    const _origRevealTiles = M._revealTiles;
    M._revealTiles = function (tileIds) {
      if (_origRevealTiles) _origRevealTiles.call(M, tileIds);

      if (window.HexScene) {
        tileIds.forEach(id => {
          const tile = window.HexScene.tiles.find(t => t.id === id);
          // Revealed tiles that were hidden become neutral by default
          // The server should send a state_update with the real type
          if (tile && tile.type === 'hidden') tile.type = 'neutral';
        });
        window.HexScene._refreshAll();
      }
    };

    // ── 13. DRAW CARD (DOM button → server / local engine) ───
    M.drawCard = function (deckType) {
      // If local engine is running, let it handle everything
      if (window.ZB && window.ZB.GS && window.ZB.GS.started) {
        window.ZB.handleDrawCard(deckType);
        return;
      }
      // Server mode
      if (typeof NET !== 'undefined') {
        if (!M._isMyTurn()) { typeof mtoast === 'function' && mtoast('Not your turn!'); return; }
        NET.drawCard(deckType);
      }
    };

    // ── 14. END TURN (DOM button → server / local engine) ──────
    M.endTurn = function () {
      // If local engine is running, let it handle everything
      if (window.ZB && window.ZB.GS && window.ZB.GS.started) {
        window.ZB.handleEndTurn();
        return;
      }
      // Server mode
      if (typeof NET !== 'undefined') {
        if (!M._isMyTurn()) { typeof mtoast === 'function' && mtoast('Not your turn!'); return; }
        NET.endTurn();
      }
    };

    // ── 15. IS MY TURN ───────────────────────────────────────
    M._isMyTurn = function () {
      return window.HexScene ? window.HexScene.isMyTurn : false;
    };

    // ── 16. REDRAW ───────────────────────────────────────────
    M.redraw = function () {
      if (window.HexScene) window.HexScene._refreshAll();
    };

    // Rename "AI Commander" label to "Opponent" in the HUD
    const aiNameEl = document.getElementById('m-ai-name');
    if (aiNameEl && aiNameEl.textContent.includes('AI')) {
      aiNameEl.textContent = 'Opponent';
    }
    // Also catch any element with text "AI Commander"
    document.querySelectorAll('.mhud-lbl, .mbar-lbl, .emp-lbl').forEach(el => {
      if (el.textContent.trim() === 'AI Commander') el.textContent = 'Opponent';
    });

    // Rename "AI Commander" → "Opponent" anywhere it appears in the HUD
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0 && el.textContent.trim() === 'AI Commander') {
        el.textContent = 'Opponent';
      }
    });

    // Rename "AI Commander" → "Opponent" anywhere in the HUD
    setTimeout(() => {
      document.querySelectorAll('*').forEach(el => {
        if (!el.children.length && el.textContent.trim() === 'AI Commander') {
          el.textContent = 'Opponent';
        }
      });
    }, 500);

    console.log('[BRIDGE] M patched — all network.js → Phaser hooks active');
  }

  // ── DOM HELPERS ───────────────────────────────────────────────

  function _renderUnitList(elementId, units) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    if (!units || units.length === 0) {
      el.innerHTML = '<div style="font-size:.6rem;color:rgba(240,232,220,.25);padding:.3rem">No units on field</div>';
      return;
    }
    units.forEach(u => {
      const hpPct = Math.max(0, Math.round(((u.hp ?? u.maxHp ?? 1) / (u.maxHp ?? 1)) * 100));
      const row = document.createElement('div');
      row.className = 'uip-row';
      row.innerHTML = `
        <div class="uip-data">
          <div class="uip-nm">${u.name || u.id}</div>
          <div class="uip-hb"><div class="uip-hbf" style="width:${hpPct}%"></div></div>
          <div class="uip-hp">${u.hp ?? '?'}/${u.maxHp ?? '?'} HP</div>
        </div>
      `;
      // Click to select unit on board
      row.addEventListener('click', () => {
        if (window.HexScene) {
          const unitData = window.HexScene.gameState.units.find(gu => gu.id === u.id);
          const tile = unitData
            ? window.HexScene.tiles.find(t => t.id === unitData.tileId)
            : null;
          if (unitData && tile) window.HexScene._selectUnit(unitData, tile);
        }
      });
      el.appendChild(row);
    });
  }

  function _renderHand(cards) {
    const area = document.querySelector('.mhand-area');
    if (!area) return;

    // Clear existing cards but keep the label
    const label = area.querySelector('.mhand-lbl');
    area.innerHTML = '';
    if (label) area.appendChild(label);

    if (!cards || cards.length === 0) return;

    cards.forEach(card => {
      area.appendChild(_makeHandCard(card));
    });
  }

  function _makeHandCard(card) {
    const el = document.createElement('div');
    el.className = 'mhcard';
    el.dataset.cardId = card.id;

    // Check affordability against current essence
    const essN = parseInt(document.getElementById('m-ess-n')?.textContent || '0');
    const essF = parseInt(document.getElementById('m-ess-f')?.textContent || '0');
    const essW = parseInt(document.getElementById('m-ess-w')?.textContent || '0');
    const totalEss = essN + essF + essW;
    const cost = (card.costNeutral ?? 0) + (card.costFire ?? 0) + (card.costWater ?? 0);
    if (totalEss >= cost) el.classList.add('playable');

    el.innerHTML = `
      ${card.imageUrl ? `<img src="${card.imageUrl}" alt="${card.name}">` : `<div style="width:100%;height:100%;background:rgba(139,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;padding:4px;text-align:center">${card.name}</div>`}
      <div class="mhcard-cost">${cost}</div>
    `;

    // Click → show card detail popup
    el.addEventListener('click', () => _showCardPopup(card));

    return el;
  }

  function _showCardPopup(card) {
    const pop = document.querySelector('.mcdpop');
    if (!pop) return;

    // Fill in card details
    const nameEl  = pop.querySelector('.mcdpop-name');
    const typeEl  = pop.querySelector('.mcdpop-type');
    const imgEl   = pop.querySelector('.mcdpop-img img');
    const sgEl    = pop.querySelector('.mcdpop-sg');

    if (nameEl) nameEl.textContent = card.name;
    if (typeEl) { typeEl.textContent = card.type; typeEl.className = `mcdpop-type ${card.type}`; }
    if (imgEl && card.imageUrl) imgEl.src = card.imageUrl;

    // Stats grid
    if (sgEl) {
      const stats = [
        { v: card.hp,     l: 'HP' },
        { v: card.defense,l: 'DEF' },
        { v: card.melee,  l: 'Melee' },
        { v: card.ranged, l: 'Ranged' },
        { v: card.speed,  l: 'Speed' },
        { v: card.size,   l: 'Size' },
      ].filter(s => s.v !== undefined);

      sgEl.innerHTML = stats.map(s =>
        `<div class="mcdpop-st"><span class="mcdpop-sv">${s.v}</span><span class="mcdpop-sl">${s.l}</span></div>`
      ).join('');
    }

    // Play button
    const playBtn = pop.querySelector('.mcdpop-play');
    if (playBtn) {
      playBtn.textContent = card.type === 'unit' ? 'Deploy Unit' :
                            card.type === 'blitz' ? 'Play Blitz' : 'Deploy Structure';
      playBtn.disabled = !pop.querySelector('.mhcard.playable[data-card-id="' + card.id + '"]');
      playBtn.onclick = () => {
        _playCard(card);
        pop.classList.remove('on');
      };
    }

    // Close button
    const closeBtn = pop.querySelector('.mcdpop-close');
    if (closeBtn) closeBtn.onclick = () => pop.classList.remove('on');

    pop.classList.add('on');
  }

  function _playCard(card) {
    if (typeof NET === 'undefined') return;

    if (card.type === 'unit') {
      // Unit cards: tell Phaser to show deploy highlights and await tile click
      if (window.HexScene) {
        window.HexScene.beginDeploy(card);
      }
      // Show toast if available
      if (typeof mtoast === 'function') mtoast('Select a tile to deploy ' + card.name);
    } else if (card.type === 'blitz') {
      NET.playBlitz(card.id);
    } else if (card.type === 'structure') {
      NET.deployStructure(card.id, null); // server picks tile or prompts
    }
  }

  function _updateDrawPhaseUI(phase, isMyTurn) {
    const unitDkBtn  = document.querySelector('.mdk.unit');
    const blitzDkBtn = document.querySelector('.mdk.blitz');
    const isDraw = phase === 'draw' && isMyTurn;

    if (unitDkBtn) {
      unitDkBtn.style.border = isDraw ? '2px solid #C9A84C' : '';
      unitDkBtn.title = isDraw ? 'Click to draw a Unit card' : '';
    }
    if (blitzDkBtn) {
      blitzDkBtn.style.border = isDraw ? '2px solid #C9A84C' : '';
      blitzDkBtn.title = isDraw ? 'Click to draw a Blitz card' : '';
    }
  }

  // ── PHASER RESIZE HELPER ──────────────────────────────────────
  // Called after the match screen becomes visible so Phaser
  // gets the correct canvas dimensions

  function _resizePhaser() {
    if (!window.PhaserGame) return;
    const wrap = document.querySelector('.mboard-wrap');
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w > 0 && h > 0) {
      window.PhaserGame.scale.resize(w, h);
      if (window.HexScene) {
        window.HexScene._calculateLayout();
        window.HexScene._buildBoard();
      }
    }
  }

  // ── LISTEN FOR PHASER READY ───────────────────────────────────
  // game.js fires this event when HexBoardScene is fully created
  window.addEventListener('hexSceneReady', function () {
    console.log('[BRIDGE] Phaser HexScene ready');
    // If match is already running, resize now
    const mscr = document.getElementById('mscr');
    if (mscr && mscr.classList.contains('on')) {
      setTimeout(_resizePhaser, 100);
    }
  });

  // ── LISTEN FOR UNIT SELECTION FROM PHASER ────────────────────
  // game.js fires 'unitSelected' when player clicks a unit token
  window.addEventListener('unitSelected', function (e) {
    const unit = e.detail;
    if (!unit) return;

    // Update the action bar info panel
    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl) nameEl.textContent = unit.name || unit.id;
    if (statsEl) {
      statsEl.innerHTML = `
        <span>HP <span>${unit.hp}/${unit.maxHp}</span></span>
        <span>SPD <span>${unit.speed ?? '—'}</span></span>
        <span>MEL <span>${unit.melee ?? '—'}</span></span>
        <span>RNG <span>${unit.rangedRange ?? '—'}</span></span>
      `;
    }

    // Update move sub-label
    const moveSub = document.getElementById('m-ab-move-sub');
    if (moveSub) moveSub.textContent = unit.hasMoved ? 'Used' : `${unit.speed ?? '?'} tiles`;

    const rangeSub = document.getElementById('m-ab-range-sub');
    if (rangeSub) rangeSub.textContent = unit.rangedRange ? `${unit.rangedRange} range` : 'N/A';
  });

  window.addEventListener('unitDeselected', function () {
    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl) nameEl.textContent = '— Select a unit on board —';
    if (nameEl) nameEl.style.color = 'rgba(240,232,220,.3)';
    if (statsEl) statsEl.innerHTML = '';
  });

  // ── START PATCHING ────────────────────────────────────────────
  patchM();

});


/* ═══════════════════════════════════════════════════════════════
   LOCAL GAME ENGINE v2 — embedded in bridge.js
   To use Colyseus server: remove from here to end of file.
   ═══════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════
   LOCAL GAME ENGINE v2 — embedded in bridge.js
   Fixes:
     1. Seat-based turn order — only active player can act
     2. Correct deck sizes: 15 unit, 15 blitz (no 3x copies)
     3. Tile placement setup phase before the game
     4. Card images restored
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── CARD DATABASE (15 units, 15 blitz — no duplicates) ──────
  // Images use the card id to load from assets/cards/ folder.
  // Format: assets/cards/u1.jpg etc. Falls back to colour block if missing.

  const UNIT_CARDS = [
    { id: 'u1',  name: 'Fireling',        type: 'unit', hp: 5,  maxHp: 5,  defense: 1, melee: 2, rangedRange: 0, speed: 3, size: 1, costNeutral: 1, element: 'fire'    },
    { id: 'u2',  name: 'Ocean Wanderer',  type: 'unit', hp: 6,  maxHp: 6,  defense: 2, melee: 2, rangedRange: 2, speed: 2, size: 1, costNeutral: 1, element: 'water'   },
    { id: 'u3',  name: 'Arid Scout',      type: 'unit', hp: 4,  maxHp: 4,  defense: 1, melee: 1, rangedRange: 3, speed: 4, size: 1, costNeutral: 1, element: 'neutral' },
    { id: 'u4',  name: 'Stone Guard',     type: 'unit', hp: 8,  maxHp: 8,  defense: 3, melee: 3, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, element: 'neutral' },
    { id: 'u5',  name: 'Ember Hawk',      type: 'unit', hp: 3,  maxHp: 3,  defense: 0, melee: 1, rangedRange: 4, speed: 3, size: 1, costNeutral: 1, element: 'fire'    },
    { id: 'u6',  name: 'Tide Caller',     type: 'unit', hp: 5,  maxHp: 5,  defense: 1, melee: 2, rangedRange: 2, speed: 2, size: 1, costNeutral: 2, element: 'water'   },
    { id: 'u7',  name: 'Dune Strider',    type: 'unit', hp: 4,  maxHp: 4,  defense: 1, melee: 2, rangedRange: 0, speed: 4, size: 1, costNeutral: 1, element: 'neutral' },
    { id: 'u8',  name: 'Lava Golem',      type: 'unit', hp: 10, maxHp: 10, defense: 4, melee: 4, rangedRange: 0, speed: 1, size: 3, costNeutral: 3, element: 'fire'    },
    { id: 'u9',  name: 'Reef Stalker',    type: 'unit', hp: 5,  maxHp: 5,  defense: 2, melee: 2, rangedRange: 1, speed: 2, size: 1, costNeutral: 1, element: 'water'   },
    { id: 'u10', name: 'Wind Dancer',     type: 'unit', hp: 3,  maxHp: 3,  defense: 0, melee: 1, rangedRange: 0, speed: 5, size: 1, costNeutral: 1, element: 'neutral' },
    { id: 'u11', name: 'Iron Bastion',    type: 'unit', hp: 7,  maxHp: 7,  defense: 3, melee: 3, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, element: 'neutral' },
    { id: 'u12', name: 'Flame Sprite',    type: 'unit', hp: 3,  maxHp: 3,  defense: 0, melee: 2, rangedRange: 2, speed: 3, size: 1, costNeutral: 1, element: 'fire'    },
    { id: 'u13', name: 'Deep Current',    type: 'unit', hp: 6,  maxHp: 6,  defense: 2, melee: 2, rangedRange: 0, speed: 2, size: 1, costNeutral: 2, element: 'water'   },
    { id: 'u14', name: 'Dust Phantom',    type: 'unit', hp: 4,  maxHp: 4,  defense: 1, melee: 1, rangedRange: 3, speed: 3, size: 1, costNeutral: 1, element: 'neutral' },
    { id: 'u15', name: 'Cinder Brute',    type: 'unit', hp: 9,  maxHp: 9,  defense: 3, melee: 4, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, element: 'fire'    },
  ];

  // Combined Blitz + Structure deck = 15 cards
  const BLITZ_CARDS = [
    { id: 'b1',  name: 'Surge Forward',   type: 'blitz',     description: 'Move one unit 2 extra tiles this turn.',         costNeutral: 1 },
    { id: 'b2',  name: 'Iron Shield',     type: 'blitz',     description: 'One unit gains +2 Defense until end of turn.',   costNeutral: 1 },
    { id: 'b3',  name: 'War Cry',         type: 'blitz',     description: 'All your units gain +1 Melee this turn.',        costNeutral: 2 },
    { id: 'b4',  name: 'Ambush',          type: 'blitz',     description: 'One unit may attack without being revealed.',    costNeutral: 1 },
    { id: 'b5',  name: 'Tidal Wave',      type: 'blitz',     description: 'Push all adjacent enemy units 1 tile back.',     costNeutral: 2 },
    { id: 'b6',  name: 'Smoke Screen',    type: 'blitz',     description: 'One unit cannot be targeted this turn.',         costNeutral: 1 },
    { id: 'b7',  name: 'Quick Draw',      type: 'blitz',     description: 'Draw 1 extra card immediately.',                 costNeutral: 1 },
    { id: 'b8',  name: 'Empower',         type: 'blitz',     description: 'One unit gains +2 to all stats this turn.',      costNeutral: 2 },
    { id: 'b9',  name: 'Fortify',         type: 'structure', description: 'Build a wall. 10 HP, blocks movement.',          costNeutral: 1 },
    { id: 'b10', name: 'Counter Charge',  type: 'blitz',     description: 'When attacked, deal damage back to attacker.',   costNeutral: 1 },
    { id: 'b11', name: 'Outpost',         type: 'structure', description: 'Place an Outpost. Grants +1 Essence each turn.', costNeutral: 2 },
    { id: 'b12', name: 'Rally',           type: 'blitz',     description: 'Heal all friendly units for 2 HP.',              costNeutral: 2 },
    { id: 'b13', name: 'Trap',            type: 'blitz',     description: 'Place a trap on any tile. Triggers on entry.',   costNeutral: 1 },
    { id: 'b14', name: 'Supply Depot',    type: 'structure', description: 'Place a depot. Draw 1 extra card per turn.',     costNeutral: 2 },
    { id: 'b15', name: 'Last Stand',      type: 'blitz',     description: 'Reaction: when a unit is destroyed, deal 3 damage to attacker.', costNeutral: 1 },
  ];

  // ── ENGINE STATE ─────────────────────────────────────────────
  const GS = {
    turn:          0,
    // mySeat: 'p1' or 'p2' — set from Colyseus game_start message
    // Both players in the room get their own GS, so p1's "player" = their view
    mySeat:        'p1',           // default; overwritten by network message
    // 'p1' or 'p2' — who is currently taking their turn
    activePlayer:  'p1',
    // Game phase: 'tile_setup' | 'standby' | 'draw' | 'main' | 'end'
    phase:         'tile_setup',
    hands:         { player: [], opponent: [] },
    decks:         { player: { unit: [], blitz: [] }, opponent: { unit: [], blitz: [] } },
    discard:       { player: [], opponent: [] },
    essence:       { player: { n: 0, f: 0, w: 0 }, opponent: { n: 0, f: 0, w: 0 } },
    hasDrawnThisTurn: false,
    deploySeq:     0,
    // Tile placement state
    tileBag:       { neutral: 20, fire: 8, water: 8 }, // tiles available to place
    selectedTileType: null,   // 'neutral'|'fire'|'water' — currently chosen for placement
    _deckPulseInterval: null,
    started:       false,
    // Setup complete flag (both players ready to start turns)
    setupDone:     false,
  };

  // ── SEAT HELPERS ─────────────────────────────────────────────
  // "isMyTurn" = the active player's seat matches MY seat

  function isMyTurn() {
    return GS.activePlayer === GS.mySeat;
  }

  function isMyPhase() {
    return isMyTurn() && (GS.phase !== 'tile_setup' || !GS.setupDone);
  }

  // ── UTILITY ──────────────────────────────────────────────────

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cloneCard(card, suffix) {
    return { ...card, id: card.id + '_' + suffix };
  }

  function buildDeck(cards, suffix) {
    // Exactly 1 copy of each card — 15 unit, 15 blitz
    return shuffle(cards.map(c => cloneCard(c, suffix)));
  }

  function toast(msg) {
    if (typeof mtoast === 'function') { mtoast(msg); return; }
    const el = document.querySelector('.mtoast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  function logCombat(msg, cls) {
    const log = document.getElementById('m-clog');
    if (!log) return;
    const p = document.createElement('p');
    p.className = 'mclog-msg ' + (cls || 's');
    p.textContent = msg;
    log.prepend(p);
    while (log.children.length > 60) log.removeChild(log.lastChild);
  }

  // ── PHASE ANNOUNCEMENT ───────────────────────────────────────

  function announcePhase(phaseName, sub) {
    const ann = document.querySelector('.mph-ann');
    if (!ann) return;
    const txt   = ann.querySelector('.mph-ann-txt');
    const subEl = ann.querySelector('.mph-ann-sub');
    if (txt)   txt.textContent   = phaseName.toUpperCase();
    if (subEl) subEl.textContent = sub || '';
    ann.classList.add('show');
    setTimeout(() => ann.classList.remove('show'), 1600);
  }

  // ── HUD UPDATERS ─────────────────────────────────────────────

  function updatePhaseUI(phase, turn) {
    ['standby', 'draw', 'main', 'end'].forEach(p => {
      const el = document.getElementById('m-ph-' + p);
      if (el) el.classList.toggle('on', p === phase);
    });
    const turnEl = document.getElementById('m-turn');
    if (turnEl && turn) turnEl.textContent = turn;

    // Sync Phaser turn flag
    if (window.HexScene) {
      window.HexScene.isMyTurn = isMyTurn() && phase === 'main';
    }
  }

  function updateEssenceUI() {
    const ess = GS.essence.player;
    const en = document.getElementById('m-ess-n');
    const ef = document.getElementById('m-ess-f');
    const ew = document.getElementById('m-ess-w');
    if (en) en.textContent = ess.n ?? 0;
    if (ef) ef.textContent = ess.f ?? 0;
    if (ew) ew.textContent = ess.w ?? 0;
  }

  function updateDeckCounts(side) {
    const d = GS.decks[side];
    const prefix = side === 'player' ? 'm-pl' : 'm-ai';
    const udk  = document.getElementById(prefix + '-udk');
    const bdk  = document.getElementById(prefix + '-bdk');
    const disc = document.getElementById(prefix + '-disc');
    if (udk)  udk.textContent  = d.unit.length;
    if (bdk)  bdk.textContent  = d.blitz.length;
    if (disc) disc.textContent = (GS.discard[side] || []).length;
  }

  function updateTurnBanner() {
    // Highlight whose name is active
    const allNames = document.querySelectorAll('.hpname');
    allNames.forEach(n => {
      const isOpp = n.textContent.includes('Opponent') || n.textContent.includes('Commander') && n !== allNames[0];
      const myActive = isMyTurn();
      if (isOpp) n.style.color = myActive ? 'rgba(240,232,220,.35)' : '#C9A84C';
      else        n.style.color = myActive ? '#C9A84C' : 'rgba(240,232,220,.35)';
    });
  }

  // ── DECK PULSE ────────────────────────────────────────────────

  function startDeckPulse() {
    stopDeckPulse();
    const btns = [document.querySelector('.mdk.unit'), document.querySelector('.mdk.blitz')];
    let on = true;
    GS._deckPulseInterval = setInterval(() => {
      on = !on;
      const glow   = on ? '0 0 18px 4px #C9A84C, inset 0 0 8px rgba(201,168,76,.3)' : 'none';
      const border = on ? '2px solid #C9A84C' : '1px solid rgba(255,140,0,.2)';
      btns.forEach(b => { if (b) { b.style.boxShadow = glow; b.style.border = border; } });
    }, 550);
  }

  function stopDeckPulse() {
    if (GS._deckPulseInterval) { clearInterval(GS._deckPulseInterval); GS._deckPulseInterval = null; }
    [document.querySelector('.mdk.unit'), document.querySelector('.mdk.blitz')].forEach(b => {
      if (b) { b.style.boxShadow = ''; b.style.border = ''; }
    });
  }

  // ── CARD IMAGE URL ────────────────────────────────────────────
  // Returns image URL for a card. Looks in assets/cards/{id}.jpg
  // If your images have different names, map them here.

  const CARD_IMAGE_MAP = {
    // Override specific card images here if filenames differ from id
    // e.g. 'u1': 'assets/cards/fireling.jpg',
  };

  function cardImageUrl(card) {
    if (CARD_IMAGE_MAP[card.id]) return CARD_IMAGE_MAP[card.id];
    // Try the card's own imageUrl property first (if set from DB)
    if (card.imageUrl) return card.imageUrl;
    // Default path
    return 'assets/cards/' + card.id.replace(/_.*$/, '') + '.jpg';
  }

  // ── HAND RENDERING ───────────────────────────────────────────

  function renderHand() {
    const cards  = GS.hands.player;
    const area   = document.querySelector('.mhand-area');
    if (!area) return;

    const lbl = area.querySelector('.mhand-lbl');
    area.innerHTML = '';
    if (lbl) area.appendChild(lbl);

    // During tile setup, show the tile placement bar instead of cards
    if (GS.phase === 'tile_setup' && !GS.setupDone) {
      _renderTileSetupBar(area);
      return;
    }

    if (!cards.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:.6rem;color:rgba(240,232,220,.3);padding:8px;align-self:center';
      empty.textContent = 'No cards in hand';
      area.appendChild(empty);
      return;
    }

    const ess      = GS.essence.player;
    const totalEss = ess.n + ess.f + ess.w;
    const myMain   = isMyTurn() && GS.phase === 'main';

    cards.forEach(card => {
      const el   = document.createElement('div');
      el.className = 'mhcard';
      el.dataset.cardId = card.id;

      const cost    = card.costNeutral ?? 0;
      const canPlay = myMain && totalEss >= cost;
      if (canPlay) el.classList.add('playable');

      const imgUrl = cardImageUrl(card);
      const elemColor = card.element === 'fire'  ? 'rgba(226,88,34,.6)'
                      : card.element === 'water' ? 'rgba(30,144,255,.6)'
                      : 'rgba(180,170,140,.4)';
      const typeColor = card.type === 'unit'      ? '#FF6B8A'
                      : card.type === 'structure' ? '#7ECF60'
                      : '#FFAD45';

      el.innerHTML = `
        <img src="${imgUrl}" alt="${card.name}"
          style="width:100%;height:100%;object-fit:cover;display:block;border-radius:4px 4px 0 0;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div style="display:none;width:100%;height:100%;background:linear-gradient(160deg,${elemColor},rgba(10,10,8,.95));
          flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px;text-align:center;border-radius:4px 4px 0 0;">
          <div style="font-size:.52rem;font-weight:700;color:#F0E8DC;line-height:1.2">${card.name}</div>
          <div style="font-size:.44rem;color:${typeColor};text-transform:uppercase;letter-spacing:.05em">${card.type}</div>
          ${card.type === 'unit'
            ? `<div style="font-size:.44rem;color:rgba(240,232,220,.5)">HP:${card.hp} SPD:${card.speed}</div>`
            : `<div style="font-size:.42rem;color:rgba(240,232,220,.4);padding:0 2px">${(card.description||'').slice(0,32)}…</div>`}
        </div>
        <div class="mhcard-cost">${cost}</div>
      `;

      el.addEventListener('click', () => {
        if (GS.phase === 'tile_setup') return;
        showCardPopup(card);
      });
      area.appendChild(el);
    });
  }

  // ── TILE SETUP BAR ───────────────────────────────────────────
  // Renders the tile placement controls in the hand area during setup phase

  function _renderTileSetupBar(area) {
    const bar = document.createElement('div');
    bar.id = 'tile-setup-bar';
    bar.style.cssText = `
      display:flex; align-items:center; gap:1rem; padding:0 1rem;
      width:100%; height:100%;
    `;

    const label = document.createElement('div');
    label.style.cssText = 'font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(240,232,220,.4);white-space:nowrap';
    label.textContent = 'Place Tiles:';
    bar.appendChild(label);

    // Tile type buttons
    const TYPES = [
      { type: 'neutral', color: '#B4AA8C', bg: 'rgba(180,170,140,.15)', border: 'rgba(180,170,140,.4)', label: 'Neutral' },
      { type: 'fire',    color: '#F4956A', bg: 'rgba(226,88,34,.15)',   border: '#E25822',               label: 'Fire'    },
      { type: 'water',   color: '#72B8FF', bg: 'rgba(30,144,255,.15)',  border: '#1E90FF',               label: 'Water'   },
    ];

    TYPES.forEach(({ type, color, bg, border, label: lbl }) => {
      const count = GS.tileBag[type];
      const btn = document.createElement('div');
      btn.dataset.tileType = type;
      btn.style.cssText = `
        display:flex; align-items:center; gap:.4rem; padding:.35rem .75rem;
        background:${bg}; border:1px solid ${border}; border-radius:5px;
        cursor:pointer; transition:all .2s; user-select:none;
        ${GS.selectedTileType === type ? `box-shadow:0 0 14px 3px ${color};border-color:${color};` : ''}
      `;
      btn.innerHTML = `
        <span style="font-size:.8rem;font-weight:700;color:${color}">${lbl}</span>
        <span style="display:flex;align-items:center;gap:.2rem">
          <span style="font-size:.65rem;color:rgba(240,232,220,.5)">×</span>
          <span style="font-size:.75rem;font-weight:700;color:#F0E8DC" id="tile-count-${type}">${count}</span>
        </span>
      `;
      btn.addEventListener('click', () => selectTileType(type));
      btn.addEventListener('mouseenter', () => {
        if (GS.selectedTileType !== type) btn.style.borderColor = color;
      });
      btn.addEventListener('mouseleave', () => {
        if (GS.selectedTileType !== type) btn.style.borderColor = border;
      });
      bar.appendChild(btn);
    });

    // Instruction / done button
    const right = document.createElement('div');
    right.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:.75rem';

    const instruction = document.createElement('div');
    instruction.id = 'tile-setup-instruction';
    instruction.style.cssText = 'font-size:.68rem;color:rgba(240,232,220,.45);font-style:italic';
    instruction.textContent = GS.selectedTileType
      ? 'Click a tile on the board to place it'
      : 'Select a tile type above, then click the board';
    right.appendChild(instruction);

    const doneBtn = document.createElement('div');
    doneBtn.style.cssText = `
      padding:.35rem .9rem; background:rgba(201,168,76,.15);
      border:1px solid rgba(201,168,76,.4); border-radius:4px;
      font-size:.75rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
      color:#C9A84C; cursor:pointer; white-space:nowrap; transition:all .2s;
    `;
    doneBtn.textContent = 'Done Placing →';
    doneBtn.addEventListener('click', finishTileSetup);
    doneBtn.addEventListener('mouseenter', () => { doneBtn.style.background = 'rgba(201,168,76,.3)'; });
    doneBtn.addEventListener('mouseleave', () => { doneBtn.style.background = 'rgba(201,168,76,.15)'; });
    right.appendChild(doneBtn);

    bar.appendChild(right);
    area.appendChild(bar);
  }

  function selectTileType(type) {
    if (!isMyTurn() && GS.phase === 'tile_setup') {
      // Both players can place tiles in setup phase — so allow it
    }
    GS.selectedTileType = (GS.selectedTileType === type) ? null : type;

    // Update board cursor hint
    if (window.HexScene) {
      window.HexScene._tileSetupMode = !!GS.selectedTileType;
    }

    // Re-render to show selection state
    renderHand();

    const instr = document.getElementById('tile-setup-instruction');
    if (instr) {
      instr.textContent = GS.selectedTileType
        ? 'Click any tile on the board to place ' + GS.selectedTileType
        : 'Select a tile type above, then click the board';
    }

    toast(GS.selectedTileType ? 'Click a tile to place: ' + GS.selectedTileType : 'Deselected');
  }

  // Called when a board tile is clicked during setup
  function placeTileOnBoard(tileId) {
    if (GS.phase !== 'tile_setup' || !GS.selectedTileType) return false;
    const type = GS.selectedTileType;
    if (!GS.tileBag[type] || GS.tileBag[type] <= 0) {
      toast('No more ' + type + ' tiles!');
      return false;
    }

    // Place tile — make it visible and set its type
    if (window.HexScene) {
      const tile = window.HexScene.tiles.find(t => t.id === tileId);
      if (!tile) return false;
      tile.type = type;
      window.HexScene._drawTile(tile, window.HexScene.tileGfx[window.HexScene.tiles.indexOf(tile)]);
    }

    GS.tileBag[type]--;

    // Update count display
    const countEl = document.getElementById('tile-count-' + type);
    if (countEl) countEl.textContent = GS.tileBag[type];

    logCombat('⬡ Placed ' + type + ' tile', 's');
    return true;
  }

  function finishTileSetup() {
    GS.selectedTileType = null;
    GS.setupDone = true;
    if (window.HexScene) window.HexScene._tileSetupMode = false;

    logCombat('✓ Tile placement complete — game starting!', 'a');
    toast('Tiles placed — game starting!');

    // Short pause then begin Turn 1
    setTimeout(() => beginTurn('p1'), 800);
  }

  // ── CARD POPUP ───────────────────────────────────────────────

  function showCardPopup(card) {
    const pop = document.querySelector('.mcdpop');
    if (!pop) {
      if (card.type === 'unit') deployUnit(card);
      return;
    }

    const nameEl = pop.querySelector('.mcdpop-name');
    const typeEl = pop.querySelector('.mcdpop-type');
    const sgEl   = pop.querySelector('.mcdpop-sg');
    const abArea = pop.querySelector('.mcdpop-ab');
    const imgEl  = pop.querySelector('.mcdpop-img img, .mcdpop img');

    if (nameEl) nameEl.textContent = card.name;
    if (typeEl) { typeEl.textContent = card.type; typeEl.className = 'mcdpop-type ' + card.type; }

    // Try to set popup image
    if (imgEl) {
      imgEl.src = cardImageUrl(card);
      imgEl.alt = card.name;
    }

    if (sgEl) {
      const stats = card.type === 'unit' ? [
        { v: card.hp,           l: 'HP'    },
        { v: card.defense,      l: 'DEF'   },
        { v: card.melee,        l: 'Melee' },
        { v: card.rangedRange || 0, l: 'Range' },
        { v: card.speed,        l: 'Speed' },
        { v: card.size,         l: 'Size'  },
      ] : [
        { v: card.costNeutral ?? 0, l: 'Cost' },
      ];
      sgEl.innerHTML = stats.map(s =>
        `<div class="mcdpop-st"><span class="mcdpop-sv">${s.v}</span><span class="mcdpop-sl">${s.l}</span></div>`
      ).join('');
    }

    if (abArea) {
      abArea.innerHTML = card.description
        ? `<span class="mcdpop-abn">${card.name}:</span> ${card.description}`
        : `<span class="mcdpop-abn">Deploy:</span> Place near your Empire tiles.`;
    }

    const playBtn = pop.querySelector('.mcdpop-play');
    if (playBtn) {
      const ess      = GS.essence.player;
      const totalEss = ess.n + ess.f + ess.w;
      const cost     = card.costNeutral ?? 0;
      const myMain   = isMyTurn() && GS.phase === 'main';
      const canPlay  = myMain && totalEss >= cost;

      playBtn.textContent = card.type === 'unit'      ? '⬡ Deploy Unit'
                          : card.type === 'structure' ? '🏗 Deploy Structure'
                          : '⚡ Play Blitz';
      playBtn.disabled = !canPlay;
      playBtn.title    = canPlay ? '' : (myMain ? 'Not enough Essence' : 'Not your Main Phase');
      playBtn.onclick  = () => {
        pop.classList.remove('on');
        if (card.type === 'unit')      deployUnit(card);
        else if (card.type === 'blitz') playBlitz(card);
        else                           playBlitz(card); // structure handled same way for now
      };
    }

    const closeBtn = pop.querySelector('.mcdpop-close');
    if (closeBtn) closeBtn.onclick = () => pop.classList.remove('on');

    pop.classList.add('on');
  }

  // ── UNIT DEPLOYMENT ──────────────────────────────────────────

  function deployUnit(card) {
    if (!isMyTurn() || GS.phase !== 'main') {
      toast('Can only deploy during your Main Phase!');
      return;
    }
    const ess  = GS.essence.player;
    const cost = card.costNeutral ?? 0;
    if (ess.n + ess.f + ess.w < cost) { toast('Not enough Essence!'); return; }

    // Remove from hand & deduct essence
    const idx = GS.hands.player.indexOf(card);
    if (idx !== -1) GS.hands.player.splice(idx, 1);
    ess.n = Math.max(0, ess.n - cost);
    updateEssenceUI();
    renderHand();

    GS.deploySeq++;
    const deployCard = { ...card, _deployId: 'unit_' + GS.deploySeq + '_' + card.id };
    if (window.HexScene) {
      window.HexScene.beginDeploy(deployCard);
      toast('Select a tile to place ' + card.name);
    }
  }

  function playBlitz(card) {
    const idx = GS.hands.player.indexOf(card);
    if (idx !== -1) GS.hands.player.splice(idx, 1);
    GS.discard.player.push(card);
    const cost = card.costNeutral ?? 0;
    GS.essence.player.n = Math.max(0, GS.essence.player.n - cost);
    updateEssenceUI();
    renderHand();
    updateDeckCounts('player');
    toast('⚡ ' + card.name + '!');
    logCombat('⚡ ' + card.name + ': ' + (card.description || 'Effect activated.'), 'a');
  }

  // ── DRAW CARD ─────────────────────────────────────────────────

  function drawCard(side, deckType) {
    const deck = GS.decks[side][deckType];
    if (!deck || !deck.length) {
      if (side === 'player') toast('Your ' + deckType + ' deck is empty!');
      return null;
    }
    const card = deck.shift();
    GS.hands[side].push(card);
    updateDeckCounts(side);
    return card;
  }

  // ── TURN FLOW ─────────────────────────────────────────────────

  function startGame() {
    if (GS.started) return;
    GS.started = true;

    // Read mySeat from Colyseus network module if available
    if (window._zbMySeat) GS.mySeat = window._zbMySeat;

    // Build decks — exactly 15 cards each, no copies
    GS.decks.player.unit   = buildDeck(UNIT_CARDS,  'pl');
    GS.decks.player.blitz  = buildDeck(BLITZ_CARDS, 'pl');
    GS.decks.opponent.unit  = buildDeck(UNIT_CARDS,  'op');
    GS.decks.opponent.blitz = buildDeck(BLITZ_CARDS, 'op');

    // Opening hands: 3 unit + 3 blitz each
    for (let i = 0; i < 3; i++) {
      drawCard('player',   'unit');
      drawCard('player',   'blitz');
      drawCard('opponent', 'unit');
      drawCard('opponent', 'blitz');
    }

    updateDeckCounts('player');
    updateDeckCounts('opponent');

    // Resize Phaser
    setTimeout(_resizePhaser, 200);

    // Begin tile setup phase
    setTimeout(() => {
      GS.phase = 'tile_setup';
      GS.activePlayer = 'p1'; // p1 goes first but both can place
      updatePhaseUI('tile_setup', 1);

      // Hook tile clicks in Phaser for placement
      if (window.HexScene) window.HexScene._tileSetupMode = true;

      announcePhase('Place Your Tiles', 'Click tile types below, then click the board');
      logCombat('⬡ Game started — place tiles to begin', 's');
      renderHand();
      toast('Select a tile type below and click the board to place');
    }, 400);
  }

  function beginTurn(seat) {
    GS.turn++;
    GS.activePlayer      = seat;
    GS.hasDrawnThisTurn  = false;

    // Grant 2 neutral Essence to the active player
    // "player" side always = local player's view
    if (seat === GS.mySeat) {
      GS.essence.player.n = 2;
      updateEssenceUI();
    }

    // Reset unit flags for the newly active player
    if (window.HexScene) {
      const ownerKey = seat === GS.mySeat ? 'player' : 'opponent';
      window.HexScene.gameState.units.forEach(u => {
        if (u.owner === ownerKey) {
          u.hasMoved = false; u.hasActed = false; u.deployRest = false;
        }
      });
    }

    updateTurnBanner();
    setPhase('standby');
  }

  function setPhase(phase) {
    GS.phase = phase;
    const myTurn = isMyTurn();
    updatePhaseUI(phase, GS.turn);
    stopDeckPulse();

    switch (phase) {
      case 'standby':
        announcePhase(myTurn ? 'Your Turn' : "Opponent's Turn", 'Turn ' + GS.turn);
        logCombat('⬡ Turn ' + GS.turn + ' — ' + (myTurn ? 'YOUR STANDBY' : "OPPONENT'S STANDBY"), 's');
        setTimeout(() => setPhase('draw'), 1500);
        break;

      case 'draw':
        announcePhase('Draw Phase', myTurn ? 'Click your deck to draw' : "Opponent drawing...");
        if (myTurn) {
          startDeckPulse();
          toast('Draw a card — click Unit or Blitz deck');
          renderHand(); // refresh playable state
        } else {
          // Opponent auto-draws
          setTimeout(() => {
            const type = Math.random() < 0.6 ? 'unit' : 'blitz';
            drawCard('opponent', type);
            setPhase('main');
          }, 1200);
        }
        break;

      case 'main':
        announcePhase('Main Phase', myTurn ? 'Deploy, Move, or Attack' : "Opponent's Main Phase");
        logCombat((myTurn ? '▶ Your' : "▶ Opponent's") + ' main phase', 's');
        renderHand(); // refresh playable state
        if (myTurn) {
          toast('Main Phase — play cards or move units');
        } else {
          toast("Opponent's turn — click End Turn when ready");
        }
        break;

      case 'end':
        announcePhase('End Phase', '');
        logCombat('◀ Turn ' + GS.turn + ' ends', 's');
        setTimeout(() => {
          const nextSeat = GS.activePlayer === 'p1' ? 'p2' : 'p1';
          beginTurn(nextSeat);
        }, 800);
        break;
    }
  }

  // ── HANDLERS (called by buttons) ──────────────────────────────

  function handleEndTurn() {
    if (GS.phase === 'tile_setup') {
      finishTileSetup();
      return;
    }
    if (!isMyTurn()) {
      toast("It's not your turn!");
      return;
    }
    if (GS.phase === 'draw' && !GS.hasDrawnThisTurn) {
      toast('You must draw a card first!');
      return;
    }
    if (GS.phase !== 'main' && GS.phase !== 'draw') {
      toast('Wait for your Main Phase.');
      return;
    }
    if (window.HexScene) window.HexScene._clearSelection();
    setPhase('end');
  }

  function handleDrawCard(deckType) {
    if (GS.phase === 'tile_setup') { toast('Finish placing tiles first'); return; }
    if (!isMyTurn()) { toast("It's not your turn!"); return; }
    if (GS.phase !== 'draw')       { toast('You can only draw during Draw Phase.'); return; }
    if (GS.hasDrawnThisTurn)       { toast('Already drew this turn.'); return; }

    const card = drawCard('player', deckType);
    if (!card) return;

    GS.hasDrawnThisTurn = true;
    stopDeckPulse();
    renderHand();
    toast('Drew: ' + card.name);
    logCombat('🃏 Drew ' + card.name + ' from ' + deckType + ' deck', 'a');
    setTimeout(() => setPhase('main'), 700);
  }

  // ── PHASER SETUP MODE HOOK ───────────────────────────────────
  // Intercept tile clicks during tile_setup phase
  // game.js fires window.dispatchEvent(new CustomEvent('tileClicked', {detail: {tileId}}))
  // OR we hook HexScene._onTileClick directly

  function _hookPhaserTileClick() {
    if (!window.HexScene) return;
    const orig = window.HexScene._onTileClick.bind(window.HexScene);
    window.HexScene._onTileClick = function (tile) {
      if (GS.phase === 'tile_setup' && GS.selectedTileType) {
        placeTileOnBoard(tile.id);
        return; // don't pass through to normal tile click
      }
      orig(tile);
    };
  }

  // ── PHASER RESIZE ────────────────────────────────────────────

  function _resizePhaser() {
    if (!window.PhaserGame) return;
    const wrap = document.querySelector('.mboard-wrap');
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w > 0 && h > 0) {
      window.PhaserGame.scale.resize(w, h);
      if (window.HexScene) {
        window.HexScene._calculateLayout();
        window.HexScene._buildBoard();
        if (window.HexScene._resyncTokenPositions) window.HexScene._resyncTokenPositions();
      }
    }
  }

  // ── SIDEBAR ───────────────────────────────────────────────────

  function refreshUnitSidebar() {
    if (!window.HexScene) return;
    const pUnits = window.HexScene.gameState.units.filter(u => u.owner === 'player');
    const oUnits = window.HexScene.gameState.units.filter(u => u.owner !== 'player');
    _renderSidebarUnits('m-pl-units', pUnits);
    _renderSidebarUnits('m-ai-units', oUnits);
  }

  function _renderSidebarUnits(elId, units) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    if (!units.length) {
      el.innerHTML = '<div style="font-size:.6rem;color:rgba(240,232,220,.25);padding:.3rem">No units on field</div>';
      return;
    }
    units.forEach(u => {
      const pct = Math.max(0, Math.round((u.hp / (u.maxHp || 1)) * 100));
      const row = document.createElement('div');
      row.className = 'uip-row';
      row.innerHTML = `<div class="uip-data">
        <div class="uip-nm">${u.name}</div>
        <div class="uip-hb"><div class="uip-hbf" style="width:${pct}%"></div></div>
        <div class="uip-hp">${u.hp}/${u.maxHp || u.hp} HP</div>
      </div>`;
      row.addEventListener('click', () => {
        if (!window.HexScene) return;
        const ud = window.HexScene.gameState.units.find(g => g.id === u.id);
        const t  = ud ? window.HexScene.tiles.find(t => t.id === ud.tileId) : null;
        if (ud && t) window.HexScene._selectUnit(ud, t);
      });
      el.appendChild(row);
    });
  }

  // ── WIRE HOOKS ────────────────────────────────────────────────

  function wireHooks() {
    if (typeof M !== 'undefined') {
      M.endTurn  = handleEndTurn;
      M.drawCard = handleDrawCard;
      M.startGame = startGame;
      M.selectAction = action => { if (window.HexScene) window.HexScene.selectAction(action); };
    }

    const endBtn = document.querySelector('.mhud-btn.end');
    if (endBtn) endBtn.onclick = e => { e.preventDefault(); handleEndTurn(); };

    const du = document.querySelector('.mdk.unit');
    const db = document.querySelector('.mdk.blitz');
    if (du) du.onclick = () => handleDrawCard('unit');
    if (db) db.onclick = () => handleDrawCard('blitz');
  }

  // ── PHASER EVENTS ─────────────────────────────────────────────

  window.addEventListener('unitSelected', function (e) {
    const unit = e.detail;
    if (!unit) return;
    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl)  { nameEl.textContent = unit.name || unit.id; nameEl.style.color = '#F0E8DC'; }
    if (statsEl) {
      const moved = unit.hasMoved  ? '<span style="color:#FF8888">Used</span>' : unit.speed + ' tiles';
      statsEl.innerHTML = `
        <span>HP <span>${unit.hp}/${unit.maxHp || unit.hp}</span></span>
        <span>SPD <span>${moved}</span></span>
        <span>MEL <span>${unit.melee ?? '—'}</span></span>
        <span>RNG <span>${unit.rangedRange ?? 0}</span></span>
      `;
    }
    const moveSub = document.getElementById('m-ab-move-sub');
    if (moveSub) moveSub.textContent = unit.hasMoved ? 'Used' : unit.speed + ' tiles';
    const moveBtn = document.getElementById('m-ab-move');
    if (moveBtn) moveBtn.classList.toggle('disabled', !!unit.hasMoved || !!unit.deployRest);
  });

  window.addEventListener('unitDeselected', function () {
    const n = document.getElementById('m-uab-name');
    const s = document.getElementById('m-uab-stats');
    if (n) { n.textContent = '— Select a unit on board —'; n.style.color = 'rgba(240,232,220,.3)'; }
    if (s) s.innerHTML = '';
  });

  window.addEventListener('unitDeployed', function () {
    renderHand();
    refreshUnitSidebar();
    logCombat('⬡ Unit deployed', 'a');
  });

  // ── EXPOSE & STARTUP ──────────────────────────────────────────

  window.ZB = {
    GS, startGame, setPhase, beginTurn, drawCard,
    handleEndTurn, handleDrawCard, wireHooks,
    renderHand, refreshUnitSidebar, selectTileType,
    placeTileOnBoard, finishTileSetup,
  };

  // Hook into network.js game_start to capture mySeat
  // network.js sets window._zbMySeat = seat when game_start fires
  // (requires 1-line addition to network.js — see README comment below)

  function _tryStart() {
    if (GS.started) return;
    const mscr = document.getElementById('mscr');
    if (mscr && mscr.classList.contains('on') && window.HexScene) {
      console.log('[LOCAL ENGINE v2] Starting — seat:', GS.mySeat);
      wireHooks();
      _hookPhaserTileClick();
      startGame();
    }
  }

  let _attempts = 0;
  const _poller = setInterval(() => {
    _attempts++;
    _tryStart();
    if (GS.started || _attempts > 120) {
      clearInterval(_poller);
      if (GS.started) {
        // Hook tile click now that HexScene is confirmed ready
        setTimeout(_hookPhaserTileClick, 500);
      }
    }
  }, 250);

  window.addEventListener('hexSceneReady', () => setTimeout(_tryStart, 100));

  const _mscr = document.getElementById('mscr');
  if (_mscr) new MutationObserver(muts => {
    for (const m of muts) if (m.attributeName === 'class') setTimeout(_tryStart, 200);
  }).observe(_mscr, { attributes: true });

  wireHooks();
  console.log('[LOCAL ENGINE v2] Loaded');

})();
