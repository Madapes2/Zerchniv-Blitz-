import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";

// ─── Schema definitions ───────────────────────────────────────────────────────

export class UnitSchema extends Schema {
  @type("string")  id: string = "";
  @type("string")  owner: string = "";   // "p1" | "p2"
  @type("number")  q: number = 0;
  @type("number")  r: number = 0;
  @type("string")  defName: string = "";
  @type("number")  hp: number = 0;
  @type("number")  maxHp: number = 0;
  @type("number")  atk: number = 0;
  @type("number")  spd: number = 1;
  @type("boolean") moved: boolean = false;
  @type("boolean") attacked: boolean = false;
}

export class GameState extends Schema {
  @type("string")  phase: string = "waiting";   // waiting | playing | gameover
  @type("string")  activePlayer: string = "p1"; // "p1" | "p2"
  @type("number")  p1Hp: number = 10;
  @type("number")  p2Hp: number = 10;
  @type("number")  p1Mana: number = 0;
  @type("number")  p2Mana: number = 0;
  @type("number")  p1EmpireQ: number = 0;
  @type("number")  p1EmpireR: number = 4;
  @type("number")  p2EmpireQ: number = 0;
  @type("number")  p2EmpireR: number = -4;
  @type("string")  winner: string = "";
  @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();
}

// ─── Unit definitions ─────────────────────────────────────────────────────────

const UNIT_DEFS: Record<string, { atk: number; hp: number; spd: number; cost: number }> = {
  Warrior:   { atk: 2, hp: 4, spd: 1, cost: 2 },
  Scout:     { atk: 1, hp: 2, spd: 2, cost: 1 },
  Berserker: { atk: 4, hp: 3, spd: 1, cost: 3 },
  Archer:    { atk: 2, hp: 2, spd: 1, cost: 2 },
  Knight:    { atk: 3, hp: 7, spd: 1, cost: 4 },
};

const MAX_MANA = 2;
const EMPIRE_HP = 10;

// ─── Hex helpers ──────────────────────────────────────────────────────────────

