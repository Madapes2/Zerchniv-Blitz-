/**
 * ═══════════════════════════════════════════════════════════════════
 *  ZERCHNIV BLITZ — Colyseus Network Module
 *  network.js  ·  Drop this file next to your index.html
 *
 *  WHAT THIS FILE DOES
 *  ───────────────────
 *  • Manages the WebSocket connection to your Colyseus Cloud server
 *  • Sends every player action to the server (move, attack, blitz, deploy…)
 *  • Listens for authoritative state patches from the server and applies
 *    them to the match engine (M module) in index.html
 *  • Handles matchmaking: Battle! button  →  join/create room  →  game start
 *  • Handles challenge flow (direct invite by username)
 *  • Drives all phase transitions from server state
 *  • Exposes a single global: window.NET
 *
 *  PHASE CONTRACT
 *  ──────────────
 *  Server sends phase strings as lowercase:
 *    'setup_tiles', 'setup_empire', 'standby', 'draw', 'main', 'end'
 *  activePlayer is always a seat label: 'p1' or 'p2'
 *
 *  _handlePhaseChange is the SINGLE entry point for all phase updates.
 *  It calls ZB.onPhaseChange FIRST, then M._setPhase.
 *  bridge.js onStateChange NEVER updates phase — tiles/units only.
 *
 *  TURN PASS CONTRACT (setup_tiles)
 *  ─────────────────────────────────
 *  During setup_tiles, the server sends an explicit 'turn_pass' message
 *  after broadcastStateUpdate + broadcastPhaseChange. This is the single
 *  authoritative signal for flipping isMyTurn. state_update does NOT
 *  call _handlePhaseChange during setup_tiles to avoid race conditions.
 * ═══════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  // ────────────────────────────────────────────────────────────────
  //  CONFIG
  // ────────────────────────────────────────────────────────────────
  const CONFIG = {
    SERVER_URL: 'https://us-mia-55cdd0b8.colyseus.cloud',
    ROOM_NAME:  'game_room',
    RECONNECT_ATTEMPTS: 3,
    MATCHMAKING_TIMEOUT_MS: 30000,
  };

  // ────────────────────────────────────────────────────────────────
  //  Internal state
  // ────────────────────────────────────────────────────────────────
  let _client       = null;
  let _room         = null;
  let _mySeat       = null;
  let _myUserId     = null;
  let _myDeckId     = null;
  let _matchTimer   = null;
  let _reconnects   = 0;
  let _pendingChallengeId = null;
  let _stormActive  = false;

  // ────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────
  function log(type, msg) {
    if (typeof M !== 'undefined' && M._log) {
      M._log(type, msg);
    } else {
      const el = document.getElementById('m-clog');
      if (!el) return;
      const p = document.createElement('div');
      p.className = `mclog-msg ${type}`;
      p.textContent = msg;
      el.appendChild(p);
      el.scrollTop = el.scrollHeight;
    }
  }

  function toast(msg) {
    if (typeof M !== 'undefined' && M._toast) {
      M._toast(msg);
    } else {
      const el = document.getElementById('m-toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2400);
    }
  }

  function setMatchmakingStatus(text) {
    const el = document.getElementById('msub');
    if (el) el.textContent = text;
  }

  // ────────────────────────────────────────────────────────────────
  //  Connection lifecycle
  // ────────────────────────────────────────────────────────────────

  function init(options = {}) {
    if (!global.Colyseus) {
      console.error('[NET] Colyseus.js SDK not loaded. Add the script tag before network.js.');
      return;
    }
    _myUserId = options.userId || _getStoredUserId();
    _client   = new Colyseus.Client(CONFIG.SERVER_URL);
    console.log('[NET] Colyseus client created →', CONFIG.SERVER_URL);
  }

  function _getStoredUserId() {
    try {
      let id = localStorage.getItem('zb_userId');
      if (!id) {
        id = 'user_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('zb_userId', id);
      }
      return id;
    } catch (e) {
      return 'user_' + Math.random().toString(36).slice(2, 10);
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  MATCHMAKING
  // ────────────────────────────────────────────────────────────────

  async function queueMatchmaking() {
    const deckSel = document.getElementById('dsel');
    if (!deckSel || !deckSel.value) {
      if (typeof flashSel === 'function') flashSel();
      return;
    }
    _myDeckId = deckSel.value;

    if (typeof op === 'function') op('mmod');
    setMatchmakingStatus('Searching for an opponent…');

    _matchTimer = setTimeout(() => {
      setMatchmakingStatus('No opponents found. You can fight an AI instead.');
      _showAIFallback();
    }, CONFIG.MATCHMAKING_TIMEOUT_MS);

    try {
      await _joinOrCreateRoom({ deckId: _myDeckId, userId: _myUserId });
    } catch (err) {
      clearTimeout(_matchTimer);
      _handleConnectionError(err);
    }
  }

  function _showAIFallback() {
    const aiBtn = document.querySelector('.mbtn.gl');
    if (aiBtn) {
      aiBtn.style.display = 'block';
      aiBtn.textContent   = 'Fight AI Instead';
      aiBtn.onclick       = () => { cancelMatchmaking(); if (typeof startAI === 'function') startAI(); };
    }
  }

  function cancelMatchmaking() {
    clearTimeout(_matchTimer);
    if (_room) { _room.leave(); _room = null; }
    if (typeof cl === 'function') cl('mmod');
  }

  // ────────────────────────────────────────────────────────────────
  //  CHALLENGE
  // ────────────────────────────────────────────────────────────────

  async function challengePlayer(targetUsername) {
    const deckSel = document.getElementById('dsel');
    if (!deckSel || !deckSel.value) { if (typeof flashSel === 'function') flashSel(); return; }
    _myDeckId = deckSel.value;

    if (!_room) {
      try {
        await _joinOrCreateRoom({ deckId: _myDeckId, userId: _myUserId, challengeMode: true });
      } catch (err) { _handleConnectionError(err); return; }
    }

    _room.send('challenge_player', { targetUsername, deckId: _myDeckId });

    const ctgt = document.getElementById('ctgt');
    if (ctgt) ctgt.textContent = targetUsername;
    if (typeof op === 'function') op('cmod');
  }

  function acceptChallenge() {
    if (!_room || !_pendingChallengeId) return;
    const deckSel = document.getElementById('dsel');
    _myDeckId = deckSel ? deckSel.value : '';
    _room.send('accept_challenge', { challengeId: _pendingChallengeId, deckId: _myDeckId });
    if (typeof cl === 'function') cl('cmod');
  }

  function declineChallenge() {
    if (!_room || !_pendingChallengeId) return;
    _room.send('decline_challenge', { challengeId: _pendingChallengeId });
    _pendingChallengeId = null;
    if (typeof cl === 'function') cl('cmod');
  }

  // ────────────────────────────────────────────────────────────────
  //  ROOM SETUP
  // ────────────────────────────────────────────────────────────────

  async function _joinOrCreateRoom(options) {
    if (!_client) {
      console.error('[NET] Call NET.init() before trying to join a room.');
      return;
    }

    const joinOptions = {
      ...options,
      displayName: options.userId || 'Player',
      unitDeck:  [],
      blitzDeck: [],
      extraDeck: [],
    };

    _room = await _client.joinOrCreate(CONFIG.ROOM_NAME, joinOptions);
    console.log('[NET] Joined room:', _room.roomId, '| Session:', _room.sessionId);

    _attachRoomListeners();
  }

  function _attachRoomListeners() {
    if (!_room) return;

    // ── Server messages ──────────────────────────────────────────

    _room.onMessage('game_start', (data) => {
      clearTimeout(_matchTimer);
      _mySeat = data.yourSeat;
      console.log('[NET] game_start — I am seat:', _mySeat, '| activePlayer:', data.state?.activePlayer);

      if (typeof cl === 'function') cl('mmod');
      _launchMatchFromServer(data.state);
    });

    _room.onMessage('state_update', (data) => {
      _applyStateUpdate(data.state);
    });

    _room.onMessage('valid_moves', (data) => {
      if (typeof M !== 'undefined' && M._setValidMoves) {
        M._setValidMoves(data.unitId, data.tiles);
      }
    });

    _room.onMessage('valid_targets', (data) => {
      if (typeof M !== 'undefined' && M._setValidTargets) {
        M._setValidTargets(data.unitId, data.tiles, data.mode);
      }
    });

    _room.onMessage('combat_result', (data) => {
      _handleCombatResult(data);
    });

    _room.onMessage('blitz_played', (data) => {
      _handleBlitzPlayed(data);
    });

    _room.onMessage('storm_update', (data) => {
      _handleStormUpdate(data);
    });

    _room.onMessage('fog_reveal', (data) => {
      if (typeof M !== 'undefined' && M._revealTiles) {
        M._revealTiles(data.tiles);
      }
    });

    _room.onMessage('draw_result', (data) => {
      _handleDrawResult(data);
    });

    _room.onMessage('phase_change', (data) => {
      _handlePhaseChange(data);
    });

    // ── TURN PASS — authoritative isMyTurn flip during setup_tiles ──
    // Server sends this AFTER broadcastStateUpdate + broadcastPhaseChange
    // so activePlayer is guaranteed current. This is the single reliable
    // signal for flipping isMyTurn during tile placement.
    _room.onMessage('turn_pass', (data) => {
      console.log('[NET] turn_pass received:', JSON.stringify(data));
      const isMyTurnNow = data.activePlayer === _mySeat;

      if (window.ZB && window.ZB.onPhaseChange) {
        window.ZB.onPhaseChange(data.phase, data.activePlayer);
      }

      if (typeof M !== 'undefined' && M._setPhase) {
        M._setPhase(data.phase, null, isMyTurnNow);
      }

      const who = isMyTurnNow
        ? 'YOUR TURN — Place your tiles'
        : 'Waiting for opponent to place tiles…';
      log('s', `⇄ Turn passed — ${who}`);
      toast(who);
    });

    _room.onMessage('essence_update', (data) => {
      if (typeof M !== 'undefined' && M._setEssence) {
        M._setEssence(data);
      } else {
        const en = document.getElementById('m-ess-n');
        const ef = document.getElementById('m-ess-f');
        const ew = document.getElementById('m-ess-w');
        if (en) en.textContent = data.n;
        if (ef) ef.textContent = data.f;
        if (ew) ew.textContent = data.w;
      }
    });

    _room.onMessage('capture_update', (data) => {
      const prog = data.progress >= 1
        ? `${data.capturedBy === _mySeat ? 'You' : 'Opponent'} captured a Structure!`
        : `Structure capture: ${Math.round(data.progress * 100)}% (${data.capturedBy === _mySeat ? 'You' : 'Opponent'})`;
      log('s', `🏛 ${prog}`);
      toast(prog);
    });

    _room.onMessage('siege_update', (data) => {
      if (data.siegeBy) {
        const who = data.siegeBy === _mySeat ? 'You have' : 'Opponent has';
        const msg = `⚔ SIEGE! ${who} ${data.unitCount}/5 units surrounding the Empire!`;
        log('a', msg);
        toast(msg);
      }
    });

    _room.onMessage('chat_message', (data) => {
      _appendChat(data.sender, data.text);
    });

    _room.onMessage('challenge_incoming', (data) => {
      _pendingChallengeId = data.challengeId;
      _showIncomingChallenge(data);
    });

    _room.onMessage('challenge_accepted', (data) => {
      if (typeof cl === 'function') cl('cmod');
      toast(`Challenge accepted by ${data.acceptedBy}! Starting match…`);
    });

    _room.onMessage('challenge_declined', (data) => {
      if (typeof cl === 'function') cl('cmod');
      toast(`${data.declinedBy} declined your challenge.`);
    });

    _room.onMessage('error', (data) => {
      console.warn('[NET] Server error:', data.code, data.message);
      toast(`⚠ ${data.message}`);
      log('e', `⚠ Server: ${data.message}`);
    });

    _room.onMessage('game_over', (data) => {
      _handleGameOver(data);
    });

    _room.onMessage('player_left', (data) => {
      const who = data.seat === _mySeat ? 'You' : 'Opponent';
      log('s', `${who} disconnected.`);
      toast(`${who} left the game.`);
      if (data.seat !== _mySeat) {
        setTimeout(() => {
          if (typeof M !== 'undefined' && M.winGame) M.winGame('forfeit');
        }, 1500);
      }
    });

    // ── Connection events ────────────────────────────────────────

    _room.onLeave((code) => {
      console.log('[NET] Left room. Code:', code);
      if (code === 1000) return;
      if (_reconnects < CONFIG.RECONNECT_ATTEMPTS) {
        _reconnects++;
        toast(`Connection lost. Reconnecting… (${_reconnects}/${CONFIG.RECONNECT_ATTEMPTS})`);
        setTimeout(() => _attemptReconnect(), 2000 * _reconnects);
      } else {
        toast('Could not reconnect. Please refresh and try again.');
        log('e', '⚠ Connection lost permanently.');
      }
    });

    _room.onError((code, message) => {
      console.error('[NET] Room error:', code, message);
    });
  }

  async function _attemptReconnect() {
    try {
      _room = await _client.reconnect(_room.roomId, _room.sessionId);
      _attachRoomListeners();
      toast('Reconnected!');
      _reconnects = 0;
    } catch (err) {
      console.warn('[NET] Reconnect attempt failed:', err);
    }
  }

  function _handleConnectionError(err) {
    console.error('[NET] Could not connect to server:', err);
    clearTimeout(_matchTimer);
    if (typeof cl === 'function') cl('mmod');
    toast('Could not connect to server — launching AI match instead.');
    if (typeof launchMatch === 'function') {
      setTimeout(launchMatch, 600);
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  LAUNCH MATCH from server state
  // ────────────────────────────────────────────────────────────────

  function _launchMatchFromServer(serverState) {
    const mscr = document.getElementById('mscr');
    if (mscr) mscr.classList.add('on');

    if (typeof M !== 'undefined' && M.initFromServer) {
      M.initFromServer(serverState, _mySeat);
    } else if (typeof M !== 'undefined' && M.init) {
      M.init();
      _applyStateUpdate(serverState);
    }

    const opponent = serverState.players
      ? Object.values(serverState.players).find(p => p && p.seat !== _mySeat)
      : null;

    log('s', `═══ MATCH BEGINS — You are ${_mySeat === 'p1' ? 'Player 1' : 'Player 2'} ═══`);
    if (opponent) log('s', `Opponent: ${opponent.username || 'Unknown'}`);

    const oppNameEl = document.getElementById('m-opp-name');
    if (oppNameEl && opponent) oppNameEl.textContent = opponent.username || 'Opponent';
  }

  // ────────────────────────────────────────────────────────────────
  //  STATE APPLICATION  (server → client)
  // ────────────────────────────────────────────────────────────────

  function _applyStateUpdate(state) {
    if (!state || typeof M === 'undefined') return;

    const me  = state.players?.[_mySeat];
    const opp = state.players?.[ _mySeat === 'p1' ? 'p2' : 'p1' ];

    if (me?.essence && M._setEssence) {
      M._setEssence(me.essence);
    }

    if (state.empires) {
      const myEmpire  = state.empires[_mySeat];
      const oppEmpire = state.empires[ _mySeat === 'p1' ? 'p2' : 'p1' ];
      if (M._setEmpireHP) {
        M._setEmpireHP('player',   myEmpire?.hp  ?? 20);
        M._setEmpireHP('opponent', oppEmpire?.hp ?? 20);
      }
    }

    if (state.units && M._setUnits) {
      const myUnits  = state.units.filter(u => u.owner === _mySeat);
      const oppUnits = state.units.filter(u => u.owner !== _mySeat);
      M._setUnits(myUnits, oppUnits);
    }

    if (state.tiles && M._applyTileState) {
      M._applyTileState(state.tiles);
    }

    if (me && M._setDeckCounts) {
      M._setDeckCounts({
        unitDeck:  me.unitDeckCount  ?? 0,
        blitzDeck: me.blitzDeckCount ?? 0,
        extraDeck: me.extraDeckCount ?? 0,
        discard:   me.discardCount   ?? 0,
      });
    }

    if (me?.hand && M._setHand) {
      M._setHand(me.hand);
    }

    // During setup_tiles, phase/turn updates come via 'turn_pass' message
    // to avoid race conditions with broadcastPhaseChange ordering.
    // All other phases update normally through _handlePhaseChange.
    if (state.phase && state.phase !== 'setup_tiles') {
      _handlePhaseChange({
        phase:        state.phase,
        turn:         state.turn,
        activePlayer: state.activePlayer,
      });
    }

    if (M.redraw) M.redraw();
  }

  // ────────────────────────────────────────────────────────────────
  //  MESSAGE HANDLERS  (server → client events)
  // ────────────────────────────────────────────────────────────────

  function _handleCombatResult(data) {
    const rollMsg = `d10 roll: ${data.roll} vs DEF ${data.def}`;

    if (data.hit) {
      if (data.isEmpireTarget) {
        log('a', `✓ HIT! ${data.damage} dmg to Empire. ${rollMsg}`);
        toast(`⚔ HIT! ${data.damage} damage to Empire!`);
      } else {
        log('a', `✓ HIT! ${data.damage} dmg. ${rollMsg}`);
        toast(`⚔ HIT! ${data.damage} damage!`);
      }
      if (data.died) {
        log('s', `☠ Unit destroyed!${data.essenceGained ? ` +${data.essenceGained} Essence` : ''}`);
        toast(`☠ Unit destroyed!`);
      }
    } else {
      log('d', `✗ MISS — ${rollMsg}`);
      toast(`✗ Miss! Roll ${data.roll} didn't beat DEF ${data.def}`);
    }

    if (typeof M !== 'undefined' && M._flashCombat) {
      M._flashCombat(data.attackerId, data.targetId, data.hit);
    }
  }

  function _handleBlitzPlayed(data) {
    const who = data.playedBy === _mySeat ? 'You played' : 'Opponent played';
    log('a', `⚡ ${who} Blitz card: ${data.cardId} [${data.blitzSpeed}]`);
    toast(`⚡ ${who} Blitz: ${data.cardId}`);
    if (data.blitzSpeed === 'reaction') {
      toast(`🌀 Reaction! ${who} countered a Blitz card.`);
    }
  }

  function _handleStormUpdate(data) {
    _stormActive = !data.resolved;
    if (data.resolved) {
      log('s', '🌀 Storm resolved.');
      toast('Storm resolved!');
      _hideStormUI();
    } else {
      log('a', `🌀 Storm! ${data.stack.length} card(s) in chain.`);
      _showStormUI(data.stack);
    }
  }

  function _handleDrawResult(data) {
    log('s', `Drew: ${data.card.name} from ${data.deckType} deck. (${data.remaining} remaining)`);
    toast(`Drew ${data.card.name}!`);
    if (typeof M !== 'undefined' && M._addCardToHand) {
      M._addCardToHand(data.card);
    }
  }

  // ── PHASE CHANGE — single entry point for all phase updates ──
  // phase is always lowercase: 'setup_tiles', 'setup_empire',
  //   'standby', 'draw', 'main', 'end'
  // activePlayer is always a seat label: 'p1' or 'p2'
  //
  // CALL ORDER:
  //   1. ZB.onPhaseChange — updates CS.currentPhase, CS.activePlayerId, renders hand
  //   2. M._setPhase     — updates phase pills, Phaser isMyTurn flag
  //
  // NOTE: During setup_tiles, isMyTurn is driven by 'turn_pass' messages,
  // not by this function, to prevent race conditions.
  // bridge.js onStateChange NEVER calls this — tiles/units only.
  function _handlePhaseChange(data) {
    console.log('[NET] _handlePhaseChange received:', JSON.stringify(data));

    const isMyTurnNow = data.activePlayer === _mySeat;

    // ── 1. ZB first — so CS.currentPhase is correct before any render ──
    if (window.ZB && window.ZB.onPhaseChange) {
      window.ZB.onPhaseChange(data.phase, data.activePlayer);
    }

    // ── 2. M._setPhase — updates DOM pills and Phaser flag ──
    if (typeof M !== 'undefined' && M._setPhase) {
      M._setPhase(data.phase, data.turn, isMyTurnNow);
    }

    const phaseLabel = {
      setup_tiles:  'SETUP TILES',
      setup_empire: 'SETUP EMPIRE',
      standby:      'STANDBY',
      draw:         'DRAW',
      main:         'MAIN',
      end:          'END',
    }[data.phase] || (data.phase || '').toUpperCase();

    if (isMyTurnNow) {
      log('s', `═══ YOUR TURN — Turn ${data.turn} · ${phaseLabel} Phase ═══`);
      toast(`Turn ${data.turn} — ${phaseLabel} — Your turn!`);
    } else {
      log('d', `Opponent's turn — ${phaseLabel} Phase`);
      toast(`Turn ${data.turn} — ${phaseLabel} — Waiting for opponent…`);
    }
  }

  function _handleGameOver(data) {
    const iWon = data.winner === _mySeat;
    const reasonMap = {
      empire_destroyed: 'Empire destroyed',
      siege:            'Empire sieged',
      forfeit:          'Opponent forfeited',
      timeout:          'Opponent timed out',
    };
    const reason = reasonMap[data.reason] || data.reason;

    if (iWon) {
      log('s', `🏆 VICTORY — ${reason}! You win!`);
      if (typeof M !== 'undefined' && M.winGame) M.winGame(data.reason);
    } else {
      log('s', `💀 DEFEAT — ${reason}. You lost.`);
      if (typeof M !== 'undefined' && M.loseGame) M.loseGame(data.reason);
    }

    setTimeout(() => { if (_room) _room.leave(); }, 3000);
  }

  // ────────────────────────────────────────────────────────────────
  //  STORM UI
  // ────────────────────────────────────────────────────────────────

  function _showStormUI(stack) {
    let panel = document.getElementById('net-storm-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'net-storm-panel';
      panel.style.cssText = `
        position:fixed; bottom:120px; left:50%; transform:translateX(-50%);
        background:rgba(10,6,18,0.97); border:1px solid rgba(220,20,60,0.7);
        border-radius:8px; padding:10px 16px; z-index:900;
        font-family:'Rajdhani',sans-serif; color:#F0E8DC; min-width:280px;
        box-shadow:0 0 30px rgba(220,20,60,0.4);
      `;
      document.body.appendChild(panel);
    }

    let html = `<div style="font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(220,20,60,0.9);margin-bottom:6px;">⚡ STORM — Blitz Chain</div>`;
    stack.forEach((entry, i) => {
      const who = entry.playedBy === _mySeat ? 'You' : 'Opponent';
      html += `<div style="font-size:.8rem;padding:3px 0;border-bottom:1px solid rgba(139,0,0,.2);">
        ${i + 1}. ${who} → <strong>${entry.cardId}</strong> <em style="color:rgba(201,168,76,.7)">[${entry.blitzSpeed}]</em>
      </div>`;
    });
    html += `<div style="margin-top:8px;font-size:.72rem;color:rgba(240,232,220,.45);">Play a Reaction Blitz card to counter, or wait for resolution.</div>`;
    panel.innerHTML = html;
    panel.style.display = 'block';
  }

  function _hideStormUI() {
    const panel = document.getElementById('net-storm-panel');
    if (panel) panel.style.display = 'none';
  }

  // ────────────────────────────────────────────────────────────────
  //  CHALLENGE UI
  // ────────────────────────────────────────────────────────────────

  function _showIncomingChallenge(data) {
    const ctgt = document.getElementById('ctgt');
    if (ctgt) ctgt.textContent = data.fromUsername;

    const cmod = document.getElementById('cmod');
    if (cmod) {
      const body = cmod.querySelector('.cmb') || cmod;
      body.innerHTML = `
        <div style="font-family:'Cinzel',serif;font-size:1rem;font-weight:700;margin-bottom:.5rem;">Incoming Challenge!</div>
        <div style="font-size:.85rem;color:rgba(240,232,220,.6);margin-bottom:1.2rem;">
          <strong>${data.fromUsername}</strong> wants to duel with deck: ${data.deckName || '—'}
        </div>
        <div style="display:flex;flex-direction:column;gap:.5rem;">
          <button class="mbtn" onclick="NET.acceptChallenge()">⚔ Accept Challenge</button>
          <button class="mbtn sc" onclick="NET.declineChallenge()">✕ Decline</button>
        </div>
      `;
      if (typeof op === 'function') op('cmod');
    }

    toast(`⚔ ${data.fromUsername} is challenging you!`);
  }

  // ────────────────────────────────────────────────────────────────
  //  CHAT
  // ────────────────────────────────────────────────────────────────

  function sendChat(text) {
    if (!_room || !text.trim()) return;
    _room.send('send_chat', { text: text.trim() });
  }

  function _appendChat(sender, text) {
    const box = document.getElementById('m-chat-log') || document.getElementById('m-clog');
    if (!box) return;
    const p = document.createElement('div');
    p.className = 'mclog-msg s';
    p.innerHTML = `<span style="color:#C9A84C">${sender}:</span> ${text}`;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  // ────────────────────────────────────────────────────────────────
  //  PLAYER ACTIONS  (client → server)
  // ────────────────────────────────────────────────────────────────

  function requestMoves(unitId) {
    if (!_assertConnected()) return;
    _room.send('request_moves', { unitId });
  }

  function moveUnit(unitId, toTile) {
    if (!_assertConnected()) return;
    _room.send('move_unit', { unitId, toTile });
    log('s', `Moving ${unitId} → tile ${toTile}…`);
  }

  function requestTargets(unitId, mode) {
    if (!_assertConnected()) return;
    _room.send('request_targets', { unitId, mode });
  }

  function declareAttack(unitId, targetTile, mode) {
    if (!_assertConnected()) return;
    _room.send('declare_attack', { unitId, targetTile, mode });
    log('a', `${unitId} declares ${mode} attack on tile ${targetTile}…`);
  }

  function playBlitz(cardId, options = {}) {
    if (!_assertConnected()) return;
    _room.send('play_blitz', { cardId, ...options });
    log('a', `Playing Blitz card: ${cardId}`);
  }

  function playReaction(cardId, stormId, reactingToId) {
    if (!_assertConnected()) return;
    _room.send('play_reaction', { cardId, stormId, reactingToId });
    log('a', `Reaction! Playing ${cardId} against ${reactingToId}`);
  }

  function deployUnit(cardId, tileIdx) {
    if (!_assertConnected()) return;
    _room.send('deploy_unit', { cardId, tileIdx });
    log('s', `Deploying ${cardId} to tile ${tileIdx}…`);
  }

  function deployStructure(cardId, tileIdx) {
    if (!_assertConnected()) return;
    _room.send('deploy_structure', { cardId, tileIdx });
    log('s', `Deploying structure ${cardId} to tile ${tileIdx}…`);
  }

  function drawCard(deckType) {
    if (!_assertConnected()) return;
    _room.send('draw_card', { deckType });
  }

  function useAbility(unitId, abilityIndex, options = {}) {
    if (!_assertConnected()) return;
    _room.send('ability_use', { unitId, abilityIndex, ...options });
    log('a', `${unitId} activates ability ${abilityIndex}`);
  }

  function captureStructure(unitId, structureTile) {
    if (!_assertConnected()) return;
    _room.send('capture_start', { unitId, structureTile });
    log('s', `${unitId} attempting to capture structure at tile ${structureTile}`);
  }

  function declareSiege(unitIds) {
    if (!_assertConnected()) return;
    _room.send('siege_declare', { unitIds });
    log('a', `SIEGE DECLARED with ${unitIds.length} units!`);
  }

  function endTurn() {
    if (!_assertConnected()) return;
    _room.send('end_turn', {});
    log('s', 'Turn ended — passing to opponent.');
    toast('Turn ended. Waiting for opponent…');
  }

  function concede() {
    if (!_assertConnected()) return;
    if (confirm('Concede the match? This counts as a loss.')) {
      _room.send('concede', {});
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  UTILITIES
  // ────────────────────────────────────────────────────────────────

  function _assertConnected() {
    if (!_room) {
      toast('Not connected to server.');
      console.warn('[NET] Action attempted without an active room.');
      return false;
    }
    return true;
  }

  function isMyTurnNow() {
    if (typeof M !== 'undefined' && M._isMyTurn) return M._isMyTurn();
    return false;
  }

  function isStormActive() {
    return _stormActive;
  }

  function disconnect() {
    clearTimeout(_matchTimer);
    if (_room) { _room.leave(true); _room = null; }
    _mySeat = null;
    _stormActive = false;
    _hideStormUI();
  }

  function debugState() {
    console.log('[NET] Seat:', _mySeat);
    console.log('[NET] Room:', _room?.roomId, '| Session:', _room?.sessionId);
    console.log('[NET] Storm active:', _stormActive);
  }

  // ────────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ────────────────────────────────────────────────────────────────

  global.NET = {
    // Setup
    init,

    // Matchmaking
    queueMatchmaking,
    cancelMatchmaking,

    // Challenge
    challengePlayer,
    acceptChallenge,
    declineChallenge,

    // Chat
    sendChat,

    // Player actions
    requestMoves,
    moveUnit,
    requestTargets,
    declareAttack,
    playBlitz,
    playReaction,
    deployUnit,
    deployStructure,
    drawCard,
    useAbility,
    captureStructure,
    declareSiege,
    endTurn,
    concede,

    // Helpers
    isMyTurnNow,
    isStormActive,
    disconnect,
    debugState,

    // Config override
    configure: (opts) => Object.assign(CONFIG, opts),
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

})(window);
