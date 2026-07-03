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

// ─── Fetch Router ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not found — this is the staticgames game server, not the frontend.", { status: 404 })
    );
  },
};
