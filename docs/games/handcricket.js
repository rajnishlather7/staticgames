import PartySocket from "https://esm.sh/partysocket@1.3.0";
import { PARTYKIT_HOST } from "../config.js";

const params = new URLSearchParams(window.location.search);
const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const validWickets = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const validOvers = new Set([1, 10, 0]);
const requestedWickets = Number(params.get("wickets"));
const requestedOvers = Number(params.get("overs"));
const wicketsToRequest = validWickets.has(requestedWickets) ? requestedWickets : null;
// 0 is a valid, meaningful value (unlimited) so we can't just check truthiness here.
const oversToRequest = params.has("overs") && validOvers.has(requestedOvers) ? requestedOvers : null;

if (!room) {
  window.location.href = "../index.html";
}

document.getElementById("room-code").textContent = room;

const connChip = document.getElementById("conn-chip");
const connLabel = document.getElementById("conn-label");
const peerMeter = document.getElementById("peer-meter");
const turnBannerEl = document.getElementById("turn-banner");
const eventBannerEl = document.getElementById("event-banner");
const youBadgeEl = document.getElementById("you-badge");
const copyBtn = document.getElementById("copy-btn");
const copyToast = document.getElementById("copy-toast");
const restartBtn = document.getElementById("restart-btn");
const matchHintEl = document.getElementById("match-hint");

const tossSection = document.getElementById("toss-section");
const decisionSection = document.getElementById("decision-section");
const inningsSection = document.getElementById("innings-section");
const startTossBtn = document.getElementById("start-toss-btn");
const chooseBatBtn = document.getElementById("choose-bat-btn");
const chooseBowlBtn = document.getElementById("choose-bowl-btn");

const inningsBoardEl = document.getElementById("innings-board");
const choicesEl = document.getElementById("hc-choices");
const revealIcon1 = document.getElementById("reveal-icon-1");
const revealIcon2 = document.getElementById("reveal-icon-2");
const revealLabel1 = document.getElementById("reveal-label-1");
const revealLabel2 = document.getElementById("reveal-label-2");
const scoringToggle = document.getElementById("scoring-toggle");
const scoringPanel = document.getElementById("scoring-panel");
const rulesTableEl = document.getElementById("rules-table");

let mySymbol = null; // "P1" | "P2" | "spectator"
let latest = {
  wickets: 3,
  overs: 10,
  phase: "toss",
  tossWinner: null,
  battingFirst: null,
  currentInnings: 1,
  currentBatter: null,
  currentBowler: null,
  innings1: { runs: 0, wicketsLost: 0, ballsBowled: 0, target: null },
  innings2: { runs: 0, wicketsLost: 0, ballsBowled: 0, target: null },
  pending: { P1: false, P2: false },
  lastBall: null,
  ballSeq: 0,
  winner: null,
  connected: 0,
};
let myChoice = null; // local-only lock, cleared each ball once a new ball starts
let revealUntil = 0;
let lastSeenBallSeq = null;
let receivedFirstState = false;
let eventBannerTimeout = null;

function opponentSymbol() {
  return mySymbol === "P1" ? "P2" : "P1";
}

function oversLabel(overs) {
  return overs === 0 ? "Unlimited overs" : `${overs} over${overs === 1 ? "" : "s"}`;
}

// ─── Number choice buttons (1-6) ────────────────────────────────────────────

function renderChoiceButtons() {
  choicesEl.innerHTML = [1, 2, 3, 4, 5, 6]
    .map(
      (n) => `
      <button type="button" class="rps-choice-btn" data-choice="${n}">
        <span class="icon">${n}</span>
      </button>`
    )
    .join("");

  choicesEl.querySelectorAll(".rps-choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (latest.phase !== "innings1" && latest.phase !== "innings2") return;
      if (myChoice) return;
      const choice = Number(btn.dataset.choice);
      myChoice = choice;
      socket.send(JSON.stringify({ type: "choose-number", choice }));
      render();
    });
  });
}
renderChoiceButtons();

// ─── Rules guide ────────────────────────────────────────────────────────────

