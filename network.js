// network.js — Colyseus client layer
// Connects to the game server, owns the room reference, exposes send helpers,
// and fires Bridge callbacks on every incoming message / state patch.

const NET = (() => {
  const SERVER_URL = "wss://us-mia-55cdd0b8.colyseus.cloud";
  const ROOM_NAME  = "battle_room";

  let client = null;
  let room   = null;
  let mySeat = null;   // "p1" | "p2"

  // ─── Public API ──────────────────────────────────────────────────────────

  async function connect() {
    try {
      client = new Colyseus.Client(SERVER_URL);
      _log("Connecting to " + SERVER_URL);
      room = await client.joinOrCreate(ROOM_NAME);
      _log("Joined room: " + room.id);
      _bindRoomEvents();
    } catch (err) {
      console.error("[NET] Connection failed:", err);
      Bridge.onConnectionError(err.message || "Connection failed");
    }
  }

  // ─── Action senders ──────────────────────────────────────────────────────

  function sendPlaceUnit(defName, q, r) {
    _send("place_unit", { defName, q, r });
  }

  function sendMoveUnit(unitId, q, r) {
    _send("move_unit", { unitId, q, r });
  }

  function sendAttackUnit(attackerId, targetId) {
    _send("attack_unit", { attackerId, targetId });
  }

  function sendAttackEmpire(attackerId) {
    _send("attack_empire", { attackerId });
  }

  function sendEndTurn() {
    _send("end_turn", {});
  }

  function getSeat() { return mySeat; }

  // ─── Internal ────────────────────────────────────────────────────────────

  function _send(type, data) {
    if (!room) { console.warn("[NET] Not connected – cannot send", type); return; }
    room.send(type, data);
  }

  function _log(msg) {
    console.log("[NET]", msg);
  }

  function _bindRoomEvents() {
    // ── Seat assignment (first thing server sends) ──
    room.onMessage("seat_assigned", (msg) => {
      mySeat = msg.seat;
      _log("Seat: " + mySeat);
      Bridge.onSeatAssigned(mySeat);
    });

    // ── Game started ──
    room.onMessage("game_started", (msg) => {
      _log("Game started – active: " + msg.activePlayer);
      Bridge.onGameStarted(msg.activePlayer);
    });

    // ── Server action broadcasts ──
    room.onMessage("unit_placed", (msg) => {
      Bridge.onUnitPlaced(msg);
    });

    room.onMessage("unit_moved", (msg) => {
      Bridge.onUnitMoved(msg);
    });

    room.onMessage("unit_attacked", (msg) => {
      Bridge.onUnitAttacked(msg);
    });

    room.onMessage("unit_died", (msg) => {
      Bridge.onUnitDied(msg);
    });

    room.onMessage("empire_attacked", (msg) => {
      Bridge.onEmpireAttacked(msg);
    });

    room.onMessage("turn_changed", (msg) => {
      Bridge.onTurnChanged(msg);
    });

    room.onMessage("game_over", (msg) => {
      Bridge.onGameOver(msg);
    });

    // ── Rejected action ──
    room.onMessage("action_rejected", (msg) => {
      Bridge.onActionRejected(msg.reason);
    });

    // ── Full state sync (Colyseus delta patches) ──
    room.onStateChange((state) => {
      Bridge.onStateSync(state);
    });

    // ── Disconnection ──
    room.onLeave((code) => {
      _log("Left room – code " + code);
      Bridge.onDisconnected(code);
    });

    room.onError((code, message) => {
      console.error("[NET] Room error:", code, message);
      Bridge.onConnectionError(message);
    });
  }

  return {
    connect,
    sendPlaceUnit,
    sendMoveUnit,
    sendAttackUnit,
    sendAttackEmpire,
    sendEndTurn,
    getSeat,
  };
})();
