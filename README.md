# Chess ML Project

An in-browser chess application featuring a TensorFlow.js value network, self-play training loop, opening recognition, and interactive weight / feature visualization.

## Key Features

- Fully legal chess engine (move generation, check / checkmate / stalemate, threefold repetition).
- TensorFlow.js value model (Dense: 773 → 96 → 48 → 1, tanh output) with engineered features.
- Engineered feature channels (beyond one-hot planes):
  - King danger zone (normalized attacked squares around king)
  - King pawn shelter quality
  - Passed pawn differential
  - Mobility differential
- ε-greedy move selection with phase‑adaptive exploration + decay.
- Per-game self-play training (immediate incremental updates) with discounted outcome propagation and draw penalty shaping.
- Opening recognition via prefix trie (SAN sequence → ECO name + code) using `openings.json`.
- Live model weights & interpretability panel (aggregated first-layer weight magnitudes by feature group and piece type).
- Material & captured pieces tracker.
- Post‑game actions: retrain on current game, reset model.
- Landing page self-play visualizer (mini board) continuously generating training data.
- Persistent model storage in browser (IndexedDB / localStorage fallback) with reset option.

## Tech Stack

- Vanilla JavaScript, HTML, CSS (Tailwind utility usage via CDN).
- TensorFlow.js 4.x in-browser (no backend server required).
- No external chess engine dependency; all rules implemented locally.

## Model Input Encoding

Total 773 floats:
1. 768: 12 piece-type * color planes (64 squares each) one-hot.
2. 1: Side to move flag.
3. 4: Engineered features (indices 769–772):
   - 769: King danger (0–1)
   - 770: King shelter (0–1)
   - 771: Passed pawn differential (scaled)
   - 772: Mobility differential (scaled)

## Training Signal

- Mid-game heuristic samples: material + mobility + king safety proxy (perspective-correct).
- Final game outcome propagated backward with discount factor γ and small draw penalty (to encourage decisive results).
- Terminal state oversampling (duplicated) for stronger gradient signal.
- Samples batched into tf.js `model.fit` calls per game.

## Exploration Strategy

- Base epsilon (`tfEpsilon`) decays over games.
- Dynamic per-position adjustment (higher exploration in opening, tapering in endgame).
- Random move list shuffling + tie-break randomness prevents deterministic loops.

## Opening Book

- `openings.json` contains ECO lines.
- A trie maps SAN prefixes → (Name, ECO Code) shown live in the UI.

## Persistence

- Model saved automatically after training epochs.
- Reset buttons clear stored weights and reinitialize architecture (compatible with engineered features).

## Running Locally

1. Clone repo and serve the folder (any static server or `python -m http.server`).
2. Open `landing.html` (or just `index.html` which will redirect if no side parameter present).
3. Observe self-play on landing page; open weight panel to see feature group magnitudes.
4. Start a human game by choosing a side (URL param `?side=White` or `?side=Black`).

### Optional Local Dev Server

```bash
python -m http.server 8080
# visit http://localhost:8080/landing.html
```

## Typical Workflow

1. Let self-play run to accumulate a few games.
2. Inspect weight panel for shifting magnitudes.
3. Play against the engine; after game, click "Train model on this game".
4. If experiments diverge, use Reset Model.

## File Overview

- `index.html` – Main play interface + weight/feature panels.
- `landing.html` – Self-play dashboard & auto-training hub.
- `script.js` – Core chess logic, model, training loop, feature encoding.
- `openings.json` – Opening lines dataset (ECO mapping).
- `styles.css` – Supplemental styling.
- `sprites/` – Piece images.
- `sounds/` – Audio assets (capture / move etc.).

## Future Enhancements (Ideas)

- Evaluation suite vs. a fixed random or shallow minimax baseline.
- Prioritized replay buffer & sample aging.
- More granular endgame feature channels (e.g., king opposition, pawn races).
- Policy head for move prior guidance (transition toward AlphaZero-style architecture).
- On-device WASM SIMD acceleration check & performance metrics panel.

## License

MIT (adjust if you prefer another license).

## Attribution

Piece sprites and audio assets belong to their respective creators (ensure they are license-compatible; replace if necessary). Opening data derived from standard public ECO references.

---
Happy experimenting with on-device reinforcement-style chess learning!