function renderRulesTable() {
  rulesTableEl.innerHTML = `
    <div class="scoring-row wrap-row">
      <span class="combo">1. Toss</span>
      <span class="pts">A coin flip decides who chooses to bat or bowl first.</span>
    </div>
    <div class="scoring-row wrap-row">
      <span class="combo">2. Each ball</span>
      <span class="pts">Both players secretly pick a number 1-6, then both are revealed together.</span>
    </div>
    <div class="scoring-row wrap-row">
      <span class="combo">3. Out</span>
      <span class="pts">If both numbers match, the batter is out.</span>
    </div>
    <div class="scoring-row wrap-row">
      <span class="combo">4. Runs</span>
      <span class="pts">If the numbers differ, the batter scores runs equal to their own number.</span>
    </div>
    <div class="scoring-row wrap-row">
      <span class="combo">5. Innings end</span>
      <span class="pts">When wickets or overs run out, roles swap for the second innings.</span>
    </div>
    <div class="scoring-row wrap-row">
      <span class="combo">6. The chase</span>
      <span class="pts">In the second innings, the match ends the instant the target score is passed.</span>
    </div>
    <div class="scoring-note">Equal totals after both innings is a tie — no tiebreaker.</div>
  `;
}
renderRulesTable();

scoringToggle.addEventListener("click", () => {
  const isOpen = scoringPanel.classList.toggle("open");
  scoringToggle.classList.toggle("open", isOpen);
});

// ─── Networking ─────────────────────────────────────────────────────────────

const socket = new PartySocket({
  host: PARTYKIT_HOST,
  party: "hand-cricket",
  room,
  query: {
    ...(wicketsToRequest !== null ? { wickets: String(wicketsToRequest) } : {}),
    ...(oversToRequest !== null ? { overs: String(oversToRequest) } : {}),
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

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    mySymbol = data.symbol;
    revealLabel1.textContent = "You";
    revealLabel2.textContent = "Opponent";
    render();
  }
  if (data.type === "state") {
    if (receivedFirstState && data.lastBall && data.ballSeq !== lastSeenBallSeq) {
      showEventBanner(data.lastBall);
      revealUntil = Date.now() + 2600;
      setTimeout(render, 2650);
    }
    receivedFirstState = true;
    lastSeenBallSeq = data.ballSeq;
    latest = data;
    if (!latest.pending[mySymbol]) myChoice = null;
    render();
  }
});

function showEventBanner(ball) {
  clearTimeout(eventBannerTimeout);
  let text = "";
  let cls = "";
  if (ball.result === "out") {
    text = `${ball.batter} is OUT! Both picked ${ball.batterChoice}.`;
    cls = "hc-out";
  } else {
    text = `${ball.batter} scores ${ball.runsScored} run${ball.runsScored === 1 ? "" : "s"}!`;
    cls = "hc-runs";
  }
  eventBannerEl.textContent = text;
  eventBannerEl.className = `event-banner show ${cls}`;
  eventBannerTimeout = setTimeout(() => {
    eventBannerEl.classList.remove("show");
  }, 2600);
}

startTossBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "start-toss" }));
});

chooseBatBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "toss-decision", decision: "bat" }));
});

chooseBowlBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "toss-decision", decision: "bowl" }));
});

restartBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "restart" }));
});

