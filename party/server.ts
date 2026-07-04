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

    if (data.type === "set-target" && typeof data.target === "number") {
      const requested = data.target;
      // Only honor this before the game has actually started (no rolls, no
      // banked score) so a reconnecting/duplicate message can't rewrite the
      // win condition mid-game.
      const gameNotStarted =
        this.game.phase === "idle" &&
        this.game.scores.P1 === 0 &&
        this.game.scores.P2 === 0 &&
        this.game.dice.every((d) => d === 0);
      if (gameNotStarted && VALID_DICE_TARGETS.has(requested)) {
        this.game.target = requested;
        await this.persist();
        this.broadcastState();
      }
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
        // Farkle — lose unbanked points, turn passes immediately
        this.game.turnScore = 0;
        this.game.eventSeq++;
        this.game.lastEvent = { type: "farkle", player: this.game.turn };
        this.game.turn = this.game.turn === "P1" ? "P2" : "P1";
        this.game.kept = [false, false, false, false, false, false];
        this.game.dice = [0, 0, 0, 0, 0, 0];
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

// ─── Fetch Router ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not found — this is the staticgames game server, not the frontend.", { status: 404 })
    );
  },
};
