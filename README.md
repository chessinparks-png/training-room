# Training Room

Personal 3+2 blitz chess trainer, installable on iPhone (Safari → Share → Add to Home Screen).
Built from the private `andchess` repository (`trainer/`). Training data stays on each device.
Stockfish 19 (GPLv3), Maestro pieces (CC BY-NC-SA 4.0), Playfair Display & Inter (OFL).

Canty trainer: `data/canty.json` is built from `data/source/canty-white.pgn` by `node tools/build-canty.mjs`
(curated decision points + 3+2 clock-decision positions, each checked against the game move).

Run locally: `node serve.mjs`, then open http://localhost:8765/ — opening `index.html` directly as a file
cannot work (browsers block JavaScript modules on file://).
