import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";

// ─── Tic-Tac-Toe ─────────────────────────────────────────────────────────────

type TicSymbol = "X" | "O";
type TicBoard = (TicSymbol | null)[];

type TicState = {
  board: TicBoard;
  turn: TicSymbol;
  winner: TicSymbol | "draw" | null;
  line: number[] | null;
};

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],             // diagonals
];

function emptyTicState(): TicState {
  return { board: Array(9).fill(null), turn: "X", winner: null, line: null };
}

function checkTicWinner(board: TicBoard): { winner: TicSymbol | "draw" | null; line: number[] | null } {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((cell) => cell !== null)) return { winner: "draw", line: null };
  return { winner: null, line: null };
}

// ─── Connect 4 ───────────────────────────────────────────────────────────────

type C4Player = "R" | "Y";
type C4Board = (C4Player | null)[];

const C4_COLS = 7;
const C4_ROWS = 6;

type C4State = {
  board: C4Board; // index = col + row * C4_COLS, row 0 = top
  turn: C4Player;
  winner: C4Player | "draw" | null;
  winCells: number[] | null;
};

function emptyC4State(): C4State {
  return { board: Array(C4_COLS * C4_ROWS).fill(null), turn: "R", winner: null, winCells: null };
}

function dropInColumn(board: C4Board, col: number): number {
  // Find the lowest empty row in this column (row 5 = bottom)
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (board[col + row * C4_COLS] === null) return row;
  }
  return -1; // column full
}

function checkC4Winner(board: C4Board): { winner: C4Player | "draw" | null; winCells: number[] | null } {
  const dirs = [
    { dc: 1, dr: 0 },  // horizontal
    { dc: 0, dr: 1 },  // vertical
    { dc: 1, dr: 1 },  // diagonal ↘
    { dc: 1, dr: -1 }, // diagonal ↗
  ];

  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col < C4_COLS; col++) {
      const cell = board[col + row * C4_COLS];
      if (!cell) continue;
      for (const { dc, dr } of dirs) {
        const cells: number[] = [];
        for (let i = 0; i < 4; i++) {
          const nc = col + dc * i;
          const nr = row + dr * i;
          if (nc < 0 || nc >= C4_COLS || nr < 0 || nr >= C4_ROWS) break;
          if (board[nc + nr * C4_COLS] !== cell) break;
          cells.push(nc + nr * C4_COLS);
        }
        if (cells.length === 4) return { winner: cell, winCells: cells };
      }
    }
  }

  if (board.every((c) => c !== null)) return { winner: "draw", winCells: null };
  return { winner: null, winCells: null };
}

// ─── Shared Env ──────────────────────────────────────────────────────────────

type Env = {
  TicTacToe: DurableObjectNamespace<TicTacToe>;
  ConnectFour: DurableObjectNamespace<ConnectFour>;
  Dice: DurableObjectNamespace<Dice>;
  Battleship: DurableObjectNamespace<Battleship>;
  RockPaperScissors: DurableObjectNamespace<RockPaperScissors>;
  HandCricket: DurableObjectNamespace<HandCricket>;
  Ludo: DurableObjectNamespace<Ludo>;
};

// ─── TicTacToe Class ─────────────────────────────────────────────────────────

export class TicTacToe extends Server<Env> {
  game: TicState = emptyTicState();
  players: Record<string, TicSymbol | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<TicState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, TicSymbol | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(connId: string): TicSymbol | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("X")) return "X";
    if (!taken.has("O")) return "O";
    return "spectator";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        board: this.game.board,
        turn: this.game.turn,
        winner: this.game.winner,
        line: this.game.line,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  onConnect(connection: Connection) {
    const role = this.players[connection.id] ?? this.assignRole(connection.id);
    this.players[connection.id] = role;
    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; index?: number };
    try { data = JSON.parse(message); } catch { return; }

    if (data.type === "move" && typeof data.index === "number") {
      const symbol = this.players[connection.id];
      if (symbol !== "X" && symbol !== "O") return;
      if (this.game.winner) return;
      if (symbol !== this.game.turn) return;
      if (this.game.board[data.index] !== null) return;

      this.game.board[data.index] = symbol;
      const result = checkTicWinner(this.game.board);
      this.game.winner = result.winner;
      this.game.line = result.line;
      this.game.turn = symbol === "X" ? "O" : "X";
      await this.persist();
      this.broadcastState();
    }

    if (data.type === "restart") {
      this.game = emptyTicState();
      await this.persist();
      this.broadcastState();
    }
  }
}

// ─── ConnectFour Class ──────────────────────────────────────────────────────────

export class ConnectFour extends Server<Env> {
  game: C4State = emptyC4State();
  players: Record<string, C4Player | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<C4State>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, C4Player | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(connId: string): C4Player | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("R")) return "R";
    if (!taken.has("Y")) return "Y";
    return "spectator";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        board: this.game.board,
        turn: this.game.turn,
        winner: this.game.winner,
        winCells: this.game.winCells,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  onConnect(connection: Connection) {
    const role = this.players[connection.id] ?? this.assignRole(connection.id);
    this.players[connection.id] = role;
    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; col?: number };
    try { data = JSON.parse(message); } catch { return; }

    if (data.type === "drop" && typeof data.col === "number") {
      const symbol = this.players[connection.id];
      if (symbol !== "R" && symbol !== "Y") return;
      if (this.game.winner) return;
      if (symbol !== this.game.turn) return;
      if (data.col < 0 || data.col >= C4_COLS) return;

      const row = dropInColumn(this.game.board, data.col);
      if (row === -1) return; // column full

      this.game.board[data.col + row * C4_COLS] = symbol;
      const result = checkC4Winner(this.game.board);
      this.game.winner = result.winner;
      this.game.winCells = result.winCells;
      this.game.turn = symbol === "R" ? "Y" : "R";
      await this.persist();
      this.broadcastState();
    }

    if (data.type === "restart") {
      this.game = emptyC4State();
      await this.persist();
      this.broadcastState();
    }
  }
}

