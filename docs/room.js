import { getGame } from "./games.js";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("game");
const game = getGame(gameId);

const panelBody = document.getElementById("panel-body");
const gameNameEl = document.getElementById("game-name");

if (!game || !game.enabled) {
  gameNameEl.textContent = "unknown game";
  panelBody.innerHTML = `
    <h1>Game not found</h1>
    <p class="sub">That game doesn't exist or isn't available yet.</p>
    <a href="index.html"><button class="primary">Back to game select</button></a>
  `;
} else {
  gameNameEl.textContent = game.name.toLowerCase();
  document.title = `staticgames — ${game.name}`;

  panelBody.innerHTML = `
    <h1>Start a game<span class="cursor"></span></h1>
    <p class="sub">Creates a private ${game.name} room. Send the link to whoever you're playing.</p>
    <button class="primary" id="create-btn" style="width:100%">Create room</button>

    <div class="divider">OR JOIN EXISTING</div>

    <label for="room-input">Room code</label>
    <div class="row">
      <input type="text" id="room-input" placeholder="e.g. FOX4" maxlength="8" autocomplete="off" />
      <button id="join-btn">Join</button>
    </div>

    <p class="hint">Rooms are held in memory by the game server and disappear once both players leave. No accounts, no history.</p>
  `;

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  document.getElementById("create-btn").addEventListener("click", () => {
    const code = randomCode();
    window.location.href = `${game.path}?room=${code}`;
  });

  function join() {
    const input = document.getElementById("room-input");
    const code = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) {
      input.focus();
      return;
    }
    window.location.href = `${game.path}?room=${code}`;
  }

  document.getElementById("join-btn").addEventListener("click", join);
  document.getElementById("room-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
}
