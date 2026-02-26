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

    // ── 13. DRAW CARD (DOM button → server) ──────────────────
    // The deck buttons in the right sidebar call M.drawCard('unit'|'blitz')
    // Route this through NET to the server
    M.drawCard = function (deckType) {
      if (!M._isMyTurn()) { mtoast && mtoast('Not your turn!'); return; }
      if (typeof NET !== 'undefined') {
        NET.drawCard(deckType);
      }
    };

    // ── 14. END TURN (DOM button → server) ───────────────────
    M.endTurn = function () {
      if (!M._isMyTurn()) { mtoast && mtoast('Not your turn!'); return; }
      if (typeof NET !== 'undefined') {
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