// ─── Dice (Farkle) ───────────────────────────────────────────────────────────

type DicePlayer = "P1" | "P2";
type DicePhase = "idle" | "must-select" | "post-select" | "gameover";
type DiceEvent = { type: "farkle" | "hotdice" | "win"; player: DicePlayer } | null;

const DEFAULT_DICE_TARGET = 5000;
const VALID_DICE_TARGETS = new Set([500, 1000, 2000, 4000, 5000]);

type DiceState = {
  dice: number[]; // length 6; 0 = not yet rolled this sub-roll
  kept: boolean[]; // length 6, parallel — true once set aside/scored this turn
  phase: DicePhase;
  turn: DicePlayer;
  turnScore: number;
  scores: { P1: number; P2: number };
  winner: DicePlayer | null;
  eventSeq: number;
  lastEvent: DiceEvent;
  target: number;
};

function emptyDiceState(): DiceState {
  return {
    dice: [0, 0, 0, 0, 0, 0],
    kept: [false, false, false, false, false, false],
    phase: "idle",
    turn: "P1",
    turnScore: 0,
    scores: { P1: 0, P2: 0 },
    winner: null,
    eventSeq: 0,
    lastEvent: null,
    target: DEFAULT_DICE_TARGET,
  };
}

function countFaces(values: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const v of values) counts[v]++;
  return counts;
}

function isStraight(values: number[]): boolean {
  if (values.length !== 6) return false;
  const c = countFaces(values);
  for (let f = 1; f <= 6; f++) if (c[f] !== 1) return false;
  return true;
}

function isThreePairs(values: number[]): boolean {
  if (values.length !== 6) return false;
  const c = countFaces(values);
  let pairs = 0;
  for (let f = 1; f <= 6; f++) {
    if (c[f] === 2) pairs++;
    else if (c[f] !== 0) return false;
  }
  return pairs === 3;
}

function kindScore(face: number, count: number): number {
  const base = face === 1 ? 1000 : face * 100;
  if (count === 3) return base;
  if (count === 4) return base * 2;
  if (count === 5) return base * 3;
  if (count === 6) return base * 4;
  return 0;
}

// Score an EXACT set of dice — every die in `values` must contribute to a
// valid scoring group, or the whole selection is invalid (returns 0).
function scoreExact(values: number[]): number {
  if (values.length === 0) return 0;
  if (isStraight(values)) return 1500;
  if (isThreePairs(values)) return 1500;
  const counts = countFaces(values);
  let total = 0;
  for (let f = 1; f <= 6; f++) {
    const c = counts[f];
    if (c === 0) continue;
    if (c >= 3) {
      total += kindScore(f, c);
    } else if (f === 1) {
      total += c * 100;
    } else if (f === 5) {
      total += c * 50;
    } else {
      return 0; // leftover die that can't score on its own — invalid selection
    }
  }
  return total;
}

// Is there ANY non-empty scoring subset within these dice? Used to detect Farkle.
function canScoreAny(values: number[]): boolean {
  if (values.some((v) => v === 1 || v === 5)) return true;
  const counts = countFaces(values);
  for (let f = 1; f <= 6; f++) if (counts[f] >= 3) return true;
  if (values.length === 6 && (isStraight(values) || isThreePairs(values))) return true;
  return false;
}

