// Code for dice game 
import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const diceRowEl = document.getElementById("dice-row");
const turnBannerEl = document.getElementById("turn-banner");
const eventBannerEl = document.getElementById("event-banner");
const turnPotValueEl = document.getElementById("turn-pot-value");
const dicePreviewEl = document.getElementById("dice-preview");
const youBadgeEl = document.getElementById("you-badge");
const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const rollBtn = document.getElementById("roll-btn");
const keepBtn = document.getElementById("keep-btn");
const bankBtn = document.getElementById("bank-btn");
const restartBtn = document.getElementById("restart-btn");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");
const score1El = document.getElementById("score-1");
const score2El = document.getElementById("score-2");

// ─── Client-side scoring preview (mirrors the server's authoritative logic —
// this is ONLY used for instant UI feedback; the server validates for real) ───

function countFaces(values) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const v of values) counts[v]++;
  return counts;
}
function isStraight(values) {
  if (values.length !== 6) return false;
  const c = countFaces(values);
  for (let f = 1; f <= 6; f++) if (c[f] !== 1) return false;
  return true;
}
function isThreePairs(values) {
  if (values.length !== 6) return false;
  const c = countFaces(values);
  let pairs = 0;
  for (let f = 1; f <= 6; f++) {
    if (c[f] === 2) pairs++;
    else if (c[f] !== 0) return false;
  }
  return pairs === 3;
}
function kindScore(face, count) {
  const base = face === 1 ? 1000 : face * 100;
  if (count === 3) return base;
  if (count === 4) return base * 2;
  if (count === 5) return base * 3;
  if (count === 6) return base * 4;
  return 0;
}
function scoreExact(values) {
  if (values.length === 0) return 0;
  if (isStraight(values)) return 1500;
  if (isThreePairs(values)) return 1500;
  const counts = countFaces(values);
  let total = 0;
  for (let f = 1; f <= 6; f++) {
    const c = counts[f];
    if (c === 0) continue;
    if (c >= 3) total += kindScore(f, c);
    else if (f === 1) total += c * 100;
    else if (f === 5) total += c * 50;
    else return 0;
  }
  return total;
}

// ─── Dice UI ──────────────────────────────────────────────────────────────

const PIP_POSITIONS = ["tl", "tm", "tr", "ml", "mm", "mr", "bl", "bm", "br"];

for (let i = 0; i < 6; i++) {
  const die = document.createElement("div");
  die.className = "die blank";
  die.dataset.index = String(i);
  PIP_POSITIONS.forEach((pos) => {
    const pip = document.createElement("span");
    pip.className = `pip ${pos}`;
    die.appendChild(pip);
  });
  die.addEventListener("click", () => onDieClick(i));
  diceRowEl.appendChild(die);
}

// Give each die a resting spot right away so idle/blank dice are scattered
// rather than all stacked in the exact center of the tray.
function layoutRestingDice() {
  const trayRect = diceRowEl.getBoundingClientRect();
  if (trayRect.width === 0) return; // not yet laid out (e.g. hidden tab)
  diceRowEl.querySelectorAll(".die").forEach((die, i) => {
    if (die.style.getPropertyValue("--x")) return; // already placed
    const { x, y, rot } = randomPlacement(trayRect.width, trayRect.height, i);
    die.style.setProperty("--x", `${x}px`);
    die.style.setProperty("--y", `${y}px`);
    die.style.setProperty("--rot", `${rot}deg`);
  });
}
requestAnimationFrame(layoutRestingDice);

let mySymbol = null; // "P1" | "P2" | "spectator"
let latest = {
  dice: [0, 0, 0, 0, 0, 0],
  kept: [false, false, false, false, false, false],
  phase: "idle",
  turn: "P1",
  turnScore: 0,
  scores: { P1: 0, P2: 0 },
  winner: null,
  eventSeq: 0,
  lastEvent: null,
  target: 5000,
  connected: 0,
};

let selected = new Set(); // indices currently toggled by the local player, not yet sent
let lastSeenEventSeq = null;
let receivedFirstState = false;
let eventBannerTimeout = null;
let prevDice = [0, 0, 0, 0, 0, 0]; // last-seen dice values, used to detect which dice just rolled
let prevKept = [false, false, false, false, false, false];

// Tray dimensions the dice can be scattered within (die is 44px, tray padding keeps it inboard)
const DIE_SIZE = 44;
const TRAY_PADDING = 8;

function randomPlacement(trayWidth, trayHeight, index) {
  // Divide the tray into 6 loose horizontal lanes so dice don't all overlap in the
  // exact same spot, then jitter within the lane for a natural scattered look.
  const lanes = 6;
  const laneWidth = (trayWidth - DIE_SIZE - TRAY_PADDING * 2) / lanes;
  const laneX = TRAY_PADDING + DIE_SIZE / 2 + index * laneWidth + Math.random() * laneWidth * 0.6;
  const y = TRAY_PADDING + DIE_SIZE / 2 + Math.random() * (trayHeight - DIE_SIZE - TRAY_PADDING * 2);
  const rot = Math.floor(Math.random() * 360) - 180;
  return { x: laneX, y, rot };
}

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "dice",
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
    // Only react to an event if it's genuinely new AND we've already
    // established a baseline — otherwise joining a room mid-game would
    // replay whatever the last historical event was as if it just happened.
    if (receivedFirstState && data.lastEvent && data.eventSeq !== lastSeenEventSeq) {
      showEventBanner(data.lastEvent);
    }
    receivedFirstState = true;
    lastSeenEventSeq = data.eventSeq;

    latest = data;
    selected = new Set(); // server state changed — any local selection is stale
    render();
  }
});

