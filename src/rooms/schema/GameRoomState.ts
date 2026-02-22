import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { Element, Phase, UnitSize, GameResult } from "../game/constants";

// ============================================================
// TILE
// ============================================================
export class Tile extends Schema {
  @type("string") id: string = "";
  @type("string") tileType: string = "neutral";   // neutral | fire | water
  @type("boolean") revealed: boolean = false;
  @type("string") occupiedBy: string = "";         // unitInstanceId or ""
  @type("string") ownedBy: string = "";            // sessionId of player who placed it
}

// ============================================================
// UNIT INSTANCE (on the board)
// ============================================================
export class UnitInstance extends Schema {
  @type("string") instanceId: string = "";
  @type("string") cardId: string = "";
  @type("string") ownerId: string = "";            // sessionId
  @type("string") tileId: string = "";
  @type("number") currentHp: number = 0;
  @type("boolean") hasDevelopmentRest: boolean = true;
  @type("boolean") hasMovedThisTurn: boolean = false;
  @type("boolean") hasAttackedThisTurn: boolean = false;
  @type("boolean") cannotBeRangedTargeted: boolean = false;
  @type("number") speedBonusThisTurn: number = 0;
  @type("number") defenseBonusThisTurn: number = 0;
  @type("number") meleeBonusThisTurn: number = 0;
}

// ============================================================
// STRUCTURE INSTANCE (on the board)
// ============================================================
export class StructureInstance extends Schema {
  @type("string") instanceId: string = "";
  @type("string") cardId: string = "";
  @type("string") ownerId: string = "";
  @type("string") tileId: string = "";
  @type("number") currentHp: number = 10;
  @type("number") captureProgress: number = 0;     // rounds contested by enemy
}

// ============================================================
// BUILDER INSTANCE
// ============================================================
export class BuilderInstance extends Schema {
  @type("string") instanceId: string = "";
  @type("string") ownerId: string = "";
  @type("string") tileId: string = "";
}

// ============================================================
// EMPIRE
// ============================================================
export class Empire extends Schema {
  @type("string") ownerId: string = "";
  @type("string") tileId: string = "";
  @type("number") currentHp: number = 20;
  @type("boolean") isPlaced: boolean = false;
}

// ============================================================
// ESSENCE POOL
// ============================================================
export class EssencePool extends Schema {
  @type("number") neutral: number = 0;
  @type("number") fire: number = 0;
  @type("number") water: number = 0;
}

// ============================================================
// PLAYER STATE
// ============================================================
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") displayName: string = "Player";

  // Decks (stored as arrays of card IDs)
  @type(["string"]) unitDeck = new ArraySchema<string>();
  @type(["string"]) blitzDeck = new ArraySchema<string>();
  @type(["string"]) extraDeck = new ArraySchema<string>();
  @type(["string"]) discardPile = new ArraySchema<string>();

  // Hand
  @type(["string"]) hand = new ArraySchema<string>();

  // Essence
  @type(EssencePool) essence = new EssencePool();

  // Empire
  @type(Empire) empire = new Empire();

  // Tile placement tracking
  @type("number") neutralTilesRemaining: number = 20;
  @type("number") elementalTilesRemaining: number = 12;
  @type("boolean") tileSetupComplete: boolean = false;
  @type("boolean") empireSet: boolean = false;

  // Ready flag for each sub-phase
  @type("boolean") readyForNextPhase: boolean = false;
}

// ============================================================
// GAME LOG ENTRY
// ============================================================
export class LogEntry extends Schema {
  @type("string") message: string = "";
  @type("number") timestamp: number = 0;
}

// ============================================================
// MAIN ROOM STATE
// ============================================================
export class GameRoomState extends Schema {

  // Players (keyed by sessionId)
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  // Board
  @type({ map: Tile }) tiles = new MapSchema<Tile>();

  // On-board entities
  @type({ map: UnitInstance }) units = new MapSchema<UnitInstance>();
  @type({ map: StructureInstance }) structures = new MapSchema<StructureInstance>();
  @type({ map: BuilderInstance }) builders = new MapSchema<BuilderInstance>();

  // Turn management
  @type("string") currentPhase: string = Phase.SETUP_TILES;
  @type("string") activePlayerId: string = "";      // sessionId of whose turn it is
  @type("number") roundNumber: number = 1;

  // Game result
  @type("string") gameResult: string = GameResult.ONGOING;
  @type("string") winnerId: string = "";

  // Pending reactions (for Instant/Reaction Blitz cards)
  @type("boolean") awaitingReaction: boolean = false;
  @type("string") reactionFromPlayerId: string = "";
  @type("string") pendingBlitzCardId: string = "";

  // Game log
  @type([LogEntry]) log = new ArraySchema<LogEntry>();
}