export class Dice extends Server<Env> {
  game: DiceState = emptyDiceState();
  players: Record<string, DicePlayer | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<DiceState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, DicePlayer | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(): DicePlayer | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("P1")) return "P1";
    if (!taken.has("P2")) return "P2";
    return "spectator";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        dice: this.game.dice,
        kept: this.game.kept,
        phase: this.game.phase,
        turn: this.game.turn,
        turnScore: this.game.turnScore,
        scores: this.game.scores,
        winner: this.game.winner,
        eventSeq: this.game.eventSeq,
        lastEvent: this.game.lastEvent,
        target: this.game.target,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  onConnect(connection: Connection, ctx: { request: Request }) {
    const role = this.players[connection.id] ?? this.assignRole();
    this.players[connection.id] = role;

    // Set the room's win target from the URL the very first time the room is
    // touched (i.e. it's still at default state) — reading it directly off the
    // connect request avoids any race with a follow-up "set-target" message.
    const isFreshRoom =
      this.game.phase === "idle" &&
      this.game.scores.P1 === 0 &&
      this.game.scores.P2 === 0 &&
      this.game.dice.every((d) => d === 0) &&
      this.game.target === DEFAULT_DICE_TARGET;
    if (isFreshRoom) {
      try {
        const url = new URL(ctx.request.url);
        const requested = Number(url.searchParams.get("target"));
        if (VALID_DICE_TARGETS.has(requested)) {
          this.game.target = requested;
        }
      } catch {
        // malformed URL — keep default target
      }
    }

    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; indices?: number[]; target?: number };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "restart") {
      this.game = emptyDiceState();
      await this.persist();
      this.broadcastState();
      return;
    }

    const role = this.players[connection.id];
    if (role !== "P1" && role !== "P2") return; // spectators can't play
    if (this.game.phase === "gameover") return;
    if (role !== this.game.turn) return; // not your turn

    if (data.type === "roll") {
      if (this.game.phase !== "idle" && this.game.phase !== "post-select") return;

      const activeIdx = this.game.kept.map((k, i) => (k ? -1 : i)).filter((i) => i >= 0);
      if (activeIdx.length === 0) return; // shouldn't happen — hot dice resets kept

      const newValues = activeIdx.map(() => 1 + Math.floor(Math.random() * 6));
      const newDice = [...this.game.dice];
      activeIdx.forEach((idx, i) => (newDice[idx] = newValues[i]));
      this.game.dice = newDice;

      if (!canScoreAny(newValues)) {
        // Farkle — lose unbanked points, turn passes immediately, but keep the
        // busted dice visible in state so the client can show what busted
        // before the next roll clears them.
        this.game.turnScore = 0;
        this.game.eventSeq++;
        this.game.lastEvent = { type: "farkle", player: this.game.turn };
        this.game.turn = this.game.turn === "P1" ? "P2" : "P1";
        this.game.kept = [false, false, false, false, false, false];
        // NOTE: dice values are intentionally left as-is (the busted roll) —
        // they get cleared to blank at the start of the next successful roll.
        this.game.phase = "idle";
      } else {
        this.game.phase = "must-select";
      }
      await this.persist();
      this.broadcastState();
    }

    if (data.type === "keep" && Array.isArray(data.indices)) {
      if (this.game.phase !== "must-select") return;
      const indices = [...new Set(data.indices)].filter(
        (i): i is number => Number.isInteger(i) && i >= 0 && i < 6 && !this.game.kept[i]
      );
      if (indices.length === 0 || indices.length !== data.indices.length) return;

      const values = indices.map((i) => this.game.dice[i]);
      const score = scoreExact(values);
      if (score <= 0) return; // invalid selection — reject

      indices.forEach((i) => (this.game.kept[i] = true));
      this.game.turnScore += score;

      const allKept = this.game.kept.every((k) => k);
      if (allKept) {
        // Hot dice — reroll all 6, keep accumulated turn score
        this.game.kept = [false, false, false, false, false, false];
        this.game.dice = [0, 0, 0, 0, 0, 0];
        this.game.phase = "idle";
        this.game.eventSeq++;
        this.game.lastEvent = { type: "hotdice", player: this.game.turn };
      } else {
        this.game.phase = "post-select";
      }
      await this.persist();
      this.broadcastState();
    }

    if (data.type === "bank") {
      if (this.game.phase !== "post-select") return;
      if (this.game.turnScore <= 0) return;

      const newTotal = this.game.scores[this.game.turn] + this.game.turnScore;
      this.game.scores[this.game.turn] = newTotal;
      const wonNow = newTotal >= this.game.target;
      this.game.turnScore = 0;
      this.game.kept = [false, false, false, false, false, false];
      this.game.dice = [0, 0, 0, 0, 0, 0];

      if (wonNow) {
        this.game.winner = this.game.turn;
        this.game.phase = "gameover";
        this.game.eventSeq++;
        this.game.lastEvent = { type: "win", player: this.game.turn };
      } else {
        this.game.turn = this.game.turn === "P1" ? "P2" : "P1";
        this.game.phase = "idle";
      }
      await this.persist();
      this.broadcastState();
    }
  }
}

// ─── Battleship ──────────────────────────────────────────────────────────────

type BSPlayer = "P1" | "P2";
type BSPhase = "placing" | "battle" | "gameover";
type Cell = [number, number]; // [row, col], 0-indexed, 10x10 board

const BOARD_SIZE = 10;
const SHIP_DEFS = [
  { name: "Carrier", size: 5 },
  { name: "Battleship", size: 4 },
  { name: "Cruiser", size: 3 },
  { name: "Submarine", size: 3 },
  { name: "Destroyer", size: 2 },
] as const;

type BSShip = {
  name: string;
  size: number;
  cells: Cell[];
  hits: boolean[]; // parallel to cells — true once that cell has been hit
};

type BSBoard = {
  ships: BSShip[];
  shotsAgainst: { cell: Cell; result: "hit" | "miss" }[]; // shots the OPPONENT has fired at this board
};

type BSLastShot = {
  by: BSPlayer;
  cell: Cell;
  result: "hit" | "miss" | "sunk";
  shipName?: string;
} | null;

type BattleshipState = {
  phase: BSPhase;
  boards: { P1: BSBoard; P2: BSBoard };
  ready: { P1: boolean; P2: boolean };
  turn: BSPlayer;
  winner: BSPlayer | null;
  lastShot: BSLastShot;
  shotSeq: number; // increments on every shot, lets clients detect a genuinely new event
};

function emptyBoard(): BSBoard {
  return { ships: [], shotsAgainst: [] };
}

function emptyBattleshipState(): BattleshipState {
  return {
    phase: "placing",
    boards: { P1: emptyBoard(), P2: emptyBoard() },
    ready: { P1: false, P2: false },
    turn: "P1",
    winner: null,
    lastShot: null,
    shotSeq: 0,
  };
}

function cellsInBounds(cells: Cell[]): boolean {
  return cells.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE);
}

function buildShipCells(size: number, origin: Cell, horizontal: boolean): Cell[] {
  const [r, c] = origin;
  const cells: Cell[] = [];
  for (let i = 0; i < size; i++) {
    cells.push(horizontal ? [r, c + i] : [r + i, c]);
  }
  return cells;
}

function isValidFleet(ships: BSShip[]): boolean {
  // Must have exactly the classic 5 ships, correct sizes, all in bounds, none overlapping.
  if (ships.length !== SHIP_DEFS.length) return false;
  const remaining = [...SHIP_DEFS];
  for (const ship of ships) {
    const defIdx = remaining.findIndex((d) => d.name === ship.name && d.size === ship.size);
    if (defIdx === -1) return false;
    remaining.splice(defIdx, 1);
    if (ship.cells.length !== ship.size) return false;
    if (!cellsInBounds(ship.cells)) return false;
  }
  const allCells = ships.flatMap((s) => s.cells.map(([r, c]) => `${r},${c}`));
  if (new Set(allCells).size !== allCells.length) return false; // no overlaps
  return true;
}

