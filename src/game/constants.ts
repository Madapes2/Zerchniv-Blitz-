// ============================================================
// ZERCHNIV-BLITZ: GAME CONSTANTS
// ============================================================

export const BOARD_TOTAL_TILES = 64;
export const NEUTRAL_TILES_PER_PLAYER = 20;
export const ELEMENTAL_TILES_PER_PLAYER = 12;

export const EMPIRE_MAX_HP = 20;
export const STRUCTURE_MAX_HP = 10;

export const EMPIRE_ESSENCE_PER_TURN = 2;
export const STRUCTURE_ESSENCE_PER_TURN = 1;
export const BUILDER_ESSENCE_PER_TURN = 1;
export const KILL_ESSENCE_REWARD = 1;

export const SIEGE_UNITS_REQUIRED = 5;
export const STRUCTURE_CAPTURE_ROUNDS_SOLO = 2;    // 1 unit nearby
export const STRUCTURE_CAPTURE_ROUNDS_GROUP = 1;   // 2+ units nearby

export const MIN_UNIT_DECK_SIZE = 15;
export const MIN_BLITZ_DECK_SIZE = 10;
export const MIN_EXTRA_DECK_SIZE = 5;

export const FIRST_PLAYER_NO_DEV_REST_ROUNDS = 2;

export enum Element {
  NEUTRAL = "neutral",
  FIRE = "fire",
  WATER = "water",
}

export enum TileType {
  NEUTRAL = "neutral",
  FIRE = "fire",
  WATER = "water",
}

export enum UnitSize {
  TINY = "tiny",
  NORMAL = "normal",
  LARGE = "large",
  EXTRA_LARGE = "extra_large",
}

export enum CardType {
  UNIT = "unit",
  BLITZ = "blitz",
  STRUCTURE = "structure",
}

export enum BlitzTiming {
  SLOW = "slow",        // Main phase only
  REACTION = "reaction", // In response to another card
  INSTANT = "instant",   // Any time
}

export enum Phase {
  SETUP_TILES = "setup_tiles",
  SETUP_EMPIRE = "setup_empire",
  STANDBY = "standby",
  DRAW = "draw",
  MAIN = "main",
  END = "end",
}

export enum GameResult {
  ONGOING = "ongoing",
  PLAYER1_WINS = "player1_wins",
  PLAYER2_WINS = "player2_wins",
}

// ============================================================
// CARD DEFINITIONS (Prototype: Fire + Water only)
// ============================================================

export interface UnitCardDef {
  id: string;
  name: string;
  type: CardType.UNIT;
  essenceCost: number;
  element: Element;
  hp: number;
  defense: number;        // D10 threshold — attacker must roll ABOVE this
  meleeAttack: number;
  rangedAttack: number;   // 0 = no ranged
  rangedRange: number;    // 0 = no ranged
  size: UnitSize;
  speed: number;
  abilities: string[];
}

export interface BlitzCardDef {
  id: string;
  name: string;
  type: CardType.BLITZ;
  essenceCost: number;
  element: Element;
  timing: BlitzTiming;
  effect: string;
}

export interface StructureCardDef {
  id: string;
  name: string;
  type: CardType.STRUCTURE;
  essenceCost: number;
  element: Element;
  effect: string;
}

export type CardDef = UnitCardDef | BlitzCardDef | StructureCardDef;

// ============================================================
// CARD POOL — Official cards from Charles Horton's design doc
// ============================================================

