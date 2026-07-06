// Ludo — 2 to 4 players race 4 tokens each around the board and home.

import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const boardEl = document.getElementById("ludo-board");
const seatsEl = document.getElementById("ludo-seats");
const turnBannerEl = document.getElementById("turn-banner");
const eventBannerEl = document.getElementById("event-banner");
const diceEl = document.getElementById("ludo-dice");
const rollBtn = document.getElementById("roll-btn");
const startBtn = document.getElementById("start-btn");
const youBadgeEl = document.getElementById("you-badge");
const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const restartBtn = document.getElementById("restart-btn");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");

const COLORS = ["R", "G", "Y", "B"];
const COLOR_NAME = { R: "Red", G: "Green", Y: "Yellow", B: "Blue" };
const PIP_POSITIONS = ["tl", "tm", "tr", "ml", "mm", "mr", "bl", "bm", "br"];
diceEl.classList.add("die", "ludo-die", "blank");
PIP_POSITIONS.forEach((pos) => {
  const pip = document.createElement("span");
  pip.className = `pip ${pos}`;
  diceEl.appendChild(pip);
});

// The 52-cell shared track, expressed as [row, col] on a 15x15 grid.
const PATH = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6],
  [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10],
  [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10],
  [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6], [13, 6],
  [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

const START_INDEX = { R: 0, G: 13, Y: 26, B: 39 };
const SAFE_GLOBAL = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const HOME_COLUMN = {
  R: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  G: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  Y: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  B: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
};

const YARD_BOUNDS = {
  R: [0, 5, 0, 5],
  G: [0, 5, 9, 14],
  Y: [9, 14, 9, 14],
  B: [9, 14, 0, 5],
};

const YARD_SLOTS = {
  R: [[1, 1], [1, 4], [4, 1], [4, 4]],
  G: [[1, 10], [1, 13], [4, 10], [4, 13]],
  Y: [[10, 10], [10, 13], [13, 10], [13, 13]],
  B: [[10, 1], [10, 4], [13, 1], [13, 4]],
};

function place(el, row, col, spanRows = 1, spanCols = 1) {
  el.style.gridRow = `${row + 1} / span ${spanRows}`;
  el.style.gridColumn = `${col + 1} / span ${spanCols}`;
}

function cellForToken(color, pos) {
  if (pos === -1) return null; // yard — handled separately via slot index
  if (pos <= 50) {
    const [r, c] = PATH[(START_INDEX[color] + pos) % 52];
    return { r, c };
  }
  if (pos <= 56) {
    const [r, c] = HOME_COLUMN[color][pos - 51];
    return { r, c };
  }
  return null; // finished — shown in the seat tray, not on the board
}

// --- build the static board structure once ---

for (const color of COLORS) {
  const [r0, r1, c0, c1] = YARD_BOUNDS[color];
  const yard = document.createElement("div");
  yard.className = `ludo-yard ${color}`;
  place(yard, r0, c0, r1 - r0 + 1, c1 - c0 + 1);
  boardEl.appendChild(yard);

  const box = document.createElement("div");
  box.className = "ludo-yard-box";
  place(box, r0 + 1, c0 + 1, r1 - r0 - 1, c1 - c0 - 1);
  boardEl.appendChild(box);
}

const hub = document.createElement("div");
hub.className = "ludo-hub";
place(hub, 6, 6, 3, 3);
boardEl.appendChild(hub);

PATH.forEach(([r, c], i) => {
  const cell = document.createElement("div");
  cell.className = "ludo-path-cell";
  if (SAFE_GLOBAL.has(i)) cell.classList.add("safe");
  for (const color of COLORS) {
    if (START_INDEX[color] === i) cell.classList.add("start", color);
  }
  place(cell, r, c);
  boardEl.appendChild(cell);
});

for (const color of COLORS) {
  HOME_COLUMN[color].forEach(([r, c]) => {
    const cell = document.createElement("div");
    cell.className = `ludo-home-cell ${color}`;
    place(cell, r, c);
    boardEl.appendChild(cell);
  });
}

const seatEls = {}; // "R".."B" -> { chip, dot, label, homeCount }

COLORS.forEach((color) => {
  const chip = document.createElement("div");
  chip.className = "ludo-seat";
  chip.innerHTML = `<span class="dot"></span><div class="seat-label"></div><span class="home-count"></span>`;
  seatsEl.appendChild(chip);
  seatEls[color] = {
    chip,
    label: chip.querySelector(".seat-label"),
    homeCount: chip.querySelector(".home-count"),
  };
});

const tokenEls = {}; // "R0".."B3" -> element, created lazily and repositioned

function tokenEl(color, idx) {
  const key = color + idx;
  if (!tokenEls[key]) {
    const el = document.createElement("div");
    el.className = `ludo-token ${color}`;
    el.addEventListener("click", () => onTokenClick(color, idx));
    boardEl.appendChild(el);
    tokenEls[key] = el;
  }
  return tokenEls[key];
}

// --- state + socket ---

let mySymbol = null; // "R" | "G" | "Y" | "B" | "spectator"
let latest = {
  phase: "lobby",
  seats: [],
  tokens: { R: [-1, -1, -1, -1], G: [-1, -1, -1, -1], Y: [-1, -1, -1, -1], B: [-1, -1, -1, -1] },
  turn: "R",
  dice: null,
  legalMoves: [],
  winner: null,
  lastEvent: null,
  eventSeq: 0,
  players: {},
  connected: 0,
};

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "ludo",
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

let lastSeenEventSeq = -1;
let eventBannerTimeout = null;
let lastSeenDice = null;

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    mySymbol = data.symbol;
    render();
  }
  if (data.type === "state") {
    latest = data;
    if (latest.lastEvent && latest.eventSeq !== lastSeenEventSeq) {
      showEventBanner(latest.lastEvent);
    }
    lastSeenEventSeq = latest.eventSeq;
    render();
  }
});