function showEventBanner(evt) {
  clearTimeout(eventBannerTimeout);
  let text = "";
  if (evt.type === "farkle") text = `${evt.player} farkled — turn lost!`;
  else if (evt.type === "hotdice") text = `${evt.player} — hot dice! Roll all 6 again.`;
  else if (evt.type === "win") text = `${evt.player} wins!`;
  eventBannerEl.textContent = text;
  eventBannerEl.className = `event-banner show ${evt.type}`;
  if (evt.type !== "win") {
    eventBannerTimeout = setTimeout(() => {
      eventBannerEl.classList.remove("show");
    }, 2600);
  }
}

function onDieClick(index) {
  if (mySymbol !== latest.turn) return;
  if (latest.phase !== "must-select") return;
  if (latest.kept[index]) return;
  if (selected.has(index)) selected.delete(index);
  else selected.add(index);
  render();
}

rollBtn.addEventListener("click", () => {
  if (mySymbol !== latest.turn) return;
  if (latest.phase !== "idle" && latest.phase !== "post-select") return;
  socket.send(JSON.stringify({ type: "roll" }));
});

keepBtn.addEventListener("click", () => {
  if (mySymbol !== latest.turn) return;
  if (latest.phase !== "must-select") return;
  if (selected.size === 0) return;
  socket.send(JSON.stringify({ type: "keep", indices: [...selected] }));
});

bankBtn.addEventListener("click", () => {
  if (mySymbol !== latest.turn) return;
  if (latest.phase !== "post-select") return;
  if (latest.turnScore <= 0) return;
  socket.send(JSON.stringify({ type: "bank" }));
});

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
  const isMyTurn = mySymbol === latest.turn && latest.phase !== "gameover";

  // dice
  const dieEls = diceRowEl.querySelectorAll(".die");
  const trayRect = diceRowEl.getBoundingClientRect();
  latest.dice.forEach((value, i) => {
    const die = dieEls[i];
    const isBlank = value === 0;
    const isKept = latest.kept[i];
    const isSelectable = isMyTurn && latest.phase === "must-select" && !isKept && !isBlank;

    // A die "just rolled" if its face value changed and it wasn't already kept —
    // kept dice hold their position/value and shouldn't re-tumble.
    const justRolled = !isKept && value !== 0 && value !== prevDice[i];

    if (justRolled) {
      const { x, y, rot } = randomPlacement(trayRect.width, trayRect.height, i);
      die.style.setProperty("--x", `${x}px`);
      die.style.setProperty("--y", `${y}px`);
      die.style.setProperty("--rot", `${rot}deg`);
      die.classList.add("rolling");
      // remove the animation class after it finishes so it can retrigger next roll
      setTimeout(() => die.classList.remove("rolling"), 500);
    }

    die.dataset.value = isBlank ? "" : String(value);
    die.className =
      "die" +
      (isBlank ? " blank" : "") +
      (isKept ? " kept" : "") +
      (isSelectable ? " selectable" : "") +
      (selected.has(i) ? " selected" : "") +
      (justRolled ? " rolling" : "");
  });
  prevDice = [...latest.dice];
  prevKept = [...latest.kept];

  // preview score of current selection
  if (selected.size > 0) {
    const values = [...selected].map((i) => latest.dice[i]);
    const preview = scoreExact(values);
    dicePreviewEl.innerHTML =
      preview > 0 ? `Selected: <b>${preview} pts</b>` : `Selected dice don't form a valid score`;
  } else {
    dicePreviewEl.innerHTML = "&nbsp;";
  }

  // turn pot
  turnPotValueEl.textContent = latest.turnScore;

  // turn banner
  if (latest.phase === "gameover" && latest.winner) {
    turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${latest.winner}</span> reached ${latest.target} — game over`;
  } else if (latest.connected < 2) {
    turnBannerEl.textContent = "Waiting for opponent to join…";
  } else if (!isMyTurn) {
    turnBannerEl.innerHTML = `<span class="sym ${latest.turn}">${latest.turn}</span>'s turn`;
  } else if (latest.phase === "idle") {
    turnBannerEl.textContent = "Your turn — roll the dice";
  } else if (latest.phase === "must-select") {
    turnBannerEl.textContent = "Select dice that score, then Keep";
  } else if (latest.phase === "post-select") {
    turnBannerEl.textContent = "Roll again to push your luck, or bank now";
  }

  // action buttons
  rollBtn.disabled = !isMyTurn || (latest.phase !== "idle" && latest.phase !== "post-select");
  keepBtn.disabled = !isMyTurn || latest.phase !== "must-select" || selected.size === 0;
  bankBtn.disabled = !isMyTurn || latest.phase !== "post-select" || latest.turnScore <= 0;

  // you badge
  if (mySymbol === "spectator") {
    youBadgeEl.innerHTML = `You're <span class="sym spectator">spectating</span> — room already has 2 players`;
  } else if (mySymbol) {
    youBadgeEl.innerHTML = `You're playing as <span class="sym ${mySymbol}">${mySymbol}</span>`;
  } else {
    youBadgeEl.innerHTML = "";
  }

  // scores
  score1El.textContent = latest.scores.P1;
  score2El.textContent = latest.scores.P2;

  // peer meter
  const bars = peerMeter.querySelectorAll(".bar");
  const connectedPlayers = Math.min(latest.connected, 2);
  bars.forEach((bar, i) => bar.classList.toggle("on", i < connectedPlayers));
}

render();
