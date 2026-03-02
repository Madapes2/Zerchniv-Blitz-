// ═══════════════════════════════════════════════════════════════
//  SERVER-CLIENT ENGINE  — Zerchniv Blitz
//  Handles Colyseus room capture, game state, and tile placement UI
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Room capture via Colyseus.Client prototype patch ──────────
  // Must run before network.js calls joinOrCreate
  (function patchColyseus() {
    if (typeof Colyseus === 'undefined') { setTimeout(patchColyseus, 50); return; }
    console.log('[ZB] Colyseus.Client patched for room capture');

    const _patchMethod = (proto, name) => {
      const orig = proto[name];
      if (!orig) return;
      proto[name] = function (...args) {
        const result = orig.apply(this, args);
        if (result && typeof result.then === 'function') {
          result.then(room => {
            if (room && room.id) {
              window._zbRoom = room;
              if (room.sessionId) {
                window._zbMySessionId = room.sessionId;
              }
              console.log('[ZB] Room captured via', name + ':', room.id, room.sessionId);
            }
          }).catch(() => {});
        }
        return result;
      };
    };

    const proto = Colyseus.Client.prototype;
    ['joinOrCreate', 'join', 'create', 'joinById'].forEach(m => _patchMethod(proto, m));
  })();

  // ── Game State ────────────────────────────────────────────────
  const CS = {
    mySeat:       null,   // "p1" | "p2"
    mySessionId:  null,   // Colyseus sessionId
    activePlayerId: null, // "p1" | "p2" — who is currently active
    activeSessionId: null, // sessionId of active player
    currentPhase: null,
    selectedTileType: null,
    myTilesLeft: { neutral: 19, fire: 5, water: 5 },
    cardDefs: {},
  };

  // ── Helpers ────────────────────────────────────────────────────
  function _getRoom() {
    return window._zbRoom
      || (window.NET && Object.values(window.NET).find(v => v && typeof v.send === 'function' && v.roomId))
      || window.room
      || null;
  }

  function isMyTurn() {
    return CS.mySeat && CS.activePlayerId && CS.mySeat === CS.activePlayerId;
  }

  function send(type, data) {
    const room = _getRoom();
    if (!room) { console.warn('[SERVER CLIENT] No room connection — cannot send:', type); return; }
    try { room.send(type, data); } catch(e) { console.error('[SERVER CLIENT] send error:', e); }
  }

  function logCombat(msg, cls) {
    const log = document.querySelector('.mclog-entries, .combat-log, #combat-log, .mlog');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'mclog-line' + (cls ? ' ' + cls : '');
    line.textContent = '○ ' + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // ── Phase / turn UI ───────────────────────────────────────────
  function updateTurnBanner() {
    const banner = document.getElementById('m-turn-banner') || document.querySelector('.turn-banner');
    if (!banner) return;
    banner.textContent = isMyTurn() ? 'YOUR TURN' : "OPPONENT'S TURN";
  }

  function updatePhaseUI(phase) {
    ['standby','draw','main','end'].forEach(p => {
      const el = document.getElementById('m-ph-' + p);
      if (el) el.classList.toggle('on', p === phase);
    });
  }

  function updateDeckUI(unitCount, blitzCount, discCount, isPlayer) {
    const prefix = isPlayer ? 'm-pl' : 'm-ai';
    const u = document.getElementById(prefix + '-udk');
    const b = document.getElementById(prefix + '-bdk');
    const d = document.getElementById(prefix + '-disc');
    if (u) u.textContent = unitCount ?? 0;
    if (b) b.textContent = blitzCount ?? 0;
    if (d) d.textContent = discCount ?? 0;
  }

  function updateEssenceUI(ess) {
    const en = document.getElementById('m-ess-n');
    const ef = document.getElementById('m-ess-f');
    const ew = document.getElementById('m-ess-w');
    if (en) en.textContent = ess.neutral ?? 0;
    if (ef) ef.textContent = ess.fire ?? 0;
    if (ew) ew.textContent = ess.water ?? 0;
  }

  // ── Tile setup UI ─────────────────────────────────────────────
  function renderHand() {
    const handArea = document.querySelector('.mhand-area');
    if (!handArea) return;

    const phaseNorm = (CS.currentPhase || '').toLowerCase();
    const myTurn    = isMyTurn();

    console.log('[ZB] renderHand — phase:', CS.currentPhase, '| phaseNorm:', phaseNorm, '| isMyTurn:', myTurn);

    if (phaseNorm === 'setup_tiles' || phaseNorm === 'setup_empire') {
      // Show tile placement UI
      const label = handArea.querySelector('.mhand-lbl');
      handArea.innerHTML = '';
      if (label) handArea.appendChild(label);

      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;min-height:60px;border-top:2px solid #C9A84C;';

      if (myTurn && phaseNorm === 'setup_tiles') {
        bar.innerHTML = '<span style="color:#C9A84C;font-size:.7rem;margin-right:4px">PLACE YOUR TILES:</span>';

        const types = [
          { key: 'neutral', label: 'Neutral', count: CS.myTilesLeft.neutral },
          { key: 'fire',    label: 'Fire',    count: CS.myTilesLeft.fire    },
          { key: 'water',   label: 'Water',   count: CS.myTilesLeft.water   },
        ];

        types.forEach(({ key, label, count }) => {
          const btn = document.createElement('button');
          btn.textContent = label + ' ' + count;
          btn.dataset.tileType = key;
          btn.style.cssText = 'padding:6px 12px;border:2px solid ' +
            (CS.selectedTileType === key ? '#FFD700' : 'rgba(240,232,220,.3)') +
            ';background:rgba(20,15,10,.7);color:#F0E8DC;cursor:pointer;font-size:.75rem;border-radius:3px;' +
            (CS.selectedTileType === key ? 'box-shadow:0 0 8px #FFD700;' : '');
          btn.addEventListener('click', () => {
            CS.selectedTileType = key;
            renderHand();
          });
          bar.appendChild(btn);
        });

        let _doneSent = false;
        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'DONE PLACING →';
        doneBtn.style.cssText = 'margin-left:auto;padding:8px 16px;background:#8B0000;color:#FFD700;border:2px solid #C9A84C;cursor:pointer;font-size:.75rem;font-weight:bold;border-radius:3px;';
        doneBtn.addEventListener('click', () => {
          if (_doneSent) return;
          _doneSent = true;
          doneBtn.disabled = true;
          doneBtn.textContent = 'Submitted ✓';
          console.log('[ZB] Sending end_tile_placement, room:', !!_getRoom());
          send('end_tile_placement', {});
          logCombat('✓ Tile placement submitted', 's');
        });
        bar.appendChild(doneBtn);

      } else if (phaseNorm === 'setup_empire' && myTurn) {
        bar.innerHTML = '<span style="color:#C9A84C;font-size:.7rem">CLICK A TILE TO PLACE YOUR EMPIRE</span>';
      } else {
        bar.innerHTML = '<span style="color:rgba(240,232,220,.5);font-size:.7rem">WAITING FOR OPPONENT TO PLACE TILES…</span>';
      }

      handArea.appendChild(bar);

    } else {
      // Normal game — restore card display
      if (CS.currentHand && CS.currentHand.length > 0) {
        _renderCardHand(CS.currentHand);
      }
    }
  }

  function _renderCardHand(cards) {
    const area = document.querySelector('.mhand-area');
    if (!area) return;
    const label = area.querySelector('.mhand-lbl');
    area.innerHTML = '';
    if (label) area.appendChild(label);
    (cards || []).forEach(card => {
      const el = document.createElement('div');
      el.className = 'mhcard';
      el.dataset.cardId = card.id;
      const cost = (card.costNeutral ?? 0) + (card.costFire ?? 0) + (card.costWater ?? 0);
      el.innerHTML = card.imageUrl
        ? `<img src="${card.imageUrl}" alt="${card.name}"><div class="mhcard-cost">${cost}</div>`
        : `<div style="width:100%;height:100%;background:rgba(139,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:.5rem;padding:4px;text-align:center">${card.name}</div><div class="mhcard-cost">${cost}</div>`;
      area.appendChild(el);
    });
  }

  // ── State handlers ────────────────────────────────────────────
  function onHandUpdate(hand) {
    CS.currentHand = hand;
    _renderCardHand(hand);
  }

  function applyTileState(tiles) {
    if (!window.HexScene || !tiles) return;
    const entries = typeof tiles.forEach === 'function'
      ? (() => { const r = []; tiles.forEach((v, k) => { if (v) r.push([k, v]); }); return r; })()
      : Object.entries(tiles);
    entries.forEach(([id, tdata]) => {
      if (id === undefined || id === null || !tdata) return;
      const numId = Number(id);
      const tile = window.HexScene.tiles.find(t => String(t.id) === String(id));
      if (!tile) return;
      tile.type = tdata.tileType || tdata.type || tile.type;
      const idx = window.HexScene.tiles.indexOf(tile);
      if (idx >= 0) window.HexScene._drawTile(tile, window.HexScene.tileGfx[idx]);
    });
  }

  function applyUnitState(units) {
    if (!window.HexScene || !units) return;
    let incoming = [];
    if (Array.isArray(units)) {
      incoming = units.filter(Boolean);
    } else if (typeof units.forEach === 'function') {
      units.forEach(u => { if (u) incoming.push(u); });
    } else {
      incoming = Object.values(units).filter(Boolean);
    }
    incoming.forEach(u => {
      if (!u || !u.instanceId) return;
      const existing = window.HexScene.gameState?.units?.find(gu => gu.id === u.instanceId);
      const owner = (u.owner === 'player' || u.owner === CS.mySeat) ? 'player' : 'opponent';
      if (existing) {
        existing.hp = u.currentHp;
        existing.tileId = u.tileId;
        existing.hasMoved = u.hasMovedThisTurn;
        existing.hasActed = u.hasAttackedThisTurn;
      }
    });
  }

  function onStateChange(state) {
    if (!state) return;

    // Ensure sessionId captured
    const room = _getRoom();
    if (!CS.mySessionId && room?.sessionId) {
      CS.mySessionId = room.sessionId;
      window._zbMySessionId = CS.mySessionId;
    }

    const incomingPhase  = state.currentPhase ?? state.phase;
    const incomingActive = state.activePlayerId ?? state.activePlayer;

    if (incomingPhase !== undefined) {
      const phaseChanged = incomingPhase !== CS.currentPhase;
      CS.currentPhase = incomingPhase;
      window._zbLatestPhase = incomingPhase;

      // Resolve active player sessionId → seat label
      let activeSeat = incomingActive;
      if (incomingActive && incomingActive.length > 4) {
        // It's a sessionId
        const myId = CS.mySessionId || window._zbMySessionId || room?.sessionId;
        if (myId && CS.mySeat) {
          activeSeat = (incomingActive === myId) ? CS.mySeat : (CS.mySeat === 'p1' ? 'p2' : 'p1');
        } else {
          window._zbPendingActiveSessionId = incomingActive;
          activeSeat = null;
        }
        CS.activeSessionId = incomingActive;
        window._zbLatestActiveSessionId = incomingActive;
      }

      if (activeSeat) {
        CS.activePlayerId = activeSeat;
        window._zbLatestActive = activeSeat;
      }

      if (phaseChanged) onPhaseChange(incomingPhase, activeSeat || CS.activePlayerId);
      else { updateTurnBanner(); updatePhaseUI(incomingPhase); }
    }

    // Players state
    if (state.players) {
      try {
        if (typeof state.players.forEach === 'function') {
          state.players.forEach((p, sessionId) => {
            if (!p || !sessionId) return;
            const myId = CS.mySessionId || window._zbMySessionId;
            if (myId && sessionId === myId) {
              updateEssenceUI(p.essence || { neutral: 0, fire: 0, water: 0 });
              if (p.neutralTilesRemaining !== undefined) CS.myTilesLeft.neutral = p.neutralTilesRemaining;
              if (p.elementalTilesRemaining !== undefined) {
                const half = Math.ceil(p.elementalTilesRemaining / 2);
                CS.myTilesLeft.fire  = Math.min(half, p.elementalTilesRemaining);
                CS.myTilesLeft.water = p.elementalTilesRemaining - CS.myTilesLeft.fire;
              }
            }
          });
        }
      } catch(e) {}
    }

    if (state.tiles) applyTileState(state.tiles);
    if (state.units) applyUnitState(state.units);
  }

  function onPhaseChange(phase, activePlayerId) {
    console.log('[ZB] onPhaseChange called — phase:', phase, '| activePid:', activePlayerId, '| mySeat:', CS.mySeat);
    if (!phase) return;
    phase = (phase || '').toLowerCase();

    if (activePlayerId) {
      CS.activePlayerId = activePlayerId;
      window._zbLatestActive = activePlayerId;
    }
    CS.currentPhase = phase;
    window._zbLatestPhase = phase;

    updatePhaseUI(phase);
    updateTurnBanner();
    renderHand();

    console.log('[SERVER CLIENT] Phase:', phase, '| Active:', activePlayerId, '| Me:', CS.mySeat, '| My turn:', isMyTurn());
  }

  // ── Game start ────────────────────────────────────────────────
  function onGameStart(seat, initialState) {
    CS.mySeat = seat;
    window._zbMySeat = seat;

    // Capture sessionId from room
    const room = _getRoom();
    if (room?.sessionId) {
      CS.mySessionId = room.sessionId;
      window._zbMySessionId = room.sessionId;
    }

    console.log('[SERVER CLIENT] onGameStart called — seat:', seat, '| sessionId:', CS.mySessionId);
    console.log('[SERVER CLIENT] initialState:', JSON.stringify(initialState));
    logCombat('⬡ Game started — placing tiles', 's');

    const activeSeat = initialState?.activePlayer || initialState?.activePlayerId || 'p1';
    CS.activePlayerId = activeSeat;
    console.log('[SERVER CLIENT] activeSeat set to:', activeSeat, '| isMyTurn:', isMyTurn());

    const phase = initialState?.phase || initialState?.currentPhase || 'setup_tiles';
    CS.currentPhase = (phase || '').toLowerCase();
    console.log('[SERVER CLIENT] Phase:', CS.currentPhase, '| Active:', CS.activePlayerId, '| Me:', CS.mySeat, '| My turn:', isMyTurn());

    // Hook room for state changes (if not already done)
    const hookRoom = _getRoom();
    if (hookRoom && !hookRoom._scHooked) {
      hookRoom._scHooked = true;
      console.log('[SERVER CLIENT] Room hooked for state changes');
      hookRoom.onStateChange(state => {
        if (!CS.mySessionId && hookRoom.sessionId) {
          CS.mySessionId = hookRoom.sessionId;
          window._zbMySessionId = hookRoom.sessionId;
        }
        onStateChange(state);
      });
    }

    renderHand();

    // After seat is set: resolve any pending sessionId that arrived before us
    setTimeout(() => {
      const myId = CS.mySessionId || window._zbMySessionId || _getRoom()?.sessionId;

      // Resolve pending active sessionId
      const pendingActive = window._zbPendingActiveSessionId || window._zbLatestActiveSessionId;
      if (pendingActive && myId && CS.mySeat) {
        const resolved = (pendingActive === myId) ? CS.mySeat : (CS.mySeat === 'p1' ? 'p2' : 'p1');
        CS.activePlayerId = resolved;
        window._zbLatestActive = resolved;
        console.log('[ZB] Resolved pending activeSeat:', resolved, '(from sessionId:', pendingActive, ')');
      }

      const latestPhase  = window._zbLatestPhase  || CS.currentPhase;
      const latestActive = window._zbLatestActive || CS.activePlayerId;
      console.log('[ZB] Post-seat sync — latestPhase:', latestPhase, '| latestActive:', latestActive, '| mySeat:', CS.mySeat);
      onPhaseChange(latestPhase || CS.currentPhase, latestActive);
    }, 150);

    // Poll for state every 3s while in setup and not our turn
    const _pollId = setInterval(() => {
      if (!CS.mySeat) { clearInterval(_pollId); return; }
      const r = _getRoom();
      if (!r) return;
      if ((CS.currentPhase || '').includes('setup') && !isMyTurn()) {
        console.log('[ZB] Polling for state update...');
        send('request_state', {});
      } else {
        clearInterval(_pollId);
      }
    }, 3000);
    setTimeout(() => clearInterval(_pollId), 60000);
  }

  // ── Hook Phaser tile clicks ────────────────────────────────────
  function _hookPhaserTileClick() {
    if (!window.HexScene || window.HexScene._serverClientHooked) return;
    window.HexScene._serverClientHooked = true;

    const origClick = window.HexScene._onTileClick.bind(window.HexScene);
    window.HexScene._onTileClick = function (tile) {
      if ((CS.currentPhase || '').toLowerCase() === 'setup_tiles' && CS.selectedTileType && isMyTurn()) {
        if (tile._zbPlaced) return;
        tile._zbPlaced = true;

        const serverType = CS.selectedTileType;
        tile.type = serverType;
        window.HexScene._drawTile(tile, window.HexScene.tileGfx[window.HexScene.tiles.indexOf(tile)]);

        if (serverType === 'neutral') CS.myTilesLeft.neutral = Math.max(0, CS.myTilesLeft.neutral - 1);
        else if (serverType === 'fire')  CS.myTilesLeft.fire  = Math.max(0, CS.myTilesLeft.fire  - 1);
        else if (serverType === 'water') CS.myTilesLeft.water = Math.max(0, CS.myTilesLeft.water - 1);
        renderHand();

        console.log('[ZB] Sending place_tile:', String(tile.id), serverType, '| room:', !!_getRoom());
        send('place_tile', { tileId: String(tile.id), tileType: serverType });
        logCombat('⬡ Placed ' + serverType + ' tile', 's');
        return;
      }
      if ((CS.currentPhase || '').toLowerCase() === 'setup_empire' && isMyTurn()) {
        send('place_empire', { tileId: String(tile.id) });
        return;
      }
      origClick(tile);
    };
  }

  // ── Hook room message listeners ───────────────────────────────
  function _installHooks(room) {
    if (!room || room._messageHooksInstalled) return;
    room._messageHooksInstalled = true;

    room.onMessage('tile_placed', msg => {
      if (!window.HexScene) return;
      const tile = window.HexScene.tiles.find(t => String(t.id) === String(msg.tileId));
      if (tile) {
        tile.type = msg.tileType;
        tile._zbPlaced = true;
        const idx = window.HexScene.tiles.indexOf(tile);
        if (idx >= 0) window.HexScene._drawTile(tile, window.HexScene.tileGfx[idx]);
      }
      if (msg.byPlayer === CS.mySeat) {
        if (msg.neutralRemaining !== undefined) CS.myTilesLeft.neutral = msg.neutralRemaining;
        if (msg.elementalRemaining !== undefined) {
          const half = Math.ceil(msg.elementalRemaining / 2);
          CS.myTilesLeft.fire  = Math.min(half, msg.elementalRemaining);
          CS.myTilesLeft.water = msg.elementalRemaining - CS.myTilesLeft.fire;
        }
        renderHand();
      }
    });

    room.onMessage('phase_change', msg => {
      console.log('[SERVER CLIENT] phase_change received:', JSON.stringify(msg));
      const activePid = msg.activePlayer ?? msg.activeSeat ?? msg.active;
      window._zbLatestPhase  = msg.phase;
      window._zbLatestActive = activePid;
      if (!CS.mySeat) {
        console.log('[SERVER CLIENT] Seat not set yet — caching');
      } else {
        onPhaseChange(msg.phase, activePid);
        if (activePid === CS.mySeat) {
          console.log('[ZB] It is now MY TURN — rendering hand');
          setTimeout(renderHand, 50);
        }
      }
    });

    room.onMessage('state_update', msg => {
      console.log('[SERVER CLIENT] state_update received — phase:', msg.state?.phase, '| active:', msg.state?.activePlayer);
      if (msg.state) {
        if (msg.state.phase)        window._zbLatestPhase  = msg.state.phase;
        if (msg.state.activePlayer) window._zbLatestActive = msg.state.activePlayer;
        if (!CS.mySeat) return;
        onStateChange(msg.state);
        const newPhase  = msg.state.phase;
        const newActive = msg.state.activePlayer;
        if (newPhase && newPhase !== CS.currentPhase) {
          onPhaseChange(newPhase, newActive);
        } else if (newActive && newActive !== CS.activePlayerId) {
          CS.activePlayerId = newActive;
          window._zbLatestActive = newActive;
          updateTurnBanner();
          renderHand();
          console.log('[ZB] Active player updated to:', newActive, '| isMyTurn:', isMyTurn());
        }
      }
    });

    room.onMessage('hand_update', msg => onHandUpdate(msg.hand || msg));
    room.onMessage('error', msg => {
      console.warn('[NET] Server error:', msg.message || msg);
    });
    room.onMessage('game_over', msg => {
      logCombat('⚑ Game over: ' + (msg.winner || 'unknown') + ' wins', 's');
    });

    room.onStateChange(state => {
      if (!CS.mySessionId && room.sessionId) {
        CS.mySessionId = room.sessionId;
        window._zbMySessionId = room.sessionId;
        console.log('[ZB] SessionId captured in onStateChange:', CS.mySessionId);
      }
      onStateChange(state);
    });

    console.log('[SERVER CLIENT] Hooks installed');
  }

  // ── _tryHookRoom: called repeatedly until room exists ─────────
  function _tryHookRoom() {
    const room = window._zbRoom || window.NET?._room || window.room;
    if (room) {
      window._zbRoom = room;
      if (room.sessionId) {
        CS.mySessionId = room.sessionId;
        window._zbMySessionId = room.sessionId;
        console.log('[ZB] SessionId set in hookRoom:', CS.mySessionId);
      }
      if (!room._scHooked) {
        room._scHooked = true;
        console.log('[SERVER CLIENT] Room hooked for state changes');
      }
      _installHooks(room);
    }
  }

  // Room monitor — re-captures if sessionId changes (reconnect)
  let _lastSessionId = null;
  setInterval(() => {
    const r = window._zbRoom || window.NET?._room || window.room;
    if (!r) return;
    const sid = r.sessionId;
    if (sid && sid !== _lastSessionId) {
      _lastSessionId = sid;
      window._zbRoom = r;
      CS.mySessionId = sid;
      window._zbMySessionId = sid;
      if (!r._messageHooksInstalled) {
        console.log('[ZB] Room changed — reinstalling hooks for session:', sid);
        _installHooks(r);
      }
    }
  }, 1000);

  // ── Expose window.ZB ──────────────────────────────────────────
  window.ZB = { CS, isMyTurn, onGameStart, onPhaseChange, onHandUpdate, onStateChange, send, renderHand };

  // Pick up any pending game start
  if (window._zbPendingStart) {
    const { seat, state } = window._zbPendingStart;
    window._zbPendingStart = null;
    setTimeout(() => onGameStart(seat, state), 50);
  }

  // ── Hook into bridge.js M.initFromServer ──────────────────────
  function _installBridgeHook() {
    if (typeof M === 'undefined') { setTimeout(_installBridgeHook, 100); return; }

    const _prevInit = M.initFromServer;
    M.initFromServer = function (state, seat) {
      if (_prevInit) _prevInit.call(M, state, seat);
      console.log('[SERVER CLIENT] M.initFromServer intercepted — seat:', seat);
    };

    // Wire Phaser hooks
    const _prevInit2 = M.initFromServer;
    window.addEventListener('hexSceneReady', () => {
      _hookPhaserTileClick();
      setTimeout(() => {
        _hookPhaserTileClick();
        _tryHookRoom();
        const r = _getRoom();
        if (r) _installHooks(r);
      }, 500);
    });

    console.log('[SERVER CLIENT] Hooks installed');
  }

  _installBridgeHook();

  // ── Hook into network.js game_start ───────────────────────────
  // network.js calls M.initFromServer(state, seat) on game_start
  // but we also need to intercept "NET" room to install message listeners
  const _netCheck = setInterval(() => {
    const r = _getRoom();
    if (r && !r._messageHooksInstalled) {
      _installHooks(r);
      clearInterval(_netCheck);
    }
  }, 500);

})();

// ─── Bridge: patch M.initFromServer to call ZB.onGameStart ──────
// This runs AFTER the server client IIFE above
document.addEventListener('DOMContentLoaded', function () {
  function _patchInitFromServer() {
    if (typeof M === 'undefined') { setTimeout(_patchInitFromServer, 100); return; }

    const _orig = M.initFromServer;
    M.initFromServer = function (state, seat) {
      if (_orig) _orig.call(M, state, seat);

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
  }
  _patchInitFromServer();
});

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
