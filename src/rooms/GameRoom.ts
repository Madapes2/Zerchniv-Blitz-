import { Room, Client } from "colyseus";
import { GameRoomState, PlayerState, UnitInstance, StructureInstance, BuilderInstance, Tile, Empire } from "./schema/GameRoomState.js";
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
// ============================================================
type Msg =
  | { type: "place_tile"; tileId: string; tileType: string }
  | { type: "end_tile_placement" }
  | { type: "place_empire"; tileId: string }
  | { type: "draw_card"; deck: "unit" | "blitz" }
  | { type: "move_unit"; unitId: string; targetTileId: string }
  | { type: "melee_attack"; attackerUnitId: string; targetId: string }
  | { type: "ranged_attack"; attackerUnitId: string; targetId: string }
  | { type: "play_unit"; cardId: string; spawnTileId: string }
  | { type: "play_blitz"; cardId: string; targetId?: string }
  | { type: "play_structure"; cardId: string; tileId: string }
  | { type: "place_builder"; tileId: string }
  | { type: "use_terraform"; unitId: string }
  | { type: "end_turn" }
  | { type: "react_blitz"; cardId: string }
  | { type: "pass_reaction" }
  | { type: "request_valid_moves"; unitId: string }
  | { type: "request_valid_targets"; unitId: string; attackType: "melee" | "ranged" };

export class GameRoom extends Room<{ state: GameRoomState }> {

  private instanceCounter = 0;

  // Typed accessor so this.state is always GameRoomState
  get gs(): GameRoomState {
    return this.state as GameRoomState;
  }

  onCreate(options: any) {
    this.setState(new GameRoomState());
    this.maxClients = 2;

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, { type, ...message } as Msg);
    });

    addLog(this.gs, "Room created. Waiting for players...");
  }

  onJoin(client: Client, options: any) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.displayName = options?.displayName ?? `Player ${this.gs.players.size + 1}`;

    // Load decks from options (sent by the deckbuilder)
    if (options?.unitDeck) options.unitDeck.forEach((id: string) => player.unitDeck.push(id));
    if (options?.blitzDeck) options.blitzDeck.forEach((id: string) => player.blitzDeck.push(id));
    if (options?.extraDeck) options.extraDeck.forEach((id: string) => player.extraDeck.push(id));

    // Shuffle decks
    shuffleDeck(player.unitDeck);
    shuffleDeck(player.blitzDeck);

    this.gs.players.set(client.sessionId, player);
    addLog(this.gs, `${player.displayName} joined.`);

    if (this.clients.length === 2) {
      this.startGame();
    }
  }

onLeave(client: Client) {
  const p = this.gs.players.get(client.sessionId);
  addLog(this.gs, `${p?.displayName ?? client.sessionId} disconnected.`);

  // IMPORTANT: remove from state map so player counts stay accurate
  this.gs.players.delete(client.sessionId);

  // Optional: if you want the match to end when someone leaves
  // this.disconnect();
}

  // ============================================================
  // GAME START
  // ============================================================

  private startGame() {
    // Randomly pick who goes first
    const playerIds = Array.from(this.gs.players.keys());
    const flip = Math.random() < 0.5;
    this.gs.activePlayerId = flip ? playerIds[0] : playerIds[1];

    this.gs.currentPhase = Phase.SETUP_TILES;
    addLog(this.gs, `Game started! ${this.getPlayerName(this.gs.activePlayerId)} places tiles first.`);

    // Send starting hand guarantee: each player picks 1 unit from their deck
    // (handled by draw on first turn — guaranteed via deck ordering in deckbuilder)
  }

  // Notify both clients
