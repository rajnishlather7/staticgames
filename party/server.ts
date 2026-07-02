import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";

type Symbol = "X" | "O";
type Board = (Symbol | null)[];

type GameState = {
  board: Board;
  turn: Symbol;
  winner: Symbol | "draw" | null;
  line: number[] | null;
};

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],           // diagonals
];

function emptyState(): GameState {
  return { board: Array(9).fill(null), turn: "X", winner: null, line: null };
}

function checkWinner(board: Board): { winner: Symbol | "draw" | null; line: number[] | null } {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { winner: "draw", line: null };
  }
  return { winner: null, line: null };
}

type Env = {
  TicTacToe: DurableObjectNamespace<TicTacToe>;
};

export class TicTacToe extends Server<Env> {
  game: GameState = emptyState();
  // connection id -> "X" | "O" | "spectator"
  players: Record<string, Symbol | "spectator"> = {};

  async onStart() {
    const saved = await this.ctx.storage.get<GameState>("game");
    if (saved) this.game = saved;
    const savedPlayers = await this.ctx.storage.get<Record<string, Symbol | "spectator">>("players");
    if (savedPlayers) this.players = savedPlayers;
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
    await this.ctx.storage.put("players", this.players);
  }

  assignRole(connId: string): Symbol | "spectator" {
    const takenSymbols = new Set(Object.values(this.players));
    if (!takenSymbols.has("X")) return "X";
    if (!takenSymbols.has("O")) return "O";
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

    connection.send(
      JSON.stringify({
        type: "welcome",
        connId: connection.id,
        symbol: role,
        roomId: this.name,
      })
    );

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
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "move" && typeof data.index === "number") {
      const symbol = this.players[connection.id];
      if (symbol !== "X" && symbol !== "O") return; // spectators can't move
      if (this.game.winner) return; // game over
      if (symbol !== this.game.turn) return; // not your turn
      if (this.game.board[data.index] !== null) return; // occupied

      this.game.board[data.index] = symbol;
      const result = checkWinner(this.game.board);
      this.game.winner = result.winner;
      this.game.line = result.line;
      this.game.turn = symbol === "X" ? "O" : "X";

      await this.persist();
      this.broadcastState();
    }

    if (data.type === "restart") {
      this.game = emptyState();
      await this.persist();
      this.broadcastState();
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