function allShipsSunk(board: BSBoard): boolean {
  return board.ships.every((ship) => ship.hits.every(Boolean));
}

// Strip ship locations from a board — used when sending a player's view of
// their OPPONENT's board. Only hit/miss shot markers are visible; unhit ship
// cells stay hidden. Sunk ships ARE revealed (their full cell list), since a
// fully-sunk ship is common knowledge once it goes down.
function redactBoardForOpponent(board: BSBoard): { ships: BSShip[]; shotsAgainst: BSBoard["shotsAgainst"] } {
  const sunkShips = board.ships.filter((s) => s.hits.every(Boolean));
  return {
    ships: sunkShips,
    shotsAgainst: board.shotsAgainst,
  };
}

export class Battleship extends Server<Env> {
  game: BattleshipState = emptyBattleshipState();
  players: Record<string, BSPlayer | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<BattleshipState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, BSPlayer | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(): BSPlayer | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("P1")) return "P1";
    if (!taken.has("P2")) return "P2";
    return "spectator";
  }

  opponentOf(p: BSPlayer): BSPlayer {
    return p === "P1" ? "P2" : "P1";
  }

  // Unlike the other games, Battleship state is NOT identical for every
  // connection — each player must see their own ships but only redacted
  // (hits/misses + sunk-ship outlines) info about their opponent's board.
  buildStateFor(viewer: BSPlayer | "spectator") {
    const connectedCount = [...this.getConnections()].length;
    if (viewer === "spectator") {
      // Spectators get a fully redacted view of both boards — no ship info at all.
      return {
        type: "state",
        phase: this.game.phase,
        turn: this.game.turn,
        winner: this.game.winner,
        ready: this.game.ready,
        lastShot: this.game.lastShot,
        shotSeq: this.game.shotSeq,
        myBoard: null,
        opponentBoard: null,
        players: this.players,
        connected: connectedCount,
      };
    }
    const opponent = this.opponentOf(viewer);
    return {
      type: "state",
      phase: this.game.phase,
      turn: this.game.turn,
      winner: this.game.winner,
      ready: this.game.ready,
      lastShot: this.game.lastShot,
      shotSeq: this.game.shotSeq,
      myBoard: this.game.boards[viewer], // full detail, including own ship locations
      opponentBoard: redactBoardForOpponent(this.game.boards[opponent]), // redacted
      players: this.players,
      connected: connectedCount,
    };
  }

  broadcastState() {
    for (const connection of this.getConnections()) {
      const role = this.players[connection.id] ?? "spectator";
      connection.send(JSON.stringify(this.buildStateFor(role)));
    }
  }

  onConnect(connection: Connection) {
    const role = this.players[connection.id] ?? this.assignRole();
    this.players[connection.id] = role;
    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: {
      type: string;
      ships?: { name: string; size: number; origin: Cell; horizontal: boolean }[];
      cell?: Cell;
    };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "restart") {
      this.game = emptyBattleshipState();
      await this.persist();
      this.broadcastState();
      return;
    }

    const role = this.players[connection.id];
    if (role !== "P1" && role !== "P2") return; // spectators can't play

    if (data.type === "place-fleet" && Array.isArray(data.ships)) {
      if (this.game.phase !== "placing") return;
      if (this.game.ready[role]) return; // already locked in

      const ships: BSShip[] = data.ships.map((s) => ({
        name: s.name,
        size: s.size,
        cells: buildShipCells(s.size, s.origin, s.horizontal),
        hits: new Array(s.size).fill(false),
      }));

      if (!isValidFleet(ships)) return; // reject malformed/overlapping fleets silently

      this.game.boards[role].ships = ships;
      this.game.ready[role] = true;

      if (this.game.ready.P1 && this.game.ready.P2) {
        this.game.phase = "battle";
      }

      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "fire" && Array.isArray(data.cell)) {
      if (this.game.phase !== "battle") return;
      if (this.game.turn !== role) return;

      const [r, c] = data.cell;
      if (
        !Number.isInteger(r) ||
        !Number.isInteger(c) ||
        r < 0 ||
        r >= BOARD_SIZE ||
        c < 0 ||
        c >= BOARD_SIZE
      )
        return;

      const opponent = this.opponentOf(role);
      const targetBoard = this.game.boards[opponent];

      const alreadyShot = targetBoard.shotsAgainst.some((s) => s.cell[0] === r && s.cell[1] === c);
      if (alreadyShot) return; // no wasted/duplicate shots

      // Find a ship occupying this cell, if any, and mark the specific segment hit.
      let hitShip: BSShip | null = null;
      let hitSegmentIdx = -1;
      for (const ship of targetBoard.ships) {
        const idx = ship.cells.findIndex(([sr, sc]) => sr === r && sc === c);
        if (idx !== -1) {
          hitShip = ship;
          hitSegmentIdx = idx;
          break;
        }
      }

      let result: "hit" | "miss" | "sunk" = "miss";
      if (hitShip) {
        hitShip.hits[hitSegmentIdx] = true;
        result = hitShip.hits.every(Boolean) ? "sunk" : "hit";
      }

      targetBoard.shotsAgainst.push({ cell: [r, c], result: result === "sunk" ? "hit" : result });

      this.game.shotSeq++;
      this.game.lastShot = {
        by: role,
        cell: [r, c],
        result,
        shipName: hitShip ? hitShip.name : undefined,
      };

      if (allShipsSunk(targetBoard)) {
        this.game.phase = "gameover";
        this.game.winner = role;
      } else if (result === "miss") {
        // Turn only passes on a miss — a hit (or sunk) earns another shot.
        this.game.turn = opponent;
      }

      await this.persist();
      this.broadcastState();
      return;
    }
  }
}