this.clients.forEach(client => {
    client.send("game_start", {
        yourSeat: client.sessionId === this.gs.activePlayerId ? "p1" : "p2",
        state: {}
    });
});

  // ============================================================
  // MESSAGE ROUTER
  // ============================================================

  private handleMessage(client: Client, msg: Msg) {
    const playerId = client.sessionId;
    const player = this.gs.players.get(playerId);
    if (!player) return;

    // Reaction window — only the reacting player can act
    if (this.gs.awaitingReaction) {
      if (msg.type === "react_blitz" && playerId === this.gs.reactionFromPlayerId) {
        this.handleReactBlitz(client, msg.cardId);
      } else if (msg.type === "pass_reaction" && playerId === this.gs.reactionFromPlayerId) {
        this.resolveReactionWindow();
      }
      return;
    }

    // Info requests — always allowed
    if (msg.type === "request_valid_moves") {
      this.sendValidMoves(client, msg.unitId);
      return;
    }
    if (msg.type === "request_valid_targets") {
      this.sendValidTargets(client, msg.unitId, msg.attackType);
      return;
    }

    switch (this.gs.currentPhase) {
      case Phase.SETUP_TILES:
        if (playerId !== this.gs.activePlayerId) return;
        if (msg.type === "place_tile") this.handlePlaceTile(client, msg.tileId, msg.tileType);
        if (msg.type === "end_tile_placement") this.handleEndTilePlacement(client);
        break;

      case Phase.SETUP_EMPIRE:
        if (msg.type === "place_empire") this.handlePlaceEmpire(client, msg.tileId);
        break;

      case Phase.DRAW:
        if (playerId !== this.gs.activePlayerId) return;
        if (msg.type === "draw_card") this.handleDrawCard(client, msg.deck);
        break;

      case Phase.MAIN:
        if (playerId !== this.gs.activePlayerId) return;
        if (msg.type === "move_unit") this.handleMoveUnit(client, msg.unitId, msg.targetTileId);
        if (msg.type === "melee_attack") this.handleMeleeAttack(client, msg.attackerUnitId, msg.targetId);
        if (msg.type === "ranged_attack") this.handleRangedAttack(client, msg.attackerUnitId, msg.targetId);
        if (msg.type === "play_unit") this.handlePlayUnit(client, msg.cardId, msg.spawnTileId);
        if (msg.type === "play_blitz") this.handlePlayBlitz(client, msg.cardId, msg.targetId);
        if (msg.type === "play_structure") this.handlePlayStructure(client, msg.cardId, msg.tileId);
        if (msg.type === "place_builder") this.handlePlaceBuilder(client, msg.tileId);
        if (msg.type === "use_terraform") this.handleTerraform(client, msg.unitId);
        if (msg.type === "end_turn") this.handleEndTurn(client);
        break;

      case Phase.END:
        // End phase is server-driven, no client actions
        break;
    }
  }

  // ============================================================
  // SETUP: TILE PLACEMENT
  // ============================================================

  private handlePlaceTile(client: Client, tileId: string, tileType: string) {
    const player = this.gs.players.get(client.sessionId)!;

    if (this.gs.tiles.has(tileId)) {
      client.send("error", { message: "Tile already placed." });
      return;
    }

    // Validate element counts
    if (tileType === "neutral" && player.neutralTilesRemaining <= 0) {
      client.send("error", { message: "No neutral tiles remaining." });
      return;
    }
    if ((tileType === "fire" || tileType === "water") && player.elementalTilesRemaining <= 0) {
      client.send("error", { message: "No elemental tiles remaining." });
      return;
    }

    const tile = new Tile();
    tile.id = tileId;
    tile.tileType = tileType;
    tile.revealed = false;
    tile.ownedBy = client.sessionId;
    this.gs.tiles.set(tileId, tile);

    if (tileType === "neutral") player.neutralTilesRemaining--;
    else player.elementalTilesRemaining--;

    addLog(this.gs, `${player.displayName} placed a tile at ${tileId}.`);
  }

  private handleEndTilePlacement(client: Client) {
    const player = this.gs.players.get(client.sessionId)!;

    // Check pile minimums (simplified: just mark complete and pass turn)
    player.tileSetupComplete = true;
    addLog(this.gs, `${player.displayName} finished placing tiles.`);

    // Switch to other player if they haven't placed yet
    const otherPlayerId = this.getOtherPlayerId(client.sessionId);
    const otherPlayer = this.gs.players.get(otherPlayerId);

    if (!otherPlayer?.tileSetupComplete) {
      this.gs.activePlayerId = otherPlayerId;
      addLog(this.gs, `${this.getPlayerName(otherPlayerId)} now places their tiles.`);
    } else {
      // Both done — move to empire placement
      this.gs.currentPhase = Phase.SETUP_EMPIRE;
      addLog(this.gs, "Both players placed tiles. Now place your Empires.");
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
      client.send("error", { message: "Tile does not exist." });
      return;
    }

    // Empire must be placed in the back 3 rows of player's half
    // (validation simplified — in full implementation, enforce row range per player)

    player.empire.ownerId = client.sessionId;
    player.empire.tileId = tileId;
    player.empire.currentHp = EMPIRE_MAX_HP;
    player.empire.isPlaced = true;
    player.empireSet = true;

    tile.revealed = true;
    tile.occupiedBy = `empire:${client.sessionId}`;

    addLog(this.gs, `${player.displayName} placed their Empire at ${tileId}.`);

    // Check if both empires are placed
    const allPlaced = (Array.from(this.gs.players.values()) as PlayerState[]).every((p: PlayerState) => p.empireSet);
    if (allPlaced) {
      this.startStandbyPhase();
    }
  }

  // ============================================================
  // STANDBY PHASE
  // ============================================================

  private startStandbyPhase() {
    this.gs.currentPhase = Phase.STANDBY;
    const playerId = this.gs.activePlayerId;
    const player = this.gs.players.get(playerId)!;

    // "At start of turn" effects would fire here

    // Recalculate essence
    recalculateEssence(this.gs, playerId);
    addLog(this.gs, `${player.displayName}'s Standby Phase. Essence: N${player.essence.neutral} F${player.essence.fire} W${player.essence.water}`);

    // Clear per-turn unit flags and bonuses
    this.gs.units.forEach((unit: UnitInstance) => {
      if (unit.ownerId === playerId) {
        unit.hasMovedThisTurn = false;
        unit.hasAttackedThisTurn = false;
        unit.speedBonusThisTurn = 0;
        unit.defenseBonusThisTurn = 0;
        unit.meleeBonusThisTurn = 0;
        unit.cannotBeRangedTargeted = false;

        // Remove development rest after first turn
        if (unit.hasDevelopmentRest) {
          unit.hasDevelopmentRest = false;
        }
      }
    });

    // First 2 rounds: no dev rest for units spawned near empire
    // (handled at spawn time via roundNumber check)

    this.gs.currentPhase = Phase.DRAW;
    addLog(this.gs, `${player.displayName}'s Draw Phase.`);
  }

  // ============================================================
  // DRAW PHASE
  // ============================================================

  private handleDrawCard(client: Client, deck: "unit" | "blitz") {
    const player = this.gs.players.get(client.sessionId)!;

    if (deck === "unit") {
      const drawn = drawCard(player.unitDeck, player.hand);
      if (!drawn) {
        client.send("error", { message: "Unit deck is empty." });
        return;
      }
      addLog(this.gs, `${player.displayName} drew a unit card.`);
    } else {
      const drawn = drawCard(player.blitzDeck, player.hand);
      if (!drawn) {
        client.send("error", { message: "Blitz deck is empty." });
        return;
      }
      addLog(this.gs, `${player.displayName} drew a blitz card.`);
    }

    this.gs.currentPhase = Phase.MAIN;
    addLog(this.gs, `${player.displayName}'s Main Phase.`);
  }

  // ============================================================
  // MAIN PHASE: MOVE
  // ============================================================

  private handleMoveUnit(client: Client, unitId: string, targetTileId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    if (unit.hasDevelopmentRest) {
      client.send("error", { message: "Unit is in Development Rest." });
      return;
    }
    if (unit.hasAttackedThisTurn) {
      client.send("error", { message: "Unit has already attacked this turn and cannot move." });
      return;
    }

    const validTiles = getValidMoveTiles(this.gs, unit);
    if (!validTiles.includes(targetTileId)) {
      client.send("error", { message: "Invalid move target." });
      return;
    }

    // Vacate old tile
    const oldTile = this.gs.tiles.get(unit.tileId);
    if (oldTile && oldTile.occupiedBy === unitId) oldTile.occupiedBy = "";

    // Move to new tile
    unit.tileId = targetTileId;
    unit.hasMovedThisTurn = true;

    const newTile = this.gs.tiles.get(targetTileId);
    if (newTile) {
      newTile.occupiedBy = unitId;
      newTile.revealed = true; // Fog of war reveal
    }

    addLog(this.gs, `${this.getPlayerName(client.sessionId)} moved unit to ${targetTileId}.`);
    this.checkStructureCapture(unitId);
  }

  // ============================================================
  // MAIN PHASE: MELEE ATTACK
  // ============================================================

  private handleMeleeAttack(client: Client, attackerUnitId: string, targetId: string) {
    const attacker = this.gs.units.get(attackerUnitId);
    if (!attacker || attacker.ownerId !== client.sessionId) return;
    if (attacker.hasDevelopmentRest || attacker.hasAttackedThisTurn) return;

    const validTargets = getValidMeleeTargets(this.gs, attacker);
    if (!validTargets.includes(targetId)) {
      client.send("error", { message: "No valid melee target." });
      return;
    }

    attacker.hasAttackedThisTurn = true;
    this.resolveAttackOnTarget(attacker, targetId, "melee", client.sessionId);
  }

  // ============================================================
  // MAIN PHASE: RANGED ATTACK
  // ============================================================

  private handleRangedAttack(client: Client, attackerUnitId: string, targetId: string) {
    const attacker = this.gs.units.get(attackerUnitId);
    if (!attacker || attacker.ownerId !== client.sessionId) return;
    if (attacker.hasDevelopmentRest || attacker.hasAttackedThisTurn) return;

    const validTargets = getValidRangedTargets(this.gs, attacker);
    if (!validTargets.includes(targetId)) {
      client.send("error", { message: "No valid ranged target." });
      return;
    }

    attacker.hasAttackedThisTurn = true;
    this.resolveAttackOnTarget(attacker, targetId, "ranged", client.sessionId);
  }

  private resolveAttackOnTarget(
    attacker: UnitInstance,
    targetId: string,
    attackType: "melee" | "ranged",
    attackerPlayerId: string
  ) {
    const isEmpireTarget = targetId.startsWith("empire:");
    const targetUnit = this.gs.units.get(targetId);
    const targetStructure = this.gs.structures.get(targetId);

    const isStructureOrEmpire = isEmpireTarget || !!targetStructure;
    const result = resolveAttack(attacker, targetUnit ?? null, isStructureOrEmpire, attackType);

    if (isEmpireTarget) {
      const empireOwnerId = targetId.replace("empire:", "");
      const empireOwner = this.gs.players.get(empireOwnerId);
      if (empireOwner) {
        empireOwner.empire.currentHp -= result.damage;
        addLog(this.gs, `Attack on Empire! Roll: ${result.roll}. Damage: ${result.damage}. Empire HP: ${empireOwner.empire.currentHp}`);
      }
    } else if (targetStructure) {
      targetStructure.currentHp -= result.damage;
      addLog(this.gs, `Attack on Structure! Damage: ${result.damage}. Structure HP: ${targetStructure.currentHp}`);
      if (targetStructure.currentHp <= 0) {
        this.destroyStructure(targetStructure.instanceId);
      }
    } else if (targetUnit) {
      if (result.hit) {
        targetUnit.currentHp -= result.damage;
        addLog(this.gs, `${attackType} attack! Roll: ${result.roll} vs Defense. Damage: ${result.damage}. Target HP: ${targetUnit.currentHp}`);
        if (targetUnit.currentHp <= 0) {
          this.killUnit(targetUnit.instanceId, attackerPlayerId);
        }
      } else {
        addLog(this.gs, `${attackType} attack missed! Roll: ${result.roll} vs Defense.`);
      }
    }

    this.checkAndApplyWinCondition();
  }

  // ============================================================
  // MAIN PHASE: PLAY UNIT
  // ============================================================

  private handlePlayUnit(client: Client, cardId: string, spawnTileId: string) {
    const player = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as UnitCardDef;
    if (!cardDef || cardDef.type !== CardType.UNIT) return;

    // Check hand
    const handIdx = player.hand.indexOf(cardId);
    if (handIdx === -1) {
      client.send("error", { message: "Card not in hand." });
      return;
    }

    // Check essence
    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { message: "Not enough Essence." });
      return;
    }

    // Check spawn tile validity (must be near Empire or owned Structure)
    if (!this.isValidSpawnTile(client.sessionId, spawnTileId)) {
      client.send("error", { message: "Invalid spawn location." });
      return;
    }

    // Spend essence, remove from hand, create unit
    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.hand.splice(handIdx, 1);

    const unit = new UnitInstance();
    unit.instanceId = this.nextId();
    unit.cardId = cardId;
    unit.ownerId = client.sessionId;
    unit.tileId = spawnTileId;
    unit.currentHp = cardDef.hp;
    unit.hasDevelopmentRest = this.gs.roundNumber > FIRST_PLAYER_NO_DEV_REST_ROUNDS;

    this.gs.units.set(unit.instanceId, unit);

    const tile = this.gs.tiles.get(spawnTileId);
    if (tile) { tile.occupiedBy = unit.instanceId; tile.revealed = true; }

    addLog(this.gs, `${player.displayName} played ${cardDef.name} at ${spawnTileId}.`);
  }

  // ============================================================
  // MAIN PHASE: PLAY BLITZ
  // ============================================================

  private handlePlayBlitz(client: Client, cardId: string, targetId?: string) {
    const player = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as BlitzCardDef;
    if (!cardDef || cardDef.type !== CardType.BLITZ) return;

    const handIdx = player.hand.indexOf(cardId);
    if (handIdx === -1) return;

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { message: "Not enough Essence." });
      return;
    }

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.hand.splice(handIdx, 1);
    player.discardPile.push(cardId);

    addLog(this.gs, `${player.displayName} played Blitz: ${cardDef.name}.`);

    // Open reaction window for opponent if this is a Slow or Instant card
    const otherId = this.getOtherPlayerId(client.sessionId);
    this.gs.pendingBlitzCardId = cardId;
    this.gs.reactionFromPlayerId = otherId;
    this.gs.awaitingReaction = true;

    // Apply effect after reaction window (or immediately for Instant if no reaction)
    // For prototype, apply immediately then check if opponent reacts
    this.applyBlitzEffect(cardDef, targetId, client.sessionId);
  }

  private handleReactBlitz(client: Client, reactionCardId: string) {
    const player = this.gs.players.get(client.sessionId)!;
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
  }

  private resolveReactionWindow() {
    this.gs.awaitingReaction = false;
    this.gs.pendingBlitzCardId = "";
    this.gs.reactionFromPlayerId = "";
  }

  private applyBlitzEffect(cardDef: BlitzCardDef, targetId: string | undefined, casterId: string) {
    switch (cardDef.id) {

      case "B001": // Heat Seeking: next attack from selected unit bypasses defense
        if (targetId) {
          const unit = this.gs.units.get(targetId);
          if (unit && unit.ownerId === casterId) {
            unit.defenseBonusThisTurn -= 99; // Effectively makes defense 0 or below
            addLog(this.gs, `Heat Seeking: ${CARD_DEFINITIONS[unit.cardId]?.name ?? "unit"}'s next attack ignores defense.`);
          }
        }
        break;

      case "B002": // Rage: selected ally unit +2 attack this turn
        if (targetId) {
          const unit = this.gs.units.get(targetId);
          if (unit && unit.ownerId === casterId) {
            unit.meleeBonusThisTurn += 2;
            addLog(this.gs, `Rage: unit gains +2 attack this turn.`);
          }
        }
        break;

      case "B003": // Swift Winds: ally unit +2 speed this turn
        if (targetId) {
          const unit = this.gs.units.get(targetId);
          if (unit && unit.ownerId === casterId) {
            unit.speedBonusThisTurn += 2;
            addLog(this.gs, `Swift Winds: unit gains +2 speed this turn.`);
          }
        }
        break;

      case "B004": // Lightning Strikes Twice: flag next blitz to trigger twice
        // Store flag on player — GameRoom checks this on next blitz play
        const lsPlayer = this.gs.players.get(casterId)!;
        (lsPlayer as any)._lightningActive = true;
        addLog(this.gs, `Lightning Strikes Twice: next Blitz card triggers twice.`);
        break;

      case "B005": // Grounded: reaction — negate opponent blitz (handled in react flow)
        addLog(this.gs, `Grounded negated the opposing Blitz card.`);
        // The pending blitz effect is already applied before reaction in prototype;
        // In full impl, defer effect application until reaction window closes.
        break;

      case "B006": // Hand of Protection: double a unit's defense this attack
        if (targetId) {
          const unit = this.gs.units.get(targetId);
          if (unit && unit.ownerId === casterId) {
            const baseDef = (CARD_DEFINITIONS[unit.cardId] as UnitCardDef)?.defense ?? 0;
            unit.defenseBonusThisTurn += baseDef; // Adds base again = doubled
            addLog(this.gs, `Hand of Protection: unit defense doubled.`);
          }
        }
        break;
    }
  }

  // ============================================================
  // MAIN PHASE: PLAY STRUCTURE
  // ============================================================

  private handlePlayStructure(client: Client, cardId: string, tileId: string) {
    const player = this.gs.players.get(client.sessionId)!;
    const cardDef = CARD_DEFINITIONS[cardId] as StructureCardDef;
    if (!cardDef || cardDef.type !== CardType.STRUCTURE) return;

    const extraIdx = player.extraDeck.indexOf(cardId);
    if (extraIdx === -1) return;

    if (!canAfford(player.essence, cardDef.essenceCost, cardDef.element)) {
      client.send("error", { message: "Not enough Essence." });
      return;
    }

    const tile = this.gs.tiles.get(tileId);
    if (!tile || tile.occupiedBy) {
      client.send("error", { message: "Tile is occupied or does not exist." });
      return;
    }

    spendEssence(player.essence, cardDef.essenceCost, cardDef.element);
    player.extraDeck.splice(extraIdx, 1);

    const structure = new StructureInstance();
    structure.instanceId = this.nextId();
    structure.cardId = cardId;
    structure.ownerId = client.sessionId;
    structure.tileId = tileId;
    structure.currentHp = STRUCTURE_MAX_HP;

    this.gs.structures.set(structure.instanceId, structure);
    tile.occupiedBy = structure.instanceId;
    tile.revealed = true;

    addLog(this.gs, `${player.displayName} built ${cardDef.name} at ${tileId}.`);
  }

  // ============================================================
  // MAIN PHASE: PLACE BUILDER
  // ============================================================

  private handlePlaceBuilder(client: Client, tileId: string) {
    const player = this.gs.players.get(client.sessionId)!;
    const tile = this.gs.tiles.get(tileId);

    if (!tile) { client.send("error", { message: "Tile not found." }); return; }
    if (tile.tileType === "neutral") { client.send("error", { message: "Builders must be on elemental tiles." }); return; }
    if (tile.occupiedBy) { client.send("error", { message: "Tile is occupied." }); return; }

    const builder = new BuilderInstance();
    builder.instanceId = this.nextId();
    builder.ownerId = client.sessionId;
    builder.tileId = tileId;

    this.gs.builders.set(builder.instanceId, builder);
    tile.occupiedBy = builder.instanceId;
    tile.revealed = true;

    addLog(this.gs, `${player.displayName} placed a Builder at ${tileId}.`);
  }

  // ============================================================
  // END TURN
  // ============================================================

  private handleEndTurn(client: Client) {
    this.gs.currentPhase = Phase.END;
    addLog(this.gs, `${this.getPlayerName(client.sessionId)} ends their turn.`);

    // "End of turn" effects fire here (placeholder)

    // Advance round counter if both players have gone
    const playerIds = Array.from(this.gs.players.keys());
    if (this.gs.activePlayerId === playerIds[1]) {
      this.gs.roundNumber++;
    }

    // Pass to other player
    this.gs.activePlayerId = this.getOtherPlayerId(client.sessionId);
    addLog(this.gs, `${this.getPlayerName(this.gs.activePlayerId)}'s turn begins.`);
    this.startStandbyPhase();
  }

  // ============================================================
  // VALID MOVE / TARGET INFO RESPONSES
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
    client.send("valid_targets", { unitId, attackType, targets });
  }

  // ============================================================
  // MAIN PHASE: TERRAFORM (Large Fish ability)
  // ============================================================

  private handleTerraform(client: Client, unitId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit || unit.ownerId !== client.sessionId) return;
    if (unit.cardId !== "U009") {
      client.send("error", { message: "Only Large Fish can use Terraform." });
      return;
    }

    // Check terraform hasn't been used already (stored as a flag on the instance)
    if ((unit as any)._terraformUsed) {
      client.send("error", { message: "Terraform has already been used by this unit." });
      return;
    }

    const tile = this.gs.tiles.get(unit.tileId);
    if (!tile) return;

    if (tile.tileType === "neutral") {
      client.send("error", { message: "Terraform requires an elemental tile." });
      return;
    }

    // Reveal the unit (fog of war — unit is now visible)
    tile.revealed = true;
    (unit as any)._terraformUsed = true;

    // Convert tile to neutral
    const oldType = tile.tileType;
    tile.tileType = "neutral";

    addLog(this.gs, `Large Fish used Terraform — converted ${oldType} tile at ${unit.tileId} to neutral. Unit is now revealed.`);
  }

  // ============================================================

  private nextId(): string {
    return `inst_${++this.instanceCounter}`;
  }

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

    // Can spawn adjacent to Empire
    if (player.empire.isPlaced) {
      const empireNeighbors = [player.empire.tileId, ...this.getNeighborIds(player.empire.tileId)];
      if (empireNeighbors.includes(tileId)) return true;
    }

    // Can spawn adjacent to owned structures
    let valid = false;
    this.gs.structures.forEach((s: StructureInstance) => {
      if (s.ownerId === playerId) {
        const structureNeighbors = [s.tileId, ...this.getNeighborIds(s.tileId)];
        if (structureNeighbors.includes(tileId)) valid = true;
      }
    });

    return valid;
  }

  private getNeighborIds(tileId: string): string[] {
    const { row, col } = { row: parseInt(tileId.split("c")[0].replace("r", "")), col: parseInt(tileId.split("c")[1]) };
    const isOdd = row % 2 !== 0;
    const offsets = isOdd
      ? [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]]
      : [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
    return offsets.map(([dr, dc]) => `r${row+dr!}c${col+dc!}`);
  }

  private checkStructureCapture(unitId: string) {
    const unit = this.gs.units.get(unitId);
    if (!unit) return;

    this.gs.structures.forEach((structure: StructureInstance) => {
      if (structure.ownerId === unit.ownerId) return;

      const neighbors = this.getNeighborIds(structure.tileId);
      const nearbyEnemies = (Array.from(this.gs.units.values()) as UnitInstance[]).filter(
        (u: UnitInstance) => u.ownerId === unit.ownerId && neighbors.includes(u.tileId)
      );

      const nearbyOwnerUnits = (Array.from(this.gs.units.values()) as UnitInstance[]).filter(
        (u: UnitInstance) => u.ownerId === structure.ownerId && neighbors.includes(u.tileId)
      );

      if (nearbyOwnerUnits.length > 0) {
        // Contested — reset capture
        structure.captureProgress = 0;
        return;
      }

      if (nearbyEnemies.length >= 2) {
        structure.captureProgress += 2; // Counts as 1 turn worth
      } else if (nearbyEnemies.length === 1) {
        structure.captureProgress += 1;
      }

      if (structure.captureProgress >= 2) {
        // Capture!
        const oldOwnerName = this.getPlayerName(structure.ownerId);
        structure.ownerId = unit.ownerId;
        structure.captureProgress = 0;
        addLog(this.gs, `${this.getPlayerName(unit.ownerId)} captured ${CARD_DEFINITIONS[structure.cardId]?.name ?? "Structure"} from ${oldOwnerName}!`);
      }
    });
  }

  private killUnit(instanceId: string, killerPlayerId: string) {
    const unit = this.gs.units.get(instanceId);
    if (!unit) return;

    const killer = this.gs.players.get(killerPlayerId)!;
    addEssence(killer.essence, 1, "neutral" as Element);
    addLog(this.gs, `Unit destroyed! ${killer.displayName} gains 1 Neutral Essence.`);

    const tile = this.gs.tiles.get(unit.tileId);
    if (tile && tile.occupiedBy === instanceId) tile.occupiedBy = "";

    this.gs.units.delete(instanceId);
  }

  private destroyStructure(instanceId: string) {
    const structure = this.gs.structures.get(instanceId);
    if (!structure) return;

    const tile = this.gs.tiles.get(structure.tileId);
    if (tile && tile.occupiedBy === instanceId) tile.occupiedBy = "";

    addLog(this.gs, `Structure destroyed at ${structure.tileId}!`);
    this.gs.structures.delete(instanceId);
  }

  private checkAndApplyWinCondition() {
    const result = checkWinConditions(this.gs);
    if (result !== GameResult.ONGOING) {
      this.gs.gameResult = result;
      addLog(this.gs, `Game Over! Winner: ${this.getPlayerName(this.gs.winnerId)}`);
      this.disconnect();
    }
  }
}
