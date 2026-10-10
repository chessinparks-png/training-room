# Training Room

Personal 3+2 blitz chess trainer, installable on iPhone (Safari → Share → Add to Home Screen).
Built from the private `andchess` repository (`trainer/`). Training data stays on each device.
Stockfish 19 (GPLv3), Maestro pieces (CC BY-NC-SA 4.0), Playfair Display & Inter (OFL).

Canty trainer: `data/canty.json` is built from `raw/models/canty-white.pgn` by `node tools/build-canty.mjs`
(curated decision points + 3+2 clock-decision positions, each checked against the game move).

Run locally: `node serve.mjs`, then open http://localhost:8765/ — opening `index.html` directly as a file
cannot work (browsers block JavaScript modules on file://).

Technique: `data/technique.json` is built from my full games in `raw/games/*.pgn` with the bundled Stockfish,
offline: `node tools/build-technique.mjs scan && node tools/build-technique.mjs deep && node tools/build-technique.mjs build`
(`report` prints the candidate report). Tactical failures found there join Repair / Calculate instead.
Check it with `node tools/test-technique.mjs`.

Repertoire courses: `data/courses.json` is built from the model players' blitz games in `raw/models/*.pgn`:
`node tools/build-repertoire.mjs build` (`node tools/build-repertoire.mjs --sanity` prints the source report).
Check it with `node tools/test-courses.mjs`. `raw/` and `tools/` are build inputs only and are not deployed.

Tactics (report only, no data file yet): `node tools/build-tactics.mjs` classifies the tactical positions already stored
for Repair / Calculate (pattern, failure type, card type, quality) from their stored Stockfish lines — no new engine run.
