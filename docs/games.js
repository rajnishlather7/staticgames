// Central list of games. To add a new game later:
// 1. Build docs/games/<id>/<id>.html + <id>.js + <id>.css (copy the tictactoe folder as a starting point)
// 2. Add the server-side room logic in party/server.ts
// 3. Add an entry here with enabled: true
export const GAMES = [
  {
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    tagline: "Classic 3x3 grid. First to a line wins.",
    players: "2 players",
    path: "games/tictactoe/tictactoe.html",
    enabled: true,
  },
  {
    id: "connect4",
    name: "Connect Four",
    tagline: "Drop discs, connect four in a row.",
    players: "2 players",
    path: "games/connect4/connect4.html",
    enabled: true,
  },
  {
    id: "battleship",
    name: "Battleship",
    tagline: "Hide your fleet, hunt theirs down. Sink all ships to win.",
    players: "2 players",
    path: "games/battleship/battleship.html",
    enabled: true,
  },
  {
    id: "dice",
    name: "Dice",
    tagline: "Play the game of chance using 6 dice to score the most points or go bust trying.",
    players: "2 players",
    path: "games/dice/dice.html",
    enabled: true,
  },
  {
    id: "rps",
    name: "Rock Paper Scissors",
    tagline: "Classic or Lizard-Spock. Best of N, simultaneous reveal.",
    players: "2 players",
    path: "games/rps/rps.html",
    enabled: true,
  },
  {
    id: "handcricket",
    name: "Hand Cricket",
    tagline: "Toss, pick bat or bowl, throw 1-6. Match numbers and you're out.",
    players: "2 players",
    path: "games/handcricket/handcricket.html",
    enabled: true,
  },
  {
    id: "ludo",
    name: "Ludo",
    tagline: "Roll, race your 4 tokens home, and send opponents back to base.",
    players: "2-4 players",
    path: "games/ludo/ludo.html",
    enabled: true,
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
