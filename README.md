# staticgames

Room-based, 2-player browser games. The frontend is plain static HTML/CSS/JS
(deployable to GitHub Pages or any static host). Real-time rooms are powered
by a Cloudflare Worker + Durable Object, using
[partyserver](https://github.com/cloudflare/partykit) — Cloudflare's own
library for building these PartyKit-style stateful servers. Deploys with
`wrangler` straight to your own Cloudflare account (free tier), so there's
no dependency on PartyKit's managed platform. Placeholder game: tic-tac-toe.

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