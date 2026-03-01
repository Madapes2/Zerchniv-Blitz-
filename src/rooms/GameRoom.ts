import { Room, Client } from "colyseus";
import {
  GameRoomState, PlayerState, UnitInstance, StructureInstance,
  BuilderInstance, Tile, Empire
} from "./schema/GameRoomState.js";
import {
  Phase, GameResult, Element, CardType,
  CARD_DEFINITIONS, UnitCardDef, BlitzCardDef, StructureCardDef,
  STRUCTURE_MAX_HP, EMPIRE_MAX_HP, NEUTRAL_TILES_PER_PLAYER,
  ELEMENTAL_TILES_PER_PLAYER, FIRST_PLAYER_NO_DEV_REST_ROUNDS
} from "../game/constants.js";
import {
  recalculateEssence, canAfford, spendEssence, addEssence,
  resolveAttack, checkWinConditions, getValidMoveTiles,
  getValidMeleeTargets, getValidRangedTargets, addLog,
  shuffleDeck, drawCard, hexDistance, tileTypeToElement, rollD10
} from "../game/GameLogic.js";

// ============================================================
// MESSAGE TYPES (client → server)
// network.js sends these exact type strings — keep in sync.
// ============================================================
type Msg =
  // Setup
  | { type: "place_tile";          tileId: string; tileType: string }
  | { type: "end_tile_placement" }
  | { type: "place_empire";        tileId: string }
  // Draw — network.js uses "deckType", GameLogic used "deck"; accept both
  | { type: "draw_card";           deck?: "unit" | "blitz"; deckType?: "unit" | "blitz" }
  // Move / combat
  | { type: "move_unit";           unitId: string; toTile?: string; targetTileId?: string }
  | { type: "melee_attack";        attackerUnitId: string; targetId: string }
  | { type: "ranged_attack";       attackerUnitId: string; targetId: string }
  | { type: "declare_attack";      unitId: string; targetTile: string; mode: "melee" | "ranged" }
  // Cards — network.js uses "deploy_unit"; accept both names
  | { type: "play_unit";           cardId: string; spawnTileId?: string; tileIdx?: number }
  | { type: "deploy_unit";         cardId: string; tileIdx?: number; spawnTileId?: string }
  | { type: "play_blitz";          cardId: string; targetId?: string; targetTile?: number }
  | { type: "play_structure";      cardId: string; tileId?: string; tileIdx?: number }
  | { type: "deploy_structure";    cardId: string; tileId?: string; tileIdx?: number }
  // Misc
  | { type: "place_builder";       tileId: string }
  | { type: "use_terraform";       unitId: string }
  | { type: "end_turn" }
  | { type: "react_blitz";         cardId: string }
  | { type: "play_reaction";       cardId: string; stormId?: string; reactingToId?: string }
  | { type: "pass_reaction" }
  | { type: "request_valid_moves"; unitId: string }
  | { type: "request_moves";       unitId: string }
  | { type: "request_valid_targets"; unitId: string; attackType: "melee" | "ranged" }
  | { type: "request_targets";     unitId: string; mode: "melee" | "ranged" }
  | { type: "send_chat";           text: string }
  | { type: "ability_use";         unitId: string; abilityIndex: number; targetId?: string; targetTile?: number; essenceCost: any }
  | { type: "concede" };

export class GameRoom extends Room<GameRoomState> {

  private instanceCounter = 0;
  // Map sessionId → seat label ("p1" | "p2")
  private seatMap = new Map<string, "p1" | "p2">();

  get gs(): GameRoomState {
    return this.state as GameRoomState;
  }

