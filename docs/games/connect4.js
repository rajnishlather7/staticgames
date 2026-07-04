// Basic game of connect 4

import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const boardEl = document.getElementById("board");
const dropRowEl = document.getElementById("drop-row");
const turnBannerEl = document.getElementById("turn-banner");
const youBadgeEl = document.getElementById("you-badge");
const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const restartBtn = document.getElementById("restart-btn");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");

// Scores
let scores = { R: 0, Y: 0, draws: 0 };
try {
  const saved = localStorage.getItem("connect4-scores");
  if (saved) scores = JSON.parse(saved);
} catch (e) { }

const score1El = document.getElementById("score-1");
const score2El = document.getElementById("score-2");
const scoreDrawsEl = document.getElementById("score-draws");
const scoreResetBtn = document.getElementById("score-reset-btn");

function updateScoreDisplay() {
  score1El.textContent = scores.R;
  score2El.textContent = scores.Y;
  scoreDrawsEl.textContent = scores.draws;
}

function saveScores() {
  localStorage.setItem("connect4-scores", JSON.stringify(scores));
  updateScoreDisplay();
}

scoreResetBtn.addEventListener("click", () => {
  scores = { R: 0, Y: 0, draws: 0 };
  saveScores();
});

updateScoreDisplay();

const C4_COLS = 7;
const C4_ROWS = 6;

// Build the 7 drop buttons
for (let c = 0; c < C4_COLS; c++) {
  const btn = document.createElement("button");
  btn.className = "c4-drop-btn";
  btn.addEventListener("click", () => onDropClick(c));
  dropRowEl.appendChild(btn);
}

// Build the 42 cells (7 cols x 6 rows). The array is indexed as col + row * C4_COLS
// So visually we build row by row (0 to 5), then col by col (0 to 6)
for (let r = 0; r < C4_ROWS; r++) {
  for (let c = 0; c < C4_COLS; c++) {
    const cell = document.createElement("div");
    cell.className = "c4-cell";
    cell.dataset.index = String(c + r * C4_COLS);
    boardEl.appendChild(cell);
  }
}

let mySymbol = null; // "R" | "Y" | "spectator"
let latest = { board: Array(C4_COLS * C4_ROWS).fill(null), turn: "R", winner: null, winCells: null, players: {}, connected: 0 };

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "Connect-four",
  room,
});

socket.addEventListener("open", () => {
  connChip.classList.add("live");
  connLabel.textContent = "CONNECTED";
});

socket.addEventListener("close", () => {
  connChip.classList.remove("live");
  connLabel.textContent = "DISCONNECTED";
});

// To track state transitions and detect exactly when a game is won
let lastWinner = null;
let receivedFirstState = false;

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    mySymbol = data.symbol;
    render();
  }
  if (data.type === "state") {
    latest = data;

    // Check if we just transitioned to a win state (skip the very first
    // state message — a rejoined/refreshed room may already have a
    // finished game persisted, and that's not a "new" win)
    if (receivedFirstState && latest.winner && lastWinner === null) {
      if (latest.winner === "R") scores.R++;
      else if (latest.winner === "Y") scores.Y++;
      else if (latest.winner === "draw") scores.draws++;
      saveScores();
    }
    receivedFirstState = true;
    lastWinner = latest.winner;

    render();
  }
});

function onDropClick(col) {
  if (mySymbol !== "R" && mySymbol !== "Y") return;
  if (latest.winner) return;
  if (latest.turn !== mySymbol) return;

  socket.send(JSON.stringify({ type: "drop", col }));
}

restartBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "restart" }));
});

copyBtn.addEventListener("click", async () => {
  const url = `${window.location.origin}${window.location.pathname}?room=${room}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard API may be unavailable
  }
  copyToast.classList.add("show");
  setTimeout(() => copyToast.classList.remove("show"), 1400);
});

function render() {
  // Update board cells
  const cells = boardEl.querySelectorAll(".c4-cell");
  latest.board.forEach((val, i) => {
    // The visual order in DOM matches our nested loop (row by row)
    // Find the right DOM element:
    const c = i % C4_COLS;
    const r = Math.floor(i / C4_COLS);
    const cellIdx = r * C4_COLS + c;
    const cell = cells[cellIdx];

    cell.className = "c4-cell" + (val ? ` ${val}` : "");
    if (latest.winCells && latest.winCells.includes(i)) {
      cell.classList.add("win");
    }
  });

  // Update drop buttons
  const btns = dropRowEl.querySelectorAll(".c4-drop-btn");
  for (let c = 0; c < C4_COLS; c++) {
    // Column is full if the top cell (row 0) is occupied
    const isFull = latest.board[c] !== null;
    const myTurn = mySymbol === latest.turn && !latest.winner;
    btns[c].disabled = isFull || !myTurn;
  }

  // turn / result banner
  if (latest.winner === "draw") {
    turnBannerEl.innerHTML = `It's a draw.`;
  } else if (latest.winner) {
    turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${latest.winner}</span> wins.`;
  } else if (latest.connected < 2) {
    turnBannerEl.textContent = "Waiting for opponent to join…";
  } else {
    turnBannerEl.innerHTML = `<span class="sym ${latest.turn}">${latest.turn}</span>'s turn`;
  }

  // you badge
  if (mySymbol === "spectator") {
    youBadgeEl.innerHTML = `You're <span class="sym spectator">spectating</span> — room already has 2 players`;
  } else if (mySymbol) {
    youBadgeEl.innerHTML = `You're playing as <span class="sym ${mySymbol}">${mySymbol}</span>`;
  } else {
    youBadgeEl.innerHTML = "";
  }

  // peer meter
  const bars = peerMeter.querySelectorAll(".bar");
  const connectedPlayers = Math.min(latest.connected, 2);
  bars.forEach((bar, i) => bar.classList.toggle("on", i < connectedPlayers));
}
