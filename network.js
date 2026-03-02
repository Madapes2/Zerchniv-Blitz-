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
 *  HOW TO ADD IT TO index.html
 *  ────────────────────────────
 *  1. Copy this file alongside index.html
 *  2. In index.html <head>, add BEFORE the closing </head>:
 *       <script src="https://unpkg.com/colyseus.js@^0.15.0/dist/colyseus.js"></script>
 *       <script src="network.js"></script>
 *  3. In startBat(), replace the existing body with:
 *       NET.queueMatchmaking();
 *  4. In startAI(), if you want a real server match instead of AI:
 *       NET.queueMatchmaking();
 *     Otherwise keep startAI() pointing to launchMatch() for local AI fallback.
 *  5. Set NET.SERVER_URL below to your Colyseus Cloud URL.
 *  6. That's it — every game action now routes through the server.
 *
 *  COLYSEUS SERVER CONTRACT  (what your server must implement)
 *  ─────────────────────────
 *  Room name   : "zerchniv_room"
 *  Join options: { deckId: string, userId: string }
 *
 *  Server → Client messages (room.onMessage):
 *    "game_start"      { yourSeat: "p1"|"p2", state: GameState }
 *    "state_update"    { state: GameState }           — full state snapshot
 *    "valid_moves"     { unitId: string, tiles: number[] }
 *    "valid_targets"   { unitId: string, tiles: number[], mode: "melee"|"ranged" }
 *    "combat_result"   { attackerId, targetId, roll, def, hit, damage, died, essenceGained }
 *    "blitz_played"    { cardId, playerId, targetId?, blitzSpeed, stormId? }
 *    "storm_update"    { stormId, stack: BlitzEntry[], resolved: boolean }
 *    "fog_reveal"      { tiles: number[] }
 *    "draw_result"     { card: CardData, deckType: "unit"|"blitz"|"extra", remaining: number }
 *    "phase_change"    { phase: "standby"|"draw"|"main"|"end", turn: number, activePlayer: "p1"|"p2" }
 *    "essence_update"  { n: number, f: number, w: number }
 *    "capture_update"  { structureTile: number, capturedBy: "p1"|"p2"|null, progress: number }
 *    "siege_update"    { empireTile: number, siegeBy: "p1"|"p2"|null, unitCount: number }
 *    "chat_message"    { sender: string, text: string }
 *    "player_left"     { seat: "p1"|"p2" }
 *    "error"           { code: string, message: string }
 *    "game_over"       { winner: "p1"|"p2", reason: string }
 *
 *  Client → Server messages (room.send):
 *    "move_unit"       { unitId, toTile }
 *    "request_moves"   { unitId }
 *    "declare_attack"  { unitId, targetTile, mode: "melee"|"ranged" }
 *    "request_targets" { unitId, mode }
 *    "play_blitz"      { cardId, targetId?, targetTile? }
 *    "play_reaction"   { cardId, stormId, reactingToId }
 *    "deploy_unit"     { cardId, tileIdx }
 *    "deploy_structure"{ cardId, tileIdx }
 *    "draw_card"       { deckType }
 *    "end_turn"        {}
 *    "send_chat"       { text }
 *    "challenge_player"{ targetUsername, deckId }
 *    "accept_challenge"{ challengeId, deckId }
 *    "decline_challenge"{ challengeId }
 *    "ability_use"     { unitId, abilityIndex, targetId?, targetTile?, essenceCost }
 *    "capture_start"   { unitId, structureTile }
 *    "siege_declare"   { unitIds: string[] }
 *    "concede"         {}
 * ═══════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  // ────────────────────────────────────────────────────────────────
  //  CONFIG — update SERVER_URL to your Colyseus Cloud instance
  // ────────────────────────────────────────────────────────────────
  const CONFIG = {
    SERVER_URL: 'https://us-mia-55cdd0b8.colyseus.cloud',  // ← CHANGE THIS
    ROOM_NAME:  'game_room',
    RECONNECT_ATTEMPTS: 3,
    MATCHMAKING_TIMEOUT_MS: 30000,
  };

  // ────────────────────────────────────────────────────────────────
  //  Internal state
  // ────────────────────────────────────────────────────────────────
  let _client       = null;   // Colyseus.Client
  let _room         = null;   // Colyseus.Room
  let _mySeat       = null;   // "p1" | "p2"
  let _myUserId     = null;
  let _myDeckId     = null;
  let _matchTimer   = null;
  let _reconnects   = 0;
  let _pendingChallengeId = null;
  let _stormActive  = false;

  // ────────────────────────────────────────────────────────────────
  //  Helpers — bridge to the M match engine in index.html
  // ────────────────────────────────────────────────────────────────
  function log(type, msg) {
    // type: 's' success/system, 'a' attack, 'd' damage/opponent, 'e' error
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

  function isMyTurn(state) {
    return state && state.activePlayer === _mySeat;
  }

  // ────────────────────────────────────────────────────────────────
  //  Connection lifecycle
  // ────────────────────────────────────────────────────────────────

  /**
   * Create the Colyseus client. Call once on page load.
   * We defer actual room joining until the player hits Battle!
   */
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
  //  MATCHMAKING  (Battle! button flow)
  // ────────────────────────────────────────────────────────────────

  /**
   * Called when the player clicks Battle!
   * Opens the matchmaking modal then attempts to join/create a room.
   */
  async function queueMatchmaking() {
    const deckSel = document.getElementById('dsel');
    if (!deckSel || !deckSel.value) {
      if (typeof flashSel === 'function') flashSel();
      return;
    }
    _myDeckId = deckSel.value;

    // Show matchmaking overlay
    if (typeof op === 'function') op('mmod');
    setMatchmakingStatus('Searching for an opponent…');

    // Start timeout — if no match found, show AI fallback option
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
    // Reveal the AI option button in the matchmaking modal
    const aiBtn = document.querySelector('.mbtn.gl');
    if (aiBtn) {
      aiBtn.style.display = 'block';
      aiBtn.textContent   = 'Fight AI Instead';
      aiBtn.onclick       = () => { cancelMatchmaking(); if (typeof startAI === 'function') startAI(); };
    }
  }

  /**
   * Cancel matchmaking — clears the timer and leaves the room if joined.
   */
  function cancelMatchmaking() {
    clearTimeout(_matchTimer);
    if (_room) {
      _room.leave();
      _room = null;
    }
    if (typeof cl === 'function') cl('mmod');
  }

  // ────────────────────────────────────────────────────────────────
  //  CHALLENGE  (Find a User flow)
  // ────────────────────────────────────────────────────────────────

  /**
   * Send a direct challenge to another player by username.
   * The server should handle routing the invite to that player.
   */
  async function challengePlayer(targetUsername) {
    const deckSel = document.getElementById('dsel');
    if (!deckSel || !deckSel.value) { if (typeof flashSel === 'function') flashSel(); return; }
    _myDeckId = deckSel.value;

    if (!_room) {
      // Connect to a lobby room first so we can receive the challenge response
      try {
        await _joinOrCreateRoom({ deckId: _myDeckId, userId: _myUserId, challengeMode: true });
      } catch (err) {
        _handleConnectionError(err);
        return;
      }
    }

    _room.send('challenge_player', { targetUsername, deckId: _myDeckId });

    // Update challenge modal
    const ctgt = document.getElementById('ctgt');
    if (ctgt) ctgt.textContent = targetUsername;
    if (typeof op === 'function') op('cmod');
  }

  /**
   * Accept an incoming challenge.
   */
  function acceptChallenge() {
    if (!_room || !_pendingChallengeId) return;
    const deckSel = document.getElementById('dsel');
    _myDeckId = deckSel ? deckSel.value : '';
    _room.send('accept_challenge', { challengeId: _pendingChallengeId, deckId: _myDeckId });
    if (typeof cl === 'function') cl('cmod');
  }

  /**
   * Decline an incoming challenge.
   */
  function declineChallenge() {
    if (!_room || !_pendingChallengeId) return;
    _room.send('decline_challenge', { challengeId: _pendingChallengeId });
    _pendingChallengeId = null;
    if (typeof cl === 'function') cl('cmod');
  }

  // ────────────────────────────────────────────────────────────────
  //  ROOM SETUP  (internal)
  // ────────────────────────────────────────────────────────────────

  async function _joinOrCreateRoom(options) {
    if (!_client) {
      console.error('[NET] Call NET.init() before trying to join a room.');
      return;
    }

    const joinOptions = {
      ...options,
      displayName: options.userId || 'Player',
      unitDeck: [],
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
      _mySeat = data.yourSeat;   // "p1" or "p2"
      console.log('[NET] game_start — I am seat:', _mySeat);

      // Close matchmaking modal
      if (typeof cl === 'function') cl('mmod');

      // Launch the match screen with server-provided initial state
      _launchMatchFromServer(data.state);
    });

    _room.onMessage('state_update', (data) => {
      _applyStateUpdate(data.state);
    });

    _room.onMessage('valid_moves', (data) => {
      // data: { unitId, tiles }
      // Tell M to highlight those tiles as move targets
      if (typeof M !== 'undefined' && M._setValidMoves) {
        M._setValidMoves(data.unitId, data.tiles);
      }
    });

    _room.onMessage('valid_targets', (data) => {
      // data: { unitId, tiles, mode }
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
      // data: { tiles: number[] }
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

    _room.onMessage('essence_update', (data) => {
      // data: { n, f, w }
      if (typeof M !== 'undefined' && M._setEssence) {
        M._setEssence(data);
      } else {
        // Fallback: update HUD directly
        const en = document.getElementById('m-ess-n');
        const ef = document.getElementById('m-ess-f');
        const ew = document.getElementById('m-ess-w');
        if (en) en.textContent = data.n;
        if (ef) ef.textContent = data.f;
        if (ew) ew.textContent = data.w;
      }
    });

    _room.onMessage('capture_update', (data) => {
      // data: { structureTile, capturedBy, progress }
      const prog = data.progress >= 1
        ? `${data.capturedBy === _mySeat ? 'You' : 'Opponent'} captured a Structure!`
        : `Structure capture: ${Math.round(data.progress * 100)}% (${data.capturedBy === _mySeat ? 'You' : 'Opponent'})`;
      log('s', `🏛 ${prog}`);
      toast(prog);
    });

    _room.onMessage('siege_update', (data) => {
      // data: { empireTile, siegeBy, unitCount }
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
      // data: { challengeId, fromUsername, deckName }
      _pendingChallengeId = data.challengeId;
      _showIncomingChallenge(data);
    });

    _room.onMessage('challenge_accepted', (data) => {
      // Our challenge was accepted — game_start will follow
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
        // Opponent left — we win by forfeit
        setTimeout(() => {
          if (typeof M !== 'undefined' && M.winGame) M.winGame('forfeit');
        }, 1500);
      }
    });

    // ── Connection events ────────────────────────────────────────

    _room.onLeave((code) => {
      console.log('[NET] Left room. Code:', code);
      if (code === 1000) return; // clean leave, do nothing
      // Unexpected disconnect — attempt reconnect
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

    // Let the player fight AI instead
    toast('Could not connect to server — launching AI match instead.');
    if (typeof launchMatch === 'function') {
      setTimeout(launchMatch, 600);
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  LAUNCH MATCH from server state
  // ────────────────────────────────────────────────────────────────

  function _launchMatchFromServer(serverState) {
    // Show the match screen
    const mscr = document.getElementById('mscr');
    if (mscr) mscr.classList.add('on');

    // Initialise M in "network mode" — skips AI simulation
    if (typeof M !== 'undefined' && M.initFromServer) {
      M.initFromServer(serverState, _mySeat);
    } else if (typeof M !== 'undefined' && M.init) {
      // Fallback: use existing init, then immediately overwrite state
      M.init();
      _applyStateUpdate(serverState);
    }

    const opponent = serverState.players
      ? Object.values(serverState.players).find(p => p.seat !== _mySeat)
      : null;

    log('s', `═══ MATCH BEGINS — You are ${_mySeat === 'p1' ? 'Player 1' : 'Player 2'} ═══`);
    if (opponent) log('s', `Opponent: ${opponent.username || 'Unknown'}`);

    // Update opponent name display if the HUD has a slot for it
    const oppNameEl = document.getElementById('m-opp-name');
    if (oppNameEl && opponent) oppNameEl.textContent = opponent.username || 'Opponent';
  }

  // ────────────────────────────────────────────────────────────────
  //  STATE APPLICATION  (server → client)
  // ────────────────────────────────────────────────────────────────

  /**
   * Apply a full authoritative state snapshot from the server.
   * Maps server field names to the M engine's internal GS object.
   *
   * Expected serverState shape:
   * {
   *   turn: number,
   *   phase: "standby"|"draw"|"main"|"end",
   *   activePlayer: "p1"|"p2",
   *   players: {
   *     p1: { username, hp, essence:{n,f,w}, unitDeckCount, blitzDeckCount, extraDeckCount, discardCount, hand: CardData[] },
   *     p2: { ... }
   *   },
   *   units: UnitInstance[],       // all units on board (both sides)
   *   structures: StructureInstance[],
   *   tiles: TileState[],          // tile types + revealed flags
   *   empires: { p1: {tileIdx, hp}, p2: {tileIdx, hp} }
   * }
   */
  function _applyStateUpdate(state) {
    if (!state || typeof M === 'undefined') return;

    const me  = state.players?.[_mySeat];
    const opp = state.players?.[ _mySeat === 'p1' ? 'p2' : 'p1' ];

    // ── Essence ──
    if (me?.essence && M._setEssence) {
      M._setEssence(me.essence);
    }

    // ── Empire HP ──
    if (state.empires) {
      const myEmpire  = state.empires[_mySeat];
      const oppEmpire = state.empires[ _mySeat === 'p1' ? 'p2' : 'p1' ];
      if (M._setEmpireHP) {
        M._setEmpireHP('player', myEmpire?.hp ?? 20);
        M._setEmpireHP('opponent', oppEmpire?.hp ?? 20);
      }
    }

    // ── Units ──
    if (state.units && M._setUnits) {
      const myUnits  = state.units.filter(u => u.owner === _mySeat);
      const oppUnits = state.units.filter(u => u.owner !== _mySeat);
      M._setUnits(myUnits, oppUnits);
    }

    // ── Tiles / fog ──
    if (state.tiles && M._applyTileState) {
      M._applyTileState(state.tiles);
    }

    // ── Deck counts ──
    if (me && M._setDeckCounts) {
      M._setDeckCounts({
        unitDeck:   me.unitDeckCount   ?? 0,
        blitzDeck:  me.blitzDeckCount  ?? 0,
        extraDeck:  me.extraDeckCount  ?? 0,
        discard:    me.discardCount    ?? 0,
      });
    }

    // ── Hand ──
    if (me?.hand && M._setHand) {
      M._setHand(me.hand);
    }

    // ── Phase ──
    if (state.phase && M._setPhase) {
      const isActive = state.activePlayer === _mySeat;
      M._setPhase(state.phase, state.turn, isActive);
    }

    // Redraw board
    if (M.redraw) M.redraw();
  }

  // ────────────────────────────────────────────────────────────────
  //  MESSAGE HANDLERS  (server → client events)
  // ────────────────────────────────────────────────────────────────

  function _handleCombatResult(data) {
    /*
     * data: {
     *   attackerId,  targetId,
     *   roll,        def,
     *   hit: bool,   damage: number,
     *   died: bool,  essenceGained: number,
     *   isEmpireTarget: bool
     * }
     */
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

    // Visual flash on the board canvas
    if (typeof M !== 'undefined' && M._flashCombat) {
      M._flashCombat(data.attackerId, data.targetId, data.hit);
    }
  }

  function _handleBlitzPlayed(data) {
    /*
     * data: { cardId, playedBy, targetId, blitzSpeed, stormId }
     * blitzSpeed: "instant" | "slow" | "reaction"
     */
    const who = data.playedBy === _mySeat ? 'You played' : 'Opponent played';
    log('a', `⚡ ${who} Blitz card: ${data.cardId} [${data.blitzSpeed}]`);
    toast(`⚡ ${who} Blitz: ${data.cardId}`);

    if (data.blitzSpeed === 'reaction') {
      toast(`🌀 Reaction! ${who} countered a Blitz card.`);
    }
  }

  function _handleStormUpdate(data) {
    /*
     * data: { stormId, stack: [{cardId, playedBy, blitzSpeed}], resolved: bool }
     * A "Storm" happens when Blitz cards chain — we show a queue UI.
     */
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
    /*
     * data: { card: CardData, deckType, remaining }
     */
    log('s', `Drew: ${data.card.name} from ${data.deckType} deck. (${data.remaining} remaining)`);
    toast(`Drew ${data.card.name}!`);
    if (typeof M !== 'undefined' && M._addCardToHand) {
      M._addCardToHand(data.card);
    }
  }

function _handlePhaseChange(data) {
  console.log('[NET] _handlePhaseChange received:', JSON.stringify(data));
  /*
   * data: { phase, turn, activePlayer }
   */
  const isMyTurnNow = data.activePlayer === _mySeat;

  // Forward to ZB
  if (window.ZB && window.ZB.onPhaseChange) {
    window.ZB.onPhaseChange(data.phase, data.activePlayer);
  }

  if (typeof M !== 'undefined' && M._setPhase) {
    M._setPhase(data.phase, data.turn, isMyTurnNow);
  }

  const phaseLabel = {
    standby: 'STANDBY', draw: 'DRAW', main: 'MAIN', end: 'END'
  }[data.phase] || data.phase.toUpperCase();

  if (isMyTurnNow) {
    log('s', `═══ YOUR TURN — Turn ${data.turn} · ${phaseLabel} Phase ═══`);
    toast(`Turn ${data.turn} — ${phaseLabel} Phase — Your turn!`);
  } else {
    log('d', `Opponent's turn — ${phaseLabel} Phase`);
    toast(`Turn ${data.turn} — ${phaseLabel} Phase — Waiting for opponent…`);
  }
}

  function _handleGameOver(data) {
    /*
     * data: { winner: "p1"|"p2", reason: "empire_destroyed"|"siege"|"forfeit"|"timeout" }
     */
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

    // Disconnect cleanly after a short delay
    setTimeout(() => { if (_room) _room.leave(); }, 3000);
  }

  // ────────────────────────────────────────────────────────────────
  //  STORM UI  (Blitz chain queue display)
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
  //  CHALLENGE UI  (incoming challenge notification)
  // ────────────────────────────────────────────────────────────────

  function _showIncomingChallenge(data) {
    // Populate the existing challenge modal for the receiver
    const ctgt = document.getElementById('ctgt');
    if (ctgt) ctgt.textContent = data.fromUsername;

    // Swap the modal buttons to Accept / Decline instead of Confirm / Cancel
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
  //  All functions below are the replacements for the local M engine
  //  functions. Instead of modifying local state, they send a message
  //  to the server. The server validates, applies, and broadcasts back.
  // ────────────────────────────────────────────────────────────────

  /**
   * Request valid move tiles for a unit.
   * Server responds with "valid_moves" message.
   */
  function requestMoves(unitId) {
    if (!_assertConnected()) return;
    _room.send('request_moves', { unitId });
  }

  /**
   * Move a unit to a tile.
   */
  function moveUnit(unitId, toTile) {
    if (!_assertConnected()) return;
    _room.send('move_unit', { unitId, toTile });
    log('s', `Moving ${unitId} → tile ${toTile}…`);
  }

  /**
   * Request valid attack targets for a unit.
   * Server responds with "valid_targets" message.
   */
  function requestTargets(unitId, mode) {
    if (!_assertConnected()) return;
    _room.send('request_targets', { unitId, mode });
  }

  /**
   * Declare an attack.
   * Server resolves the d10 roll and responds with "combat_result" then "state_update".
   */
  function declareAttack(unitId, targetTile, mode) {
    if (!_assertConnected()) return;
    _room.send('declare_attack', { unitId, targetTile, mode });
    log('a', `${unitId} declares ${mode} attack on tile ${targetTile}…`);
  }

  /**
   * Play a Blitz card from hand.
   */
  function playBlitz(cardId, options = {}) {
    if (!_assertConnected()) return;
    _room.send('play_blitz', { cardId, ...options });
    log('a', `Playing Blitz card: ${cardId}`);
  }

  /**
   * Play a Reaction Blitz card during a Storm.
   */
  function playReaction(cardId, stormId, reactingToId) {
    if (!_assertConnected()) return;
    _room.send('play_reaction', { cardId, stormId, reactingToId });
    log('a', `Reaction! Playing ${cardId} against ${reactingToId}`);
  }

  /**
   * Deploy a unit from hand onto the board.
   */
  function deployUnit(cardId, tileIdx) {
    if (!_assertConnected()) return;
    _room.send('deploy_unit', { cardId, tileIdx });
    log('s', `Deploying ${cardId} to tile ${tileIdx}…`);
  }

  /**
   * Deploy a structure from the Extra deck onto the board.
   */
  function deployStructure(cardId, tileIdx) {
    if (!_assertConnected()) return;
    _room.send('deploy_structure', { cardId, tileIdx });
    log('s', `Deploying structure ${cardId} to tile ${tileIdx}…`);
  }

  /**
   * Draw a card from a deck.
   * Server validates draw phase + deck count, then sends "draw_result".
   */
  function drawCard(deckType) {
    if (!_assertConnected()) return;
    _room.send('draw_card', { deckType });
  }

  /**
   * Use a unit's active ability.
   */
  function useAbility(unitId, abilityIndex, options = {}) {
    if (!_assertConnected()) return;
    _room.send('ability_use', { unitId, abilityIndex, ...options });
    log('a', `${unitId} activates ability ${abilityIndex}`);
  }

  /**
   * Start a Structure capture attempt.
   * Server tracks the 1–2 round timer based on unit count.
   */
  function captureStructure(unitId, structureTile) {
    if (!_assertConnected()) return;
    _room.send('capture_start', { unitId, structureTile });
    log('s', `${unitId} attempting to capture structure at tile ${structureTile}`);
  }

  /**
   * Declare a Siege on the opponent's Empire (requires 5 surrounding units).
   */
  function declareSiege(unitIds) {
    if (!_assertConnected()) return;
    _room.send('siege_declare', { unitIds });
    log('a', `SIEGE DECLARED with ${unitIds.length} units!`);
  }

  /**
   * End your turn — server transitions to opponent's Standby phase.
   */
  function endTurn() {
    if (!_assertConnected()) return;
    _room.send('end_turn', {});
    log('s', 'Turn ended — passing to opponent.');
    toast('Turn ended. Waiting for opponent…');
  }

  /**
   * Concede the match.
   */
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

  /**
   * Is it currently this client's turn?
   */
  function isMyTurnNow() {
    // If M has a phase reference use that, otherwise we can't know without state
    if (typeof M !== 'undefined' && M._isMyTurn) return M._isMyTurn();
    return false;
  }

  /**
   * Returns whether a Storm chain is currently active.
   * Use this to decide whether to show the Reaction button.
   */
  function isStormActive() {
    return _stormActive;
  }

  /**
   * Clean disconnect — call when the player leaves the match screen normally.
   */
  function disconnect() {
    clearTimeout(_matchTimer);
    if (_room) {
      _room.leave(true);  // true = clean leave
      _room = null;
    }
    _mySeat = null;
    _stormActive = false;
    _hideStormUI();
  }

  /**
   * Debug helper — logs current room state to console.
   */
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

    // Player actions (send to server)
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

    // Expose config for easy URL override
    configure: (opts) => Object.assign(CONFIG, opts),
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

})(window);