function showEventBanner(ev) {
  clearTimeout(eventBannerTimeout);
  const name = COLOR_NAME[ev.color];
  let text;
  if (ev.action === "voided-six") {
    text = `${name} rolled three 6s in a row — turn passes.`;
  } else if (ev.action === "no-move") {
    text = `${name} rolled a ${ev.dice} — no legal moves, turn passes.`;
  } else {
    text = `${name} rolled a ${ev.dice}`;
    if (ev.finished) text += " and got a token home!";
    else if (ev.captured && ev.captured.length) {
      text += ev.captured.length > 1 ? ` and captured ${ev.captured.length} tokens!` : " and captured a token!";
    } else {
      text += " and moved a token.";
    }
    if (ev.extraTurn) text += " Extra turn!";
  }
  eventBannerEl.textContent = text;
  eventBannerEl.className = `event-banner show ${ev.color}`;
  eventBannerTimeout = setTimeout(() => eventBannerEl.classList.remove("show"), 3200);
}

function onTokenClick(color, idx) {
  if (mySymbol !== latest.turn) return;
  if (color !== mySymbol) return;
  if (latest.dice === null) return;
  if (!latest.legalMoves.includes(idx)) return;
  socket.send(JSON.stringify({ type: "move", tokenIndex: idx }));
}

rollBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "roll" }));
});

startBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "start" }));
});

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
  // seats row — update existing chips in place, never rebuild them
  COLORS.forEach((color) => {
    const seated = latest.seats.includes(color);
    const { chip, label, homeCount } = seatEls[color];
    chip.className =
      "ludo-seat" +
      (seated ? ` filled ${color}` : "") +
      (latest.turn === color && latest.phase === "playing" ? " active" : "");
    label.textContent = seated ? COLOR_NAME[color] : "open";
    if (seated) {
      const finishedCount = latest.tokens[color].filter((p) => p === 57).length;
      homeCount.textContent = `🏠 ${finishedCount}/4`;
      homeCount.style.display = "";
    } else {
      homeCount.style.display = "none";
    }
  });

  // tokens
  COLORS.forEach((color) => {
    const seated = latest.seats.includes(color);
    latest.tokens[color].forEach((pos, idx) => {
      const el = tokenEl(color, idx);
      if (!seated || pos === 57) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      if (pos === -1) {
        const [r, c] = YARD_SLOTS[color][idx];
        place(el, r, c);
      } else {
        const cell = cellForToken(color, pos);
        place(el, cell.r, cell.c);
      }
      const movable =
        latest.phase === "playing" &&
        mySymbol === latest.turn &&
        color === mySymbol &&
        latest.dice !== null &&
        latest.legalMoves.includes(idx);
      el.classList.toggle("movable", movable);
    });
  });

  // dice
  if (latest.dice) {
    diceEl.classList.remove("blank");
    diceEl.dataset.value = String(latest.dice);
    if (latest.dice !== lastSeenDice) {
      diceEl.classList.remove("rolling");
      void diceEl.offsetWidth; // restart animation
      diceEl.classList.add("rolling");
    }
  } else {
    diceEl.classList.add("blank");
    delete diceEl.dataset.value;
  }
  lastSeenDice = latest.dice;

  // roll button
  const canRoll = latest.phase === "playing" && mySymbol === latest.turn && latest.dice === null;
  rollBtn.disabled = !canRoll;
  rollBtn.textContent = latest.phase === "playing" && mySymbol === latest.turn && latest.dice !== null ? "Pick a token above" : "Roll dice";

  // start button
  const canStart = latest.phase === "lobby" && mySymbol && mySymbol !== "spectator" && latest.seats.length >= 2;
  startBtn.style.display = canStart ? "block" : "none";

  // turn / status banner
  if (latest.phase === "lobby") {
    turnBannerEl.textContent = `Waiting for players… (${latest.seats.length}/4 joined, need at least 2)`;
  } else if (latest.phase === "gameover") {
    turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${COLOR_NAME[latest.winner]}</span> wins!`;
  } else {
    turnBannerEl.innerHTML = `<span class="sym ${latest.turn}">${COLOR_NAME[latest.turn]}</span>'s turn`;
  }

  // you badge
  if (mySymbol === "spectator") {
    youBadgeEl.innerHTML = `You're <span class="sym spectator">spectating</span> — room already has 4 players`;
  } else if (mySymbol) {
    youBadgeEl.innerHTML = `You're playing as <span class="sym ${mySymbol}">${COLOR_NAME[mySymbol]}</span>`;
  } else {
    youBadgeEl.innerHTML = "";
  }

  // peer meter
  const bars = peerMeter.querySelectorAll(".bar");
  const connectedSeats = Math.min(latest.seats.length, 4);
  bars.forEach((bar, i) => bar.classList.toggle("on", i < connectedSeats));
}

render();
