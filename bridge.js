// bridge.js — wires Colyseus server events → Phaser scene + HUD
// NET fires into Bridge; Bridge calls HexScene methods and updates the DOM.
// Bridge never mutates game logic — it only reflects what the server says.

const Bridge = (() => {

  // Local mirror of server state (read-only — never mutate directly)
  const state = {
    seat:        null,   // "p1" | "p2"   — this client's seat
    activePlayer: null,  // "p1" | "p2"
    p1Hp: 10, p2Hp: 10,
    p1Mana: 0, p2Mana: 0,
    p1EmpireQ: 0, p1EmpireR:  4,
    p2EmpireQ: 0, p2EmpireR: -4,
    units: {},           // id → { id, owner, q, r, defName, hp, maxHp, atk, spd, moved, attacked }
    phase: "waiting",
    winner: null,
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function getScene() {
    if (window.game) return window.game.scene.getScene("BattleScene");
    return null;
  }

  function isMyTurn() {
    return state.seat && state.activePlayer === state.seat;
  }

  function myMana() {
    return state.seat === "p1" ? state.p1Mana : state.p2Mana;
  }

  // ─── Incoming from NET ────────────────────────────────────────────────────

  function onSeatAssigned(seat) {
    state.seat = seat;
    _updateTurnLabel();
    addLog("You are " + (seat === "p1" ? "Player 1 (Red Empire)" : "Player 2 (Blue Empire)"), "important");
    addLog("Waiting for opponent...");
    const wm = document.getElementById("waiting-msg");
    if (wm) wm.textContent = "Connected as " + (seat === "p1" ? "Player 1" : "Player 2") + " — waiting for opponent...";
  }

  function onGameStarted(activePlayer) {
    state.activePlayer = activePlayer;
    state.phase = "playing";
    _updateTurnLabel();
    _updateManaDisplay();
    _updateCardStates();
    addLog("═══ Game started! ═══", "important");
    if (isMyTurn()) addLog("Your turn — place, attack, or move, then end turn.", "important");
    // Hide the waiting-for-opponent overlay
    document.dispatchEvent(new Event("game_started_ui"));
    document.getElementById("end-turn-btn").disabled = !isMyTurn();
    const scene = getScene();
    if (scene) scene.onGameStarted(state);
  }

  function onUnitPlaced(msg) {
    // msg: { id, owner, defName, q, r }
    const def = UNIT_DEFS[msg.defName];
    if (!def) return;
    state.units[msg.id] = {
      id:       msg.id,
      owner:    msg.owner,
      q:        msg.q,
      r:        msg.r,
      defName:  msg.defName,
      hp:       def.hp,
      maxHp:    def.hp,
      atk:      def.atk,
      spd:      def.spd,
      moved:    false,
      attacked: false,
    };
    addLog((msg.owner === state.seat ? "You" : "Opponent") + " placed " + msg.defName + ".", msg.owner === state.seat ? "" : "enemy");
    const scene = getScene();
    if (scene) scene.redraw(state);
  }

  function onUnitMoved(msg) {
    // msg: { id, q, r }
    const u = state.units[msg.id];
    if (!u) return;
    u.q = msg.q; u.r = msg.r; u.moved = true;
    addLog((u.owner === state.seat ? "Your" : "Enemy") + " " + u.defName + " moved.");
    const scene = getScene();
    if (scene) scene.redraw(state);
  }

  function onUnitAttacked(msg) {
    // msg: { attackerId, targetId, damage, targetHp }
    const atk = state.units[msg.attackerId];
    const tgt = state.units[msg.targetId];
    if (!atk || !tgt) return;
    atk.attacked = true;
    tgt.hp = msg.targetHp;
    addLog(`${atk.defName} attacks ${tgt.defName} for ${msg.damage} (${tgt.hp} HP left)`, "damage");
    const scene = getScene();
    if (scene) scene.playAttackFX(atk, tgt, state);
  }

  function onUnitDied(msg) {
    // msg: { id }
    const u = state.units[msg.id];
    if (u) addLog(u.defName + " was destroyed!", "death");
    delete state.units[msg.id];
    const scene = getScene();
    if (scene) scene.redraw(state);
  }

  function onEmpireAttacked(msg) {
    // msg: { attacker, target, damage, p1Hp, p2Hp }
    state.p1Hp = msg.p1Hp;
    state.p2Hp = msg.p2Hp;
    const atkSeat = msg.attacker;
    addLog(
      (atkSeat === state.seat ? "Your unit" : "Enemy unit") +
      " strikes " + (msg.target === state.seat ? "YOUR" : "enemy") +
      " Empire for " + msg.damage + "!",
      "damage"
    );
    _updateHpBars();
    const scene = getScene();
    if (scene) scene.redraw(state);
  }

  function onTurnChanged(msg) {
    // msg: { activePlayer, p1Mana, p2Mana }
    state.activePlayer = msg.activePlayer;
    state.p1Mana = msg.p1Mana;
    state.p2Mana = msg.p2Mana;

    // Reset all unit flags for the new active player's units
    for (const id in state.units) {
      if (state.units[id].owner === msg.activePlayer) {
        state.units[id].moved    = false;
        state.units[id].attacked = false;
      }
    }

    _updateTurnLabel();
    _updateManaDisplay();
    _updateCardStates();

    if (isMyTurn()) {
      addLog("─── Your turn begins ───", "important");
      document.getElementById("end-turn-btn").disabled = false;
    } else {
      addLog("─── Opponent's turn ───", "enemy");
      document.getElementById("end-turn-btn").disabled = true;
    }

    // Clear any selection
    const scene = getScene();
    if (scene) {
      scene.clearSelection();
      scene.redraw(state);
    }
  }

  function onStateSync(serverState) {
    // Full Colyseus delta sync — mirror all fields
    if (serverState.p1Hp        !== undefined) state.p1Hp        = serverState.p1Hp;
    if (serverState.p2Hp        !== undefined) state.p2Hp        = serverState.p2Hp;
    if (serverState.p1Mana      !== undefined) state.p1Mana      = serverState.p1Mana;
    if (serverState.p2Mana      !== undefined) state.p2Mana      = serverState.p2Mana;
    if (serverState.activePlayer !== undefined) state.activePlayer = serverState.activePlayer;
    if (serverState.phase        !== undefined) state.phase        = serverState.phase;
    if (serverState.winner       !== undefined) state.winner       = serverState.winner;

    // Sync units map
    if (serverState.units) {
      serverState.units.forEach((unit, id) => {
        if (!state.units[id]) {
          const def = UNIT_DEFS[unit.defName] || { hp: unit.hp, atk: unit.atk, spd: unit.spd };
          state.units[id] = {
            id, owner: unit.owner, q: unit.q, r: unit.r,
            defName: unit.defName, hp: unit.hp, maxHp: unit.maxHp || def.hp,
            atk: unit.atk, spd: unit.spd, moved: unit.moved, attacked: unit.attacked,
          };
        } else {
          Object.assign(state.units[id], {
            q: unit.q, r: unit.r, hp: unit.hp,
            moved: unit.moved, attacked: unit.attacked,
          });
        }
      });
      // Remove units no longer on server
      for (const id in state.units) {
        if (!serverState.units.has(id)) delete state.units[id];
      }
    }

    _updateHpBars();
    _updateManaDisplay();
    _updateCardStates();
    _updateTurnLabel();
  }

  function onGameOver(msg) {
    // msg: { winner, reason }
    state.phase  = "gameover";
    state.winner = msg.winner;
    const iWon = msg.winner === state.seat;
    addLog(iWon ? "═══ VICTORY! ═══" : "═══ DEFEAT ═══", iWon ? "important" : "death");
    document.getElementById("end-turn-btn").disabled = true;

    const overlay = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = iWon ? "VICTORY" : "DEFEAT";
    document.getElementById("overlay-title").style.color = iWon ? "var(--gold-light)" : "var(--red)";
    document.getElementById("overlay-sub").textContent = iWon
      ? "The enemy empire has been crushed."
      : "Your empire lies in ruins.";
    overlay.style.display = "flex";
  }

  function onActionRejected(reason) {
    const MESSAGES = {
      not_your_turn:            "It's not your turn.",
      not_enough_mana:          "Not enough mana.",
      hex_occupied:             "That hex is occupied.",
      off_board:                "That hex is off the board.",
      not_adjacent_to_empire:   "Must place adjacent to your Empire.",
      unit_not_found:           "Unit not found.",
      not_your_unit:            "That's not your unit.",
      cannot_attack_own_unit:   "Can't attack your own unit.",
      already_moved:            "Already moved this turn.",
      already_attacked:         "Already attacked this turn.",
      out_of_range:             "Target is out of range.",
    };
    addLog(MESSAGES[reason] || ("Rejected: " + reason), "important");
  }

  function onConnectionError(msg) {
    addLog("Connection error: " + msg, "death");
    document.getElementById("waiting-overlay").style.display = "flex";
    document.getElementById("waiting-msg").textContent = "Connection failed — " + msg;
  }

  function onDisconnected(code) {
    addLog("Disconnected (code " + code + ")", "death");
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function _updateHpBars() {
    const myHp    = state.seat === "p1" ? state.p1Hp : state.p2Hp;
    const enemyHp = state.seat === "p1" ? state.p2Hp : state.p1Hp;

    document.getElementById("player-hp-text").textContent = myHp + " / 10";
    document.getElementById("enemy-hp-text").textContent  = enemyHp + " / 10";
    document.getElementById("player-hp-bar").style.width  = (myHp / 10 * 100) + "%";
    document.getElementById("enemy-hp-bar").style.width   = (enemyHp / 10 * 100) + "%";
  }

  function _updateManaDisplay() {
    document.getElementById("mana-text").textContent = myMana() + " / 2 Mana";
  }

  function _updateTurnLabel() {
    const lbl = document.getElementById("turn-label");
    if (state.phase === "waiting") {
      lbl.textContent = "WAITING...";
      lbl.style.color = "var(--muted)";
    } else if (isMyTurn()) {
      lbl.textContent = "YOUR TURN";
      lbl.style.color = "var(--gold-light)";
    } else {
      lbl.textContent = "OPPONENT'S TURN";
      lbl.style.color = "#6688cc";
    }
  }

  function _updateCardStates() {
    const mana = myMana();
    UNIT_DEFS && Object.keys(UNIT_DEFS).forEach((name, i) => {
      const card = document.getElementById("card-" + i);
      if (!card) return;
      const canAfford = UNIT_DEFS[name].cost <= mana;
      const myTurn = isMyTurn();
      if (!canAfford || !myTurn) card.classList.add("depleted");
      else card.classList.remove("depleted");
    });
  }

  // ─── Public getters for Phaser scene ─────────────────────────────────────

  function getState()   { return state; }
  function getMyTurn()  { return isMyTurn(); }
  function getMyMana()  { return myMana(); }
  function getMySeat()  { return state.seat; }

  return {
    // Incoming from NET
    onSeatAssigned,
    onGameStarted,
    onUnitPlaced,
    onUnitMoved,
    onUnitAttacked,
    onUnitDied,
    onEmpireAttacked,
    onTurnChanged,
    onStateSync,
    onGameOver,
    onActionRejected,
    onConnectionError,
    onDisconnected,
    // Outgoing to Phaser/DOM
    getState,
    getMyTurn,
    getMyMana,
    getMySeat,
  };
})();