copyBtn.addEventListener("click", async () => {
  const wicketsParam = wicketsToRequest !== null ? `&wickets=${wicketsToRequest}` : "";
  const oversParam = oversToRequest !== null ? `&overs=${oversToRequest}` : "";
  const url = `${window.location.origin}${window.location.pathname}?room=${room}${wicketsParam}${oversParam}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard API may be unavailable
  }
  copyToast.classList.add("show");
  setTimeout(() => copyToast.classList.remove("show"), 1400);
});

// ─── Render ─────────────────────────────────────────────────────────────────

function renderInningsBoard() {
  const rows = [
    { num: 1, innings: latest.innings1, batter: latest.battingFirst },
    {
      num: 2,
      innings: latest.innings2,
      batter: latest.battingFirst ? (latest.battingFirst === "P1" ? "P2" : "P1") : null,
    },
  ];
  // Note: innings2's batter is only meaningful once battingFirst is set (i.e.
  // post toss-decision) — the ternary above already returns null beforehand
  // since it's gated on `latest.battingFirst ? ... : null`.

  inningsBoardEl.innerHTML = rows
    .map(({ num, innings, batter }) => {
      const isActive = latest.currentInnings === num && latest.phase !== "gameover" && latest.phase !== "toss" && latest.phase !== "choosing";
      const oversText =
        latest.overs === 0 ? `${Math.floor(innings.ballsBowled / 6)}.${innings.ballsBowled % 6} ov` : `${Math.floor(innings.ballsBowled / 6)}.${innings.ballsBowled % 6}/${latest.overs} ov`;
      return `
        <div class="hc-innings-card${isActive ? " active" : ""}">
          <div class="hc-innings-label">Innings ${num}${batter ? ` — ${batter} batting` : ""}</div>
          <div class="hc-innings-score">${innings.runs}<span class="wickets">/${innings.wicketsLost}</span></div>
          <div class="hc-innings-meta">${oversText} · max ${latest.wickets} wkt</div>
          ${innings.target !== null ? `<div class="hc-innings-target">target ${innings.target}</div>` : ""}
        </div>`;
    })
    .join("");
}

function render() {
  const myPending = mySymbol ? latest.pending[mySymbol] : false;
  const oppPending = mySymbol ? latest.pending[opponentSymbol()] : false;
  const isBatting = mySymbol === latest.currentBatter;
  const isBowling = mySymbol === latest.currentBowler;
  const inMatch = latest.phase === "innings1" || latest.phase === "innings2";

  // section visibility
  tossSection.style.display = latest.phase === "toss" ? "" : "none";
  decisionSection.style.display = latest.phase === "choosing" ? "" : "none";
  inningsSection.style.display = inMatch || latest.phase === "gameover" ? "" : "none";

  if (inMatch || latest.phase === "gameover") renderInningsBoard();

  // toss button — anyone can trigger it, but only if not already tossed
  startTossBtn.disabled = latest.connected < 2;
  startTossBtn.textContent = latest.connected < 2 ? "Waiting for opponent…" : "Flip coin";

  // bat/bowl decision — only the toss winner sees actionable buttons
  const isTossWinner = mySymbol === latest.tossWinner;
  chooseBatBtn.disabled = !isTossWinner;
  chooseBowlBtn.disabled = !isTossWinner;

  // number choice buttons
  choicesEl.querySelectorAll(".rps-choice-btn").forEach((btn) => {
    const isSelected = myChoice === Number(btn.dataset.choice);
    btn.classList.toggle("selected", isSelected);
    btn.disabled = !inMatch || !!myChoice;
  });

  // reveal display
  const justResolved = latest.lastBall && (latest.phase === "gameover" || (Date.now() < revealUntil && !myPending && !oppPending));
  if (justResolved) {
    const batter = latest.lastBall.batter;
    const bowler = batter === "P1" ? "P2" : "P1";
    const batterChoice = latest.lastBall.batterChoice;
    const bowlerChoice = latest.lastBall.bowlerChoice;
    const myIsBatter = mySymbol === batter;
    const myChoiceVal = myIsBatter ? batterChoice : bowlerChoice;
    const oppChoiceVal = myIsBatter ? bowlerChoice : batterChoice;
    const isOut = latest.lastBall.result === "out";

    revealIcon1.textContent = String(myChoiceVal);
    revealIcon1.className = "rps-reveal-icon" + (isOut ? "" : myIsBatter ? " winner" : "");
    revealIcon2.textContent = String(oppChoiceVal);
    revealIcon2.className = "rps-reveal-icon" + (isOut ? "" : !myIsBatter ? " winner" : "");
  } else if (myPending || oppPending) {
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
  revealLabel1.textContent = isBatting ? "You (batting)" : isBowling ? "You (bowling)" : "You";
  revealLabel2.textContent = mySymbol === opponentSymbol() ? "Opponent" : latest.currentBatter === opponentSymbol() ? "Opponent (batting)" : "Opponent (bowling)";

  // turn banner
  if (latest.phase === "toss") {
    if (latest.connected < 2) turnBannerEl.textContent = "Waiting for opponent to join…";
    else turnBannerEl.textContent = "Flip the coin to decide who chooses first";
  } else if (latest.phase === "choosing") {
    turnBannerEl.innerHTML = isTossWinner
      ? "You won the toss — choose bat or bowl"
      : `<span class="sym ${latest.tossWinner}">${latest.tossWinner}</span> won the toss and is choosing…`;
  } else if (latest.phase === "gameover") {
    if (latest.winner === "tie") {
      turnBannerEl.textContent = "Match tied!";
    } else {
      turnBannerEl.innerHTML = `<span class="sym ${latest.winner}">${latest.winner}</span> wins the match!`;
    }
  } else if (inMatch) {
    if (myChoice) turnBannerEl.textContent = "Locked in — waiting for opponent…";
    else turnBannerEl.textContent = isBatting ? "You're batting — pick a number" : "You're bowling — pick a number";
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

  // match hint
  if (matchHintEl) matchHintEl.textContent = `${latest.wickets} wicket${latest.wickets === 1 ? "" : "s"} · ${oversLabel(latest.overs)}`;
}

render();