// ─── Rock Paper Scissors (Lizard Spock) ────────────────────────────────────

type RPSPlayer = "P1" | "P2";
type RPSVariant = "classic" | "lizard-spock";
type RPSChoice = "rock" | "paper" | "scissors" | "lizard" | "spock";

const RPS_CHOICES: Record<RPSVariant, RPSChoice[]> = {
  classic: ["rock", "paper", "scissors"],
  "lizard-spock": ["rock", "paper", "scissors", "lizard", "spock"],
};

// beats[a] is the set of choices that `a` defeats
const RPS_BEATS: Record<RPSChoice, RPSChoice[]> = {
  rock: ["scissors", "lizard"],
  paper: ["rock", "spock"],
  scissors: ["paper", "lizard"],
  lizard: ["paper", "spock"],
  spock: ["rock", "scissors"],
};

const VALID_ROUND_TARGETS = new Set([3, 5, 10, 15]);
const DEFAULT_ROUND_TARGET = 3;

type RPSRoundResult = {
  choices: { P1: RPSChoice; P2: RPSChoice };
  winner: RPSPlayer | "draw";
} | null;

type RPSState = {
  variant: RPSVariant;
  target: number; // rounds needed to win the match
  phase: "choosing" | "reveal" | "gameover";
  pending: { P1: boolean; P2: boolean }; // true once that player has locked in a choice this round (value itself hidden)
  choices: { P1: RPSChoice | null; P2: RPSChoice | null };
  scores: { P1: number; P2: number };
  lastRound: RPSRoundResult;
  roundSeq: number;
  winner: RPSPlayer | null;
};

function emptyRPSState(): RPSState {
  return {
    variant: "classic",
    target: DEFAULT_ROUND_TARGET,
    phase: "choosing",
    pending: { P1: false, P2: false },
    choices: { P1: null, P2: null },
    scores: { P1: 0, P2: 0 },
    lastRound: null,
    roundSeq: 0,
    winner: null,
  };
}

function resolveRPSRound(a: RPSChoice, b: RPSChoice): "P1" | "P2" | "draw" {
  if (a === b) return "draw";
  if (RPS_BEATS[a].includes(b)) return "P1";
  return "P2";
}

export class RockPaperScissors extends Server<Env> {
  game: RPSState = emptyRPSState();
  players: Record<string, RPSPlayer | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<RPSState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, RPSPlayer | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(): RPSPlayer | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("P1")) return "P1";
    if (!taken.has("P2")) return "P2";
    return "spectator";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        variant: this.game.variant,
        target: this.game.target,
        phase: this.game.phase,
        pending: this.game.pending, // reveals WHO has chosen, never WHAT they chose
        scores: this.game.scores,
        lastRound: this.game.lastRound,
        roundSeq: this.game.roundSeq,
        winner: this.game.winner,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  onConnect(connection: Connection, ctx: { request: Request }) {
    const role = this.players[connection.id] ?? this.assignRole();
    this.players[connection.id] = role;

    // Set variant + round target from the URL the very first time the room is
    // touched — same atomic-on-connect pattern used for Dice's win target.
    const isFreshRoom =
      this.game.phase === "choosing" &&
      this.game.scores.P1 === 0 &&
      this.game.scores.P2 === 0 &&
      this.game.roundSeq === 0 &&
      this.game.target === DEFAULT_ROUND_TARGET &&
      this.game.variant === "classic";
    if (isFreshRoom) {
      try {
        const url = new URL(ctx.request.url);
        const requestedVariant = url.searchParams.get("variant");
        if (requestedVariant === "classic" || requestedVariant === "lizard-spock") {
          this.game.variant = requestedVariant;
        }
        const requestedTarget = Number(url.searchParams.get("target"));
        if (VALID_ROUND_TARGETS.has(requestedTarget)) {
          this.game.target = requestedTarget;
        }
      } catch {
        // malformed URL — keep defaults
      }
    }

    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; choice?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "restart") {
      const keepVariant = this.game.variant;
      const keepTarget = this.game.target;
      this.game = emptyRPSState();
      this.game.variant = keepVariant;
      this.game.target = keepTarget;
      await this.persist();
      this.broadcastState();
      return;
    }

    const role = this.players[connection.id];
    if (role !== "P1" && role !== "P2") return; // spectators can't play

    if (data.type === "choose" && typeof data.choice === "string") {
      if (this.game.phase !== "choosing") return;
      if (this.game.pending[role]) return; // already locked in this round
      const validChoices = RPS_CHOICES[this.game.variant];
      if (!validChoices.includes(data.choice as RPSChoice)) return;

      this.game.choices[role] = data.choice as RPSChoice;
      this.game.pending[role] = true;

      if (this.game.pending.P1 && this.game.pending.P2) {
        // Both locked in — resolve the round immediately.
        const a = this.game.choices.P1 as RPSChoice;
        const b = this.game.choices.P2 as RPSChoice;
        const outcome = resolveRPSRound(a, b);

        if (outcome === "P1") this.game.scores.P1++;
        if (outcome === "P2") this.game.scores.P2++;

        this.game.lastRound = { choices: { P1: a, P2: b }, winner: outcome };
        this.game.roundSeq++;

        if (this.game.scores.P1 >= this.game.target) {
          this.game.phase = "gameover";
          this.game.winner = "P1";
        } else if (this.game.scores.P2 >= this.game.target) {
          this.game.phase = "gameover";
          this.game.winner = "P2";
        } else {
          // Reset for the next round, keeping scores.
          this.game.choices = { P1: null, P2: null };
          this.game.pending = { P1: false, P2: false };
          this.game.phase = "choosing";
        }
      }

      await this.persist();
      this.broadcastState();
      return;
    }
  }
}

