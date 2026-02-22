/**
 * ═══════════════════════════════════════════════════════════════════
 *  ZERCHNIV BLITZ — M Engine Extension Hooks
 *  m_network_hooks.js
 *
 *  WHAT THIS FILE IS
 *  ─────────────────
 *  This file shows exactly what new functions to ADD inside the M module
 *  in index.html so that network.js can drive the match engine from
 *  server state instead of local AI logic.
 *
 *  HOW TO USE IT
 *  ─────────────
 *  1. Open index.html
 *  2. Find the M module: `const M = (() => {`
 *  3. Find the `return { init, quit, endTurn, drawCard, selectAction, playCard, closePop };` line
 *  4. BEFORE that return line, paste ALL the functions below
 *  5. UPDATE the return line to add the new exports (shown at bottom)
 *
 *  Then in the functions that currently call local game logic directly
 *  (endTurn, drawCard, selectAction, doAttack, moveUnit), swap them
 *  to call NET.xxx() instead. The patches for each are shown below.
 * ═══════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════════════════
//  PASTE THESE FUNCTIONS INSIDE THE M MODULE  (before the return {})
// ══════════════════════════════════════════════════════════════════

  /**
   * NETWORK HOOK: Initialise match from server-provided initial state.
   * Called by NET when game_start is received.
   * Replaces the local init() for multiplayer matches.
   */
  function initFromServer(serverState, mySeat) {
    canvas = document.getElementById('m-canvas');
    ctx = canvas ? canvas.getContext('2d') : null;
    if (!ctx) { console.error('m-canvas not found!'); return; }

    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      clickBoardNetwork(mx, my, mySeat);
    });

    // Zero out local state — server is authoritative
    clearInterval(timerInt);
    TILES = [];
    GS = {
      phase: 'standby', turn: 1, ts: 150,
      plHP: 20, oppHP: 20,
      ess: { n: 0, f: 0, w: 0 },
      hand: [], plUnits: [], oppUnits: [],
      plDeckU: 0, plDeckB: 0, aiDeckU: 0, aiDeckB: 0,
      plDisc: 0, aiDisc: 0,
      selUnit: null, selTile: null, actionMode: null,
      aiEmpireTile: 0, plEmpireTile: 0,
      drawnThisTurn: false,
      mySeat: mySeat,
      isMyTurn: false,
    };

    initBoard();
    resizeCanvas();

    // Apply the initial server state
    if (serverState) _applyServerStateToGS(serverState, mySeat);

    updateHUD(); updateEss(); updateDecks();
    updatePlPanel(); updateAIPanel(); renderHand();
    startTimer();
    mlog('s', `═══ MATCH BEGINS — You are ${mySeat === 'p1' ? 'Player 1' : 'Player 2'} ═══`);
  }

  /**
   * NETWORK HOOK: Apply a full state snapshot from the server to local GS.
   * Called by NET._applyStateUpdate.
   */
  function _applyServerStateToGS(state, mySeat) {
    const me  = state.players?.[mySeat];
    const opp = state.players?.[ mySeat === 'p1' ? 'p2' : 'p1' ];

    if (me?.essence) GS.ess = { ...me.essence };
    if (state.empires) {
      GS.plHP  = state.empires[mySeat]?.hp ?? 20;
      GS.aiHP  = state.empires[ mySeat === 'p1' ? 'p2' : 'p1' ]?.hp ?? 20;
      GS.plEmpireTile  = state.empires[mySeat]?.tileIdx ?? GS.plEmpireTile;
      GS.aiEmpireTile  = state.empires[ mySeat === 'p1' ? 'p2' : 'p1' ]?.tileIdx ?? GS.aiEmpireTile;
    }

    // Map server unit objects to local unit format
    if (state.units) {
      GS.plUnits = state.units
        .filter(u => u.owner === mySeat)
        .map(_serverUnitToLocal);
      GS.aiUnits = state.units
        .filter(u => u.owner !== mySeat)
        .map(_serverUnitToLocal);
    }

    // Apply tile state (revealed, type)
    if (state.tiles) {
      state.tiles.forEach((st, i) => {
        if (!TILES[i]) return;
        TILES[i].type     = st.type     ?? TILES[i].type;
        TILES[i].revealed = st.revealed ?? TILES[i].revealed;
      });
    }

    if (me) {
      GS.plDeckU = me.unitDeckCount  ?? GS.plDeckU;
      GS.plDeckB = me.blitzDeckCount ?? GS.plDeckB;
      GS.plDisc  = me.discardCount   ?? GS.plDisc;
    }
    if (me?.hand) {
      GS.hand = me.hand.map(c => CARDS.find(x => x.id === c.id) || c);
    }

    GS.isMyTurn = (state.activePlayer === mySeat);
    GS.phase    = state.phase ?? GS.phase;
    GS.turn     = state.turn  ?? GS.turn;

    // Refresh all panels
    updateHUD(); updateEss(); updateDecks();
    updatePlPanel(); updateAIPanel(); renderHand();
    drawBoard();
  }

  /**
   * Convert a server unit object to the local M engine format.
   */
  function _serverUnitToLocal(su) {
    const card = CARDS.find(c => c.id === su.cardId) || {
      id: su.cardId, name: su.cardId, hp: su.maxHp, def: su.def,
      matk: su.matk, ratk: su.ratk || '—', sz: su.sz || 'N', spd: su.spd,
      ab: [], t: 'unit', e: 'neutral', c: 0,
    };
    return {
      id:          su.id,
      card:        card,
      tileIdx:     su.tileIdx,
      hp:          su.hp,
      moved:       su.moved     ?? false,
      attacked:    su.attacked  ?? false,
      deployRest:  su.deployRest ?? false,
    };
  }

  // ── Network-mode board click handler ─────────────────────────────
  // Replaces clickBoard() for multiplayer — sends actions to server
  // instead of resolving locally.

  function clickBoardNetwork(mx, my, mySeat) {
    if (!GS.isMyTurn) {
      mtoast('Wait for your turn!');
      return;
    }

    const tile = closestTile(mx, my);
    if (!tile) { deselect(); return; }

    // Move action
    if (GS.actionMode === 'move' && GS.selUnit !== null) {
      const vm = GS._validMoveTiles || [];
      if (vm.includes(tile.idx)) {
        const u = GS.plUnits[GS.selUnit];
        NET.moveUnit(u.id, tile.idx);
        GS.actionMode = null;
      } else {
        deselect();
      }
      return;
    }

    // Attack action
    if ((GS.actionMode === 'melee' || GS.actionMode === 'ranged') && GS.selUnit !== null) {
      const vt = GS._validTargetTiles || [];
      if (vt.includes(tile.idx)) {
        const u = GS.plUnits[GS.selUnit];
        NET.declareAttack(u.id, tile.idx, GS.actionMode);
        GS.actionMode = null;
        GS.selUnit    = null;
      } else {
        deselect();
      }
      return;
    }

    // Select player unit
    const pui = GS.plUnits.findIndex(u => u.tileIdx === tile.idx);
    if (pui >= 0) {
      selectUnit(pui);
      // Ask server for valid moves so we can highlight them
      NET.requestMoves(GS.plUnits[pui].id);
      GS.selTile = tile.idx;
      drawBoard();
      return;
    }

    GS.selTile = tile.idx;
    drawBoard();
  }

  // ── NET bridge: server tells us what tiles are valid ─────────────

  function _setValidMoves(unitId, tiles) {
    GS._validMoveTiles = tiles;
    drawBoard(); // will highlight move tiles using this array
  }

  function _setValidTargets(unitId, tiles, mode) {
    GS._validTargetTiles = tiles;
    drawBoard();
  }

  function _revealTiles(tileIdxList) {
    tileIdxList.forEach(idx => {
      if (TILES[idx]) TILES[idx].revealed = true;
    });
    drawBoard();
  }

  function _setEssence(ess) {
    GS.ess = { ...ess };
    updateEss();
  }

  function _setEmpireHP(side, hp) {
    if (side === 'player')   { GS.plHP = hp; }
    if (side === 'opponent') { GS.aiHP = hp; }
    updateHUD();
    if (GS.plHP  <= 0) setTimeout(() => loseGame(), 200);
    if (GS.aiHP  <= 0) setTimeout(() => winGame(),  200);
  }

  function _setUnits(myUnits, oppUnits) {
    GS.plUnits  = myUnits.map(_serverUnitToLocal);
    GS.aiUnits  = oppUnits.map(_serverUnitToLocal);
    updatePlPanel(); updateAIPanel(); drawBoard();
  }

  function _applyTileState(tiles) {
    tiles.forEach((st, i) => {
      if (!TILES[i]) return;
      if (st.type)     TILES[i].type     = st.type;
      if (st.revealed !== undefined) TILES[i].revealed = st.revealed;
    });
    drawBoard();
  }

  function _setDeckCounts(counts) {
    GS.plDeckU = counts.unitDeck;
    GS.plDeckB = counts.blitzDeck;
    GS.plDisc  = counts.discard;
    updateDecks();
  }

  function _setHand(cards) {
    GS.hand = cards.map(c => CARDS.find(x => x.id === c.id) || c);
    renderHand();
  }

  function _addCardToHand(card) {
    const localCard = CARDS.find(c => c.id === card.id) || card;
    GS.hand.push(localCard);
    renderHand();
  }

  function _setPhase(phase, turn, isMyTurn) {
    GS.phase    = phase;
    GS.turn     = turn;
    GS.isMyTurn = isMyTurn;
    setPhase(phase);   // existing M function that updates phase indicator
  }

  function _flashCombat(attackerId, targetId, hit) {
    // Visual flash: briefly tint the attacking/target tiles
    const atk = GS.plUnits.find(u => u.id === attackerId) || GS.aiUnits.find(u => u.id === attackerId);
    const tgt = GS.plUnits.find(u => u.id === targetId)   || GS.aiUnits.find(u => u.id === targetId);
    if (!atk || !tgt) return;
    // Brief canvas glow — just redraw twice with a short delay
    drawBoard();
    setTimeout(drawBoard, 300);
  }

  function _isMyTurn() {
    return GS.isMyTurn === true;
  }

  function _log(type, msg) { mlog(type, msg); }
  function _toast(msg)      { mtoast(msg); }
  function redraw()         { drawBoard(); }