function hexDist(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

function hexNeighbors(q: number, r: number): { q: number; r: number }[] {
  return [
    { q: q + 1, r }, { q: q - 1, r },
    { q, r: r + 1 }, { q, r: r - 1 },
    { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 },
  ];
}

// Board hex set (oval shape matching client)
const BOARD_SET = new Set<string>();
(function buildBoard() {
  const rows = [
    { r: -4, qMin: -1, qMax: 2 }, { r: -3, qMin: -2, qMax: 3 },
    { r: -2, qMin: -3, qMax: 3 }, { r: -1, qMin: -3, qMax: 4 },
    { r:  0, qMin: -4, qMax: 4 }, { r:  1, qMin: -4, qMax: 3 },
    { r:  2, qMin: -3, qMax: 3 }, { r:  3, qMin: -3, qMax: 2 },
    { r:  4, qMin: -2, qMax: 1 },
  ];
  rows.forEach(({ r, qMin, qMax }) => {
    for (let q = qMin; q <= qMax; q++) BOARD_SET.add(`${q},${r}`);
  });
})();

function isOnBoard(q: number, r: number): boolean {
  return BOARD_SET.has(`${q},${r}`);
}

// ─── GameRoom ─────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameState> {
  private seats: Map<string, "p1" | "p2"> = new Map();
  private nextUnitId = 0;

  onCreate() {
    this.setState(new GameState() as any);
    this.maxClients = 2;

    this.onMessage("place_unit",   (client, msg) => this.handlePlaceUnit(client, msg));
    this.onMessage("move_unit",    (client, msg) => this.handleMoveUnit(client, msg));
    this.onMessage("attack_unit",  (client, msg) => this.handleAttackUnit(client, msg));
    this.onMessage("attack_empire",(client, msg) => this.handleAttackEmpire(client, msg));
    this.onMessage("end_turn",     (client, _)   => this.handleEndTurn(client));
  }

  onJoin(client: Client) {
    const seat: "p1" | "p2" = this.seats.size === 0 ? "p1" : "p2";
    this.seats.set(client.sessionId, seat);
    client.send("seat_assigned", { seat });

    if (this.seats.size === 2) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    const seat = this.seats.get(client.sessionId);
    if (seat && this.state.phase === "playing") {
      const winner = seat === "p1" ? "p2" : "p1";
      this.endGame(winner, "opponent_left");
    }
  }

  // ─── Game start ────────────────────────────────────────────────────────────

  private startGame() {
    this.state.phase = "playing";
    this.state.activePlayer = "p1";
    this.state.p1Hp = EMPIRE_HP;
    this.state.p2Hp = EMPIRE_HP;
    this.state.p1Mana = MAX_MANA;
    this.state.p2Mana = MAX_MANA;
    this.broadcast("game_started", { activePlayer: "p1" });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private getSeat(client: Client): "p1" | "p2" | null {
    return this.seats.get(client.sessionId) || null;
  }

  private unitAt(q: number, r: number): UnitSchema | null {
    for (const [, unit] of this.state.units) {
      if (unit.q === q && unit.r === r) return unit;
    }
    return null;
  }

  private reject(client: Client, reason: string) {
    client.send("action_rejected", { reason });
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  private handlePlaceUnit(client: Client, msg: { defName: string; q: number; r: number }) {
    const seat = this.getSeat(client);
    if (!seat || this.state.phase !== "playing") return;
    if (this.state.activePlayer !== seat) return this.reject(client, "not_your_turn");

    const def = UNIT_DEFS[msg.defName];
    if (!def) return this.reject(client, "unknown_unit");

    const mana = seat === "p1" ? this.state.p1Mana : this.state.p2Mana;
    if (def.cost > mana) return this.reject(client, "not_enough_mana");

    if (!isOnBoard(msg.q, msg.r)) return this.reject(client, "off_board");
    if (this.unitAt(msg.q, msg.r)) return this.reject(client, "hex_occupied");

    // Must be adjacent to own empire
    const eq = seat === "p1" ? this.state.p1EmpireQ : this.state.p2EmpireQ;
    const er = seat === "p1" ? this.state.p1EmpireR : this.state.p2EmpireR;
    if (hexDist(msg.q, msg.r, eq, er) > 1) return this.reject(client, "not_adjacent_to_empire");

    // Deduct mana
    if (seat === "p1") this.state.p1Mana -= def.cost;
    else               this.state.p2Mana -= def.cost;

    // Create unit
    const unit = new UnitSchema();
    unit.id       = `u${this.nextUnitId++}`;
    unit.owner    = seat;
    unit.q        = msg.q;
    unit.r        = msg.r;
    unit.defName  = msg.defName;
    unit.hp       = def.hp;
    unit.maxHp    = def.hp;
    unit.atk      = def.atk;
    unit.spd      = def.spd;
    unit.moved    = false;
    unit.attacked = false;

    this.state.units.set(unit.id, unit);
    this.broadcast("unit_placed", { id: unit.id, owner: seat, defName: msg.defName, q: msg.q, r: msg.r });
  }

  private handleMoveUnit(client: Client, msg: { unitId: string; q: number; r: number }) {
    const seat = this.getSeat(client);
    if (!seat || this.state.phase !== "playing") return;
    if (this.state.activePlayer !== seat) return this.reject(client, "not_your_turn");

    const unit = this.state.units.get(msg.unitId);
    if (!unit) return this.reject(client, "unit_not_found");
    if (unit.owner !== seat) return this.reject(client, "not_your_unit");
    if (unit.moved) return this.reject(client, "already_moved");

    if (!isOnBoard(msg.q, msg.r)) return this.reject(client, "off_board");
    if (this.unitAt(msg.q, msg.r)) return this.reject(client, "hex_occupied");
    if (hexDist(unit.q, unit.r, msg.q, msg.r) > unit.spd) return this.reject(client, "out_of_range");

    unit.q     = msg.q;
    unit.r     = msg.r;
    unit.moved = true;

    this.broadcast("unit_moved", { id: unit.id, q: msg.q, r: msg.r });
  }

  private handleAttackUnit(client: Client, msg: { attackerId: string; targetId: string }) {
    const seat = this.getSeat(client);
    if (!seat || this.state.phase !== "playing") return;
    if (this.state.activePlayer !== seat) return this.reject(client, "not_your_turn");

    const attacker = this.state.units.get(msg.attackerId);
    const target   = this.state.units.get(msg.targetId);
    if (!attacker || !target) return this.reject(client, "unit_not_found");
    if (attacker.owner !== seat) return this.reject(client, "not_your_unit");
    if (target.owner === seat) return this.reject(client, "cannot_attack_own_unit");
    if (attacker.attacked) return this.reject(client, "already_attacked");
    if (hexDist(attacker.q, attacker.r, target.q, target.r) > 1) return this.reject(client, "out_of_range");

    attacker.attacked = true;
    target.hp -= attacker.atk;

    this.broadcast("unit_attacked", {
      attackerId: attacker.id,
      targetId:   target.id,
      damage:     attacker.atk,
      targetHp:   target.hp,
    });

    if (target.hp <= 0) {
      this.state.units.delete(target.id);
      this.broadcast("unit_died", { id: target.id });
    }

    this.checkWinCondition();
  }

  private handleAttackEmpire(client: Client, msg: { attackerId: string }) {
    const seat = this.getSeat(client);
    if (!seat || this.state.phase !== "playing") return;
    if (this.state.activePlayer !== seat) return this.reject(client, "not_your_turn");

    const attacker = this.state.units.get(msg.attackerId);
    if (!attacker) return this.reject(client, "unit_not_found");
    if (attacker.owner !== seat) return this.reject(client, "not_your_unit");
    if (attacker.attacked) return this.reject(client, "already_attacked");

    const enemySeat = seat === "p1" ? "p2" : "p1";
    const eq = enemySeat === "p1" ? this.state.p1EmpireQ : this.state.p2EmpireQ;
    const er = enemySeat === "p1" ? this.state.p1EmpireR : this.state.p2EmpireR;

    if (hexDist(attacker.q, attacker.r, eq, er) > 1) return this.reject(client, "out_of_range");

    attacker.attacked = true;

    if (enemySeat === "p1") this.state.p1Hp = Math.max(0, this.state.p1Hp - attacker.atk);
    else                    this.state.p2Hp = Math.max(0, this.state.p2Hp - attacker.atk);

    this.broadcast("empire_attacked", {
      attacker: seat,
      target:   enemySeat,
      damage:   attacker.atk,
      p1Hp:     this.state.p1Hp,
      p2Hp:     this.state.p2Hp,
    });

    this.checkWinCondition();
  }

  private handleEndTurn(client: Client) {
    const seat = this.getSeat(client);
    if (!seat || this.state.phase !== "playing") return;
    if (this.state.activePlayer !== seat) return this.reject(client, "not_your_turn");

    const next: "p1" | "p2" = seat === "p1" ? "p2" : "p1";

    // Reset unit flags for the next player's units
    for (const [, unit] of this.state.units) {
      if (unit.owner === next) {
        unit.moved    = false;
        unit.attacked = false;
      }
    }

    // Refill mana for next player
    if (next === "p1") this.state.p1Mana = MAX_MANA;
    else               this.state.p2Mana = MAX_MANA;

    this.state.activePlayer = next;

    this.broadcast("turn_changed", {
      activePlayer: next,
      p1Mana: this.state.p1Mana,
      p2Mana: this.state.p2Mana,
    });
  }

  // ─── Win condition ─────────────────────────────────────────────────────────

  private checkWinCondition() {
    if (this.state.p1Hp <= 0) this.endGame("p2", "empire_destroyed");
    else if (this.state.p2Hp <= 0) this.endGame("p1", "empire_destroyed");
  }

  private endGame(winner: string, reason: string) {
    this.state.phase  = "gameover";
    this.state.winner = winner;
    this.broadcast("game_over", { winner, reason });
  }
}