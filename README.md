# staticgames

Room-based, 2-player browser games. The frontend is plain static HTML/CSS/JS
(deployable to GitHub Pages or any static host). Real-time rooms are powered
by a Cloudflare Worker + Durable Object, using
[partyserver](https://github.com/cloudflare/partykit) — Cloudflare's own
library for building these PartyKit-style stateful servers. Deploys with
`wrangler` straight to your own Cloudflare account (free tier), so there's
no dependency on PartyKit's managed platform. Placeholder game: tic-tac-toe.

## How it works

- `public/` — the static site. No build step, no framework.
  - `index.html` — home page / game picker. Lists every entry in `games.js`.
  - `room.html` + `room.js` — create-or-join screen for whichever game was
    picked (`room.html?game=tictactoe`). "Create room" generates a 4-char
    code and redirects into the game's own page; "Join" does the same with
    a code you paste in.
  - `games/tictactoe.html` + `games/tictactoe.js` — the actual board. Reads
    `?room=CODE` from the URL and connects to that game room.
  - `games.js` — the registry of games (id, display name, path to its page,
    `enabled` flag). This is the single place you touch to add a new game
    to the home page.
  - `config.js` — the Worker host, shared by every game page.
- `party/server.ts` — the Worker + Durable Object. One "room" = one Durable
  Object instance = one game. First connection becomes `X`, second becomes
  `O`, anyone after that is a spectator. Game state is persisted to the
  Durable Object's own storage so it survives brief disconnects.
- Room state is authoritative on the server — clients only send `{type:
  "move", index}` or `{type: "restart"}`; the server validates turn order
  and rejects illegal moves.

## Local development

```bash
npm install
npm run dev
```

This starts a local Cloudflare Workers simulation at `http://127.0.0.1:8787`,
matching the default in `public/config.js`. Then just open
`public/index.html` in a browser (or serve the `public/` folder with any
static server, e.g. `npx serve public`).

Open a game in two tabs/windows to play against yourself locally.

## Deploying

**1. Deploy the game server:**

```bash
npx wrangler login    # one-time, opens a browser to authorize your Cloudflare account
npx wrangler deploy
```

This gives you a URL like `staticgames.<your-subdomain>.workers.dev`. This
is your own Cloudflare account's free tier — no PartyKit account, no shared
platform, no dependency on anyone else's infrastructure being up.

**2. Point the frontend at it** — edit `public/config.js`:

```js
export const PARTYKIT_HOST = "staticgames.<your-subdomain>.workers.dev";
```

**3. Deploy the `public/` folder to GitHub Pages** (or Netlify, Vercel,
Cloudflare Pages, etc. — it's just static files). For GitHub Pages: push this
repo, then set Pages to serve from the `public/` folder (or a `gh-pages`
branch containing its contents).

## Adding a new game

The home page, room creation, and connection plumbing are all game-agnostic
already. To add a second game:

1. Build `public/games/<id>.html` + `public/games/<id>.js` — copy
   `tictactoe.html` / `tictactoe.js` as a starting point. They just need to
   read `?room=` from the URL and open a `PartySocket` to it (with the
   right `party` name — see below).
2. Add a Durable Object class for the new game's rules in `party/server.ts`
   (or a separate file), and add a binding for it in `wrangler.jsonc` under
   `durable_objects.bindings` + a matching entry in `migrations`.
3. The `party` name your client connects with is the kebab-case version of
   the class name — e.g. a class called `ConnectFour` is reached at
   `party: "connect-four"`.
4. Flip the entry in `public/games.js` to `enabled: true` and point `path`
   at the new page. It'll now show up on the home page automatically.
