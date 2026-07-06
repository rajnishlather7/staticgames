import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const BOARD_SIZE = 10;
const SHIP_DEFS = [
  { name: "Carrier", size: 5 },
  { name: "Battleship", size: 4 },
  { name: "Cruiser", size: 3 },
  { name: "Submarine", size: 3 },
  { name: "Destroyer", size: 2 },
];

const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const turnBannerEl = document.getElementById("turn-banner");
const eventBannerEl = document.getElementById("event-banner");
const youBadgeEl = document.getElementById("you-badge");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");
const restartBtn = document.getElementById("restart-btn");

const placementSection = document.getElementById("placement-section");
const battleSection = document.getElementById("battle-section");
const fleetListEl = document.getElementById("fleet-list");
const placementBoardEl = document.getElementById("placement-board");
const rotateBtn = document.getElementById("rotate-btn");
const randomizeBtn = document.getElementById("randomize-btn");
const confirmFleetBtn = document.getElementById("confirm-fleet-btn");

const myBoardEl = document.getElementById("my-board");
const enemyBoardEl = document.getElementById("enemy-board");

let mySymbol = null; // "P1" | "P2" | "spectator"
let latest = {
  phase: "placing",
  turn: "P1",
  winner: null,
  ready: { P1: false, P2: false },
  lastShot: null,
  shotSeq: 0,
  myBoard: null,
  opponentBoard: null,
  connected: 0,
};
let lastSeenShotSeq = null;
let receivedFirstState = false;
let eventBannerTimeout = null;

// ─── Placement state (local only, until confirmed) ─────────────────────────
let horizontal = true;
let selectedShipIdx = null; // index into SHIP_DEFS of the ship currently being placed
let placedShips = []; // { name, size, origin: [r,c], horizontal, cells: [[r,c],...] }
let hoverCell = null;

function buildCells(size, origin, isHorizontal) {
  const [r, c] = origin;
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(isHorizontal ? [r, c + i] : [r + i, c]);
  }
  return cells;
}

function cellsInBounds(cells) {
  return cells.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE);
}

function cellsOverlapPlaced(cells) {
  const occupied = new Set(placedShips.flatMap((s) => s.cells.map(([r, c]) => `${r},${c}`)));
  return cells.some(([r, c]) => occupied.has(`${r},${c}`));
}

function nextUnplacedShipIdx() {
  return SHIP_DEFS.findIndex((def) => !placedShips.some((s) => s.name === def.name));
}

// ─── Build the 10x10 grid DOM once per board (cells are reused/updated) ────
function buildEmptyGrid(container) {
  container.innerHTML = "";
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "bs-cell";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      container.appendChild(cell);
    }
  }
}

buildEmptyGrid(placementBoardEl);
buildEmptyGrid(myBoardEl);
buildEmptyGrid(enemyBoardEl);

function renderFleetList() {
  fleetListEl.innerHTML = "";
  SHIP_DEFS.forEach((def, idx) => {
    const isPlaced = placedShips.some((s) => s.name === def.name);
    const chip = document.createElement("div");
    chip.className =
      "bs-ship-chip" + (isPlaced ? " placed" : "") + (selectedShipIdx === idx ? " selected" : "");
    chip.innerHTML = `<span>${def.name}</span><span class="ship-size">${def.size}</span>`;
    if (!isPlaced) {
      chip.addEventListener("click", () => {
        selectedShipIdx = idx;
        renderFleetList();
        renderPlacementBoard();
      });
    }
    fleetListEl.appendChild(chip);
  });
}

function renderPlacementBoard() {
  const cells = placementBoardEl.querySelectorAll(".bs-cell");
  cells.forEach((cell) => {
    cell.className = "bs-cell";
  });

  // paint already-placed ships
  placedShips.forEach((ship) => {
    ship.cells.forEach(([r, c]) => {
      const cell = placementBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.add("ship-occupied");
    });
  });

  // hover preview for the currently selected, not-yet-placed ship
  if (selectedShipIdx !== null && hoverCell) {
    const def = SHIP_DEFS[selectedShipIdx];
    const previewCells = buildCells(def.size, hoverCell, horizontal);
    const valid = cellsInBounds(previewCells) && !cellsOverlapPlaced(previewCells);
    previewCells.forEach(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      const cell = placementBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.add(valid ? "placement-preview-ok" : "placement-preview-bad");
    });
  }

  confirmFleetBtn.disabled = placedShips.length !== SHIP_DEFS.length;
}

