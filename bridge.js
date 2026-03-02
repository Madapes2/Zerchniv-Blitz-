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
          const tile = window.HexScene.tiles.find(t => t.id === numId || String(t.id) === String(id));
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
          const tile = window.HexScene.tiles.find(t => String(t.id) === String(id));
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

      // During setup phases, render the tile/empire placement bar
      if (phase === 'setup_tiles' || phase === 'setup_empire') {
        if (window.ZB && window.ZB.renderHand) window.ZB.renderHand();
      }
    };

    // ── 10. INIT FROM SERVER ─────────────────────────────────
    // network.js calls M.initFromServer(state, mySeat) on game_start
    const _origInitFromServer = M.initFromServer;
    M.initFromServer = function (state, seat) {
      if (_origInitFromServer) _origInitFromServer.call(M, state, seat);

      // Expose seat to server client
      window._zbMySeat = seat;
      console.log('[BRIDGE] My seat:', seat);

      // Show match screen
      const mscr = document.getElementById('mscr');
      if (mscr && !mscr.classList.contains('on')) mscr.classList.add('on');

      // Hand off to server client
      // Store args so ZB can pick them up even if it loads after this fires
      window._zbPendingStart = { seat, state };
      console.log('[BRIDGE] Queued game start for ZB, seat:', seat, 'state keys:', Object.keys(state || {}));

      function _tryHandoff() {
        console.log('[BRIDGE] _tryHandoff attempt — ZB:', !!window.ZB, 'HexScene:', !!window.HexScene);
        if (window.ZB && window.ZB.onGameStart && window.HexScene) {
          window._zbPendingStart = null;
          window.ZB.onGameStart(seat, state);
        } else {
          setTimeout(_tryHandoff, 150);
        }
      }
      setTimeout(_tryHandoff, 100);
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
          const tile = window.HexScene.tiles.find(t => String(t.id) === String(id));
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
   SERVER CLIENT — all game state is authoritative on Colyseus.
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   SERVER CLIENT — Zerchniv Blitz
   Replaces the local engine. All game state lives on the Colyseus
   server. This file only:
     1. Sends player actions to the server
     2. Listens to state patches and renders them
     3. Shows/hides UI based on whose turn it is

   The server (GameRoom.ts) is the single source of truth.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── ROOM CAPTURE — runs immediately on script load ────────────
  // Patch Colyseus.Client.prototype NOW before network.js calls joinOrCreate.
  // Load order: Colyseus SDK → network.js → bridge.js
  // network.js calls joinOrCreate when player clicks Battle!, which happens
  // AFTER page load, so this patch fires in time.
  (function _patchColyseus() {
    if (!window.Colyseus || !window.Colyseus.Client) {
      setTimeout(_patchColyseus, 50);
      return;
    }
    const proto = window.Colyseus.Client.prototype;
    if (proto._zbPatched) return;
    proto._zbPatched = true;

    ['joinOrCreate', 'join', 'create', 'joinById', 'reconnect'].forEach(method => {
      if (!proto[method]) return;
      const orig = proto[method];
      proto[method] = async function(...args) {
        const room = await orig.apply(this, args);
        if (room && !window._zbRoom) {
          window._zbRoom = room;
          console.log('[ZB] Room captured via', method, ':', room.roomId, room.sessionId);
        }
        return room;
      };
    });
    console.log('[ZB] Colyseus.Client patched for room capture');
  })();

  // ── CLIENT STATE (render-only, never authoritative) ───────────
  const CS = {
    mySeat:        null,   // "p1" or "p2" seat label
    mySessionId:   null,   // actual Colyseus sessionId
    activePlayerId: null,  // "p1" or "p2" seat label (from phase_change broadcasts)
    activeSessionId: null, // sessionId of active player (from schema auto-sync)
    currentPhase:  null,   // Phase enum string from server
    myHand:        [],     // card ids in my hand (private, sent directly)
    tiles:         {},     // tileId → { tileType, revealed, occupiedBy }
    units:         {},     // instanceId → unit data
    essence:       { neutral: 0, fire: 0, water: 0 },
    deckCounts:    { unit: 0, blitz: 0, discard: 0 },
    oppDeckCounts: { unit: 0, blitz: 0 },
    // Tile placement bag — 19 neutral, 5 fire, 5 water
    myTilesLeft:   { neutral: 19, fire: 5, water: 5 },
    selectedTileType: null,   // for placement UI
    // Card definitions (populated from server state patches)
    cardDefs:      {},
    _deckPulseInterval: null,
    ready: false,
  };

  // ── IS MY TURN ────────────────────────────────────────────────
  function isMyTurn() {
    if (!CS.mySeat || !CS.activePlayerId) return false;
    // Compare seat labels — both should be "p1" or "p2"
    return CS.mySeat.toLowerCase() === CS.activePlayerId.toLowerCase();
  }

  // ── SEND TO SERVER ────────────────────────────────────────────
  function send(type, payload) {
    const room = _getRoom();
    if (room) {
      try {
        room.send(type, payload);
      } catch(e) {
        console.error('[SERVER CLIENT] send error:', e);
      }
    } else {
      console.warn('[SERVER CLIENT] No room connection — cannot send:', type, payload);
    }
  }

  function _getRoom() {
    // Already captured
    if (window._zbRoom) {
      // Also store sessionId the first time we see it
      if (!CS.mySessionId && window._zbRoom.sessionId) {
        CS.mySessionId = window._zbRoom.sessionId;
        console.log('[ZB] My sessionId:', CS.mySessionId);
      }
      return window._zbRoom;
    }

    // network.js stores room privately — try to find it by scanning NET object
    if (window.NET) {
      for (const key of Object.keys(window.NET)) {
        const val = window.NET[key];
        if (val && typeof val === 'object' && typeof val.send === 'function' && val.roomId) {
          window._zbRoom = val;
          console.log('[ZB] Room found on NET.' + key);
          return val;
        }
      }
      // Try private _room via property access (works if not truly private)
      if (window.NET._room) { window._zbRoom = window.NET._room; return window._zbRoom; }
    }

    // Fallback: direct global
    if (window.room && typeof window.room.send === 'function') return window.room;

    return null;
  }

  // ── TOAST / LOG ───────────────────────────────────────────────
  function toast(msg) {
    if (typeof mtoast === 'function') { mtoast(msg); return; }
  }

  function logCombat(msg, cls) {
    const log = document.getElementById('m-clog');
    if (!log) return;
    const p = document.createElement('p');
    p.className = 'mclog-msg ' + (cls || 's');
    p.textContent = msg;
    log.prepend(p);
    while (log.children.length > 80) log.removeChild(log.lastChild);
  }

  // ── PHASE ANNOUNCEMENT ────────────────────────────────────────
  function announcePhase(title, sub) {
    const ann = document.querySelector('.mph-ann');
    if (!ann) return;
    const txt   = ann.querySelector('.mph-ann-txt');
    const subEl = ann.querySelector('.mph-ann-sub');
    if (txt)   txt.textContent   = title.toUpperCase();
    if (subEl) subEl.textContent = sub || '';
    ann.classList.add('show');
    setTimeout(() => ann.classList.remove('show'), 1600);
  }

  // ── PHASE UI ─────────────────────────────────────────────────
  // Maps server Phase enum to pill ids
  const PHASE_MAP = {
    'SETUP_TILES':  null,     // no pills for setup
    'SETUP_EMPIRE': null,
    'STANDBY':      'standby',
    'DRAW':         'draw',
    'MAIN':         'main',
    'END':          'end',
  };

  function updatePhaseUI(phase) {
    ['standby','draw','main','end'].forEach(p => {
      const el = document.getElementById('m-ph-' + p);
      if (el) el.classList.toggle('on', PHASE_MAP[phase] === p);
    });
    // Sync Phaser turn flag — only allow interaction during MAIN phase on your turn
    if (window.HexScene) {
      window.HexScene.isMyTurn = isMyTurn() && phase === 'MAIN';
    }
  }

  function updateTurnBanner() {
    document.querySelectorAll('.hpname').forEach(n => {
      const isOpp = n.textContent.includes('Opponent');
      const myActive = isMyTurn();
      n.style.color = isOpp
        ? (myActive ? 'rgba(240,232,220,.35)' : '#C9A84C')
        : (myActive ? '#C9A84C' : 'rgba(240,232,220,.35)');
    });
  }

  // ── ESSENCE UI ────────────────────────────────────────────────
  function updateEssenceUI(essence) {
    CS.essence = essence;
    const en = document.getElementById('m-ess-n');
    const ef = document.getElementById('m-ess-f');
    const ew = document.getElementById('m-ess-w');
    if (en) en.textContent = essence.neutral ?? 0;
    if (ef) ef.textContent = essence.fire    ?? 0;
    if (ew) ew.textContent = essence.water   ?? 0;
  }

  // ── DECK COUNT UI ─────────────────────────────────────────────
  function updateDeckUI(unitCount, blitzCount, discardCount, isMe) {
    const prefix = isMe ? 'm-pl' : 'm-ai';
    const udk  = document.getElementById(prefix + '-udk');
    const bdk  = document.getElementById(prefix + '-bdk');
    const disc = document.getElementById(prefix + '-disc');
    if (udk)  udk.textContent  = unitCount   ?? 0;
    if (bdk)  bdk.textContent  = blitzCount  ?? 0;
    if (disc) disc.textContent = discardCount ?? 0;
  }

  // ── DECK PULSE ────────────────────────────────────────────────
  function startDeckPulse() {
    stopDeckPulse();
    const btns = [document.querySelector('.mdk.unit'), document.querySelector('.mdk.blitz')];
    let on = true;
    CS._deckPulseInterval = setInterval(() => {
      on = !on;
      const glow   = on ? '0 0 18px 4px #C9A84C, inset 0 0 8px rgba(201,168,76,.3)' : 'none';
      const border = on ? '2px solid #C9A84C' : '1px solid rgba(255,140,0,.2)';
      btns.forEach(b => { if (b) { b.style.boxShadow = glow; b.style.border = border; } });
    }, 550);
  }

  function stopDeckPulse() {
    if (CS._deckPulseInterval) { clearInterval(CS._deckPulseInterval); CS._deckPulseInterval = null; }
    [document.querySelector('.mdk.unit'), document.querySelector('.mdk.blitz')].forEach(b => {
      if (b) { b.style.boxShadow = ''; b.style.border = ''; }
    });
  }

  // ── HAND RENDERING ───────────────────────────────────────────
  function renderHand() {
    const area = document.querySelector('.mhand-area');
    if (!area) { console.warn('[ZB] renderHand: .mhand-area not found'); return; }

    const lbl = area.querySelector('.mhand-lbl');
    area.innerHTML = '';
    if (lbl) area.appendChild(lbl);

    // Tile setup phases — show tile placement bar
    const phaseNorm = (CS.currentPhase || '').toLowerCase();
    console.log('[ZB] renderHand — phase:', CS.currentPhase, '| phaseNorm:', phaseNorm, '| isMyTurn:', isMyTurn());
    if (phaseNorm === 'setup_tiles' || phaseNorm === 'setup_empire') {
      _renderSetupBar(area);
      return;
    }

    if (!CS.myHand.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:.6rem;color:rgba(240,232,220,.3);padding:8px;align-self:center';
      empty.textContent = 'No cards in hand';
      area.appendChild(empty);
      return;
    }

    const totalEss = CS.essence.neutral + CS.essence.fire + CS.essence.water;
    const myMain   = isMyTurn() && CS.currentPhase === 'MAIN';

    CS.myHand.forEach(cardId => {
      const def    = CS.cardDefs[cardId] || { id: cardId, name: cardId, type: 'unit', essenceCost: { neutral: 1 } };
      const cost   = (def.essenceCost?.neutral ?? 0) + (def.essenceCost?.fire ?? 0) + (def.essenceCost?.water ?? 0);
      const canPlay = myMain && totalEss >= cost;

      const el = document.createElement('div');
      el.className = 'mhcard' + (canPlay ? ' playable' : '');
      el.dataset.cardId = cardId;

      const elemColor = def.element === 'fire'  ? 'rgba(226,88,34,.6)'
                      : def.element === 'water' ? 'rgba(30,144,255,.6)'
                      : 'rgba(180,170,140,.4)';

      const imgUrl = 'assets/cards/' + cardId.toLowerCase() + '.jpg';
      el.innerHTML = `
        <img src="${imgUrl}" alt="${def.name}"
          style="width:100%;height:100%;object-fit:cover;border-radius:4px 4px 0 0;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div style="display:none;width:100%;height:100%;
          background:linear-gradient(160deg,${elemColor},rgba(10,10,8,.95));
          flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px;text-align:center;">
          <div style="font-size:.52rem;font-weight:700;color:#F0E8DC">${def.name}</div>
          <div style="font-size:.44rem;color:rgba(201,168,76,.7);text-transform:uppercase">${def.type}</div>
          ${def.type === 'unit'
            ? `<div style="font-size:.44rem;color:rgba(240,232,220,.5)">HP:${def.hp} SPD:${def.speed}</div>`
            : `<div style="font-size:.42rem;color:rgba(240,232,220,.4)">${(def.description||'').slice(0,30)}…</div>`}
        </div>
        <div class="mhcard-cost">${cost}</div>
      `;
      el.addEventListener('click', () => showCardPopup(cardId, def));
      area.appendChild(el);
    });
  }

  // ── TILE SETUP BAR ────────────────────────────────────────────
  function _renderSetupBar(area) {
    const myTurn   = isMyTurn();
    const isEmpire = (CS.currentPhase || '').toLowerCase() === 'setup_empire';

    const bar = document.createElement('div');
    bar.style.cssText = `
      display:flex;align-items:center;gap:1rem;padding:0 1.5rem;
      width:100%;min-height:60px;height:100%;
      background:rgba(6,4,12,0.6);
      border-top:1px solid rgba(201,168,76,0.2);
    `;

    if (isEmpire) {
      // Empire placement phase
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:.75rem;font-weight:700;color:' + (myTurn ? '#C9A84C' : 'rgba(240,232,220,.3)');
      lbl.textContent = myTurn ? '⬡ Click a tile to place your Empire' : 'Waiting for opponent to place Empire…';
      bar.appendChild(lbl);
    } else {
      // Tile placement phase
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(240,232,220,.4);white-space:nowrap';
      labelEl.style.cssText = 'font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + (myTurn ? 'rgba(201,168,76,.8)' : 'rgba(240,232,220,.3)') + ';white-space:nowrap';
      labelEl.textContent = myTurn ? 'Place Your Tiles:' : "Waiting for opponent to place tiles…";
      bar.appendChild(labelEl);

      if (myTurn) {
        const TYPES = [
          { type: 'neutral', color: '#B4AA8C', bg: 'rgba(180,170,140,.15)', border: 'rgba(180,170,140,.4)', label: 'Neutral', count: CS.myTilesLeft.neutral },
          { type: 'fire',    color: '#F4956A', bg: 'rgba(226,88,34,.15)',   border: '#E25822',              label: 'Fire',    count: CS.myTilesLeft.fire    },
          { type: 'water',   color: '#72B8FF', bg: 'rgba(30,144,255,.15)',  border: '#1E90FF',              label: 'Water',   count: CS.myTilesLeft.water   },
        ];

        TYPES.forEach(({ type, color, bg, border, label, count }) => {
          const btn = document.createElement('div');
          btn.dataset.tileType = type;
          const selected = CS.selectedTileType === type;
          btn.style.cssText = `
            display:flex;align-items:center;gap:.5rem;padding:.5rem 1.1rem;
            background:${selected ? 'rgba(201,168,76,.25)' : bg};
            border:${selected ? '2px solid #C9A84C' : `1px solid ${border}`};
            border-radius:6px;cursor:${count > 0 ? 'pointer' : 'not-allowed'};
            transition:all .15s;opacity:${count > 0 ? '1' : '0.3'};
            ${selected ? `box-shadow:0 0 12px 2px ${color}55;` : ''}
          `;
          btn.innerHTML = `
            <span style="font-size:.9rem;font-weight:700;letter-spacing:.04em;color:${color}">${label}</span>
            <span style="display:flex;align-items:center;gap:.15rem">
              <span style="font-size:.7rem;color:rgba(240,232,220,.4)">×</span>
              <span style="font-size:.9rem;font-weight:700;color:#F0E8DC">${count}</span>
            </span>
          `;

          if (count > 0) {
            btn.addEventListener('click', () => {
              CS.selectedTileType = CS.selectedTileType === type ? null : type;
              renderHand(); // re-render to show selection
              toast(CS.selectedTileType ? 'Click a tile to place: ' + CS.selectedTileType : 'Deselected');
            });
          }
          bar.appendChild(btn);
        });

        // Done button
        const right = document.createElement('div');
        right.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:.5rem';

        const instr = document.createElement('div');
        instr.style.cssText = 'font-size:.65rem;color:rgba(240,232,220,.4);font-style:italic';
        instr.textContent = CS.selectedTileType ? 'Click board to place' : 'Select type then click board';
        right.appendChild(instr);

        const doneBtn = document.createElement('div');
        doneBtn.style.cssText = `
          padding:.5rem 1.2rem;background:rgba(201,168,76,.2);
          border:1px solid rgba(201,168,76,.6);border-radius:5px;
          font-size:.85rem;font-weight:700;letter-spacing:.06em;
          text-transform:uppercase;color:#C9A84C;cursor:pointer;white-space:nowrap;
          box-shadow:0 0 10px rgba(201,168,76,.2);
        `;
        doneBtn.textContent = 'Done Placing →';
        doneBtn.addEventListener('click', () => {
          CS.selectedTileType = null;
          send('end_tile_placement', {});
          logCombat('✓ Tile placement submitted', 's');
          toast('Waiting for opponent…');
          renderHand();
        });
        right.appendChild(doneBtn);
        bar.appendChild(right);
      }
    }

    area.appendChild(bar);
  }

  // ── CARD POPUP ────────────────────────────────────────────────
  function showCardPopup(cardId, def) {
    const pop = document.querySelector('.mcdpop');
    if (!pop) {
      if (def.type === 'unit') beginDeploy(cardId, def);
      return;
    }

    const nameEl = pop.querySelector('.mcdpop-name');
    const typeEl = pop.querySelector('.mcdpop-type');
    const sgEl   = pop.querySelector('.mcdpop-sg');
    const abArea = pop.querySelector('.mcdpop-ab');
    const imgEl  = pop.querySelector('.mcdpop-img img, .mcdpop img');

    if (nameEl) nameEl.textContent = def.name || cardId;
    if (typeEl) { typeEl.textContent = def.type; typeEl.className = 'mcdpop-type ' + def.type; }
    if (imgEl)  { imgEl.src = 'assets/cards/' + cardId.toLowerCase() + '.jpg'; imgEl.alt = def.name; }

    if (sgEl && def.type === 'unit') {
      sgEl.innerHTML = [
        { v: def.hp,      l: 'HP'    },
        { v: def.defense, l: 'DEF'   },
        { v: def.melee,   l: 'Melee' },
        { v: def.rangedAttack ?? 0, l: 'Range' },
        { v: def.speed,   l: 'Speed' },
        { v: def.size,    l: 'Size'  },
      ].map(s => `<div class="mcdpop-st"><span class="mcdpop-sv">${s.v ?? '—'}</span><span class="mcdpop-sl">${s.l}</span></div>`).join('');
    }

    if (abArea) {
      abArea.innerHTML = def.description
        ? `<span class="mcdpop-abn">${def.name}:</span> ${def.description}`
        : `<span class="mcdpop-abn">Deploy:</span> Place near your Empire or a Structure.`;
    }

    const playBtn = pop.querySelector('.mcdpop-play');
    if (playBtn) {
      const cost    = (def.essenceCost?.neutral ?? 0) + (def.essenceCost?.fire ?? 0) + (def.essenceCost?.water ?? 0);
      const totalEss = CS.essence.neutral + CS.essence.fire + CS.essence.water;
      const myMain  = isMyTurn() && (CS.currentPhase||'').toLowerCase() === 'main';
      const canPlay = myMain && totalEss >= cost;

      playBtn.textContent = def.type === 'unit' ? '⬡ Deploy Unit'
                          : def.type === 'structure' ? '🏗 Deploy Structure'
                          : '⚡ Play Blitz';
      playBtn.disabled = !canPlay;
      playBtn.title    = canPlay ? '' : (myMain ? 'Not enough Essence' : 'Not your Main Phase');
      playBtn.onclick  = () => {
        pop.classList.remove('on');
        if (def.type === 'unit') beginDeploy(cardId, def);
        else                     send('play_blitz', { cardId });
      };
    }

    const closeBtn = pop.querySelector('.mcdpop-close');
    if (closeBtn) closeBtn.onclick = () => pop.classList.remove('on');

    pop.classList.add('on');
  }

  // ── UNIT DEPLOYMENT ──────────────────────────────────────────
  function beginDeploy(cardId, def) {
    if (!isMyTurn() || (CS.currentPhase||'').toLowerCase() !== 'main') {
      toast('Not your Main Phase!');
      return;
    }
    if (window.HexScene) {
      // Pass card to Phaser for tile selection; _doDeploy will fire 'unitDeployed' event
      window.HexScene.beginDeploy({ ...def, id: cardId, _serverCardId: cardId });
      toast('Select a spawn tile for ' + (def.name || cardId));
    }
  }

  // ── BOARD RENDERING ───────────────────────────────────────────
  // Apply tile state from server schema patches to Phaser
  function applyTileState(tiles) {
    if (!window.HexScene) return;
    // tiles is a Colyseus MapSchema converted to plain object
    Object.entries(tiles).forEach(([tileId, tileData]) => {
      // Convert server tileId (e.g. "r3c5") to Phaser tile index if needed
      const tile = window.HexScene.tiles.find(t => t.id === tileId || t.serverId === tileId);
      if (!tile) return;
      tile.type     = tileData.tileType  || 'hidden';
      tile.revealed = tileData.revealed  ?? false;
    });
    window.HexScene._refreshAll();
  }

  function applyUnitState(units) {
    if (!window.HexScene || !units) return;
    // Handle both array (from state_update) and MapSchema (from onStateChange)
    let incoming = [];
    if (Array.isArray(units)) {
      incoming = units.filter(Boolean);
    } else if (typeof units.forEach === 'function') {
      units.forEach(u => { if (u) incoming.push(u); });
    } else {
      incoming = Object.values(units).filter(Boolean);
    }
    incoming.forEach(u => {
      if (!u || !u.instanceId) return; // skip undefined/malformed entries
      const existing = window.HexScene.gameState?.units?.find(gu => gu.id === u.instanceId);
      const owner    = (u.ownerId === CS.mySessionId || u.owner === 'player' || u.owner === CS.mySeat) ? 'player' : 'opponent';
      if (existing) {
        existing.hp       = u.currentHp;
        existing.tileId   = u.tileId;
        existing.hasMoved = u.hasMovedThisTurn;
        existing.hasActed = u.hasAttackedThisTurn;
      } else {
        const def = CS.cardDefs[u.cardId] || {};
        const newUnit = {
          id:          u.instanceId,
          tileId:      u.tileId,
          owner,
          name:        def.name || u.cardId,
          hp:          u.currentHp,
          maxHp:       def.hp    || u.currentHp,
          speed:       def.speed || 2,
          melee:       def.melee || 1,
          rangedRange: def.rangedRange || 0,
          defense:     def.defense || 0,
          hasMoved:    u.hasMovedThisTurn,
          hasActed:    u.hasAttackedThisTurn,
          deployRest:  u.hasDevelopmentRest,
        };
        window.HexScene.gameState.units.push(newUnit);
        window.HexScene._spawnToken(newUnit);
      }
    });

    // Remove units no longer in server state
    const incomingIds = new Set(incoming.map(u => u.instanceId));
    window.HexScene.gameState.units = window.HexScene.gameState.units.filter(u => {
      if (!incomingIds.has(u.id)) {
        window.HexScene._removeToken(u.id);
        return false;
      }
      return true;
    });

    window.HexScene._refreshAll();
    refreshUnitSidebar();
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
        <div class="uip-hp">${u.hp}/${u.maxHp} HP</div>
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

  // ── HOOK: Phaser tile clicked during setup ────────────────────
  function _hookPhaserTileClick() {
    if (!window.HexScene || window.HexScene._serverClientHooked) return;
    window.HexScene._serverClientHooked = true;

    const origClick = window.HexScene._onTileClick.bind(window.HexScene);
    window.HexScene._onTileClick = function (tile) {
      // During tile placement
      if ((CS.currentPhase||'').toLowerCase() === 'setup_tiles' && CS.selectedTileType && isMyTurn()) {
        // Determine correct type — fire and water both come from elemental budget
        const serverType = CS.selectedTileType; // 'neutral', 'fire', or 'water'

        // Prevent placing on an already-placed tile
        if (tile._zbPlaced) return;
        tile._zbPlaced = true; // mark immediately to prevent double-send

        // Optimistic local render
        tile.type = serverType;
        window.HexScene._drawTile(tile, window.HexScene.tileGfx[window.HexScene.tiles.indexOf(tile)]);

        // Deduct from local count for UI
        if (serverType === 'neutral') CS.myTilesLeft.neutral = Math.max(0, CS.myTilesLeft.neutral - 1);
        else if (serverType === 'fire')  CS.myTilesLeft.fire  = Math.max(0, CS.myTilesLeft.fire  - 1);
        else if (serverType === 'water') CS.myTilesLeft.water = Math.max(0, CS.myTilesLeft.water - 1);

        renderHand(); // refresh counts

        // Send to server
        console.log('[ZB] Sending place_tile:', String(tile.id), serverType, '| room:', !!_getRoom());
        send('place_tile', { tileId: String(tile.id), tileType: serverType });
        logCombat('⬡ Placed ' + serverType + ' tile', 's');
        return;
      }

      // During empire placement
      if ((CS.currentPhase||'').toLowerCase() === 'setup_empire' && isMyTurn()) {
        send('place_empire', { tileId: String(tile.id) });
        return;
      }

      // Normal game — pass through
      origClick(tile);
    };
  }

  // ── WIRE BUTTONS ─────────────────────────────────────────────
  function wireButtons() {
    // End Turn button
    const endBtn = document.querySelector('.mhud-btn.end');
    if (endBtn) {
      endBtn.onclick = e => {
        e.preventDefault();
        if (!isMyTurn()) { toast("It's not your turn!"); return; }
        if ((CS.currentPhase||'').toLowerCase() === 'setup_tiles') {
          CS.selectedTileType = null;
          send('end_tile_placement', {});
          toast('Tiles submitted — waiting for opponent…');
          renderHand();
        } else if ((CS.currentPhase||'').toLowerCase() === 'draw') {
          toast('Draw a card first!');
        } else if ((CS.currentPhase||'').toLowerCase() === 'main') {
          send('end_turn', {});
          if (window.HexScene) window.HexScene._clearSelection();
        } else {
          toast('Wait for your turn.');
        }
      };
    }

    // Deck buttons — draw card
    const du = document.querySelector('.mdk.unit');
    const db = document.querySelector('.mdk.blitz');
    if (du) du.onclick = () => {
      if (!isMyTurn() || (CS.currentPhase||'').toLowerCase() !== 'draw') {
        toast(isMyTurn() ? 'Not Draw Phase' : "Not your turn!"); return;
      }
      send('draw_card', { deck: 'unit' });
      stopDeckPulse();
    };
    if (db) db.onclick = () => {
      if (!isMyTurn() || (CS.currentPhase||'').toLowerCase() !== 'draw') {
        toast(isMyTurn() ? 'Not Draw Phase' : "Not your turn!"); return;
      }
      send('draw_card', { deck: 'blitz' });
      stopDeckPulse();
    };

    // M object overrides (for any HTML onclick="M.xxx()")
    if (typeof M !== 'undefined') {
      M.endTurn  = () => endBtn?.click();
      M.drawCard = type => type === 'unit' ? du?.click() : db?.click();
      M.selectAction = action => { if (window.HexScene) window.HexScene.selectAction(action); };
    }
  }

  // ── LISTEN TO SERVER STATE PATCHES ────────────────────────────
  // network.js / bridge.js calls M.initFromServer(state, seat) on game_start.
  // After that, Colyseus auto-patches arrive via room.onStateChange.
  // We hook in by patching M.initFromServer and also listening on window events.

  function onGameStart(seat, initialState) {
    CS.mySeat = seat;
    window._zbMySeat = seat;
    // Capture sessionId from room if available
    if (window._zbRoom && window._zbRoom.sessionId) {
      CS.mySessionId = window._zbRoom.sessionId;
    }
    console.log('[SERVER CLIENT] onGameStart called — seat:', seat, '| sessionId:', CS.mySessionId);
    console.log('[SERVER CLIENT] initialState:', JSON.stringify(initialState));
    logCombat('⬡ Game started — placing tiles', 's');

    // Read active player from state — server uses "activePlayer" (seat label)
    // Default to "p1" if not provided (p1 always goes first in tile placement)
    const activeSeat = initialState?.activePlayer
                    || initialState?.activePlayerId
                    || 'p1';
    CS.activePlayerId = activeSeat;
    console.log('[SERVER CLIENT] activeSeat set to:', activeSeat, '| isMyTurn:', seat === activeSeat);

    // Resize Phaser now that match screen is visible
    setTimeout(_resizePhaser, 200);
    setTimeout(() => {
      wireButtons();
      _hookPhaserTileClick();
    }, 300);

    // Set phase — use whatever field name the server sent
    const phase = initialState?.phase
               || initialState?.currentPhase
               || 'setup_tiles';
    onPhaseChange(phase, activeSeat);

    // renderHand immediately and again after layout settles
    renderHand();

    // Apply the most recently seen phase/activePlayer (may have arrived before seat was set)
    setTimeout(() => {
      const latestPhase  = window._zbLatestPhase  || CS.currentPhase;
      const latestActive = window._zbLatestActive || CS.activePlayerId;
      console.log('[ZB] Post-seat sync — latestPhase:', latestPhase, '| latestActive:', latestActive, '| mySeat:', CS.mySeat);
      onPhaseChange(latestPhase || CS.currentPhase, latestActive);
    }, 150);

    // Poll for state updates — if still waiting and active player hasn't switched to us,
    // request a fresh state from server every 3 seconds
    const _statePollId = setInterval(() => {
      if (!CS.mySeat) { clearInterval(_statePollId); return; }
      const room = _getRoom();
      if (!room) return;
      // Check if room connection is open
      const ws = room.connection?.transport?.ws;
      const connected = !ws || ws.readyState === 1; // 1 = OPEN
      if (!connected) { console.log('[ZB] Poll skipped — not connected'); return; }
      if ((CS.currentPhase || '').includes('setup') && !isMyTurn()) {
        console.log('[ZB] Polling for state update...');
        send('request_state', {});
      } else {
        clearInterval(_statePollId);
      }
    }, 3000);
    // Stop polling after 60s regardless
    setTimeout(() => clearInterval(_statePollId), 60000);
  }

  function onPhaseChange(phase, activePlayerId) {
    CS.currentPhase = phase;
    // Only update activePlayerId if a real value is provided
    if (activePlayerId) CS.activePlayerId = activePlayerId;
    console.log('[SERVER CLIENT] Phase:', phase, '| Active:', CS.activePlayerId, '| Me:', CS.mySeat, '| My turn:', isMyTurn());

    updatePhaseUI(phase);
    updateTurnBanner();
    stopDeckPulse();

    const myTurn = isMyTurn();

    switch (phase) {
      case 'SETUP_TILES':
        announcePhase(myTurn ? 'Place Your Tiles' : "Opponent Placing Tiles", '');
        toast(myTurn ? 'Select a tile type, then click the board' : 'Waiting for opponent…');
        break;
      case 'SETUP_EMPIRE':
        announcePhase(myTurn ? 'Place Your Empire' : "Opponent Placing Empire", '');
        toast(myTurn ? 'Click a tile to place your Empire' : 'Waiting for opponent…');
        break;
      case 'STANDBY':
        announcePhase(myTurn ? 'Your Turn' : "Opponent's Turn", '');
        logCombat('⬡ ' + (myTurn ? 'YOUR' : "OPPONENT'S") + ' standby', 's');
        break;
      case 'DRAW':
        announcePhase('Draw Phase', myTurn ? 'Click a deck to draw' : "Opponent drawing…");
        if (myTurn) {
          startDeckPulse();
          toast('Click Unit or Blitz deck to draw');
        }
        break;
      case 'MAIN':
        announcePhase('Main Phase', myTurn ? 'Deploy, Move, or Attack' : "Opponent's turn");
        logCombat((myTurn ? '▶ Your' : "▶ Opponent's") + ' main phase', 's');
        if (myTurn) toast('Your Main Phase');
        else        toast("Opponent's turn — wait…");
        renderHand(); // refresh playable state
        break;
      case 'END':
        announcePhase('End Phase', '');
        break;
    }

    // Always re-render after phase change — ensures setup bar shows for correct player
    renderHand();
    setTimeout(renderHand, 200);
  }

  function onHandUpdate(cards) {
    // Server sends private hand update directly to this client
    CS.myHand = cards || [];
    renderHand();
  }

  function onStateChange(state) {
    // Called when Colyseus patches arrive
    if (!state) return;

    // Phase / active player — schema sends sessionId; broadcasts send seat label
    const incomingPhase  = state.currentPhase ?? state.phase;
    const incomingActive = state.activePlayerId ?? state.activePlayer; // may be sessionId

    if (incomingPhase !== undefined) {
      const phaseChanged = incomingPhase !== CS.currentPhase;
      CS.currentPhase = incomingPhase;

      // Resolve active player to a seat label
      let activeSeat = incomingActive;
      if (incomingActive && incomingActive.length > 4) {
        // Looks like a sessionId — convert to seat using seatMap
        // We know our own sessionId → if it matches, we're active
        const myId = CS.mySessionId || window._zbRoom?.sessionId;
        activeSeat = (incomingActive === myId) ? CS.mySeat : (CS.mySeat === 'p1' ? 'p2' : 'p1');
        CS.activeSessionId = incomingActive;
      }
      if (activeSeat) CS.activePlayerId = activeSeat;

      if (phaseChanged) onPhaseChange(incomingPhase, activeSeat);
      else { updateTurnBanner(); updatePhaseUI(incomingPhase); }
    }

    // Tiles
    if (state.tiles) applyTileState(state.tiles);

    // Units
    if (state.units) applyUnitState(state.units);
  }

  // ── PHASER EVENTS ─────────────────────────────────────────────

  window.addEventListener('unitSelected', e => {
    const unit = e.detail;
    if (!unit) return;
    const nameEl  = document.getElementById('m-uab-name');
    const statsEl = document.getElementById('m-uab-stats');
    if (nameEl)  { nameEl.textContent = unit.name || unit.id; nameEl.style.color = '#F0E8DC'; }
    if (statsEl) {
      const moved = unit.hasMoved ? '<span style="color:#FF8888">Used</span>' : unit.speed + ' tiles';
      statsEl.innerHTML = `
        <span>HP <span>${unit.hp}/${unit.maxHp||unit.hp}</span></span>
        <span>SPD <span>${moved}</span></span>
        <span>MEL <span>${unit.melee??'—'}</span></span>
        <span>RNG <span>${unit.rangedRange??0}</span></span>
      `;
    }
    const moveSub = document.getElementById('m-ab-move-sub');
    if (moveSub) moveSub.textContent = unit.hasMoved ? 'Used' : unit.speed + ' tiles';
    const moveBtn = document.getElementById('m-ab-move');
    if (moveBtn) moveBtn.classList.toggle('disabled', !!unit.hasMoved || !!unit.deployRest);
  });

  window.addEventListener('unitDeselected', () => {
    const n = document.getElementById('m-uab-name');
    const s = document.getElementById('m-uab-stats');
    if (n) { n.textContent = '— Select a unit on board —'; n.style.color = 'rgba(240,232,220,.3)'; }
    if (s) s.innerHTML = '';
  });

  window.addEventListener('unitDeployed', e => {
    const unit = e.detail;
    if (!unit || !unit._serverCardId) return;
    // unit was placed on tile via Phaser — send to server
    send('play_unit', { cardId: unit._serverCardId, spawnTileId: unit.tileId });
    logCombat('⬡ Deploying unit…', 'a');
    refreshUnitSidebar();
  });

  // ── PHASER RESIZE ─────────────────────────────────────────────
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

  // ── EXPOSE — set immediately so bridge._tryHandoff can find it ──
  window.ZB = {
    CS,
    isMyTurn,
    onGameStart,
    onPhaseChange,
    onHandUpdate,
    onStateChange,
    send,
    renderHand,
    wireButtons,
  };

  // Pick up any game_start that fired before this script finished loading
  if (window._zbPendingStart) {
    console.log('[SERVER CLIENT] Picking up pending game start');
    const { seat, state } = window._zbPendingStart;
    window._zbPendingStart = null;
    setTimeout(() => onGameStart(seat, state), 50);
  }

  // ── INIT: hook into bridge.js M.initFromServer ────────────────
  // bridge.js patches M.initFromServer and calls it with (state, seat).
  // We override that here to route into our onGameStart.
  // This runs after bridge.js DOMContentLoaded block completes.

  function _interceptColyseusRoom() {
    // Strategy 1: Patch Client.joinOrCreate to capture returned room
    if (window.Colyseus && window.Colyseus.Client) {
      const OrigClient = window.Colyseus.Client;
      const origProto  = OrigClient.prototype;

      // Wrap joinOrCreate
      if (origProto.joinOrCreate && !origProto._zbPatched) {
        const origJOC = origProto.joinOrCreate;
        origProto.joinOrCreate = async function(...args) {
          const room = await origJOC.apply(this, args);
          if (room) {
            window._zbRoom = room;
            console.log('[SERVER CLIENT] Room captured via joinOrCreate:', room.roomId);
          }
          return room;
        };
        origProto._zbPatched = true;
        console.log('[SERVER CLIENT] Colyseus.Client.joinOrCreate patched');
      }
    } else {
      // Colyseus not loaded yet — try again
      setTimeout(_interceptColyseusRoom, 100);
    }
  }



  function _installHooks() {
    if (typeof M === 'undefined') {
      setTimeout(_installHooks, 100);
      return;
    }

    // ── Intercept Colyseus room creation to capture room reference ──
    // network.js creates the room via _client.joinOrCreate() which returns
    // a Colyseus.Room. We intercept at the prototype level so any room
    // created anywhere is captured automatically.
    _interceptColyseusRoom();

    const _prevInit = M.initFromServer;
    M.initFromServer = function (state, seat) {
      if (_prevInit) _prevInit.call(M, state, seat);
      onGameStart(seat, state);
    };

    // Hook state changes — network.js may expose room on window
    function _tryHookRoom() {
      const room = window._zbRoom || window.NET?._room || window.room;
      if (room && !room._serverClientHooked) {
        window._zbRoom = room; // ensure captured
        if (!CS.mySessionId && room.sessionId) {
          CS.mySessionId = room.sessionId;
          console.log('[ZB] SessionId set in hookRoom:', CS.mySessionId);
        }
        room._serverClientHooked = true;
        room.onStateChange(state => onStateChange(state));

        // Also listen for direct messages (hand updates, errors)
        room.onMessage('hand_update',    msg => onHandUpdate(msg.cards));
        room.onMessage('phase_change',   msg => onPhaseChange(msg.phase, msg.activePlayerId));
        room.onMessage('tile_placed', msg => {
          logCombat('⬡ ' + msg.byPlayer + ' placed ' + msg.tileType + ' tile', 's');

          // Update board for both players
          if (window.HexScene) {
            const tile = window.HexScene.tiles.find(t => String(t.id) === String(msg.tileId));
            if (tile) {
              tile.type = msg.tileType;
              const idx = window.HexScene.tiles.indexOf(tile);
              if (window.HexScene.tileGfx && window.HexScene.tileGfx[idx]) {
                window.HexScene._drawTile(tile, window.HexScene.tileGfx[idx]);
              }
            }
          }

          // If this was placed by me, update my remaining counts from server truth
          if (msg.byPlayer === CS.mySeat) {
            CS.myTilesLeft.neutral = msg.neutralRemaining ?? CS.myTilesLeft.neutral;
            if (msg.elementalRemaining !== undefined) {
              const e = msg.elementalRemaining;
              CS.myTilesLeft.fire  = Math.ceil(e / 2);
              CS.myTilesLeft.water = e - CS.myTilesLeft.fire;
            }
            renderHand(); // refresh counts display
          }
        });
        room.onMessage('error', msg => toast('⚠ ' + msg.message));
        room.onMessage('valid_moves', msg => {
          if (window.HexScene) window.HexScene._clearHighlights();
          if (!msg.tiles) return;
          msg.tiles.forEach(id => {
            const t = window.HexScene?.tiles.find(t => t.id === id);
            if (t) t.highlight = 2; // HL.MOVE = light blue
          });
          window.HexScene?._refreshAll();
        });
        console.log('[SERVER CLIENT] Room hooked for state changes');
      } else if (!room) {
        setTimeout(_tryHookRoom, 300);
      }
    }
    setTimeout(_tryHookRoom, 300);

    wireButtons();
    console.log('[SERVER CLIENT] Hooks installed');
  }

  window.addEventListener('hexSceneReady', () => {
    setTimeout(_hookPhaserTileClick, 200);
  });

  _installHooks();
  console.log('[SERVER CLIENT] Loaded');

})();
