import {
  CARD_DEFINITIONS, UnitCardDef, CardType, Element,
  EMPIRE_ESSENCE_PER_TURN, STRUCTURE_ESSENCE_PER_TURN,
  BUILDER_ESSENCE_PER_TURN, KILL_ESSENCE_REWARD,
  SIEGE_UNITS_REQUIRED, STRUCTURE_CAPTURE_ROUNDS_SOLO,
  STRUCTURE_CAPTURE_ROUNDS_GROUP, GameResult
} from "./constants.js";
import {
  GameRoomState, PlayerState, UnitInstance,
  StructureInstance, EssencePool, LogEntry
} from "../rooms/schema/GameRoomState.js";
import { ArraySchema } from "@colyseus/schema";

// ============================================================
// HEX GRID HELPERS
// The board uses offset coordinates. Each tile has an id like "r3c5"
// ============================================================

export function tileIdToCoords(tileId: string): { row: number; col: number } {
  const parts = tileId.replace("r", "").split("c");
  return { row: parseInt(parts[0]), col: parseInt(parts[1]) };
}

export function coordsToTileId(row: number, col: number): string {
  return `r${row}c${col}`;
}

/**
 * Returns all tile IDs within `range` steps of `tileId` on the hex grid.
 * Uses offset hex adjacency.
 */
export function getHexNeighbors(tileId: string, range: number = 1): string[] {
  const { row, col } = tileIdToCoords(tileId);
  const results = new Set<string>();

  // BFS outward by range
  const queue: Array<{ row: number; col: number; dist: number }> = [{ row, col, dist: 0 }];
  const visited = new Set<string>([tileId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.dist >= range) continue;

    const neighbors = getAdjacentCoords(current.row, current.col);
    for (const n of neighbors) {
      const nId = coordsToTileId(n.row, n.col);
      if (!visited.has(nId)) {
        visited.add(nId);
        results.add(nId);
        queue.push({ row: n.row, col: n.col, dist: current.dist + 1 });
      }
    }
  }

  return Array.from(results);
}

/**
 * Offset hex grid adjacency (pointy-top, odd-row shift).
 */
function getAdjacentCoords(row: number, col: number): Array<{ row: number; col: number }> {
  const isOddRow = row % 2 !== 0;
  return isOddRow
    ? [
        { row: row - 1, col: col },
        { row: row - 1, col: col + 1 },
        { row: row, col: col - 1 },
        { row: row, col: col + 1 },
        { row: row + 1, col: col },
        { row: row + 1, col: col + 1 },
      ]
    : [
        { row: row - 1, col: col - 1 },
        { row: row - 1, col: col },
        { row: row, col: col - 1 },
        { row: row, col: col + 1 },
        { row: row + 1, col: col - 1 },
        { row: row + 1, col: col },
      ];
}

export function hexDistance(tileA: string, tileB: string): number {
  const a = tileIdToCoords(tileA);
  const b = tileIdToCoords(tileB);
  // Convert offset to cube coords for proper hex distance
  const aCube = offsetToCube(a.row, a.col);
  const bCube = offsetToCube(b.row, b.col);
  return Math.max(
    Math.abs(aCube.x - bCube.x),
    Math.abs(aCube.y - bCube.y),
    Math.abs(aCube.z - bCube.z)
  );
}

function offsetToCube(row: number, col: number) {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  const y = -x - z;
  return { x, y, z };
}

// ============================================================
// ESSENCE HELPERS
// ============================================================

export function canAfford(pool: EssencePool, cost: number, element: Element): boolean {
  if (element === Element.NEUTRAL) {
    return (pool.neutral + pool.fire + pool.water) >= cost;
  }
  if (element === Element.FIRE) return pool.fire >= cost;
  if (element === Element.WATER) return pool.water >= cost;
  return false;
}

export function spendEssence(pool: EssencePool, cost: number, element: Element): boolean {
  if (!canAfford(pool, cost, element)) return false;
  if (element === Element.FIRE) { pool.fire -= cost; }
  else if (element === Element.WATER) { pool.water -= cost; }
  else {
    // Spend neutral first, then fire, then water
    let remaining = cost;
    const fromNeutral = Math.min(pool.neutral, remaining);
    pool.neutral -= fromNeutral;
    remaining -= fromNeutral;
    const fromFire = Math.min(pool.fire, remaining);
    pool.fire -= fromFire;
    remaining -= fromFire;
    pool.water -= remaining;
  }
  return true;
}