// ══════════════════════════════════════════════════════════════════
//  REPLACE THE EXISTING `return {}` LINE AT THE BOTTOM OF M WITH:
// ══════════════════════════════════════════════════════════════════

/*
  return {
    // Existing exports
    init, quit, endTurn, drawCard, selectAction, playCard, closePop,
    winGame, loseGame,

    // Network hooks (called by NET module)
    initFromServer,
    _applyServerStateToGS,
    _setValidMoves,
    _setValidTargets,
    _revealTiles,
    _setEssence,
    _setEmpireHP,
    _setUnits,
    _applyTileState,
    _setDeckCounts,
    _setHand,
    _addCardToHand,
    _setPhase,
    _flashCombat,
    _isMyTurn,
    _log,
    _toast,
    redraw,
  };
*/


// ══════════════════════════════════════════════════════════════════
//  REPLACE THESE 3 FUNCTIONS IN index.html  (swap local logic → NET)
// ══════════════════════════════════════════════════════════════════

/*
──────────────────────────────────────────────
1. startBat()  — replaces matchmaking mock
──────────────────────────────────────────────
REMOVE THIS:
  function startBat(){
    if(!document.getElementById('dsel').value){flashSel();return;}
    op('mmod');
    let s=0;
    matchInt=setInterval(()=>{
      s++;
      document.getElementById('msub').textContent=s<8?`Searching... ${s}s`:'No opponents found — launching AI match!';
      if(s>=8){clearInterval(matchInt);cl('mmod');launchMatch();}
    },1000);
  }

ADD THIS:
  function startBat(){
    NET.queueMatchmaking();
  }

──────────────────────────────────────────────
2. endTurn()  — inside M module
──────────────────────────────────────────────
Find the existing endTurn function inside M and ADD at the top:
  if (typeof NET !== 'undefined' && NET.isMyTurnNow !== undefined) {
    NET.endTurn();
    return;
  }

──────────────────────────────────────────────
3. drawCard(type)  — inside M module
──────────────────────────────────────────────
Find the existing drawCard function inside M and ADD at the top:
  if (typeof NET !== 'undefined' && NET.drawCard) {
    NET.drawCard(type);
    return;
  }

──────────────────────────────────────────────
4. selectAction('move' | 'melee' | 'ranged')  — inside M module
──────────────────────────────────────────────
For 'move': after setting GS.actionMode = 'move', add:
  if (typeof NET !== 'undefined' && GS.selUnit !== null) {
    NET.requestMoves(GS.plUnits[GS.selUnit]?.id);
  }

For 'melee'|'ranged': after setting GS.actionMode, add:
  if (typeof NET !== 'undefined' && GS.selUnit !== null) {
    NET.requestTargets(GS.plUnits[GS.selUnit]?.id, act);
  }

──────────────────────────────────────────────
5. doChallenge() / confC()  — challenge flow
──────────────────────────────────────────────
REPLACE confC() with:
  function confC(){
    const t = document.getElementById('ctgt').textContent;
    NET.challengePlayer(t);
  }

──────────────────────────────────────────────
6. quit()  — inside M module
──────────────────────────────────────────────
ADD at the top:
  if (typeof NET !== 'undefined') NET.disconnect();

──────────────────────────────────────────────
7. Add the script tags to <head>
──────────────────────────────────────────────
Add these two lines BEFORE </head>:
  <script src="https://unpkg.com/colyseus.js@^0.15.0/dist/colyseus.js"></script>
  <script src="network.js"></script>

──────────────────────────────────────────────
8. Set your server URL
──────────────────────────────────────────────
In network.js line 60, replace:
  SERVER_URL: 'wss://your-colyseus-cloud-instance.colyseus.cloud',
With your actual Colyseus Cloud URL, e.g.:
  SERVER_URL: 'wss://zerchniv.colyseus.cloud',

Or call it at runtime before the Battle! button:
  NET.configure({ SERVER_URL: 'wss://your-url.colyseus.cloud' });
*/


// ══════════════════════════════════════════════════════════════════
//  DRAW BOARD PATCH  (highlight server-provided tiles, not local)
// ══════════════════════════════════════════════════════════════════

/*
In drawTile(), find the highlight detection block:
  if (GS.actionMode === 'move' && GS.selUnit !== null) {
    if (validMoves(GS.selUnit).includes(tile.idx)) highlightMode = 'move';
  }

REPLACE with:
  if (GS.actionMode === 'move' && GS.selUnit !== null) {
    const moves = GS._validMoveTiles || validMoves(GS.selUnit);
    if (moves.includes(tile.idx)) highlightMode = 'move';
  }

And:
  if ((GS.actionMode === 'melee' || GS.actionMode === 'ranged') && GS.selUnit !== null) {
    if (validTargets(GS.selUnit, GS.actionMode).includes(tile.idx)) highlightMode = 'attack';
  }

REPLACE with:
  if ((GS.actionMode === 'melee' || GS.actionMode === 'ranged') && GS.selUnit !== null) {
    const targets = GS._validTargetTiles || validTargets(GS.selUnit, GS.actionMode);
    if (targets.includes(tile.idx)) highlightMode = 'attack';
  }
*/