// ─── Hand Cricket ────────────────────────────────────────────────────────────

type HCPlayer = "P1" | "P2";
type HCPhase = "toss" | "choosing" | "innings1" | "innings2" | "gameover";

const VALID_WICKETS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const VALID_OVERS = new Set([1, 10, 0]); // 0 represents "unlimited"
const DEFAULT_WICKETS = 3;
const DEFAULT_OVERS = 10;
const BALLS_PER_OVER = 6;

type HCInnings = {
  runs: number;
  wicketsLost: number;
  ballsBowled: number;
  target: number | null; // set only for innings2 — the score to chase
};

function emptyInnings(): HCInnings {
  return { runs: 0, wicketsLost: 0, ballsBowled: 0, target: null };
}

type HCLastBall = {
  batter: HCPlayer;
  batterChoice: number;
  bowlerChoice: number;
  result: "out" | "runs";
  runsScored: number;
} | null;

type HCState = {
  wickets: number; // max wickets per innings
  overs: number; // 0 = unlimited
  phase: HCPhase;
  tossWinner: HCPlayer | null;
  battingFirst: HCPlayer | null;
  currentInnings: 1 | 2;
  currentBatter: HCPlayer | null;
  currentBowler: HCPlayer | null;
  innings1: HCInnings;
  innings2: HCInnings;
  pending: { P1: boolean; P2: boolean };
  choices: { P1: number | null; P2: number | null };
  lastBall: HCLastBall;
  ballSeq: number;
  winner: HCPlayer | "tie" | null;
};

function emptyHCState(): HCState {
  return {
    wickets: DEFAULT_WICKETS,
    overs: DEFAULT_OVERS,
    phase: "toss",
    tossWinner: null,
    battingFirst: null,
    currentInnings: 1,
    currentBatter: null,
    currentBowler: null,
    innings1: emptyInnings(),
    innings2: emptyInnings(),
    pending: { P1: false, P2: false },
    choices: { P1: null, P2: null },
    lastBall: null,
    ballSeq: 0,
    winner: null,
  };
}

export class HandCricket extends Server<Env> {
  game: HCState = emptyHCState();
  players: Record<string, HCPlayer | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<HCState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, HCPlayer | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(): HCPlayer | "spectator" {
    const taken = new Set(Object.values(this.players));
    if (!taken.has("P1")) return "P1";
    if (!taken.has("P2")) return "P2";
    return "spectator";
  }

  opponentOf(p: HCPlayer): HCPlayer {
    return p === "P1" ? "P2" : "P1";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        wickets: this.game.wickets,
        overs: this.game.overs,
        phase: this.game.phase,
        tossWinner: this.game.tossWinner,
        battingFirst: this.game.battingFirst,
        currentInnings: this.game.currentInnings,
        currentBatter: this.game.currentBatter,
        currentBowler: this.game.currentBowler,
        innings1: this.game.innings1,
        innings2: this.game.innings2,
        pending: this.game.pending, // reveals WHO has chosen, never WHAT
        lastBall: this.game.lastBall,
        ballSeq: this.game.ballSeq,
        winner: this.game.winner,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  onConnect(connection: Connection, ctx: { request: Request }) {
    const role = this.players[connection.id] ?? this.assignRole();
    this.players[connection.id] = role;

    // Set wickets/overs from the URL the very first time the room is touched —
    // same atomic-on-connect pattern used for Dice's target and RPS's variant.
    const isFreshRoom =
      this.game.phase === "toss" &&
      this.game.wickets === DEFAULT_WICKETS &&
      this.game.overs === DEFAULT_OVERS &&
      this.game.ballSeq === 0;
    if (isFreshRoom) {
      try {
        const url = new URL(ctx.request.url);
        const requestedWickets = Number(url.searchParams.get("wickets"));
        if (VALID_WICKETS.has(requestedWickets)) {
          this.game.wickets = requestedWickets;
        }
        const requestedOvers = Number(url.searchParams.get("overs"));
        if (VALID_OVERS.has(requestedOvers)) {
          this.game.overs = requestedOvers;
        }
      } catch {
        // malformed URL — keep defaults
      }
    }

    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));
    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  currentInningsState(): HCInnings {
    return this.game.currentInnings === 1 ? this.game.innings1 : this.game.innings2;
  }