export function addEssence(pool: EssencePool, amount: number, element: Element): void {
  if (element === Element.FIRE) pool.fire += amount;
  else if (element === Element.WATER) pool.water += amount;
  else pool.neutral += amount;
}

/**
 * Recalculate a player's essence at the start of their Standby phase.
 * Resets to zero then adds from all sources.
 */
export function recalculateEssence(state: GameRoomState, playerId: string): void {
  const player = state.players.get(playerId);
  if (!player) return;

  // Reset
  player.essence.neutral = 0;
  player.essence.fire = 0;
  player.essence.water = 0;

  // Empire base income
  if (player.empire.isPlaced) {
    const empireTile = state.tiles.get(player.empire.tileId);
    const empireElement = tileTypeToElement(empireTile?.tileType ?? "neutral");
    addEssence(player.essence, EMPIRE_ESSENCE_PER_TURN, empireElement);
  }

  // Structures
  state.structures.forEach((structure: StructureInstance) => {
    if (structure.ownerId !== playerId) return;
    const tile = state.tiles.get(structure.tileId);
    const element = tileTypeToElement(tile?.tileType ?? "neutral");
    addEssence(player.essence, STRUCTURE_ESSENCE_PER_TURN, element);
  });

  // Builders
  state.builders.forEach((builder: BuilderInstance) => {
    if (builder.ownerId !== playerId) return;
    const tile = state.tiles.get(builder.tileId);
    const element = tileTypeToElement(tile?.tileType ?? "neutral");
    addEssence(player.essence, BUILDER_ESSENCE_PER_TURN, element);
  });
}

export function tileTypeToElement(tileType: string): Element {
  if (tileType === "fire") return Element.FIRE;
  if (tileType === "water") return Element.WATER;
  return Element.NEUTRAL;
}

// ============================================================
// COMBAT HELPERS
// ============================================================

/**
 * Rolls a d10 (1-10). Returns the roll value.
 */
export function rollD10(): number {
  return Math.floor(Math.random() * 10) + 1;
}

/**
 * Resolves an attack. Returns an object describing the result.
 * Defense is "must roll ABOVE defense value" (e.g. defense 5 = need 6+).
 */
export function resolveAttack(
  attacker: UnitInstance,
  target: UnitInstance | null,
  targetIsStructureOrEmpire: boolean,
  attackType: "melee" | "ranged"
): { hit: boolean; roll: number; damage: number } {
  const attackerCard = CARD_DEFINITIONS[attacker.cardId] as UnitCardDef;
  if (!attackerCard) return { hit: false, roll: 0, damage: 0 };

  // Structures and Empires have no defense — always hit
  if (targetIsStructureOrEmpire) {
    const damage = attackType === "melee"
      ? attackerCard.meleeAttack + attacker.meleeBonusThisTurn
      : attackerCard.rangedAttack;
    return { hit: true, roll: 10, damage };
  }

  if (!target) return { hit: false, roll: 0, damage: 0 };

  const targetCard = CARD_DEFINITIONS[target.cardId] as UnitCardDef;
  const effectiveDefense = targetCard.defense + target.defenseBonusThisTurn;

  const roll = rollD10();
  const hit = roll > effectiveDefense;

  const damage = hit
    ? (attackType === "melee"
        ? attackerCard.meleeAttack + attacker.meleeBonusThisTurn
        : attackerCard.rangedAttack)
    : 0;

  return { hit, roll, damage };
}

// ============================================================
// WIN CONDITION CHECKS
// ============================================================

export function checkWinConditions(state: GameRoomState): GameResult {
  const playerIds = Array.from(state.players.keys());

  for (const playerId of playerIds) {
    const player = state.players.get(playerId)!;

    // Empire destroyed
    if (player.empire.isPlaced && player.empire.currentHp <= 0) {
      const winner = playerIds.find(id => id !== playerId)!;
      state.winnerId = winner;
      return GameResult.PLAYER1_WINS; // caller should determine which player
    }

    // Siege check: 5 enemy units as close as possible to this player's empire
    if (player.empire.isPlaced) {
      const siegeResult = checkSiege(state, playerId);
      if (siegeResult) {
        const winner = playerIds.find(id => id !== playerId)!;
        state.winnerId = winner;
        return GameResult.PLAYER1_WINS;
      }
    }
  }

  return GameResult.ONGOING;
}

