# Games Unlimited

Lobby-based party games for the web. Make a room, share the 4-letter code, play.
No accounts, no installs, and no game server to run: whoever is hosting acts as
the server, and hosting hands itself to someone else automatically if they leave.

**Games included**

| | Game | Players | |
|---|---|---|---|
| 💣 | **Short Fuse** | 1–16 | A word-bomb game. The bomb shows a few letters; type a word containing them before the hidden fuse runs out. Lives, a bonus alphabet that earns extra lives, no repeat words. |
| 🌙 | **Mafia** | 3–20 | Hidden roles (Villager, Doctor, Detective, Vigilante, Mafioso, Godfather, Jester), night actions, day voting with majority execution, and separate Town / Mafia / Graveyard chats. |
| 🃏 | **Single** | 2–10 | A color-matching card game. Match the top card's color or number, hit opponents with Skip, Reverse, +2 and Wild +4, and call “Single!” on your last card before someone catches you. One hand or play to 100/250/500 points; optional stacking and draw-until-playable house rules. |
| 🂠 | **Cards with Insanity** | 3–20 | A fill-in-the-blank party card game in the style of Pretend You're Xyzzy. A rotating Card Czar picks the funniest anonymous answer. Ships with all 42 official sets from PYX (2,000+ white cards, 540 black) and imports any [CrCast](https://crcast.cc) deck by its 5-character code. Blank write-in cards, Rando Cardrissian, Rebooting the Universe, and people can join mid-game. |
| 💬 | **Quips** | 3–10 | A head-to-head comedy writing game. Everyone answers two prompts, each prompt goes to two players, and everyone else votes for the funnier answer. Points split by vote share, with bonuses for winning, clean sweeps and the crowd's pick; jinxes score nothing. Rounds 2–3 count double/triple, then the Last Quip: one prompt for everyone and three votes each. Ships with 972 prompts, and the host can add their own. Spectators vote as the audience. |

## Deploy to Vercel

1. Import this repository in Vercel ("Add New → Project").
2. Leave the defaults (Vercel detects Vite; `vercel.json` sets the build and SPA routing).
3. Deploy. That's it.

The build downloads nothing at runtime. It builds the Short Fuse dictionary
(~275k English words) from an npm package into `public/games/wordbomb/`, and
converts the Pretend You're Xyzzy card database (`data/pyx/cah_cards.sql`) into
`public/games/insanity/pyx-cards.json`.

Cards with Insanity imports CrCast decks through a tiny pass-through function,
`api/crcast.js`. Vercel deploys it automatically; in development Vite serves it.
If it's missing (another static host), browsers call CrCast directly instead.
The card text comes from Cards Against Humanity (CC BY-NC-SA 2.0) via Pretend
You're Xyzzy; see `data/pyx/README.md`.

## How it works

```
            ┌───────────── matchmaking (PeerJS) ─────────────┐
            │  only used to introduce browsers to each other │
            └────────────────────────────────────────────────┘
                 ▲            ▲             ▲
   Bob ◄──WebRTC──► Alice (host) ◄──WebRTC──► Cara
                    runs the rules,
                    holds room code "ABCD"
```

* **Star topology.** Each player connects directly (WebRTC data channel) to the
  host's browser. The host runs `HostCore` (`src/core/host.js`): membership,
  lobby, chat and the game rules. Each player receives only their own view of
  the game, so hidden information (Mafia roles, the bomb timer) stays hidden.
* **Room codes.** The current host "holds" an address derived from the code
  (`room-ABCD`) so newcomers can find it.
* **Host succession** (`src/core/succession.js`): host → co-hosts in the order
  they were promoted → everyone else by seniority (who joined first). The member
  list shows this order. The host can promote/demote co-hosts, hand hosting to
  anyone ("Make host"), or kick people.
* **Host migration.**
  * *Planned* (Make host, Leave, closing the tab): the host sends the full state
    to the new host and tells everyone where to go. It takes well under a second.
  * *Unplanned* (crash, lost Wi-Fi): players notice the host has gone quiet for
    about 7 seconds, walk the succession list, and regroup around the first
    person who answers. The next-in-line player always holds a fresh backup of
    the full game state, so the game continues where it left off.
* **Reconnects.** Reloading the tab rejoins you as the same player, with your
  seat and role kept, as long as you're back within ~45 s during a game.

### What runs where

| Piece | Where | Load |
|---|---|---|
| The site (static files) | Vercel | static hosting only |
| Matchmaking | PeerJS's free public server by default | a tiny message per connection; no game traffic |
| CrCast deck import | a Vercel function (`api/crcast.js`) | one request per imported deck, cached at the edge |
| Game logic and traffic | the players' browsers | none for you |

To use your own matchmaking server instead of the public one, run
[`peer`](https://github.com/peers/peerjs-server) anywhere that supports
WebSockets (not Vercel). Then set `VITE_PEER_HOST` / `VITE_PEER_PORT` /
`VITE_PEER_PATH` / `VITE_PEER_SECURE` in Vercel's environment variables (see
`.env.example`). Players on very restrictive networks (some corporate or
school networks, a few mobile carriers) may need a TURN relay. Add one via
`VITE_ICE_SERVERS`.

**Trust model:** the host's browser necessarily knows everything, and so does
their backup. Someone determined could peek at hidden roles from their
browser's developer tools while hosting or next in line. That's the trade-off
for having no server; it's fine for playing with friends.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # rules + succession unit tests (Node's built-in runner)
npm run build          # production build into dist/
```

To test multiplayer without any network, open several tabs at
**`http://localhost:5173/?net=local`**. Tabs talk to each other through a
`BroadcastChannel` instead of WebRTC. Each tab is its own player.

To test real WebRTC fully offline, run `npm run signal` (a local matchmaking
server on port 9000) and open tabs at `http://localhost:5173/?peer=localhost:9000`.

## Adding games

Games are self-contained folders under `src/games/`. A game supplies a manifest
(name, player counts, settings), host-side rules (`setup`, `action`, `tick`,
`view`), and a Preact view. The framework provides lobbies, settings UI, chat,
spectators, reconnects and host migration. See
**[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)** for a full walkthrough with a
working example.

```
src/
  net/          transports (WebRTC via PeerJS, local BroadcastChannel) and Room (joining, heartbeats, migration)
  core/         HostCore (authoritative room state), succession rules, game registry
  ui/           home, lobby, member list, chat, settings form, game stage
  games/        one folder per game + index.js listing them
api/            Vercel functions (CrCast deck proxy)
data/pyx/       Pretend You're Xyzzy card database (source for Cards with Insanity)
scripts/        dictionary and card builders, local signaling server
test/           unit tests for game rules and succession
```