  // Ends the current innings (wickets/overs exhausted, or target reached in
  // innings2) and either moves to innings2 or finishes the match.
  endInnings() {
    if (this.game.currentInnings === 1) {
      this.game.innings2.target = this.game.innings1.runs + 1; // must EXCEED, not just match
      this.game.currentInnings = 2;
      this.game.phase = "innings2";
      // Swap roles for the second innings.
      const prevBatter = this.game.currentBatter as HCPlayer;
      const prevBowler = this.game.currentBowler as HCPlayer;
      this.game.currentBatter = prevBowler;
      this.game.currentBowler = prevBatter;
      this.game.pending = { P1: false, P2: false };
      this.game.choices = { P1: null, P2: null };
    } else {
      this.game.phase = "gameover";
      const i1 = this.game.innings1.runs;
      const i2 = this.game.innings2.runs;
      if (i1 === i2) {
        this.game.winner = "tie";
      } else {
        // Whoever batted in innings1 scored i1; whoever batted in innings2 scored i2.
        const innings1Batter = this.game.battingFirst as HCPlayer;
        const innings2Batter = this.opponentOf(innings1Batter);
        this.game.winner = i1 > i2 ? innings1Batter : innings2Batter;
      }
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; choice?: number; decision?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "restart") {
      const keepWickets = this.game.wickets;
      const keepOvers = this.game.overs;
      this.game = emptyHCState();
      this.game.wickets = keepWickets;
      this.game.overs = keepOvers;
      await this.persist();
      this.broadcastState();
      return;
    }

    const role = this.players[connection.id];
    if (role !== "P1" && role !== "P2") return; // spectators can't play

    if (data.type === "start-toss") {
      if (this.game.phase !== "toss") return;
      if (this.game.tossWinner) return; // already tossed
      this.game.tossWinner = Math.random() < 0.5 ? "P1" : "P2";
      this.game.phase = "choosing";
      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "toss-decision" && (data.decision === "bat" || data.decision === "bowl")) {
      if (this.game.phase !== "choosing") return;
      if (role !== this.game.tossWinner) return; // only the toss winner decides

      const winner = this.game.tossWinner as HCPlayer;
      const other = this.opponentOf(winner);
      if (data.decision === "bat") {
        this.game.battingFirst = winner;
        this.game.currentBatter = winner;
        this.game.currentBowler = other;
      } else {
        this.game.battingFirst = other;
        this.game.currentBatter = other;
        this.game.currentBowler = winner;
      }
      this.game.phase = "innings1";
      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "choose-number" && typeof data.choice === "number") {
      if (this.game.phase !== "innings1" && this.game.phase !== "innings2") return;
      if (this.game.pending[role]) return; // already locked in this ball
      if (!Number.isInteger(data.choice) || data.choice < 1 || data.choice > 6) return;

      this.game.choices[role] = data.choice;
      this.game.pending[role] = true;

      if (this.game.pending.P1 && this.game.pending.P2) {
        const batter = this.game.currentBatter as HCPlayer;
        const bowler = this.game.currentBowler as HCPlayer;
        const batterChoice = this.game.choices[batter] as number;
        const bowlerChoice = this.game.choices[bowler] as number;

        const innings = this.currentInningsState();
        const isOut = batterChoice === bowlerChoice;

        if (isOut) {
          innings.wicketsLost++;
          this.game.lastBall = { batter, batterChoice, bowlerChoice, result: "out", runsScored: 0 };
        } else {
          innings.runs += batterChoice;
          this.game.lastBall = { batter, batterChoice, bowlerChoice, result: "runs", runsScored: batterChoice };
        }
        innings.ballsBowled++;
        this.game.ballSeq++;

        // Check innings2 early-win: chasing score has exceeded the target.
        const chaseWon = this.game.currentInnings === 2 && innings.target !== null && innings.runs >= innings.target;

        const wicketsGone = innings.wicketsLost >= this.game.wickets;
        const oversDone = this.game.overs !== 0 && innings.ballsBowled >= this.game.overs * BALLS_PER_OVER;

        this.game.choices = { P1: null, P2: null };
        this.game.pending = { P1: false, P2: false };

        if (chaseWon) {
          this.game.phase = "gameover";
          this.game.winner = batter; // the chasing batter just won it
        } else if (wicketsGone || oversDone) {
          this.endInnings();
        }
        // else: same innings continues, next ball proceeds normally
      }

      await this.persist();
      this.broadcastState();
      return;
    }
  }
}

// ─── Ludo ────────────────────────────────────────────────────────────────────

type LudoColor = "R" | "G" | "Y" | "B";
type LudoPhase = "lobby" | "playing" | "gameover";

const LUDO_COLORS: LudoColor[] = ["R", "G", "Y", "B"];

// Global index (0-51) of each color's entry square on the shared 52-cell track.
const LUDO_START: Record<LudoColor, number> = { R: 0, G: 13, Y: 26, B: 39 };

// The 8 classic "safe" squares — the 4 start squares plus the 4 star squares.
// Tokens resting here can never be captured.
const LUDO_SAFE_GLOBAL = new Set<number>([0, 8, 13, 21, 26, 34, 39, 47]);

// pos: -1 = in yard, 0-50 = on the shared track (51 cells), 51-56 = home column
// (6 cells), 57 = finished ("home").
const LUDO_YARD = -1;
const LUDO_FINISHED = 57;
const LUDO_HOME_COL_START = 51;

type LudoCaptured = { color: LudoColor; tokenIndex: number };

type LudoLastEvent = {
  color: LudoColor;
  dice: number;
  action: "moved" | "no-move" | "voided-six";
  tokenIndex?: number;
  from?: number;
  to?: number;
  captured?: LudoCaptured[];
  finished?: boolean;
  extraTurn: boolean;
} | null;

type LudoState = {
  phase: LudoPhase;
  seats: LudoColor[]; // colors in use, in join order — fixed once assigned
  tokens: Record<LudoColor, number[]>; // 4 token positions per seated color
  turn: LudoColor;
  dice: number | null;
  legalMoves: number[]; // token indices the current player may move right now
  sixStreak: number;
  winner: LudoColor | null;
  lastEvent: LudoLastEvent;
  eventSeq: number;
};

function emptyLudoState(): LudoState {
  return {
    phase: "lobby",
    seats: [],
    tokens: { R: [-1, -1, -1, -1], G: [-1, -1, -1, -1], Y: [-1, -1, -1, -1], B: [-1, -1, -1, -1] },
    turn: "R",
    dice: null,
    legalMoves: [],
    sixStreak: 0,
    winner: null,
    lastEvent: null,
    eventSeq: 0,
  };
}

function ludoGlobalCell(color: LudoColor, pos: number): number {
  return (LUDO_START[color] + pos) % 52;
}

function ludoLegalMoves(tokens: number[], dice: number): number[] {
  const moves: number[] = [];
  tokens.forEach((pos, idx) => {
    if (pos === LUDO_FINISHED) return;
    if (pos === LUDO_YARD) {
      if (dice === 6) moves.push(idx);
      return;
    }
    if (pos + dice <= LUDO_FINISHED) moves.push(idx);
  });
  return moves;
}