placementBoardEl.addEventListener("mousemove", (e) => {
  const cellEl = e.target.closest(".bs-cell");
  if (!cellEl) return;
  hoverCell = [Number(cellEl.dataset.row), Number(cellEl.dataset.col)];
  renderPlacementBoard();
});

placementBoardEl.addEventListener("mouseleave", () => {
  hoverCell = null;
  renderPlacementBoard();
});

placementBoardEl.addEventListener("click", (e) => {
  const cellEl = e.target.closest(".bs-cell");
  if (!cellEl) return;
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);

  // clicking an already-placed ship removes it
  const existingIdx = placedShips.findIndex((s) => s.cells.some(([r, c]) => r === row && c === col));
  if (existingIdx !== -1) {
    placedShips.splice(existingIdx, 1);
    renderFleetList();
    renderPlacementBoard();
    return;
  }

  if (selectedShipIdx === null) return;
  const def = SHIP_DEFS[selectedShipIdx];
  const cells = buildCells(def.size, [row, col], horizontal);
  if (!cellsInBounds(cells) || cellsOverlapPlaced(cells)) return;

  placedShips.push({ name: def.name, size: def.size, origin: [row, col], horizontal, cells });
  selectedShipIdx = nextUnplacedShipIdx();
  if (selectedShipIdx === -1) selectedShipIdx = null;
  renderFleetList();
  renderPlacementBoard();
});

rotateBtn.addEventListener("click", () => {
  horizontal = !horizontal;
  renderPlacementBoard();
});

randomizeBtn.addEventListener("click", () => {
  placedShips = [];
  for (const def of SHIP_DEFS) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 300) {
      attempts++;
      const isHorizontal = Math.random() < 0.5;
      const maxRow = isHorizontal ? BOARD_SIZE - 1 : BOARD_SIZE - def.size;
      const maxCol = isHorizontal ? BOARD_SIZE - def.size : BOARD_SIZE - 1;
      const origin = [Math.floor(Math.random() * (maxRow + 1)), Math.floor(Math.random() * (maxCol + 1))];
      const cells = buildCells(def.size, origin, isHorizontal);
      if (cellsInBounds(cells) && !cellsOverlapPlaced(cells)) {
        placedShips.push({ name: def.name, size: def.size, origin, horizontal: isHorizontal, cells });
        placed = true;
      }
    }
  }
  selectedShipIdx = nextUnplacedShipIdx();
  if (selectedShipIdx === -1) selectedShipIdx = null;
  renderFleetList();
  renderPlacementBoard();
});

confirmFleetBtn.addEventListener("click", () => {
  if (placedShips.length !== SHIP_DEFS.length) return;
  socket.send(
    JSON.stringify({
      type: "place-fleet",
      ships: placedShips.map((s) => ({
        name: s.name,
        size: s.size,
        origin: s.origin,
        horizontal: s.horizontal,
      })),
    })
  );
  confirmFleetBtn.disabled = true;
  confirmFleetBtn.textContent = "Waiting for opponent…";
});

selectedShipIdx = 0; // pre-select the first ship so the player can start placing immediately
renderFleetList();
renderPlacementBoard();

// ─── Networking ─────────────────────────────────────────────────────────────

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "battleship",
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
    if (receivedFirstState && data.lastShot && data.shotSeq !== lastSeenShotSeq) {
      showEventBanner(data.lastShot);
    }
    receivedFirstState = true;
    lastSeenShotSeq = data.shotSeq;
    latest = data;
    render();
  }
});

