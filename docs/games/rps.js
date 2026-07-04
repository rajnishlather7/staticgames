import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const requestedVariant = params.get("variant");
const requestedTarget = Number(params.get("target"));
const validVariant = requestedVariant === "classic" || requestedVariant === "lizard-spock" ? requestedVariant : null;
const validRoundTargets = [3, 5, 10, 15];
const targetToRequest = validRoundTargets.includes(requestedTarget) ? requestedTarget : null;

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const CHOICE_META = {
  rock: { icon: "✊", label: "Rock" },
  paper: { icon: "✋", label: "Paper" },
  scissors: { icon: "✌️", label: "Scissors" },
  lizard: { icon: "🦎", label: "Lizard" },
  spock: { icon: "🖖", label: "Spock" },
};

const RPS_CHOICES = {
  classic: ["rock", "paper", "scissors"],
  "lizard-spock": ["rock", "paper", "scissors", "lizard", "spock"],
};

// Mirrors the server's RPS_BEATS table — used only for the rules guide display,
// never for authoritative scoring (the server always resolves the real round).
const RPS_BEATS = {
  rock: ["scissors", "lizard"],
  paper: ["rock", "spock"],
  scissors: ["paper", "lizard"],
  lizard: ["paper", "spock"],
  spock: ["rock", "scissors"],
};

const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const turnBannerEl = document.getElementById("turn-banner");
const eventBannerEl = document.getElementById("event-banner");
const youBadgeEl = document.getElementById("you-badge");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");
const restartBtn = document.getElementById("restart-btn");
const score1El = document.getElementById("score-1");
const score2El = document.getElementById("score-2");
const targetHintEl = document.getElementById("target-hint");
const choicesEl = document.getElementById("rps-choices");
const revealIcon1 = document.getElementById("reveal-icon-1");
const revealIcon2 = document.getElementById("reveal-icon-2");
const revealLabel1 = document.getElementById("reveal-label-1");
const revealLabel2 = document.getElementById("reveal-label-2");
const scoringToggle = document.getElementById("scoring-toggle");
const scoringPanel = document.getElementById("scoring-panel");
const rulesTableEl = document.getElementById("rules-table");

let mySymbol = null; // "P1" | "P2" | "spectator"
let latest = {
  variant: "classic",
  target: 3,
  phase: "choosing",
  pending: { P1: false, P2: false },
  scores: { P1: 0, P2: 0 },
  lastRound: null,
  roundSeq: 0,
  winner: null,
  connected: 0,
};
let myLockedChoice = null; // local-only, cleared each round once a new round starts
let lastSeenRoundSeq = null;
let receivedFirstState = false;
let eventBannerTimeout = null;

function opponentSymbol() {
  return mySymbol === "P1" ? "P2" : "P1";
}

// ─── Choice buttons ─────────────────────────────────────────────────────────

function renderChoiceButtons() {
  const choices = RPS_CHOICES[latest.variant] || RPS_CHOICES.classic;
  choicesEl.className = `rps-choices${choices.length === 5 ? " five" : ""}`;
  choicesEl.innerHTML = choices
    .map(
      (choice) => `
      <button type="button" class="rps-choice-btn" data-choice="${choice}">
        <span class="icon">${CHOICE_META[choice].icon}</span>
        <span>${CHOICE_META[choice].label}</span>
      </button>`
    )
    .join("");

  choicesEl.querySelectorAll(".rps-choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (latest.phase !== "choosing") return;
      if (myLockedChoice) return;
      const choice = btn.dataset.choice;
      myLockedChoice = choice;
      socket.send(JSON.stringify({ type: "choose", choice }));
      render();
    });
  });
}

// ─── Rules guide ────────────────────────────────────────────────────────────

function renderRulesTable() {
  const choices = RPS_CHOICES[latest.variant] || RPS_CHOICES.classic;
  rulesTableEl.innerHTML = choices
    .map((choice) => {
      const beats = RPS_BEATS[choice].filter((b) => choices.includes(b));
      const beatsText = beats.map((b) => `${CHOICE_META[b].icon} ${CHOICE_META[b].label}`).join(", ");
      return `
        <div class="scoring-row wrap-row" data-choice="${choice}">
          <span class="combo">${CHOICE_META[choice].icon} ${CHOICE_META[choice].label}</span>
          <span class="pts">beats ${beatsText}</span>
        </div>`;
    })
    .join("");
}

function highlightRulesRow(choice) {
  rulesTableEl.querySelectorAll(".scoring-row").forEach((row) => row.classList.remove("active"));
  if (!choice) return;
  const row = rulesTableEl.querySelector(`.scoring-row[data-choice="${choice}"]`);
  if (row) row.classList.add("active");
}

scoringToggle.addEventListener("click", () => {
  const isOpen = scoringPanel.classList.toggle("open");
  scoringToggle.classList.toggle("open", isOpen);
});

// ─── Networking ─────────────────────────────────────────────────────────────

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "rock-paper-scissors",
  room,
  query: {
    ...(validVariant ? { variant: validVariant } : {}),
    ...(targetToRequest ? { target: String(targetToRequest) } : {}),
  },
});

socket.addEventListener("open", () => {
  connChip.classList.add("live");
  connLabel.textContent = "CONNECTED";
});

socket.addEventListener("close", () => {
  connChip.classList.remove("live");
  connLabel.textContent = "DISCONNECTED";
});