function checkSiege(state: GameRoomState, defenderId: string): boolean {
  const defender = state.players.get(defenderId);
  if (!defender || !defender.empire.isPlaced) return false;

  const empireNeighbors = getHexNeighbors(defender.empire.tileId, 1);
  let enemyUnitsNearby = 0;

  state.units.forEach((unit: UnitInstance) => {
    if (unit.ownerId === defenderId) return;
    if (empireNeighbors.includes(unit.tileId) || unit.tileId === defender.empire.tileId) {
      enemyUnitsNearby++;
    }
  });

  return enemyUnitsNearby >= SIEGE_UNITS_REQUIRED;
}

// ============================================================
// VALID MOVEMENT TILES
// ============================================================

export function getValidMoveTiles(
  state: GameRoomState,
  unit: UnitInstance
): string[] {
  const card = CARD_DEFINITIONS[unit.cardId] as UnitCardDef;
  if (!card) return [];

  const totalSpeed = card.speed + unit.speedBonusThisTurn;
  const reachableTiles = getHexNeighbors(unit.tileId, totalSpeed);

  return reachableTiles.filter(tileId => {
    const tile = state.tiles.get(tileId);
    if (!tile) return false;

    // Can't stop on an occupied tile (except Tiny units can share)
    const occupant = tile.occupiedBy;
    if (occupant && occupant !== unit.instanceId) {
      // Check if occupant is an ally structure (allowed) or enemy/ally unit (not allowed)
      const occupantUnit = state.units.get(occupant);
      if (occupantUnit) {
        if (card.size === "tiny") return true; // Tiny can share
        return false;
      }
      const occupantStructure = state.structures.get(occupant);
      if (occupantStructure && occupantStructure.ownerId !== unit.ownerId) return false;
    }

    return true;
  });
}

// ============================================================
// VALID ATTACK TARGETS
// ============================================================

export function getValidMeleeTargets(
  state: GameRoomState,
  unit: UnitInstance
): string[] {
  const adjacent = getHexNeighbors(unit.tileId, 1);
  const targets: string[] = [];

  adjacent.forEach(tileId => {
    // Enemy units
    state.units.forEach((u: UnitInstance, uid: string) => {
      if (u.ownerId !== unit.ownerId && u.tileId === tileId) targets.push(uid);
    });
    // Enemy structures
    state.structures.forEach((s: StructureInstance, sid: string) => {
      if (s.ownerId !== unit.ownerId && s.tileId === tileId) targets.push(sid);
    });
    // Enemy empire
    state.players.forEach((p: PlayerState, pid: string) => {
      if (pid !== unit.ownerId && p.empire.isPlaced && p.empire.tileId === tileId) {
        targets.push(`empire:${pid}`);
      }
    });
  });

  return targets;
}

export function getValidRangedTargets(
  state: GameRoomState,
  unit: UnitInstance
): string[] {
  const card = CARD_DEFINITIONS[unit.cardId] as UnitCardDef;
  if (!card || card.rangedRange === 0) return [];

  const inRange = getHexNeighbors(unit.tileId, card.rangedRange);
  const targets: string[] = [];

  inRange.forEach(tileId => {
    state.units.forEach((u: UnitInstance, uid: string) => {
      if (u.ownerId !== unit.ownerId && u.tileId === tileId) {
        if (!u.cannotBeRangedTargeted) targets.push(uid);
      }
    });
    state.structures.forEach((s: StructureInstance, sid: string) => {
      if (s.ownerId !== unit.ownerId && s.tileId === tileId) targets.push(sid);
    });
    state.players.forEach((p: PlayerState, pid: string) => {
      if (pid !== unit.ownerId && p.empire.isPlaced && p.empire.tileId === tileId) {
        targets.push(`empire:${pid}`);
      }
    });
  });

  return targets;
}

// ============================================================
// LOGGING
// ============================================================

export function addLog(state: GameRoomState, message: string): void {
  const entry = new LogEntry();
  entry.message = message;
  entry.timestamp = Date.now();
  state.log.push(entry);
  // Keep log to last 100 entries
  while (state.log.length > 100) state.log.splice(0, 1);
}

// ============================================================
// DECK HELPERS
// ============================================================

export function shuffleDeck(deck: ArraySchema<string>): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
}

export function drawCard(
  deck: ArraySchema<string>,
  hand: ArraySchema<string>
): string | null {
  if (deck.length === 0) return null;
  const card = deck[0];
  deck.splice(0, 1);
  hand.push(card);
  return card;
}
