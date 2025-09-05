// Basic ML integration for self-play value learning
// Dependencies: chess.js, tf.js

const gameML = new Chess(); // separate from UI logic if needed
let valueModel = null;
let trainingData = [];

async function createModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({inputShape: [773], units: 64, activation: 'relu'}));
  model.add(tf.layers.dense({units: 1, activation: 'tanh'}));
  model.compile({optimizer: 'adam', loss: 'meanSquaredError'});
  valueModel = model;
  return model;
}

// Encode board into 773 features
function encodeBoard(chess) {
  const mapping = {p:0,n:1,b:2,r:3,q:4,k:5};
  const planes = new Float32Array(773);
  const board = chess.board();
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      if (sq) {
        const base = mapping[sq.type];
        const colorOffset = sq.color === 'w' ? 0 : 6;
        const idx = (colorOffset + base) * 64 + (r * 8 + c);
        planes[idx] = 1;
      }
    });
  });
  planes[768] = chess.turn() === 'w' ? 1 : 0;
  return planes;
}

function randomMove(chessInstance = gameML) {
  const moves = chessInstance.moves({verbose: true});
  if (!moves.length) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

function recordGameResult(result, chessInstance = gameML) {
  const history = chessInstance.history({verbose: true});
  const replay = new Chess();
  trainingData = [];
  history.forEach((mv, i) => {
    const encoded = encodeBoard(replay);
    const label = (replay.turn() === 'w' ? result : -result);
    trainingData.push({x: encoded, y: label});
    replay.move(mv);
  });
}

async function trainModel() {
  if (!valueModel) await createModel();
  if (trainingData.length === 0) return;
  const xs = tf.tensor2d(trainingData.map(d => d.x));
  const ys = tf.tensor2d(trainingData.map(d => [d.y]));
  await valueModel.fit(xs, ys, {epochs: 5, batchSize: 32});
  xs.dispose(); ys.dispose();
  console.log('Model trained on', trainingData.length, 'positions');
}

async function resetModel() {
  valueModel = null;
  await createModel();
  console.log('Model reset to blank weights');
}

async function greedyMove(chessInstance = gameML) {
  if (!valueModel) await createModel();
  const moves = chessInstance.moves({verbose: true});
  if (!moves.length) return null;
  let bestScore = -Infinity; let best = null;
  for (const mv of moves) {
    chessInstance.move(mv);
    const encoded = encodeBoard(chessInstance);
    const pred = valueModel.predict(tf.tensor2d([encoded]));
    const score = (await pred.data())[0];
    pred.dispose();
    chessInstance.undo();
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  return best;
}

async function saveModel() {
  if (!valueModel) return;
  await valueModel.save('indexeddb://chess-model');
  console.log('Model saved');
}

async function loadModel() {
  try {
    valueModel = await tf.loadLayersModel('indexeddb://chess-model');
    console.log('Model loaded');
  } catch(e) { console.warn('Load failed', e); }
}

window.MLChess = {
  gameML,
  createModel,
  randomMove,
  greedyMove,
  recordGameResult,
  trainModel,
  resetModel,
  encodeBoard,
  saveModel,
  loadModel
};