export const CARD_DEFINITIONS: Record<string, CardDef> = {

  // -------------------------------------------------------
  // UNIT CARDS
  // Cost = neutral + elemental essence combined
  // -------------------------------------------------------

  "U001": {
    id: "U001", name: "Arid Wanderer",
    type: CardType.UNIT, essenceCost: 2, element: Element.NEUTRAL,
    hp: 4, defense: 5, meleeAttack: 2, rangedAttack: 2, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Burst Speed: The first turn after Development Rest ends, this unit may move an extra 2 tiles.",
      "Firewalk: Moving over a Fire tile does not cost movement."
    ]
  },

  "U002": {
    id: "U002", name: "Fireling",
    type: CardType.UNIT, essenceCost: 1, element: Element.FIRE,
    hp: 2, defense: 1, meleeAttack: 1, rangedAttack: 0, rangedRange: 0,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Attach: Attaching this unit to an ally unit grants that ally +1 ranged attack and +2 HP."
    ]
  },

  "U003": {
    id: "U003", name: "Freaky Deaky",
    type: CardType.UNIT, essenceCost: 3, element: Element.FIRE,
    hp: 4, defense: 5, meleeAttack: 3, rangedAttack: 1, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 3,
    abilities: [
      "Hook: If any enemy is hit by this ranged attack, they are pulled to the closest open tile nearby this unit."
    ]
  },

  "U004": {
    id: "U004", name: "Local Drunk",
    type: CardType.UNIT, essenceCost: 2, element: Element.NEUTRAL,
    hp: 3, defense: 4, meleeAttack: 3, rangedAttack: 0, rangedRange: 0,
    size: UnitSize.NORMAL, speed: 3,
    abilities: [
      "Instigator: If the enemy unit is undiscovered (on a hidden tile), deal an extra 1 damage on a successful hit."
    ]
  },

  "U005": {
    id: "U005", name: "La'Lucha",
    type: CardType.UNIT, essenceCost: 8, element: Element.FIRE,
    hp: 6, defense: 7, meleeAttack: 5, rangedAttack: 4, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Scorch the Earth: Spend 3 Essence — designate an area of 7 tiles; all units in those tiles take 4 damage."
    ]
  },

  "U006": {
    id: "U006", name: "Embodiment of Fire",
    type: CardType.UNIT, essenceCost: 3, element: Element.FIRE,
    hp: 4, defense: 6, meleeAttack: 2, rangedAttack: 3, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Flaming Body: When a melee attack hits this unit, the attacker takes 1 damage.",
      "Flame Engine: If this unit starts the turn on a Fire tile, its ranged range increases by 1 and deals 1 more ranged damage."
    ]
  },

  "U007": {
    id: "U007", name: "Ocean Wanderer",
    type: CardType.UNIT, essenceCost: 2, element: Element.NEUTRAL,
    hp: 4, defense: 5, meleeAttack: 2, rangedAttack: 2, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Burst Speed: The first turn after Development Rest ends, this unit may move an extra 2 tiles.",
      "Waterwalk: Moving over a Water tile does not cost movement."
    ]
  },

  "U008": {
    id: "U008", name: "El'Camino",
    type: CardType.UNIT, essenceCost: 8, element: Element.WATER,
    hp: 8, defense: 8, meleeAttack: 4, rangedAttack: 4, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 3,
    abilities: [
      "Hurricane: Spend 3 Essence — designate a group of 7 tiles; those tiles become Water tiles for the rest of the game.",
      "Waterwalk: Moving over a Water tile does not cost movement."
    ]
  },

  "U009": {
    id: "U009", name: "Large Fish",
    type: CardType.UNIT, essenceCost: 4, element: Element.WATER,
    hp: 5, defense: 7, meleeAttack: 2, rangedAttack: 1, rangedRange: 1,
    size: UnitSize.NORMAL, speed: 1,
    abilities: [
      "Thick Scales: Deflect 1 ranged damage back at the attacker when hit by a ranged attack.",
      "Terraform (once per unit, reveals unit): If this unit is standing on an elemental tile, destroy that tile and set it to a neutral tile."
    ]
  },

  "U010": {
    id: "U010", name: "Crazy Ah Ah Eel",
    type: CardType.UNIT, essenceCost: 3, element: Element.WATER,
    hp: 4, defense: 3, meleeAttack: 2, rangedAttack: 1, rangedRange: 3,
    size: UnitSize.NORMAL, speed: 3,
    abilities: [
      "Serpent Eyes: If this unit hits an undiscovered unit with a ranged attack, all ally units gain +1 movement this turn."
    ]
  },

  "U011": {
    id: "U011", name: "Seahope",
    type: CardType.UNIT, essenceCost: 1, element: Element.WATER,
    hp: 2, defense: 2, meleeAttack: 0, rangedAttack: 1, rangedRange: 1,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Attach: Attaching this unit to an ally unit grants that ally +1 melee attack and +2 defense."
    ]
  },

  "U012": {
    id: "U012", name: "Water Mage",
    type: CardType.UNIT, essenceCost: 2, element: Element.WATER,
    hp: 3, defense: 4, meleeAttack: 0, rangedAttack: 3, rangedRange: 2,
    size: UnitSize.NORMAL, speed: 2,
    abilities: [
      "Drench: If this ranged attack lands, the target's speed is decreased by 1 until the end of the opponent's next turn."
    ]
  },

  // -------------------------------------------------------
  // BLITZ CARDS
  // -------------------------------------------------------

  "B001": {
    id: "B001", name: "Heat Seeking",
    type: CardType.BLITZ, essenceCost: 3, element: Element.NEUTRAL,
    timing: BlitzTiming.INSTANT,
    effect: "Select a unit. Its next attack this turn ignores all defense — it deals direct damage with no d10 roll required."
  },

  "B002": {
    id: "B002", name: "Rage",
    type: CardType.BLITZ, essenceCost: 2, element: Element.NEUTRAL,
    timing: BlitzTiming.INSTANT,
    effect: "Select an ally unit. Its attack gains +2 until the end of this turn."
  },

  "B003": {
    id: "B003", name: "Swift Winds",
    type: CardType.BLITZ, essenceCost: 1, element: Element.NEUTRAL,
    timing: BlitzTiming.SLOW,
    effect: "An ally unit gains +2 speed until the end of this turn."
  },

  "B004": {
    id: "B004", name: "Lightning Strikes Twice",
    type: CardType.BLITZ, essenceCost: 2, element: Element.NEUTRAL,
    timing: BlitzTiming.SLOW,
    effect: "The next Blitz card you play this turn is played twice — its effect triggers two times."
  },

  "B005": {
    id: "B005", name: "Grounded",
    type: CardType.BLITZ, essenceCost: 3, element: Element.NEUTRAL,
    timing: BlitzTiming.REACTION,
    effect: "In response to any Blitz card played against you: negate that card's effect. It is sent to the discard pile."
  },

  "B006": {
    id: "B006", name: "Hand of Protection",
    type: CardType.BLITZ, essenceCost: 2, element: Element.NEUTRAL,
    timing: BlitzTiming.INSTANT,
    effect: "Double the defense of a selected ally unit until the end of the current attack resolution."
  },

  // -------------------------------------------------------
  // STRUCTURE CARDS
  // -------------------------------------------------------

  "S001": {
    id: "S001", name: "Barracks",
    type: CardType.STRUCTURE, essenceCost: 2, element: Element.NEUTRAL,
    effect: "Can be placed on any tile type. If you pay an extra 2 Essence when deploying a unit to this structure, that unit will not have Development Rest."
  },

  "S002": {
    id: "S002", name: "Research Facility",
    type: CardType.STRUCTURE, essenceCost: 5, element: Element.NEUTRAL,
    effect: "Can be placed on any tile type. At most one ally unit may be located at this structure. At the beginning of your turn, if there is an ally unit at this structure, gain +2 Essence."
  },

  "S003": {
    id: "S003", name: "Library",
    type: CardType.STRUCTURE, essenceCost: 2, element: Element.NEUTRAL,
    effect: "Can be placed on any tile type. Once per turn, pay 1 Essence to draw one card from either deck."
  },

  "S004": {
    id: "S004", name: "Water Basin",
    type: CardType.STRUCTURE, essenceCost: 3, element: Element.WATER,
    effect: "Must be played on a Water tile. When played, all nearby tiles become Water tiles."
  },

  "S005": {
    id: "S005", name: "Fuel Plant",
    type: CardType.STRUCTURE, essenceCost: 3, element: Element.FIRE,
    effect: "Must be played on a Fire tile. When played, this structure generates 1 Essence for every nearby Fire tile."
  },

};
