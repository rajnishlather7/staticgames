// Central list of games. To add a new game later:
// 1. Build public/games/<id>.html + public/games/<id>.js (copy the tictactoe ones as a starting point)
// 2. Add the server-side room logic in party/server.ts
// 3. Add an entry here with enabled: true
export const GAMES = [
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    tagline: "Classic 3x3 grid. First to a line wins.",
    players: "2 players",
    path: "games/tictactoe.html",
    enabled: true,
  },
  {
    id: "connect4",
    name: "Connect Four",
    tagline: "Drop discs, connect four in a row.",
    players: "2 players",
    path: null,
    enabled: false,
  },
  {
    id: "dots",
    name: "Dots & Boxes",
    tagline: "Claim boxes, block your opponent.",
    players: "2 players",
    path: null,
    enabled: false,
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