function showEventBanner(shot) {
  clearTimeout(eventBannerTimeout);
  let text = "";
  const extraTurn = shot.result !== "miss" && shot.by === mySymbol;
  if (shot.result === "sunk") text = `${shot.by} sank the ${shot.shipName}!${extraTurn ? " Fire again!" : ""}`;
  else if (shot.result === "hit") text = `${shot.by} scored a hit!${extraTurn ? " Fire again!" : ""}`;
  else text = `${shot.by} missed.`;
  eventBannerEl.textContent = text;
  eventBannerEl.className = `event-banner show ${shot.result}`;
  eventBannerTimeout = setTimeout(() => {
    eventBannerEl.classList.remove("show");
  }, 2400);
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

enemyBoardEl.addEventListener("click", (e) => {
  if (latest.phase !== "battle") return;
  if (mySymbol !== latest.turn) return;
  const cellEl = e.target.closest(".bs-cell");
  if (!cellEl) return;
  if (cellEl.classList.contains("shot")) return;
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);
  socket.send(JSON.stringify({ type: "fire", cell: [row, col] }));
});

// ─── Render ─────────────────────────────────────────────────────────────────

function renderMyBoard() {
  const cells = myBoardEl.querySelectorAll(".bs-cell");
  cells.forEach((cell) => cell.className = "bs-cell");
  if (!latest.myBoard) return;

  latest.myBoard.ships.forEach((ship) => {
    ship.cells.forEach(([r, c], i) => {
      const cell = myBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
      if (!cell) return;
      cell.classList.add("ship-occupied");
      if (ship.hits[i]) cell.classList.add("hit");
    });
  });

  // opponent's shots against me — shotsAgainst on myBoard are shots THEY fired at ME
  latest.myBoard.shotsAgainst.forEach((shot) => {
    const [r, c] = shot.cell;
    const cell = myBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
    if (!cell) return;
    cell.classList.add("marker", shot.result);
  });
}

function renderEnemyBoard() {
  const cells = enemyBoardEl.querySelectorAll(".bs-cell");
  cells.forEach((cell) => cell.className = "bs-cell");
  if (!latest.opponentBoard) return;

  // sunk ships get revealed on the enemy board
  latest.opponentBoard.ships.forEach((ship) => {
    ship.cells.forEach(([r, c]) => {
      const cell = enemyBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.add("sunk-ship");
    });
  });

  // my own shots against the opponent's board
  latest.opponentBoard.shotsAgainst.forEach((shot) => {
    const [r, c] = shot.cell;
    const cell = enemyBoardEl.querySelector(`.bs-cell[data-row="${r}"][data-col="${c}"]`);
    if (!cell) return;
    cell.classList.add("shot", "marker", shot.result);
  });
}

function render() {
  const isMyTurn = mySymbol === latest.turn && latest.phase === "battle";

  if (latest.phase === "placing") {
    placementSection.style.display = "";
    battleSection.style.display = "none";
  } else {
    placementSection.style.display = "none";
    battleSection.style.display = "";
    renderMyBoard();
    renderEnemyBoard();
  }

  // turn banner
  if (latest.phase === "placing") {
    const myReady = mySymbol === "P1" ? latest.ready.P1 : latest.ready.P2;
    const oppReady = mySymbol === "P1" ? latest.ready.P2 : latest.ready.P1;
    if (latest.connected < 2) turnBannerEl.textContent = "Waiting for opponent to join…";
    else if (myReady && !oppReady) turnBannerEl.textContent = "Fleet locked in — waiting for opponent…";
    else if (!myReady) turnBannerEl.textContent = "Place your fleet, then confirm";
    else turnBannerEl.textContent = "Both fleets locked in — starting battle…";
  } else if (latest.phase === "gameover" && latest.winner) {
    turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${latest.winner}</span> sank the entire enemy fleet — game over`;
  } else if (latest.connected < 2) {
    turnBannerEl.textContent = "Waiting for opponent to join…";
  } else if (isMyTurn) {
    turnBannerEl.textContent = "Your turn — fire at the enemy board";
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
