# Phase 3 — UI

Goal: localhost page served by our server, streaming the engine live over one WebSocket. Serves the two demo moments: (1) verification checks flipping green line-by-line WITH evidence, (2) a recipe re-running instantly with a visible "0 model calls" proof.

## Locked structure (do not deviate)
- Svelte CSR, built with Vite, served as static files by the Bun server. No SSR, no SvelteKit.
- ui/src/App.svelte — layout shell only
- ui/src/lib/ws.ts — one WebSocket client, holds the session token
- ui/src/lib/stores.ts — activity, checks, recipes, killTotal
- ui/src/components/ — one dumb component per file: DropSurface, ActivityStream, VerifyPanel, RecipeCard, Shelf, KillCounter
- All state lives in stores. Components render props/stores only — no fetch, no ws, no logic.
- NO Tailwind, NO component libraries, NO icon packs, NO webfont fetches. Hand-written CSS in one ui/src/app.css using the design tokens below.

## Design tokens (from BRAND.md — warm/analog, light)
- --paper: #F3EEE3 (page background)
- --surface: #FFFFFF (cards)
- --ink: #25231F (primary text)
- --muted: #6F6659 (secondary text)
- --line: #E5DED2 (hairline borders)
- --sky: #78A8C8 (atmosphere/imagery accents only, never controls)
- --deep-sky: #355F78 (buttons, links, focus, functional accents)
- --ember: #BE3F0C (struck-through prices + kill counter ONLY)
- --green: #1A7F4B (passed checks) · --red: #B3261E (failed checks)
- Display serif: font-family: ui-serif, "New York", Georgia, serif — wordmark "Steward", hero, section titles. Sentence case, regular/semibold, no italics.
- Body: -apple-system, system-ui, sans-serif (SF Pro)
- Machine evidence/commands: ui-monospace, "SF Mono", Menlo, monospace
- Radius 10px, 1px solid var(--line) borders, shadows ≤ 0 1px 2px rgba(37,35,31,.06). No gradients, no glows, no dark mode toggle.
- Halftone artwork: ONLY the drop-zone empty-state illustration (use a flat placeholder until the final asset lands). Never behind text, controls, evidence, prices, or counters. Operational UI stays perfectly crisp.

## Voice (from BRAND.md)
Calm operator: no "I/we", no exclamation marks, no AI jargon. Say what happened, show proof, offer next action. All numbers in microcopy come from check evidence (expected/actual) — the UI never composes its own figures. Failed outputs are DISCARDED by policy; copy must say so, never offer to keep them.
- Empty state: "Drop a file. Tell Steward what you need." + tagline "Your computer already knows how."
- Saved: "Recipe saved. Future runs use zero model calls."

## Run choreography
- The visible order follows the real work: PROBE → PLAN → EXECUTE → VERIFY.
- Each stage remains visible for at least one second. This is presentation pacing only; receipts use original event timestamps and authoritative command/verification durations.
- Planning copy stays in PLAN. A fresh plan shows "Plan ready" before execution; a saved command shows that its saved plan is ready and retains the explicit `0 model calls` evidence.
- VERIFY remains visible while measured checks arrive. It never reuses the execution command or execution duration as verification evidence.
- Deferred repair UI: command failure must visibly enter repair, show the structured revised command, rerun it, and reverify. The existing bounded repair engine remains authoritative; this choreography is not part of the smaller stage/layout correction.

## Layout (single screen, no routing)
Left column (~60%): DropSurface on top (drag a file OR type a task, one input line beneath the drop zone), ActivityStream below it (mono, streaming lines), VerifyPanel below that (checks appear pending → flip green/red one by one; each row shows name, expected, actual — evidence is ALWAYS visible, not hover-hidden).
Right column (~40%): KillCounter on top (serif, large: "$34.99/mo killed · nothing left this laptop"), Shelf below — grid of RecipeCards.
RecipeCard: recipe name (serif) · the real command in mono (visible, this teaches) · struck-through service price in --ember (e.g. ~~Clideo $9/mo~~) only when the price map has an entry · Run button · after a rerun, a "0 model calls" badge.

## Server (AUDIT.md listener requirements — non-negotiable)
- Bind 127.0.0.1 ONLY, random free port.
- Generate a per-session token at startup; print URL http://127.0.0.1:PORT/?token=TOKEN and open it.
- Every HTTP request and the WS upgrade must present the token; wrong/missing token = 401, connection refused.
- Serve ui/dist statically. No other routes except /ws.
- WS messages are typed JSON events: run_started, activity, check_pending, check_result {name, pass, expected, actual}, repair_attempt, recipe_saved, recipe_matched {score, model_calls: 0}, run_complete, error. Client→server: run_task {task, files}, run_recipe {name, files}.
- The server imports the engine as it exists. NO changes to plan schema, executor, policies, or verification. If the UI seems to need an engine change, STOP and ask.

## Steps (one at a time, gate after each)
- [x] P3.1 Server: loopback + random port + token + static serving + /ws echo. Show: curl without token → 401, with token → 200.
- [x] P3.2 Engine→WS bridge: engine events emitted as typed WS events for a real run. Show: raw WS event log from a real compression run.
- [x] P3.3 Svelte scaffold: Vite build, ws.ts (token from URL), stores wired to event types, app.css with all tokens. Show: build output + events landing in stores (console).
- [ ] P3.4 Components: ActivityStream + VerifyPanel first (demo moment 1). Show: screenshot of a live run.
- [ ] P3.5 Components: Shelf + RecipeCard + KillCounter (demo moment 2, prices from replacement-prices.ts via a WS snapshot event on connect). Show: screenshot with struck prices + counter.
- [ ] P3.6 DropSurface + full end-to-end: drag file → plan → execute → checks flip → recipe appears on shelf → rerun shows 0 model calls badge. Show: screen recording notes + screenshots.
- Update MAP.md/GUIDE.md and check off each step in this file, same commit.