  onCreate(options: any) {
    this.setState(new GameRoomState());
    this.maxClients = 2;

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, { type, ...message } as Msg);
    });

    addLog(this.gs, "Room created. Waiting for players…");
  }

  onJoin(client: Client, options: any) {
    try {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.displayName = options?.displayName ?? `Player ${this.gs.players.size + 1}`;

    // Assign seat labels in join order
    const seat: "p1" | "p2" = this.seatMap.size === 0 ? "p1" : "p2";
    this.seatMap.set(client.sessionId, seat);
    (player as any).seat = seat;

    // Load decks from options
    if (options?.unitDeck)  options.unitDeck.forEach((id: string)  => player.unitDeck.push(id));
    if (options?.blitzDeck) options.blitzDeck.forEach((id: string) => player.blitzDeck.push(id));
    if (options?.extraDeck) options.extraDeck.forEach((id: string) => player.extraDeck.push(id));

    shuffleDeck(player.unitDeck);
    shuffleDeck(player.blitzDeck);

    // Set tile budgets (19 neutral, 10 elemental per player for 58-tile board)
    // 19 neutral + 10 elemental (5 fire + 5 water) per player for 58-tile board
    player.neutralTilesRemaining   = (typeof NEUTRAL_TILES_PER_PLAYER   !== 'undefined') ? NEUTRAL_TILES_PER_PLAYER   : 19;
    player.elementalTilesRemaining = (typeof ELEMENTAL_TILES_PER_PLAYER  !== 'undefined') ? ELEMENTAL_TILES_PER_PLAYER  : 10;

    this.gs.players.set(client.sessionId, player);
    addLog(this.gs, `${player.displayName} joined as ${seat}.`);

    if (this.clients.length === 2) {
      this.startGame();
    }
    } catch(e) { console.error('[GameRoom] onJoin error:', e); }
  }

  onLeave(client: Client) {
    const p = this.gs.players.get(client.sessionId);
    const seat = this.seatMap.get(client.sessionId) ?? "?";
    addLog(this.gs, `${p?.displayName ?? client.sessionId} (${seat}) disconnected.`);
    this.gs.players.delete(client.sessionId);

    // Notify remaining client
    this.broadcast("player_left", { seat });
  }

  // ============================================================
  // SEAT HELPERS
  // ============================================================

  private getSeat(sessionId: string): "p1" | "p2" {
    return this.seatMap.get(sessionId) ?? "p1";
  }

  private getSessionBySeat(seat: "p1" | "p2"): string {
    for (const [sid, s] of this.seatMap) { if (s === seat) return sid; }
    return "";
  }

  private getActiveSeat(): "p1" | "p2" {
    return this.getSeat(this.gs.activePlayerId);
  }

  private getOtherSeat(seat: "p1" | "p2"): "p1" | "p2" {
    return seat === "p1" ? "p2" : "p1";
  }

  // ============================================================
  // BROADCAST HELPERS — keep network.js contract
  // ============================================================

  /** Broadcast phase_change to all clients using seat labels, not sessionIds. */
  private broadcastPhaseChange() {
    const activeSeat = this.getActiveSeat();
    const phaseStr   = this.phaseToString(this.gs.currentPhase);
    this.broadcast("phase_change", {
      phase:        phaseStr,
      turn:         this.gs.roundNumber,
      activePlayer: activeSeat,    // "p1" or "p2" — what network.js expects
    });
  }

  /** Send a full state_update snapshot to both clients. */
  private broadcastStateUpdate() {
    const activeSeat = this.getActiveSeat();
    this.clients.forEach(client => {
      const mySeat  = this.getSeat(client.sessionId);
      const myId    = client.sessionId;
      const oppId   = this.getSessionBySeat(this.getOtherSeat(mySeat));
      const me      = this.gs.players.get(myId);
      const opp     = this.gs.players.get(oppId);

      client.send("state_update", {
        state: {
          phase:        this.phaseToString(this.gs.currentPhase),
          turn:         this.gs.roundNumber,
          activePlayer: activeSeat,
          players: {
            [mySeat]: me ? this.serializePlayerForSelf(me) : null,
            [this.getOtherSeat(mySeat)]: opp ? this.serializePlayerForOpponent(opp) : null,
          },
          units:      this.serializeUnits(mySeat),
          tiles:      this.serializeTiles(),
          empires:    this.serializeEmpires(),
        }
      });
    });
  }

  private phaseToString(phase: any): string {
    // Map Phase enum values to strings network.js understands
    const map: Record<string, string> = {
      [Phase.SETUP_TILES]:  "setup_tiles",
      [Phase.SETUP_EMPIRE]: "setup_empire",
      [Phase.STANDBY]:      "standby",
      [Phase.DRAW]:         "draw",
      [Phase.MAIN]:         "main",
      [Phase.END]:          "end",
    };
    return map[String(phase)] ?? String(phase).toLowerCase();
  }

  private serializePlayerForSelf(p: PlayerState) {
    return {
      username:        p.displayName,
      hp:              p.empire?.currentHp ?? 20,
      essence:         { n: p.essence?.neutral ?? 0, f: p.essence?.fire ?? 0, w: p.essence?.water ?? 0 },
      hand:            Array.from(p.hand),
      unitDeckCount:   p.unitDeck.length,
      blitzDeckCount:  p.blitzDeck.length,
      discardCount:    p.discardPile.length,
      neutralTilesRemaining:   p.neutralTilesRemaining,
      elementalTilesRemaining: p.elementalTilesRemaining,
      tileSetupComplete: p.tileSetupComplete,
      empireSet:       p.empireSet,
    };
  }

  private serializePlayerForOpponent(p: PlayerState) {
    return {
      username:       p.displayName,
      hp:             p.empire?.currentHp ?? 20,
      unitDeckCount:  p.unitDeck.length,
      blitzDeckCount: p.blitzDeck.length,
      discardCount:   p.discardPile.length,
      tileSetupComplete: p.tileSetupComplete,
      empireSet:      p.empireSet,
      // hand intentionally omitted — private information
    };
  }

  private serializeUnits(viewerSeat: "p1" | "p2") {
    const units: any[] = [];
    this.gs.units.forEach((u: UnitInstance) => {
      const ownerSeat = this.getSeat(u.ownerId);
      units.push({
        instanceId:         u.instanceId,
        cardId:             u.cardId,
        owner:              ownerSeat,
        tileId:             u.tileId,
        currentHp:          u.currentHp,
        hasMovedThisTurn:   u.hasMovedThisTurn,
        hasAttackedThisTurn: u.hasAttackedThisTurn,
        hasDevelopmentRest: u.hasDevelopmentRest,
      });
    });
    return units;
  }

  private serializeTiles() {
    const tiles: Record<string, any> = {};
    this.gs.tiles.forEach((t: Tile, id: string) => {
      tiles[id] = { tileType: t.tileType, revealed: t.revealed, occupiedBy: t.occupiedBy };
    });
    return tiles;
  }

  private serializeEmpires() {
    const empires: Record<string, any> = {};
    this.gs.players.forEach((p: PlayerState, sid: string) => {
      const seat = this.getSeat(sid);
      empires[seat] = { tileId: p.empire?.tileId, hp: p.empire?.currentHp ?? 20 };
    });
    return empires;
  }

  // ============================================================
  // GAME START
  // ============================================================

  private startGame() {
    const playerIds = Array.from(this.gs.players.keys());
    const flip = Math.random() < 0.5;
    this.gs.activePlayerId = flip ? playerIds[0] : playerIds[1];
    this.gs.currentPhase   = Phase.SETUP_TILES;
    this.gs.roundNumber    = 1;

    addLog(this.gs, `Game started! ${this.getPlayerName(this.gs.activePlayerId)} places tiles first.`);

    // Send game_start to each client with their seat label
    this.clients.forEach(client => {
      const seat = this.getSeat(client.sessionId);
      client.send("game_start", {
        yourSeat: seat,
        state: {
          phase:        "setup_tiles",
          turn:         1,
          activePlayer: this.getActiveSeat(),
          players: {
            [seat]: this.serializePlayerForSelf(this.gs.players.get(client.sessionId)!),
            [this.getOtherSeat(seat)]: null,
          },
          units:  [],
          tiles:  {},
          empires: {},
        }
      });
    });
  }

  // ============================================================
  // MESSAGE ROUTER
  // ============================================================

  private handleMessage(client: Client, msg: Msg) {
    try {
    const playerId = client.sessionId;
    const player   = this.gs.players.get(playerId);
    if (!player) return;

    // Reaction window
    if (this.gs.awaitingReaction) {
      if ((msg.type === "react_blitz" || msg.type === "play_reaction") && playerId === this.gs.reactionFromPlayerId) {
        this.handleReactBlitz(client, (msg as any).cardId);
      } else if (msg.type === "pass_reaction" && playerId === this.gs.reactionFromPlayerId) {
        this.resolveReactionWindow();
      }
      return;
    }

    // Info requests — always allowed
    if (msg.type === "request_valid_moves" || msg.type === "request_moves") {
      this.sendValidMoves(client, (msg as any).unitId);
      return;
    }
    if (msg.type === "request_valid_targets" || msg.type === "request_targets") {
      this.sendValidTargets(client, (msg as any).unitId, (msg as any).attackType ?? (msg as any).mode);
      return;
    }
    if (msg.type === "send_chat") {
      this.broadcast("chat_message", { sender: player.displayName, text: (msg as any).text });
      return;
    }
    if (msg.type === "concede") {
      this.handleConcede(client);
      return;
    }

    switch (this.gs.currentPhase) {

      case Phase.SETUP_TILES:
        if (playerId !== this.gs.activePlayerId) {
          client.send("error", { code: "NOT_YOUR_TURN", message: "It's not your turn to place tiles." });
          return;
        }
        if (msg.type === "place_tile")       this.handlePlaceTile(client, (msg as any).tileId, (msg as any).tileType);
        if (msg.type === "end_tile_placement") this.handleEndTilePlacement(client);
        break;

      case Phase.SETUP_EMPIRE:
        if (msg.type === "place_empire") this.handlePlaceEmpire(client, (msg as any).tileId);
        break;

      case Phase.STANDBY:
        // Server-driven — no client actions during standby
        break;

      case Phase.DRAW:
        if (playerId !== this.gs.activePlayerId) {
          client.send("error", { code: "NOT_YOUR_TURN", message: "It's not your turn." });
          return;
        }
        if (msg.type === "draw_card") this.handleDrawCard(client, (msg as any).deck ?? (msg as any).deckType);
        break;

      case Phase.MAIN:
        if (playerId !== this.gs.activePlayerId) {
          client.send("error", { code: "NOT_YOUR_TURN", message: "It's not your turn." });
          return;
        }
        if (msg.type === "move_unit")
          this.handleMoveUnit(client, (msg as any).unitId, (msg as any).toTile ?? (msg as any).targetTileId);
        if (msg.type === "melee_attack")
          this.handleMeleeAttack(client, (msg as any).attackerUnitId, (msg as any).targetId);
        if (msg.type === "ranged_attack")
          this.handleRangedAttack(client, (msg as any).attackerUnitId, (msg as any).targetId);
        if (msg.type === "declare_attack")
          this.handleDeclareAttack(client, (msg as any).unitId, (msg as any).targetTile, (msg as any).mode);
        if (msg.type === "play_unit" || msg.type === "deploy_unit")
          this.handlePlayUnit(client, (msg as any).cardId, (msg as any).spawnTileId ?? String((msg as any).tileIdx ?? ""));
        if (msg.type === "play_blitz")
          this.handlePlayBlitz(client, (msg as any).cardId, (msg as any).targetId);
        if (msg.type === "play_structure" || msg.type === "deploy_structure")
          this.handlePlayStructure(client, (msg as any).cardId, (msg as any).tileId ?? String((msg as any).tileIdx ?? ""));
        if (msg.type === "place_builder")
          this.handlePlaceBuilder(client, (msg as any).tileId);
        if (msg.type === "use_terraform")
          this.handleTerraform(client, (msg as any).unitId);
        if (msg.type === "end_turn")
          this.handleEndTurn(client);
        break;

      case Phase.END:
        // End phase is server-driven
        break;
    }
    } catch(e) { console.error('[GameRoom] handleMessage error:', e); client.send('error', { code: 'SERVER_ERROR', message: String(e) }); }
  }

  // ============================================================
  // SETUP: TILE PLACEMENT
  // ============================================================

  private handlePlaceTile(client: Client, tileId: string, tileType: string) {
    const player = this.gs.players.get(client.sessionId)!;

    if (this.gs.tiles.has(tileId)) {
      client.send("error", { code: "TILE_EXISTS", message: "Tile already placed." });
      return;
    }

    if (tileType === "neutral" && player.neutralTilesRemaining <= 0) {
      client.send("error", { code: "NO_TILES", message: "No neutral tiles remaining." });
      return;
    }
    if ((tileType === "fire" || tileType === "water") && player.elementalTilesRemaining <= 0) {
      client.send("error", { code: "NO_TILES", message: "No elemental tiles remaining." });
      return;
    }

    const tile = new Tile();
    tile.id       = tileId;
    tile.tileType = tileType;
    tile.revealed = true;     // All placed tiles are visible for prototype
    tile.ownedBy  = client.sessionId;
    this.gs.tiles.set(tileId, tile);

    if (tileType === "neutral") player.neutralTilesRemaining--;
    else                        player.elementalTilesRemaining--;

    addLog(this.gs, `${player.displayName} placed ${tileType} tile at ${tileId}.`);

    // Broadcast to both clients so both boards update
    this.broadcast("tile_placed", {
      tileId,
      tileType,
      byPlayer: this.getSeat(client.sessionId),
      neutralRemaining:   player.neutralTilesRemaining,
      elementalRemaining: player.elementalTilesRemaining,
    });
  }

  private handleEndTilePlacement(client: Client) {
    const player = this.gs.players.get(client.sessionId)!;
    player.tileSetupComplete = true;
    addLog(this.gs, `${player.displayName} finished placing tiles.`);

    const otherPlayerId = this.getOtherPlayerId(client.sessionId);
    const otherPlayer   = this.gs.players.get(otherPlayerId);

    if (!otherPlayer?.tileSetupComplete) {
      // Pass tile placement turn to other player
      this.gs.activePlayerId = otherPlayerId;
      addLog(this.gs, `${this.getPlayerName(otherPlayerId)} now places their tiles.`);
      this.broadcastPhaseChange();
      this.broadcastStateUpdate();
    } else {
      // Both done — move to empire placement
      this.gs.currentPhase = Phase.SETUP_EMPIRE;
      addLog(this.gs, "Both players placed tiles. Now place your Empires.");
      this.broadcastPhaseChange();
      this.broadcastStateUpdate();
    }
  }

  // ============================================================
  // SETUP: EMPIRE PLACEMENT
  // ============================================================

  private handlePlaceEmpire(client: Client, tileId: string) {
    const player = this.gs.players.get(client.sessionId)!;
    if (player.empireSet) return;

    const tile = this.gs.tiles.get(tileId);
    if (!tile) {
      client.send("error", { code: "NO_TILE", message: "Tile does not exist — place it first." });
      return;
    }

    player.empire.ownerId   = client.sessionId;
    player.empire.tileId    = tileId;
    player.empire.currentHp = (typeof EMPIRE_MAX_HP !== 'undefined') ? EMPIRE_MAX_HP : 20;
    player.empire.isPlaced  = true;
    player.empireSet        = true;

    tile.revealed  = true;
    tile.occupiedBy = `empire:${client.sessionId}`;

    addLog(this.gs, `${player.displayName} placed Empire at ${tileId}.`);

    const allPlaced = (Array.from(this.gs.players.values()) as PlayerState[]).every(p => p.empireSet);
    if (allPlaced) {
      this.startStandbyPhase();
    } else {
      this.broadcastStateUpdate();
    }
  }

  // ============================================================
  // STANDBY PHASE — server-driven, no client action needed
  // ============================================================

  private startStandbyPhase() {
    this.gs.currentPhase = Phase.STANDBY;
    const playerId = this.gs.activePlayerId;
    const player   = this.gs.players.get(playerId)!;

    recalculateEssence(this.gs, playerId);

    // Reset unit flags
    this.gs.units.forEach((unit: UnitInstance) => {
      if (unit.ownerId === playerId) {
        unit.hasMovedThisTurn    = false;
        unit.hasAttackedThisTurn = false;
        unit.speedBonusThisTurn  = 0;
        unit.defenseBonusThisTurn = 0;
        unit.meleeBonusThisTurn  = 0;
        unit.cannotBeRangedTargeted = false;
        if (unit.hasDevelopmentRest) unit.hasDevelopmentRest = false;
      }
    });

    addLog(this.gs, `${player.displayName}'s Standby. Essence: N${player.essence?.neutral ?? 0} F${player.essence?.fire ?? 0} W${player.essence?.water ?? 0}`);

    // Broadcast standby then immediately advance to draw
    this.broadcastPhaseChange();
    this.broadcastStateUpdate();

    // Auto-advance to draw after 1.5s
    this.clock.setTimeout(() => {
      this.gs.currentPhase = Phase.DRAW;
      addLog(this.gs, `${player.displayName}'s Draw Phase.`);
      this.broadcastPhaseChange();
      this.broadcastStateUpdate();
    }, 1500);
  }

  // ============================================================
  // DRAW PHASE
  // ============================================================

  private handleDrawCard(client: Client, deck: "unit" | "blitz") {
    const player = this.gs.players.get(client.sessionId)!;

    let drawn: string | null = null;
    let remaining = 0;

    if (deck === "unit") {
      drawn = drawCard(player.unitDeck, player.hand);
      remaining = player.unitDeck.length;
    } else {
      drawn = drawCard(player.blitzDeck, player.hand);
      remaining = player.blitzDeck.length;
    }

    if (!drawn) {
      client.send("error", { code: "DECK_EMPTY", message: `${deck} deck is empty.` });
      return;
    }

    addLog(this.gs, `${player.displayName} drew from ${deck} deck.`);

    // Send draw_result privately to the drawing player
    const cardDef = CARD_DEFINITIONS[drawn];
    client.send("draw_result", {
      card:     { id: drawn, ...(cardDef ?? { name: drawn, type: "unit" }) },
      deckType: deck,
      remaining,
    });

    // Advance to main phase
    this.gs.currentPhase = Phase.MAIN;
    addLog(this.gs, `${player.displayName}'s Main Phase.`);
    this.broadcastPhaseChange();
    this.broadcastStateUpdate();
  }

  // ============================================================
  // MAIN PHASE: MOVE
  // ============================================================

  private handleMoveUnit(client: Client, unitId: string, targetTileId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    if (unit.hasDevelopmentRest) { client.send("error", { code: "DEV_REST", message: "Unit is in Development Rest." }); return; }
    if (unit.hasAttackedThisTurn) { client.send("error", { code: "ALREADY_ACTED", message: "Unit already attacked this turn." }); return; }

    const validTiles = getValidMoveTiles(this.gs, unit);
    if (!validTiles.includes(targetTileId)) {
      client.send("error", { code: "INVALID_MOVE", message: "Invalid move target." });
      return;
    }

    const oldTile = this.gs.tiles.get(unit.tileId);
    if (oldTile && oldTile.occupiedBy === unitId) oldTile.occupiedBy = "";

    unit.tileId           = targetTileId;
    unit.hasMovedThisTurn = true;

    const newTile = this.gs.tiles.get(targetTileId);
    if (newTile) { newTile.occupiedBy = unitId; newTile.revealed = true; }

    addLog(this.gs, `${this.getPlayerName(client.sessionId)} moved unit to ${targetTileId}.`);
    this.checkStructureCapture(unitId);
    this.broadcastStateUpdate();
  }

  // ============================================================
  // MAIN PHASE: ATTACKS
  // ============================================================

  private handleMeleeAttack(client: Client, attackerUnitId: string, targetId: string) {
    const attacker = this.gs.units.get(attackerUnitId);
    if (!attacker || attacker.ownerId !== client.sessionId) return;
    if (attacker.hasDevelopmentRest || attacker.hasAttackedThisTurn) return;

    if (!getValidMeleeTargets(this.gs, attacker).includes(targetId)) {
      client.send("error", { code: "INVALID_TARGET", message: "No valid melee target." });
      return;
    }

    attacker.hasAttackedThisTurn = true;
    this.resolveAttackOnTarget(attacker, targetId, "melee", client.sessionId);
    this.broadcastStateUpdate();
  }

  private handleRangedAttack(client: Client, attackerUnitId: string, targetId: string) {
    const attacker = this.gs.units.get(attackerUnitId);
    if (!attacker || attacker.ownerId !== client.sessionId) return;
    if (attacker.hasDevelopmentRest || attacker.hasAttackedThisTurn) return;

    if (!getValidRangedTargets(this.gs, attacker).includes(targetId)) {
      client.send("error", { code: "INVALID_TARGET", message: "No valid ranged target." });
      return;
    }

    attacker.hasAttackedThisTurn = true;
    this.resolveAttackOnTarget(attacker, targetId, "ranged", client.sessionId);
    this.broadcastStateUpdate();
  }

  // network.js sends "declare_attack" — route to correct handler
  private handleDeclareAttack(client: Client, unitId: string, targetTile: string, mode: "melee" | "ranged") {
    if (mode === "melee") this.handleMeleeAttack(client, unitId, targetTile);
    else                  this.handleRangedAttack(client, unitId, targetTile);
  }

  private resolveAttackOnTarget(attacker: UnitInstance, targetId: string, attackType: "melee" | "ranged", attackerPlayerId: string) {
    const isEmpireTarget  = targetId.startsWith("empire:");
    const targetUnit      = this.gs.units.get(targetId);
    const targetStructure = this.gs.structures.get(targetId);
    const isStructureOrEmpire = isEmpireTarget || !!targetStructure;

    const result = resolveAttack(attacker, targetUnit ?? null, isStructureOrEmpire, attackType);

    const combatPayload: any = {
      attackerId: attacker.instanceId,
      targetId,
      roll:   result.roll,
      def:    result.def ?? 0,
      hit:    result.hit,
      damage: result.damage,
      died:   false,
      isEmpireTarget,
    };

    if (isEmpireTarget) {
      const empireOwnerId = targetId.replace("empire:", "");
      const empireOwner   = this.gs.players.get(empireOwnerId);
      if (empireOwner) {
        empireOwner.empire.currentHp -= result.damage;
        addLog(this.gs, `Attack on Empire! Roll: ${result.roll}. Damage: ${result.damage}. Empire HP: ${empireOwner.empire.currentHp}`);
      }
    } else if (targetStructure) {
      targetStructure.currentHp -= result.damage;
      if (targetStructure.currentHp <= 0) this.destroyStructure(targetStructure.instanceId);
    } else if (targetUnit) {
      if (result.hit) {
        targetUnit.currentHp -= result.damage;
        if (targetUnit.currentHp <= 0) {
          combatPayload.died = true;
          combatPayload.essenceGained = 1;
          this.killUnit(targetUnit.instanceId, attackerPlayerId);
        }
      }
    }

    this.broadcast("combat_result", combatPayload);
    this.checkAndApplyWinCondition();
  }

  // ============================================================
  // MAIN PHASE: PLAY UNIT
  // ============================================================

  private handlePlayUnit(client: Client, cardId: string, spawnTileId: string) {
    const player  = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as UnitCardDef;
    if (!cardDef || cardDef.type !== CardType.UNIT) return;

    const handIdx = player.hand.indexOf(cardId);
    if (handIdx === -1) { client.send("error", { code: "NOT_IN_HAND", message: "Card not in hand." }); return; }

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { code: "NO_ESSENCE", message: "Not enough Essence." });
      return;
    }

    if (!this.isValidSpawnTile(client.sessionId, spawnTileId)) {
      client.send("error", { code: "INVALID_SPAWN", message: "Invalid spawn location." });
      return;
    }

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.hand.splice(handIdx, 1);

    const unit = new UnitInstance();
    unit.instanceId        = this.nextId();
    unit.cardId            = cardId;
    unit.ownerId           = client.sessionId;
    unit.tileId            = spawnTileId;
    unit.currentHp         = cardDef.hp;
    const noRestRounds = (typeof FIRST_PLAYER_NO_DEV_REST_ROUNDS !== 'undefined') ? FIRST_PLAYER_NO_DEV_REST_ROUNDS : 2;
    unit.hasDevelopmentRest = this.gs.roundNumber > noRestRounds;

    this.gs.units.set(unit.instanceId, unit);

    const tile = this.gs.tiles.get(spawnTileId);
    if (tile) { tile.occupiedBy = unit.instanceId; tile.revealed = true; }

    addLog(this.gs, `${player.displayName} played ${cardDef.name} at ${spawnTileId}.`);
    this.broadcastStateUpdate();
  }

  // ============================================================
  // MAIN PHASE: PLAY BLITZ
  // ============================================================

  private handlePlayBlitz(client: Client, cardId: string, targetId?: string) {
    const player  = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as BlitzCardDef;
    if (!cardDef || cardDef.type !== CardType.BLITZ) return;

    const handIdx = player.hand.indexOf(cardId);
    if (handIdx === -1) return;

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { code: "NO_ESSENCE", message: "Not enough Essence." });
      return;
    }

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.hand.splice(handIdx, 1);
    player.discardPile.push(cardId);

    addLog(this.gs, `${player.displayName} played Blitz: ${cardDef.name}.`);

    this.broadcast("blitz_played", {
      cardId,
      playedBy: this.getSeat(client.sessionId),
      targetId,
      blitzSpeed: "instant",
    });

    // Open reaction window for opponent
    const otherId = this.getOtherPlayerId(client.sessionId);
    this.gs.pendingBlitzCardId    = cardId;
    this.gs.reactionFromPlayerId  = otherId;
    this.gs.awaitingReaction      = true;

    this.applyBlitzEffect(cardDef, targetId, client.sessionId);
    this.broadcastStateUpdate();
  }

  private handleReactBlitz(client: Client, reactionCardId: string) {
    const player  = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[reactionCardId] as BlitzCardDef;
    if (!cardDef || cardDef.type !== CardType.BLITZ) return;

    const handIdx = player.hand.indexOf(reactionCardId);
    if (handIdx === -1) return;

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) return;

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.hand.splice(handIdx, 1);
    player.discardPile.push(reactionCardId);

    addLog(this.gs, `${player.displayName} reacted with: ${cardDef.name}.`);
    this.applyBlitzEffect(cardDef, undefined, client.sessionId);
    this.resolveReactionWindow();
    this.broadcastStateUpdate();
  }

  private resolveReactionWindow() {
    this.gs.awaitingReaction     = false;
    this.gs.pendingBlitzCardId   = "";
    this.gs.reactionFromPlayerId = "";
  }

  private applyBlitzEffect(cardDef: BlitzCardDef, targetId: string | undefined, casterId: string) {
    switch (cardDef.id) {
      case "B001":
        if (targetId) { const u = this.gs.units.get(targetId); if (u && u.ownerId === casterId) u.defenseBonusThisTurn -= 99; }
        break;
      case "B002":
        if (targetId) { const u = this.gs.units.get(targetId); if (u && u.ownerId === casterId) u.meleeBonusThisTurn += 2; }
        break;
      case "B003":
        if (targetId) { const u = this.gs.units.get(targetId); if (u && u.ownerId === casterId) u.speedBonusThisTurn += 2; }
        break;
      case "B006":
        if (targetId) {
          const u = this.gs.units.get(targetId);
          if (u && u.ownerId === casterId) {
            const baseDef = (CARD_DEFINITIONS[u.cardId] as UnitCardDef)?.defense ?? 0;
            u.defenseBonusThisTurn += baseDef;
          }
        }
        break;
    }
  }

  // ============================================================
  // MAIN PHASE: PLAY STRUCTURE
  // ============================================================

  private handlePlayStructure(client: Client, cardId: string, tileId: string) {
    const player  = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as StructureCardDef;
    if (!cardDef || cardDef.type !== CardType.STRUCTURE) return;

    // Structures come from extraDeck
    const extraIdx = player.extraDeck.indexOf(cardId);
    if (extraIdx === -1) { client.send("error", { code: "NOT_IN_DECK", message: "Structure not in extra deck." }); return; }

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { code: "NO_ESSENCE", message: "Not enough Essence." });
      return;
    }

    const tile = this.gs.tiles.get(tileId);
    if (!tile || tile.occupiedBy) { client.send("error", { code: "TILE_BLOCKED", message: "Tile occupied or missing." }); return; }

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.extraDeck.splice(extraIdx, 1);

    const structure        = new StructureInstance();
    structure.instanceId   = this.nextId();
    structure.cardId       = cardId;
    structure.ownerId      = client.sessionId;
    structure.tileId       = tileId;
    structure.currentHp    = (typeof STRUCTURE_MAX_HP !== 'undefined') ? STRUCTURE_MAX_HP : 10;

    this.gs.structures.set(structure.instanceId, structure);
    tile.occupiedBy = structure.instanceId;
    tile.revealed   = true;

    addLog(this.gs, `${player.displayName} built ${cardDef.name} at ${tileId}.`);
    this.broadcastStateUpdate();
  }

  // ============================================================
  // MAIN PHASE: BUILDER
  // ============================================================

  private handlePlaceBuilder(client: Client, tileId: string) {
    const player = this.gs.players.get(client.sessionId)!;
    const tile   = this.gs.tiles.get(tileId);

    if (!tile)              { client.send("error", { code: "NO_TILE",  message: "Tile not found." }); return; }
    if (tile.tileType === "neutral") { client.send("error", { code: "WRONG_TILE", message: "Builders must be on elemental tiles." }); return; }
    if (tile.occupiedBy)    { client.send("error", { code: "OCCUPIED", message: "Tile is occupied." }); return; }

    const builder         = new BuilderInstance();
    builder.instanceId    = this.nextId();
    builder.ownerId       = client.sessionId;
    builder.tileId        = tileId;

    this.gs.builders.set(builder.instanceId, builder);
    tile.occupiedBy = builder.instanceId;
    tile.revealed   = true;

    addLog(this.gs, `${player.displayName} placed a Builder at ${tileId}.`);
    this.broadcastStateUpdate();
  }

  // ============================================================
  // TERRAFORM
  // ============================================================

  private handleTerraform(client: Client, unitId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    if (unit.cardId !== "U009") { client.send("error", { code: "WRONG_UNIT", message: "Only Large Fish can Terraform." }); return; }
    if ((unit as any)._terraformUsed) { client.send("error", { code: "USED", message: "Terraform already used." }); return; }

    const tile = this.gs.tiles.get(unit.tileId);
    if (!tile || tile.tileType === "neutral") { client.send("error", { code: "WRONG_TILE", message: "Terraform requires elemental tile." }); return; }

    tile.revealed = true;
    (unit as any)._terraformUsed = true;
    tile.tileType = "neutral";

    addLog(this.gs, `Terraform — converted tile at ${unit.tileId} to neutral.`);
    this.broadcastStateUpdate();
  }

  // ============================================================
  // END TURN
  // ============================================================

  private handleEndTurn(client: Client) {
    addLog(this.gs, `${this.getPlayerName(client.sessionId)} ends turn.`);
    this.gs.currentPhase = Phase.END;
    this.broadcastPhaseChange();

    // Advance round counter when p2 ends their turn
    const playerIds = Array.from(this.gs.players.keys());
    if (this.gs.activePlayerId === playerIds[1]) this.gs.roundNumber++;

    // Pass to other player
    this.gs.activePlayerId = this.getOtherPlayerId(client.sessionId);
    addLog(this.gs, `${this.getPlayerName(this.gs.activePlayerId)}'s turn begins.`);

    // Short pause then start next standby
    this.clock.setTimeout(() => this.startStandbyPhase(), 800);
  }

  // ============================================================
  // CONCEDE
  // ============================================================

  private handleConcede(client: Client) {
    const winner = this.getOtherSeat(this.getSeat(client.sessionId));
    this.broadcast("game_over", { winner, reason: "forfeit" });
    addLog(this.gs, `${this.getPlayerName(client.sessionId)} conceded.`);
    this.clock.setTimeout(() => this.disconnect(), 2000);
  }

  // ============================================================
  // WIN CONDITIONS
  // ============================================================

  private checkAndApplyWinCondition() {
    const result = checkWinConditions(this.gs);
    if (!result) return;

    const winnerSeat = this.getSeat((result as any).winnerId ?? "");
    this.broadcast("game_over", { winner: winnerSeat, reason: result.reason });
    addLog(this.gs, `GAME OVER — ${this.getPlayerName((result as any).winnerId ?? "")} wins: ${result.reason}`);
    this.clock.setTimeout(() => this.disconnect(), 3000);
  }

  // ============================================================
  // VALID MOVE / TARGET RESPONSES
  // ============================================================

  private sendValidMoves(client: Client, unitId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    const tiles = getValidMoveTiles(this.gs, unit);
    client.send("valid_moves", { unitId, tiles });
  }

  private sendValidTargets(client: Client, unitId: string, attackType: "melee" | "ranged") {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    const targets = attackType === "melee"
      ? getValidMeleeTargets(this.gs, unit)
      : getValidRangedTargets(this.gs, unit);
    client.send("valid_targets", { unitId, tiles: targets, mode: attackType });
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private nextId(): string { return `inst_${++this.instanceCounter}`; }

  private getOtherPlayerId(sessionId: string): string {
    const ids = Array.from(this.gs.players.keys()) as string[];
    return ids.find((id: string) => id !== sessionId) ?? "";
  }

  private getPlayerName(sessionId: string): string {
    return this.gs.players.get(sessionId)?.displayName ?? sessionId;
  }

  private isValidSpawnTile(playerId: string, tileId: string): boolean {
    const player = this.gs.players.get(playerId);
    if (!player) return false;

    if (player.empire.isPlaced) {
      if ([player.empire.tileId, ...this.getNeighborIds(player.empire.tileId)].includes(tileId)) return true;
    }

    let valid = false;
    this.gs.structures.forEach((s: StructureInstance) => {
      if (s.ownerId === playerId && [s.tileId, ...this.getNeighborIds(s.tileId)].includes(tileId)) valid = true;
    });
    return valid;
  }

  private getNeighborIds(tileId: string): string[] {
    const row    = parseInt(tileId.split("c")[0].replace("r", ""));
    const col    = parseInt(tileId.split("c")[1]);
    const isOdd  = row % 2 !== 0;
    const offs   = isOdd
      ? [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]]
      : [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
    return offs.map(([dr, dc]) => `r${row+dr!}c${col+dc!}`);
  }

  private checkStructureCapture(unitId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit) return;

    this.gs.structures.forEach((s: StructureInstance) => {
      if (s.ownerId === unit.ownerId) return;
      const neighbors = this.getNeighborIds(s.tileId);
      const enemies   = (Array.from(this.gs.units.values()) as UnitInstance[]).filter(u => u.ownerId === unit.ownerId && neighbors.includes(u.tileId));
      const defenders = (Array.from(this.gs.units.values()) as UnitInstance[]).filter(u => u.ownerId === s.ownerId  && neighbors.includes(u.tileId));

      if (defenders.length > 0) { s.captureProgress = 0; return; }
      s.captureProgress += enemies.length >= 2 ? 2 : enemies.length;

      if (s.captureProgress >= 2) {
        const from = this.getPlayerName(s.ownerId);
        s.ownerId         = unit.ownerId;
        s.captureProgress = 0;
        this.broadcast("capture_update", { structureTile: s.tileId, capturedBy: this.getSeat(unit.ownerId), progress: 1 });
        addLog(this.gs, `${this.getPlayerName(unit.ownerId)} captured Structure from ${from}!`);
      } else {
        this.broadcast("capture_update", { structureTile: s.tileId, capturedBy: this.getSeat(unit.ownerId), progress: s.captureProgress / 2 });
      }
    });
  }

  private killUnit(instanceId: string, killerPlayerId: string) {
    const unit = this.gs.units.get(instanceId);
    if (!unit) return;

    const tile = this.gs.tiles.get(unit.tileId);
    if (tile && tile.occupiedBy === instanceId) tile.occupiedBy = "";

    this.gs.units.delete(instanceId);
    addLog(this.gs, `Unit ${instanceId} destroyed by ${this.getPlayerName(killerPlayerId)}.`);
  }

  private destroyStructure(instanceId: string) {
    const s = this.gs.structures.get(instanceId);
    if (!s) return;
    const tile = this.gs.tiles.get(s.tileId);
    if (tile && tile.occupiedBy === instanceId) tile.occupiedBy = "";
    this.gs.structures.delete(instanceId);
    addLog(this.gs, `Structure ${instanceId} destroyed.`);
  }
}
