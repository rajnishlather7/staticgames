import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const boardEl = document.getElementById("board");
const turnBannerEl = document.getElementById("turn-banner");
const youBadgeEl = document.getElementById("you-badge");
const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const restartBtn = document.getElementById("restart-btn");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");

// Build the 9 cells once.
for (let i = 0; i < 9; i++) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.dataset.index = String(i);
  cell.addEventListener("click", () => onCellClick(i));
  boardEl.appendChild(cell);
}

let mySymbol = null; // "X" | "O" | "spectator"
let latest = { board: Array(9).fill(null), turn: "X", winner: null, line: null, players: {}, connected: 0 };

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "tic-tac-toe",
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

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    mySymbol = data.symbol;
    render();
  }
  if (data.type === "state") {
    latest = data;
    render();
  }
});

function onCellClick(index) {
  if (mySymbol !== "X" && mySymbol !== "O") return;
  if (latest.winner) return;
  if (latest.turn !== mySymbol) return;
  if (latest.board[index] !== null) return;
  socket.send(JSON.stringify({ type: "move", index }));
}

restartBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "restart" }));
});

copyBtn.addEventListener("click", async () => {
  const url = `${window.location.origin}${window.location.pathname}?room=${room}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard API may be unavailable (e.g. non-https local file); fall back silently
  }
  copyToast.classList.add("show");
  setTimeout(() => copyToast.classList.remove("show"), 1400);
});

function render() {
  // board cells
  const cells = boardEl.querySelectorAll(".cell");
  latest.board.forEach((val, i) => {
    const cell = cells[i];
    cell.textContent = val || "";
    cell.className = "cell" + (val ? ` filled ${val}` : "");
    if (latest.line && latest.line.includes(i)) cell.classList.add("win");
    const myTurn = mySymbol === latest.turn && !latest.winner;
    if (!myTurn || val) cell.classList.add("disabled");
  });

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

render();
