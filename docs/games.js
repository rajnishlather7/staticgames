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
    path: "games/connect4.html",
    enabled: true,
  },
  {
    id: "battleship",
    name: "Battleship",
    tagline: "Hide your fleet, hunt theirs down. Sink all ships to win.",
    players: "2 players",
    path: "games/battleship.html",
    enabled: true,
  },
  {
    id: "dice",
    name: "Dice",
    tagline: "Play the game of chance using 6 dice to score the most points or go bust trying.",
    players: "2 players",
    path: "games/dice.html",
    enabled: true,
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