export class Ludo extends Server<Env> {
  game: LudoState = emptyLudoState();
  players: Record<string, LudoColor | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<LudoState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, LudoColor | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(connId: string): LudoColor | "spectator" {
    const taken = new Set(Object.values(this.players));
    for (const color of LUDO_COLORS) {
      if (!taken.has(color)) return color;
    }
    return "spectator";
  }

  broadcastState() {
    this.broadcast(
      JSON.stringify({
        type: "state",
        phase: this.game.phase,
        seats: this.game.seats,
        tokens: this.game.tokens,
        turn: this.game.turn,
        dice: this.game.dice,
        legalMoves: this.game.legalMoves,
        winner: this.game.winner,
        lastEvent: this.game.lastEvent,
        eventSeq: this.game.eventSeq,
        players: this.players,
        connected: [...this.getConnections()].length,
      })
    );
  }

  startGame() {
    this.game.phase = "playing";
    this.game.turn = this.game.seats[0];
    this.game.dice = null;
    this.game.legalMoves = [];
    this.game.sixStreak = 0;
    this.game.winner = null;
  }

  advanceTurn() {
    const idx = this.game.seats.indexOf(this.game.turn);
    this.game.turn = this.game.seats[(idx + 1) % this.game.seats.length];
    this.game.sixStreak = 0;
    this.game.dice = null;
    this.game.legalMoves = [];
  }

  onConnect(connection: Connection) {
    let role = this.players[connection.id];
    if (!role) {
      role = this.assignRole(connection.id);
      this.players[connection.id] = role;
      if (role !== "spectator" && !this.game.seats.includes(role)) {
        this.game.seats.push(role);
      }
    }
    connection.send(JSON.stringify({ type: "welcome", connId: connection.id, symbol: role, roomId: this.name }));

    // Auto-start once the room is full.
    if (this.game.phase === "lobby" && this.game.seats.length === 4) {
      this.startGame();
    }

    this.persist();
    this.broadcastState();
  }

  onClose(connection: Connection) {
    delete this.players[connection.id];
    this.persist();
    this.broadcastState();
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let data: { type: string; tokenIndex?: number };
    try { data = JSON.parse(message); } catch { return; }

    const role = this.players[connection.id];

    if (data.type === "start") {
      if (this.game.phase !== "lobby") return;
      if (role === "spectator" || !role) return;
      if (this.game.seats.length < 2) return;
      this.startGame();
      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "roll") {
      if (this.game.phase !== "playing") return;
      if (role !== this.game.turn) return;
      if (this.game.dice !== null) return; // already rolled, awaiting a move

      const value = 1 + Math.floor(Math.random() * 6);

      if (value === 6) this.game.sixStreak++;
      else this.game.sixStreak = 0;

      if (this.game.sixStreak === 3) {
        // Three sixes in a row voids the move and forfeits the turn.
        this.game.lastEvent = { color: role, dice: value, action: "voided-six", extraTurn: false };
        this.game.eventSeq++;
        this.advanceTurn();
        await this.persist();
        this.broadcastState();
        return;
      }

      const legal = ludoLegalMoves(this.game.tokens[role], value);
      if (legal.length === 0) {
        this.game.lastEvent = { color: role, dice: value, action: "no-move", extraTurn: false };
        this.game.eventSeq++;
        this.advanceTurn();
        await this.persist();
        this.broadcastState();
        return;
      }

      this.game.dice = value;
      this.game.legalMoves = legal;
      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "move" && typeof data.tokenIndex === "number") {
      if (this.game.phase !== "playing") return;
      if (role !== this.game.turn) return;
      if (this.game.dice === null) return;
      if (!this.game.legalMoves.includes(data.tokenIndex)) return;

      const dice = this.game.dice;
      const tokens = this.game.tokens[role];
      const from = tokens[data.tokenIndex];
      const to = from === LUDO_YARD ? 0 : from + dice;
      tokens[data.tokenIndex] = to;

      const captured: LudoCaptured[] = [];
      if (to >= 0 && to <= 50) {
        const targetGlobal = ludoGlobalCell(role, to);
        if (!LUDO_SAFE_GLOBAL.has(targetGlobal)) {
          for (const otherColor of this.game.seats) {
            if (otherColor === role) continue;
            this.game.tokens[otherColor].forEach((opos, oidx) => {
              if (opos >= 0 && opos <= 50 && ludoGlobalCell(otherColor, opos) === targetGlobal) {
                this.game.tokens[otherColor][oidx] = LUDO_YARD;
                captured.push({ color: otherColor, tokenIndex: oidx });
              }
            });
          }
        }
      }

      const finished = to === LUDO_FINISHED;
      const won = finished && tokens.every((p) => p === LUDO_FINISHED);
      const extraTurn = dice === 6 || captured.length > 0 || finished;

      this.game.lastEvent = {
        color: role,
        dice,
        action: "moved",
        tokenIndex: data.tokenIndex,
        from,
        to,
        captured,
        finished,
        extraTurn,
      };
      this.game.eventSeq++;
      this.game.dice = null;
      this.game.legalMoves = [];

      if (won) {
        this.game.phase = "gameover";
        this.game.winner = role;
      } else if (extraTurn) {
        // Same player rolls again — sixStreak is already up to date from the roll.
      } else {
        this.advanceTurn();
      }

      await this.persist();
      this.broadcastState();
      return;
    }

    if (data.type === "restart") {
      const seats = this.game.seats;
      this.game = emptyLudoState();
      this.game.seats = seats;
      if (seats.length >= 2) this.startGame();
      await this.persist();
      this.broadcastState();
      return;
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not found — this is the staticgames game server, not the frontend.", { status: 404 })
    );
  },
};