let revealUntil = 0; // timestamp; while Date.now() < revealUntil, show the last round's actual choices

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    mySymbol = data.symbol;
    revealLabel1.textContent = "You";
    revealLabel2.textContent = "Opponent";
    render();
  }
  if (data.type === "state") {
    const variantChanged = data.variant !== latest.variant;
    if (receivedFirstState && data.lastRound && data.roundSeq !== lastSeenRoundSeq) {
      showEventBanner(data.lastRound);
      revealUntil = Date.now() + 2800; // keep showing the resolved choices briefly
      setTimeout(render, 2850); // re-render once the reveal window closes
    }
    receivedFirstState = true;
    lastSeenRoundSeq = data.roundSeq;
    latest = data;
    if (variantChanged) {
      renderChoiceButtons();
      renderRulesTable();
    }
    if (!latest.pending[mySymbol]) myLockedChoice = null;
    render();
  }
});

function showEventBanner(roundResult) {
  clearTimeout(eventBannerTimeout);
  let text = "";
  let cls = "draw";
  if (roundResult.winner === "draw") {
    text = "Draw — same choice, replay this round.";
    cls = "draw";
  } else {
    const winnerChoice = roundResult.choices[roundResult.winner];
    const loserSymbol = roundResult.winner === "P1" ? "P2" : "P1";
    const loserChoice = roundResult.choices[loserSymbol];
    text = `${roundResult.winner} wins the round — ${CHOICE_META[winnerChoice].label} beats ${CHOICE_META[loserChoice].label}`;
    cls = roundResult.winner === "P1" ? "p1win" : "p2win";
  }
  eventBannerEl.textContent = text;
  eventBannerEl.className = `event-banner show ${cls}`;
  eventBannerTimeout = setTimeout(() => {
    eventBannerEl.classList.remove("show");
  }, 3200);
}

restartBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "restart" }));
});

copyBtn.addEventListener("click", async () => {
  const variantParam = validVariant ? `&variant=${validVariant}` : "";
  const targetParam = targetToRequest ? `&target=${targetToRequest}` : "";
  const url = `${window.location.origin}${window.location.pathname}?room=${room}${variantParam}${targetParam}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard API may be unavailable
  }
  copyToast.classList.add("show");
  setTimeout(() => copyToast.classList.remove("show"), 1400);
});

// ─── Render ─────────────────────────────────────────────────────────────────

function render() {
  const myPending = mySymbol ? latest.pending[mySymbol] : false;
  const oppPending = mySymbol ? latest.pending[opponentSymbol()] : false;

  // choice buttons enabled state
  choicesEl.querySelectorAll(".rps-choice-btn").forEach((btn) => {
    const isSelected = myLockedChoice === btn.dataset.choice;
    btn.classList.toggle("selected", isSelected);
    btn.disabled = latest.phase !== "choosing" || !!myLockedChoice;
  });

  // reveal display
  // Determine what to show in each icon slot:
  // - Round just resolved (lastRound matches current roundSeq, nobody pending
  //   for the NEXT round yet since phase just flipped back to "choosing" or
  //   the match ended): show the actual choices from lastRound.
  // - Mid-round (someone has locked in, round not yet resolved): show a
  //   locked/hidden marker — never the real choice — for pending players.
  // - Idle (nothing chosen yet): show "?".
  const justResolved = latest.lastRound && (latest.phase === "gameover" || (Date.now() < revealUntil && !myPending && !oppPending));

  if (justResolved) {
    const myChoice = latest.lastRound.choices[mySymbol];
    const oppChoice = latest.lastRound.choices[opponentSymbol()];
    const iWon = latest.lastRound.winner === mySymbol;
    const oppWon = latest.lastRound.winner === opponentSymbol();

    revealIcon1.textContent = CHOICE_META[myChoice]?.icon ?? "?";
    revealIcon1.className = "rps-reveal-icon" + (iWon ? " winner" : oppWon ? " loser" : "");
    revealIcon2.textContent = CHOICE_META[oppChoice]?.icon ?? "?";
    revealIcon2.className = "rps-reveal-icon" + (oppWon ? " winner" : iWon ? " loser" : "");
  } else if (myPending || oppPending) {
    // Mid-round: show locked icon for whoever has chosen, "?" for whoever
    // hasn't — never leaking the actual choice pre-reveal.
    revealIcon1.textContent = myPending ? "🔒" : "?";
    revealIcon1.className = "rps-reveal-icon" + (myPending ? " locked" : "");
    revealIcon2.textContent = oppPending ? "🔒" : "?";
    revealIcon2.className = "rps-reveal-icon" + (oppPending ? " locked" : "");
  } else {
    revealIcon1.textContent = "?";
    revealIcon1.className = "rps-reveal-icon";
    revealIcon2.textContent = "?";
    revealIcon2.className = "rps-reveal-icon";
  }

  if (justResolved && latest.lastRound.winner !== "draw") {
    highlightRulesRow(latest.lastRound.choices[latest.lastRound.winner]);
  } else {
    highlightRulesRow(null);
  }

  // turn banner
  if (latest.phase === "gameover" && latest.winner) {
    turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${latest.winner}</span> wins the match!`;
  } else if (latest.connected < 2) {
    turnBannerEl.textContent = "Waiting for opponent to join…";
  } else if (myLockedChoice) {
    turnBannerEl.textContent = "Locked in — waiting for opponent…";
  } else {
    turnBannerEl.textContent = "Choose your move";
  }

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

  // target hint
  const variantLabel = latest.variant === "lizard-spock" ? "Lizard-Spock" : "Classic";
  if (targetHintEl) targetHintEl.textContent = `${variantLabel} — first to ${latest.target} round wins takes the match.`;
}

renderChoiceButtons();
renderRulesTable();
render();
