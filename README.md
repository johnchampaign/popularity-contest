# Popularity Contest — Digital

A digital adaptation of Thomas Sidener's card game **Popularity Contest**.

- **Solo / hotseat + AI** — open `index.html` directly in a browser. No server needed.
- **Online multiplayer** — open `online.html`. Requires deploying the PartyKit server (instructions below).

## Files

| File | Purpose |
|---|---|
| `engine.js` | Pure game engine + AI. Used by both client and server. |
| `index.html` | Solo / hotseat / vs AI mode. Fully client-side. |
| `online.html` | Multiplayer client. Connects to a PartyKit room over WebSockets. |
| `party/popularity.ts` | PartyKit server. One room = one game. Authoritative state. |
| `partykit.json` | PartyKit project config. |
| `package.json` | npm scripts: `dev`, `deploy`. |

## How the game works

Each player starts with cards `+2, +1, 0, -1, -2`. Each round has three phases:

1. **Popularity** — every player secretly gives up to 3 cards to any non-eliminated player (including themselves). Multiple cards may go to the same target.
2. **Evaluation** — cards revealed. Sum = your popularity. The unique lowest is eliminated (ties = "safety in numbers" — no elimination). If 3+ players remain, the unique highest player who received a `0` is also eliminated.
3. **Gather** — keep your received cards (your hand grows over rounds). Eliminated players' cards become a stack they draw 1 from randomly each round to play on a live player.

Last player standing wins the game; at 2 players left, highest popularity wins. The designer's standard "match" play is first-to-6-pips on a die (we render this as a row of pips per player).

## Deploying multiplayer (PartyKit)

PartyKit deploys serverless WebSocket apps onto Cloudflare's edge — generous free tier, perfect for friends-and-family scale.

**One-time setup:**

```bash
npm install
npx partykit login         # opens browser to authenticate via GitHub
npx partykit deploy        # deploys the server
```

After deploy you'll see a URL like `popularity-contest.your-username.partykit.dev`. Open `online.html` and edit the `DEFAULT_HOST` constant near the top of its `<script>` block to that URL — or append `?host=popularity-contest.your-username.partykit.dev` to the URL the first time and the value is remembered in `localStorage`.

**Local dev:**

```bash
npx partykit dev           # starts server at 127.0.0.1:1999
```

Then open `online.html?host=127.0.0.1:1999`.

## Deploying the static client (GitHub Pages)

The HTML files are static — push the repo to GitHub, enable Pages, done. The client connects to whatever PartyKit URL you've baked in.

Recommended GitHub Actions deploy: see [Dimensional Traveler best-practices doc §5](../Dimensional%20Traveler/BEST-PRACTICES.md).

## Online flow

1. **Host:** opens `online.html`. A random room code is generated (e.g. `red-oak-42`) and put in the URL.
2. Host clicks "Copy invite link" and shares it.
3. **Guests:** open the link. Each enters a name, joins a seat.
4. Host may add AI seats and toggle the die-pips match mode.
5. Host clicks **Start** when ≥3 seats are filled (humans + AIs).
6. The PartyKit server runs the engine authoritatively. Each client sees only their own hand. AI seats play automatically on the server.

If a human disconnects mid-game, their seat is auto-converted to AI so the game doesn't stall; they can rejoin (by re-opening the link with the same name) to reclaim their seat.

## Architecture notes

- The engine is pure ES module — same `engine.js` runs in the browser and in the PartyKit Durable Object.
- The server redacts state per-recipient via `viewFor(G, seatId)`: other players' hands and pre-reveal received cards are sent as `{hidden: true}` placeholders.
- Determinism: a single seed seeds all RNG (eliminated-player draws, AI choices). Replays + bug repros work.
- AI: simple heuristic (target leader with negatives + 0, self-preserve with positives when at risk). Tuned for 3+ players; switches strategy at 2-player endgame.

## Rules sources

- Rules PDF: `Popularity Print and Play.pdf` (in this folder).
- Designer's how-to video: <https://www.youtube.com/watch?v=qjo9HKq8UPg> (confirmed: sequential giving with face-down reveal; cards may not be given to eliminated players; die mechanic is the designer's standard, not a 4–5 player variant).
