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
   LOCAL GAME ENGINE — embedded in bridge.js
   Remove the section below when Colyseus server drives the game.
   ═══════════════════════════════════════════════════════════════ */

/**
 * ═══════════════════════════════════════════════════════════════
 *  localEngine.js — Zerchniv Blitz  |  Self-Contained Turn Engine
 *
 *  DROP-IN prototype engine. Runs the full game loop client-side:
 *    • Deals starting hands (3 Unit + 3 Blitz per player)
 *    • Drives Standby → Draw → Main → End phases
 *    • Grants 2 neutral Essence per turn (mimics Empire)
 *    • Pulsing deck highlights on Draw phase
 *    • Unit deployment onto board tiles
 *    • Turn passing between Player 1 (you) and Player 2 (opponent)
 *    • Move action with light-blue hex highlights
 *    • Per-turn draw on turn 2+
 *
 *  Load order in index.html (after Phaser and game.js):
 *    <script src="localEngine.js"></script>
 *
 *  No Colyseus / server required. When real server is ready,
 *  this file can be removed and bridge.js takes over.
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ── CARD DATABASE (minimal prototype set) ────────────────────
  const UNIT_CARDS = [
    { id: 'u1',  name: 'Fireling',       type: 'unit', hp: 5, maxHp: 5, defense: 1, melee: 2, rangedRange: 0, speed: 3, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'fire' },
    { id: 'u2',  name: 'Ocean Wanderer', type: 'unit', hp: 6, maxHp: 6, defense: 2, melee: 2, rangedRange: 2, speed: 2, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'water' },
    { id: 'u3',  name: 'Arid Scout',     type: 'unit', hp: 4, maxHp: 4, defense: 1, melee: 1, rangedRange: 3, speed: 4, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u4',  name: 'Stone Guard',    type: 'unit', hp: 8, maxHp: 8, defense: 3, melee: 3, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u5',  name: 'Ember Hawk',     type: 'unit', hp: 3, maxHp: 3, defense: 0, melee: 1, rangedRange: 4, speed: 3, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'fire' },
    { id: 'u6',  name: 'Tide Caller',    type: 'unit', hp: 5, maxHp: 5, defense: 1, melee: 2, rangedRange: 2, speed: 2, size: 1, costNeutral: 2, costFire: 0, costWater: 0, element: 'water' },
    { id: 'u7',  name: 'Dune Strider',   type: 'unit', hp: 4, maxHp: 4, defense: 1, melee: 2, rangedRange: 0, speed: 4, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u8',  name: 'Lava Golem',     type: 'unit', hp: 10,maxHp: 10,defense: 4, melee: 4, rangedRange: 0, speed: 1, size: 3, costNeutral: 3, costFire: 0, costWater: 0, element: 'fire' },
    { id: 'u9',  name: 'Reef Stalker',   type: 'unit', hp: 5, maxHp: 5, defense: 2, melee: 2, rangedRange: 1, speed: 2, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'water' },
    { id: 'u10', name: 'Wind Dancer',    type: 'unit', hp: 3, maxHp: 3, defense: 0, melee: 1, rangedRange: 0, speed: 5, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u11', name: 'Iron Bastion',   type: 'unit', hp: 7, maxHp: 7, defense: 3, melee: 3, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u12', name: 'Flame Sprite',   type: 'unit', hp: 3, maxHp: 3, defense: 0, melee: 2, rangedRange: 2, speed: 3, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'fire' },
    { id: 'u13', name: 'Deep Current',   type: 'unit', hp: 6, maxHp: 6, defense: 2, melee: 2, rangedRange: 0, speed: 2, size: 1, costNeutral: 2, costFire: 0, costWater: 0, element: 'water' },
    { id: 'u14', name: 'Dust Phantom',   type: 'unit', hp: 4, maxHp: 4, defense: 1, melee: 1, rangedRange: 3, speed: 3, size: 1, costNeutral: 1, costFire: 0, costWater: 0, element: 'neutral' },
    { id: 'u15', name: 'Cinder Brute',   type: 'unit', hp: 9, maxHp: 9, defense: 3, melee: 4, rangedRange: 0, speed: 1, size: 2, costNeutral: 2, costFire: 0, costWater: 0, element: 'fire' },
  ];

  const BLITZ_CARDS = [
    { id: 'b1', name: 'Surge Forward',  type: 'blitz', description: 'Move one unit 2 extra tiles this turn.',      costNeutral: 1 },
    { id: 'b2', name: 'Iron Shield',    type: 'blitz', description: 'One unit gains +2 Defense until end of turn.', costNeutral: 1 },
    { id: 'b3', name: 'War Cry',        type: 'blitz', description: 'All your units gain +1 Melee this turn.',      costNeutral: 2 },
    { id: 'b4', name: 'Ambush',         type: 'blitz', description: 'One unit may attack without being revealed.',  costNeutral: 1 },
    { id: 'b5', name: 'Tidal Wave',     type: 'blitz', description: 'Push all adjacent enemy units 1 tile back.',   costNeutral: 2 },
    { id: 'b6', name: 'Smoke Screen',   type: 'blitz', description: 'One of your units cannot be targeted this turn.', costNeutral: 1 },
    { id: 'b7', name: 'Quick Draw',     type: 'blitz', description: 'Draw 1 extra card immediately.',               costNeutral: 1 },
    { id: 'b8', name: 'Empower',        type: 'blitz', description: 'One unit gains +2 to all stats this turn.',    costNeutral: 2 },
    { id: 'b9', name: 'Fortify',        type: 'blitz', description: 'One structure gains +5 HP.',                   costNeutral: 1 },
    { id: 'b10',name: 'Counter Charge', type: 'blitz', description: 'When attacked, deal damage back to attacker.', costNeutral: 1 },
  ];

  // ── ENGINE STATE ─────────────────────────────────────────────
  const GS = {
    // Turn 0 = not started yet
    turn:        0,
    // 'player' or 'opponent' — whose turn it is
    activePlayer: 'player',
    // 'standby'|'draw'|'main'|'end'
    phase:       'standby',
    // Both players' hands  { player: [], opponent: [] }
    hands: { player: [], opponent: [] },
    // Decks
    decks: {
      player:   { unit: [], blitz: [] },
      opponent: { unit: [], blitz: [] },
    },
    // Discard piles
    discard: { player: [], opponent: [] },
    // Essence
    essence: { player: { n: 0, f: 0, w: 0 }, opponent: { n: 0, f: 0, w: 0 } },
    // Whether the current player has drawn this phase
    hasDrawnThisTurn: false,
    // Unit deploy counter (for unique IDs)
    deploySeq: 0,
    // CSS interval reference for pulsing deck animation
    _deckPulseInterval: null,
    // Whether game has started
    started: false,
  };

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

  function buildDeck(cards, player, type) {
    // Build 3 copies of each card for a proper deck
    const deck = [];
    cards.forEach(c => {
      deck.push(cloneCard(c, player + '_a'));
      deck.push(cloneCard(c, player + '_b'));
      deck.push(cloneCard(c, player + '_c'));
    });
    return shuffle(deck);
  }

  function toast(msg) {
    if (typeof mtoast === 'function') { mtoast(msg); return; }
    // Fallback toast
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
    // Keep log tidy
    while (log.children.length > 60) log.removeChild(log.lastChild);
  }

  // ── PHASE ANNOUNCEMENT ───────────────────────────────────────

  function announcePhase(phaseName, sub) {
    const ann = document.querySelector('.mph-ann');
    if (!ann) return;
    const txt = ann.querySelector('.mph-ann-txt');
    const subEl = ann.querySelector('.mph-ann-sub');
    if (txt) txt.textContent = phaseName.toUpperCase();
    if (subEl) subEl.textContent = sub || '';
    ann.classList.add('show');
    setTimeout(() => ann.classList.remove('show'), 1400);
  }

  // ── HUD UPDATERS ─────────────────────────────────────────────

  function updatePhaseUI(phase, turn, isMyTurn) {
    // Phase pills
    ['standby', 'draw', 'main', 'end'].forEach(p => {
      const el = document.getElementById('m-ph-' + p);
      if (el) el.classList.toggle('on', p === phase);
    });
    // Turn counter
    const turnEl = document.getElementById('m-turn');
    if (turnEl) turnEl.textContent = turn;
    // Tell Phaser
    if (window.HexScene) {
      window.HexScene.isMyTurn = !!isMyTurn;
      window.HexScene.gameState.phase = phase === 'main' ? 'main' : phase;
    }
  }

  function updateEssenceUI(essence) {
    const en = document.getElementById('m-ess-n');
    const ef = document.getElementById('m-ess-f');
    const ew = document.getElementById('m-ess-w');
    if (en) en.textContent = essence.n ?? 0;
    if (ef) ef.textContent = essence.f ?? 0;
    if (ew) ew.textContent = essence.w ?? 0;
  }

  function updateDeckCounts(player) {
    const d = GS.decks[player];
    const h = GS.hands[player];
    if (player === 'player') {
      const udk  = document.getElementById('m-pl-udk');
      const bdk  = document.getElementById('m-pl-bdk');
      const disc = document.getElementById('m-pl-disc');
      if (udk)  udk.textContent  = d.unit.length;
      if (bdk)  bdk.textContent  = d.blitz.length;
      if (disc) disc.textContent = (GS.discard.player || []).length;
    } else {
      const udk  = document.getElementById('m-ai-udk');
      const bdk  = document.getElementById('m-ai-bdk');
      const disc = document.getElementById('m-ai-disc');
      if (udk)  udk.textContent  = d.unit.length;
      if (bdk)  bdk.textContent  = d.blitz.length;
      if (disc) disc.textContent = (GS.discard.opponent || []).length;
    }
  }

  function updateTurnLabel() {
    const isMe = GS.activePlayer === 'player';
    // Show "Your Turn" / "Opponent's Turn" in the opponent label
    const oppLabel = document.querySelector('.hpav.ai + div .hpname, .hpblock:last-of-type .hpname');
    if (!oppLabel) {
      // Try direct ID approach
      const nodes = document.querySelectorAll('.hpname');
      nodes.forEach(n => {
        if (n.textContent.trim() === 'Opponent' || n.textContent.includes('Opponent')) {
          n.style.color = isMe ? 'rgba(240,232,220,.4)' : '#C9A84C';
        } else {
          // Player label
          n.style.color = isMe ? '#C9A84C' : 'rgba(240,232,220,.4)';
        }
      });
    }
  }

  // ── DECK PULSE ANIMATION ─────────────────────────────────────

  function startDeckPulse() {
    stopDeckPulse();
    const unitBtn  = document.querySelector('.mdk.unit');
    const blitzBtn = document.querySelector('.mdk.blitz');
    if (!unitBtn || !blitzBtn) return;

    let on = true;
    GS._deckPulseInterval = setInterval(() => {
      on = !on;
      const glow = on ? '0 0 18px 4px #C9A84C, inset 0 0 8px rgba(201,168,76,.3)' : 'none';
      const border = on ? '2px solid #C9A84C' : '1px solid rgba(255,140,0,.2)';
      if (unitBtn)  { unitBtn.style.boxShadow  = glow; unitBtn.style.border  = border; }
      if (blitzBtn) { blitzBtn.style.boxShadow = glow; blitzBtn.style.border = border; }
    }, 550);
  }

  function stopDeckPulse() {
    if (GS._deckPulseInterval) {
      clearInterval(GS._deckPulseInterval);
      GS._deckPulseInterval = null;
    }
    const unitBtn  = document.querySelector('.mdk.unit');
    const blitzBtn = document.querySelector('.mdk.blitz');
    if (unitBtn)  { unitBtn.style.boxShadow  = ''; unitBtn.style.border  = ''; }
    if (blitzBtn) { blitzBtn.style.boxShadow = ''; blitzBtn.style.border = ''; }
  }

  // ── HAND RENDERING ───────────────────────────────────────────

  function renderHand(player) {
    // Only render the local player's hand (opponent's is hidden)
    if (player !== 'player') return;
    const cards = GS.hands.player;
    const area  = document.querySelector('.mhand-area');
    if (!area) return;

    // Keep label if exists
    const lbl = area.querySelector('.mhand-lbl');
    area.innerHTML = '';
    if (lbl) area.appendChild(lbl);

    if (!cards.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:.6rem;color:rgba(240,232,220,.3);padding:8px';
      empty.textContent = 'No cards in hand';
      area.appendChild(empty);
      return;
    }

    const essence = GS.essence.player;
    const totalEss = essence.n + essence.f + essence.w;

    cards.forEach(card => {
      const el  = document.createElement('div');
      el.className = 'mhcard';
      el.dataset.cardId = card.id;

      const cost = (card.costNeutral ?? 0) + (card.costFire ?? 0) + (card.costWater ?? 0);
      const canPlay = GS.phase === 'main' && GS.activePlayer === 'player' && totalEss >= cost;
      if (canPlay) el.classList.add('playable');

      // Card visual — colour-coded by type
      const bg = card.type === 'unit'
        ? 'linear-gradient(160deg,rgba(139,0,0,.4),rgba(40,20,20,.9))'
        : 'linear-gradient(160deg,rgba(180,80,0,.35),rgba(30,20,10,.9))';

      el.innerHTML = `
        <div style="width:100%;height:100%;background:${bg};display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:3px;padding:4px;text-align:center">
          <div style="font-size:.52rem;font-weight:700;line-height:1.2;color:#F0E8DC">${card.name}</div>
          <div style="font-size:.45rem;color:rgba(201,168,76,.7);text-transform:uppercase;letter-spacing:.05em">${card.type}</div>
          ${card.type === 'unit' ? `<div style="font-size:.48rem;color:rgba(240,232,220,.5)">HP:${card.hp} SPD:${card.speed}</div>` : `<div style="font-size:.44rem;color:rgba(240,232,220,.4)">${(card.description||'').slice(0,28)}…</div>`}
        </div>
        <div class="mhcard-cost">${cost}</div>
      `;

      el.addEventListener('click', () => showCardPopup(card));
      area.appendChild(el);
    });
  }

  // ── CARD POPUP ───────────────────────────────────────────────

  function showCardPopup(card) {
    const pop = document.querySelector('.mcdpop');
    if (!pop) {
      // Fallback: just deploy directly if it's a unit
      if (card.type === 'unit') deployUnit(card);
      return;
    }

    const nameEl = pop.querySelector('.mcdpop-name');
    const typeEl = pop.querySelector('.mcdpop-type');
    const sgEl   = pop.querySelector('.mcdpop-sg');
    const abEl   = pop.querySelector('.mcdpop-abh');

    if (nameEl) nameEl.textContent = card.name;
    if (typeEl) { typeEl.textContent = card.type; typeEl.className = 'mcdpop-type ' + card.type; }

    if (sgEl) {
      const stats = card.type === 'unit'
        ? [
            { v: card.hp,     l: 'HP' },
            { v: card.defense,l: 'DEF' },
            { v: card.melee,  l: 'Melee' },
            { v: card.rangedRange || 0, l: 'Range' },
            { v: card.speed,  l: 'Speed' },
            { v: card.size,   l: 'Size' },
          ]
        : [{ v: card.costNeutral ?? 0, l: 'Cost' }];

      sgEl.innerHTML = stats.map(s =>
        `<div class="mcdpop-st"><span class="mcdpop-sv">${s.v}</span><span class="mcdpop-sl">${s.l}</span></div>`
      ).join('');
    }

    // Abilities / description
    const abArea = pop.querySelector('.mcdpop-ab');
    if (abArea) {
      abArea.innerHTML = card.description
        ? `<span class="mcdpop-abn">${card.name}:</span> ${card.description}`
        : card.type === 'unit'
          ? `<span class="mcdpop-abn">Deploy:</span> Place on any tile within 2 of your Empire.`
          : '';
    }

    // Play button
    const playBtn = pop.querySelector('.mcdpop-play');
    if (playBtn) {
      const essence  = GS.essence.player;
      const totalEss = essence.n + essence.f + essence.w;
      const cost     = (card.costNeutral ?? 0) + (card.costFire ?? 0) + (card.costWater ?? 0);
      const isMyMain = GS.phase === 'main' && GS.activePlayer === 'player';
      const canPlay  = isMyMain && totalEss >= cost;

      playBtn.textContent = card.type === 'unit' ? '⬡ Deploy Unit'
                          : card.type === 'blitz' ? '⚡ Play Blitz'
                          : '🏗 Deploy Structure';
      playBtn.disabled = !canPlay;
      playBtn.title    = canPlay ? '' : (isMyMain ? 'Not enough Essence' : 'Not your main phase');

      playBtn.onclick = () => {
        pop.classList.remove('on');
        if (card.type === 'unit') {
          deployUnit(card);
        } else if (card.type === 'blitz') {
          playBlitz(card);
        }
      };
    }

    const closeBtn = pop.querySelector('.mcdpop-close');
    if (closeBtn) closeBtn.onclick = () => pop.classList.remove('on');

    pop.classList.add('on');
  }

  // ── UNIT DEPLOYMENT ──────────────────────────────────────────

  function deployUnit(card) {
    if (GS.phase !== 'main' || GS.activePlayer !== 'player') {
      toast('Can only deploy in your Main phase!');
      return;
    }
    const essence = GS.essence.player;
    const cost    = (card.costNeutral ?? 0) + (card.costFire ?? 0) + (card.costWater ?? 0);
    if (essence.n + essence.f + essence.w < cost) {
      toast('Not enough Essence!');
      return;
    }

    // Remove from hand
    const idx = GS.hands.player.indexOf(card);
    if (idx !== -1) GS.hands.player.splice(idx, 1);

    // Deduct essence
    let remaining = cost;
    if (essence.n >= remaining) { essence.n -= remaining; remaining = 0; }
    else { remaining -= essence.n; essence.n = 0; }
    if (remaining > 0 && essence.f >= remaining) { essence.f -= remaining; remaining = 0; }
    else if (remaining > 0) { remaining -= essence.f; essence.f = 0; }
    if (remaining > 0) essence.w = Math.max(0, essence.w - remaining);

    updateEssenceUI(GS.essence.player);
    renderHand('player');

    // Tell Phaser to show deploy zone highlights and await tile click
    if (window.HexScene) {
      // Build a deployable card object with a unique instance ID
      GS.deploySeq++;
      const deployCard = { ...card, _deployId: 'unit_' + GS.deploySeq + '_' + card.id };
      window.HexScene.beginDeploy(deployCard);
      toast('Select a tile near the center to place ' + card.name);
    }
  }

  function playBlitz(card) {
    const idx = GS.hands.player.indexOf(card);
    if (idx !== -1) GS.hands.player.splice(idx, 1);
    GS.discard.player.push(card);
    const cost = card.costNeutral ?? 0;
    GS.essence.player.n = Math.max(0, GS.essence.player.n - cost);
    updateEssenceUI(GS.essence.player);
    renderHand('player');
    updateDeckCounts('player');
    toast('⚡ ' + card.name + ' played!');
    logCombat('⚡ ' + card.name + ': ' + (card.description || 'Effect activated.'), 's');
  }

  // ── DRAW CARD ─────────────────────────────────────────────────

  function drawCard(player, deckType) {
    const deck = GS.decks[player][deckType];
    if (!deck || deck.length === 0) {
      if (player === 'player') toast('Your ' + deckType + ' deck is empty!');
      return null;
    }
    const card = deck.shift();
    GS.hands[player].push(card);
    updateDeckCounts(player);
    return card;
  }

  // ── TURN FLOW ─────────────────────────────────────────────────

  function startGame() {
    if (GS.started) return;
    GS.started = true;

    // Build decks
    GS.decks.player.unit   = buildDeck(UNIT_CARDS,  'pl', 'unit');
    GS.decks.player.blitz  = buildDeck(BLITZ_CARDS, 'pl', 'blitz');
    GS.decks.opponent.unit  = buildDeck(UNIT_CARDS,  'op', 'unit');
    GS.decks.opponent.blitz = buildDeck(BLITZ_CARDS, 'op', 'blitz');

    // Opening hands: 3 Unit + 3 Blitz each
    for (let i = 0; i < 3; i++) {
      drawCard('player',   'unit');
      drawCard('player',   'blitz');
      drawCard('opponent', 'unit');
      drawCard('opponent', 'blitz');
    }

    // Seed board with some revealed tiles so it isn't all dark
    _seedBoardTiles();

    // Update UI
    updateDeckCounts('player');
    updateDeckCounts('opponent');
    renderHand('player');

    // Reveal match screen if not already on
    const mscr = document.getElementById('mscr');
    if (mscr && !mscr.classList.contains('on')) mscr.classList.add('on');

    // Resize Phaser to fit visible canvas
    setTimeout(() => {
      _resizePhaser();
      // Begin Turn 1, Player 1's turn
      beginTurn('player');
    }, 300);
  }

  function beginTurn(player) {
    GS.turn = (GS.turn || 0) + 1;
    GS.activePlayer  = player;
    GS.hasDrawnThisTurn = false;

    // Grant 2 neutral Essence (mimics Empire)
    GS.essence[player].n = 2;
    if (player === 'player') updateEssenceUI(GS.essence.player);

    // Reset all units owned by this player (clear hasMoved / hasActed)
    if (window.HexScene) {
      window.HexScene.gameState.units.forEach(u => {
        if (u.owner === player) {
          u.hasMoved  = false;
          u.hasActed  = false;
          u.deployRest = false;
        }
      });
    }

    updateTurnLabel();
    setPhase('standby');
  }

  function setPhase(phase) {
    GS.phase = phase;
    const isMe = GS.activePlayer === 'player';
    updatePhaseUI(phase, GS.turn, isMe);

    stopDeckPulse();

    switch (phase) {
      case 'standby':
        announcePhase(GS.activePlayer === 'player' ? 'Your Turn' : "Opponent's Turn",
                      'Turn ' + GS.turn + ' — Standby');
        logCombat('⬡ Turn ' + GS.turn + ' — ' + (isMe ? 'YOUR' : "OPPONENT'S") + ' standby', 's');
        // Standby resolves automatically after 1.5s
        setTimeout(() => setPhase('draw'), 1500);
        break;

      case 'draw':
        announcePhase('Draw Phase', isMe ? 'Choose a deck to draw from' : "Opponent's Draw Phase");
        if (isMe) {
          startDeckPulse();
          toast('Draw 1 card — click your Unit or Blitz deck');
        } else {
          // Opponent draws automatically
          setTimeout(() => {
            const type = Math.random() < 0.6 ? 'unit' : 'blitz';
            drawCard('opponent', type);
            updateDeckCounts('opponent');
            setPhase('main');
          }, 1200);
        }
        break;

      case 'main':
        announcePhase('Main Phase', isMe ? 'Deploy, Move, or Attack' : "Opponent's Main Phase");
        logCombat((isMe ? '▶ Your' : "▶ Opponent's") + ' main phase', 's');
        if (!isMe) {
          // Opponent does nothing visible in main (or we could add simple AI later)
          toast("Opponent's turn — click End Turn when ready");
        } else {
          toast('Main Phase — play cards or select units to act');
        }
        break;

      case 'end':
        announcePhase('End Phase', '');
        logCombat('◀ Turn ' + GS.turn + ' ends', 's');
        // End phase resolves after a short pause
        setTimeout(() => {
          const nextPlayer = GS.activePlayer === 'player' ? 'opponent' : 'player';
          beginTurn(nextPlayer);
        }, 800);
        break;
    }
  }

  // ── END TURN HANDLER ─────────────────────────────────────────

  function handleEndTurn() {
    if (GS.phase === 'draw' && GS.activePlayer === 'player' && !GS.hasDrawnThisTurn) {
      toast('You must draw a card first!');
      return;
    }
    if (GS.phase !== 'main' && GS.phase !== 'draw') {
      toast('Wait for your main phase to end your turn.');
      return;
    }
    // Discard any unit deploy highlights
    if (window.HexScene) {
      window.HexScene._clearSelection();
    }
    setPhase('end');
  }

  // ── DRAW CARD HANDLER (DOM deck click) ───────────────────────

  function handleDrawCard(deckType) {
    if (GS.activePlayer !== 'player') {
      toast("Not your turn!");
      return;
    }
    if (GS.phase !== 'draw') {
      toast('You can only draw during the Draw phase.');
      return;
    }
    if (GS.hasDrawnThisTurn) {
      toast('You already drew this turn.');
      return;
    }
    const card = drawCard('player', deckType);
    if (!card) return;

    GS.hasDrawnThisTurn = true;
    stopDeckPulse();
    renderHand('player');
    toast('Drew: ' + card.name);
    logCombat('🃏 You drew ' + card.name + ' from ' + deckType + ' deck', 'a');

    // Auto-advance to main phase after a short delay
    setTimeout(() => setPhase('main'), 700);
  }

  // ── BOARD SEED ───────────────────────────────────────────────

  function _seedBoardTiles() {
    if (!window.HexScene) return;
    // Reveal a meaningful spread of tiles so units can be placed
    // Center-ish tiles in the diamond
    const neutralIds = [
      10, 11, 12, 13,
      18, 19, 20, 21, 22,
      26, 27, 28, 29, 30, 31,
      35, 36, 37, 38, 39, 40, 41,
      44, 45, 46, 47, 48,
      52, 53, 54, 55,
    ];
    const fireIds   = [5, 6, 7, 16, 17, 58, 59, 60];
    const waterIds  = [61, 62, 63, 49, 50, 0, 1, 2];

    const scene = window.HexScene;
    neutralIds.forEach(id => {
      if (scene.tiles[id]) scene.tiles[id].type = 'neutral';
    });
    fireIds.forEach(id => {
      if (scene.tiles[id]) scene.tiles[id].type = 'fire';
    });
    waterIds.forEach(id => {
      if (scene.tiles[id]) scene.tiles[id].type = 'water';
    });
    scene._refreshAll();
  }

  // ── PHASER RESIZE ────────────────────────────────────────────

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
        if (window.HexScene._resyncTokenPositions) {
          window.HexScene._resyncTokenPositions();
        }
      }
    }
  }

  // ── UNIT LIST SIDEBAR ────────────────────────────────────────

  function refreshUnitSidebar() {
    if (!window.HexScene) return;
    const playerUnits = window.HexScene.gameState.units.filter(u => u.owner === 'player');
    const oppUnits    = window.HexScene.gameState.units.filter(u => u.owner !== 'player');

    _renderSidebarUnits('m-pl-units', playerUnits);
    _renderSidebarUnits('m-ai-units', oppUnits);
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
      const hpPct = Math.max(0, Math.round((u.hp / (u.maxHp || 1)) * 100));
      const row   = document.createElement('div');
      row.className = 'uip-row';
      row.innerHTML = `
        <div class="uip-data">
          <div class="uip-nm">${u.name}</div>
          <div class="uip-hb"><div class="uip-hbf" style="width:${hpPct}%"></div></div>
          <div class="uip-hp">${u.hp}/${u.maxHp || u.hp} HP</div>
        </div>
      `;
      row.addEventListener('click', () => {
        if (!window.HexScene) return;
        const unitData = window.HexScene.gameState.units.find(gu => gu.id === u.id);
        const tile     = unitData ? window.HexScene.tiles.find(t => t.id === unitData.tileId) : null;
        if (unitData && tile) window.HexScene._selectUnit(unitData, tile);
      });
      el.appendChild(row);
    });
  }

  // ── WIRE INTO EXISTING M / index.html HOOKS ──────────────────

  function wireHooks() {
    // Override M.endTurn — called by "End Turn" button in HTML
    if (typeof M !== 'undefined') {
      M.endTurn = handleEndTurn;
      M.drawCard = handleDrawCard;
      M.startGame = startGame;

      // Allow M.selectAction to still reach Phaser
      M.selectAction = function (action) {
        if (window.HexScene) window.HexScene.selectAction(action);
      };
    } else {
      // M not defined yet — patch global function references used in onclick handlers
      window.endTurnFn   = handleEndTurn;
      window.drawCardFn  = handleDrawCard;
    }

    // Patch the onclick="M.endTurn()" and onclick="M.drawCard(...)" buttons
    // by overwriting on the object if M exists, or by hooking after DOMContentLoaded
    const endBtn = document.querySelector('.mhud-btn.end');
    if (endBtn) {
      endBtn.onclick = (e) => { e.preventDefault(); handleEndTurn(); };
    }

    const deckUnit  = document.querySelector('.mdk.unit');
    const deckBlitz = document.querySelector('.mdk.blitz');
    if (deckUnit)  deckUnit.onclick  = () => handleDrawCard('unit');
    if (deckBlitz) deckBlitz.onclick = () => handleDrawCard('blitz');
  }

  // ── LISTEN FOR EVENTS FROM PHASER ────────────────────────────

  window.addEventListener('unitSelected', function (e) {
    const unit = e.detail;
    if (!unit) return;

    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl) {
      nameEl.textContent = unit.name || unit.id;
      nameEl.style.color = '#F0E8DC';
    }
    if (statsEl) {
      const moved  = unit.hasMoved  ? '<span style="color:#FF8888">Used</span>' : `${unit.speed ?? '?'} tiles`;
      const acted  = unit.hasActed  ? '<span style="color:#FF8888">Used</span>' : 'Ready';
      const dRest  = unit.deployRest ? ' <span style="color:#FF8888;font-size:.55rem">(Deploy Rest)</span>' : '';
      statsEl.innerHTML = `
        <span>HP <span>${unit.hp}/${unit.maxHp || unit.hp}</span></span>
        <span>SPD <span>${moved}</span></span>
        <span>MEL <span>${acted}</span></span>
        <span>RNG <span>${unit.rangedRange ?? 0}</span></span>
        ${dRest}
      `;
    }

    const moveSub = document.getElementById('m-ab-move-sub');
    if (moveSub) moveSub.textContent = unit.hasMoved ? 'Used' : `${unit.speed ?? '?'} tiles`;

    const rangeSub = document.getElementById('m-ab-range-sub');
    if (rangeSub) rangeSub.textContent = unit.rangedRange ? `${unit.rangedRange} range` : 'N/A';

    // Highlight action buttons for deploy-rested units
    const moveBtn = document.getElementById('m-ab-move');
    if (moveBtn) moveBtn.classList.toggle('disabled', !!unit.hasMoved || !!unit.deployRest);
  });

  window.addEventListener('unitDeselected', function () {
    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl) { nameEl.textContent = '— Select a unit on board —'; nameEl.style.color = 'rgba(240,232,220,.3)'; }
    if (statsEl) statsEl.innerHTML = '';
  });

  // After a unit is deployed via Phaser (tile clicked), refresh sidebar
  window.addEventListener('unitDeployed', function () {
    renderHand('player');
    refreshUnitSidebar();
    logCombat('⬡ Unit deployed to board', 'a');
  });

  // ── EXPOSE FOR DEBUGGING (do this first so console can call ZB.startGame()) ──
  window.ZB = {
    GS,
    startGame,
    setPhase,
    beginTurn,
    drawCard,
    handleEndTurn,
    handleDrawCard,
    wireHooks,
    renderHand,
    refreshUnitSidebar,
  };

  // ── ROBUST STARTUP: poll every 200ms until everything is ready ───
  // Handles all race conditions:
  //   - network.js shows #mscr before localEngine.js loads
  //   - hexSceneReady fires before localEngine.js loads
  //   - DOMContentLoaded already fired
  //   - Any ordering of Colyseus join vs script load

  function _tryStart() {
    if (GS.started) return; // already running

    const mscr = document.getElementById('mscr');
    const mscrVisible = mscr && mscr.classList.contains('on');
    const phaserReady = !!window.HexScene;

    if (mscrVisible && phaserReady) {
      console.log('[LOCAL ENGINE] Both conditions met — starting game');
      wireHooks();
      startGame();
      return;
    }

    if (mscrVisible && !phaserReady) {
      console.log('[LOCAL ENGINE] Match screen visible, waiting for Phaser...');
    } else if (!mscrVisible && phaserReady) {
      console.log('[LOCAL ENGINE] Phaser ready, waiting for match screen...');
    }
  }

  // Poll every 250ms for up to 30 seconds
  let _startAttempts = 0;
  const _startPoller = setInterval(function () {
    _startAttempts++;
    _tryStart();
    if (GS.started || _startAttempts > 120) {
      clearInterval(_startPoller);
      if (!GS.started) console.warn('[LOCAL ENGINE] Gave up waiting after 30s');
    }
  }, 250);

  // Also hook events as backup (in case they fire after this script loads)
  window.addEventListener('hexSceneReady', function () {
    console.log('[LOCAL ENGINE] hexSceneReady event received');
    setTimeout(_tryStart, 100);
  });

  // Watch for mscr getting 'on' class
  const _mscrObserver = new MutationObserver(function (mutations) {
    for (const mut of mutations) {
      if (mut.attributeName === 'class' && mut.target.id === 'mscr') {
        console.log('[LOCAL ENGINE] #mscr class changed:', mut.target.className);
        setTimeout(_tryStart, 200);
      }
    }
  });
  const _mscr = document.getElementById('mscr');
  if (_mscr) _mscrObserver.observe(_mscr, { attributes: true });

  // Wire buttons immediately regardless (safe to call multiple times)
  wireHooks();

  console.log('[LOCAL ENGINE] Loaded — polling for start conditions (mscr.on + HexScene)');

})();
