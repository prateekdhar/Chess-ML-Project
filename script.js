const chessboard = document.querySelector('.chessboard');
const historyBody = document.getElementById('history-body');
const resultBanner = document.getElementById('result-banner');
const newGameBtn = document.getElementById('new-game-btn');
const historyWrapper = document.querySelector('.history-wrapper');
const themeToggleInput = document.getElementById('theme-toggle');
// Navigation buttons (may not exist if HTML not updated yet)
const btnFirst = document.getElementById('nav-first');
const btnPrev = document.getElementById('nav-prev');
const btnNext = document.getElementById('nav-next');
const btnLast = document.getElementById('nav-last');

// Theme initialization & toggle
function applyStoredTheme() {
    const stored = localStorage.getItem('chess-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const useDark = stored ? stored === 'dark' : prefersDark;
    if (useDark) {
        document.body.classList.add('dark');
        if (themeToggleInput) themeToggleInput.checked = true;
    }
}
applyStoredTheme();

// Board orientation based on chosen player color (stored by landing page)
function applyBoardOrientation() {
    const urlParams = new URLSearchParams(window.location.search);
    const sideParam = urlParams.get('side');
    let stored = null;
    try { stored = localStorage.getItem('playerColor'); } catch(_) {}
    const playerColor = (sideParam === 'Black' || sideParam === 'White') ? sideParam : (stored || 'White');
    if (sideParam && sideParam !== stored) {
        try { localStorage.setItem('playerColor', sideParam); } catch(_) {}
    }
    // If player chose Black, flip board so black pieces appear at bottom.
    const shouldFlip = playerColor === 'Black';
    document.body.classList.toggle('board-flipped', shouldFlip);
    console.log('[orientation] playerColor=', playerColor, 'flip=', shouldFlip);
    // Optional: update debug element if exists
    const dbg = document.getElementById('orientation-debug');
    if (dbg) dbg.textContent = `Player: ${playerColor} | flipped: ${shouldFlip}`;
}
applyBoardOrientation();

if (themeToggleInput) {
    themeToggleInput.addEventListener('change', () => {
        const dark = themeToggleInput.checked;
        document.body.classList.toggle('dark', dark);
        localStorage.setItem('chess-theme', dark ? 'dark' : 'light');
    });
}
const pieces = [
    ["Black Rook", "Black Knight", "Black Bishop", "Black Queen", "Black King", "Black Bishop", "Black Knight", "Black Rook"],
    ["Black Pawn", "Black Pawn", "Black Pawn", "Black Pawn", "Black Pawn", "Black Pawn", "Black Pawn", "Black Pawn"],
    [], [], [], [],
    ["White Pawn", "White Pawn", "White Pawn", "White Pawn", "White Pawn", "White Pawn", "White Pawn", "White Pawn"],
    ["White Rook", "White Knight", "White Bishop", "White Queen", "White King", "White Bishop", "White Knight", "White Rook"]
];

let selectedPiece = null;
let selectedSquare = null;
let turn = "White"; // White starts the game
let activeSelection = null; // stores {piece, fromRow, fromCol, moves}
// En passant state: stores the square a pawn landed on after a two-square advance
// { row, col, color } and is only valid for the very next opponent move
let enPassant = null;
let gameOver = false; // flag to stop interaction after checkmate
let moveHistory = []; // stores { ply, san, fullMoveNumber, color }
let positionHistory = []; // FEN positions (initial + after each move)
let currentPositionIndex = 0; // pointer into positionHistory
let promotionPending = false; // blocks AI move until user picks promotion piece
// Clock / Timer state
let baseMinutes = 0; // 0 = unlimited
let whiteTimeMs = 0;
let blackTimeMs = 0;
let activeClockInterval = null;
let clockRunning = false;
const clockWhiteEl = document.getElementById('clock-white');
const clockBlackEl = document.getElementById('clock-black');
// Removed unified wrapper; clocks positioned around board

// --- Sound Effect Setup (with autoplay unlock) ---
let soundEnabled = true;
let moveAudio = null;
let captureAudio = null;
let audioUnlocked = false;
let pendingSound = null; // {capture:boolean}
function initMoveSound(){
    if (!moveAudio) {
        moveAudio = new Audio('sounds/normal_moves.mp3');
        moveAudio.preload = 'auto';
        moveAudio.volume = 0.55;
    }
    if (!captureAudio) {
        captureAudio = new Audio('sounds/Capture.mp3');
        captureAudio.preload = 'auto';
        captureAudio.volume = 0.65;
    }
    try {
        const mv = moveAudio.volume, cv = captureAudio.volume;
        moveAudio.volume = 0; captureAudio.volume = 0;
        Promise.allSettled([moveAudio.play(), captureAudio.play()]).then(()=>{
            moveAudio.pause(); captureAudio.pause();
            moveAudio.currentTime = 0; captureAudio.currentTime = 0;
            moveAudio.volume = mv; captureAudio.volume = cv;
            audioUnlocked = true;
            if (pendingSound){ const cap = pendingSound.capture; pendingSound=null; playMoveSound(cap); }
        }).catch(()=>{});
    } catch(_) {}
}
initMoveSound();
const soundToggleBtn = document.getElementById('sound-toggle');
if (soundToggleBtn){
    soundToggleBtn.addEventListener('click', ()=>{
        soundEnabled = !soundEnabled;
        soundToggleBtn.setAttribute('aria-pressed', String(soundEnabled));
        soundToggleBtn.innerHTML = soundEnabled ? '🔊' : '🔇';
    });
}
function playMoveSound(isCapture=false){
    if (!soundEnabled) return;
    if (!audioUnlocked) { pendingSound = {capture:isCapture}; return; }
    const audio = isCapture ? captureAudio : moveAudio;
    if (!audio) return;
    try { audio.currentTime = 0; audio.play(); } catch(_) {}
}
['pointerdown','keydown','touchstart'].forEach(evt=>{
    window.addEventListener(evt, function once(){
        if (audioUnlocked) return;
        try {
            moveAudio.play().then(()=>{ moveAudio.pause(); moveAudio.currentTime=0; audioUnlocked=true; if (pendingSound){ const cap=pendingSound.capture; pendingSound=null; playMoveSound(cap);} });
        } catch(_) {}
        window.removeEventListener(evt, once, true);
    }, true);
});

// --- Simple Random Opponent State ---
let aiEnabled = true; // always enable simple random opponent for now
let playerColorChoice = 'White';
try { playerColorChoice = localStorage.getItem('playerColor') || 'White'; } catch(_) {}
// Player choice determines orientation only; random AI plays the opposite color
aiEnabled = true;
const aiColor = (playerColorChoice === 'White') ? 'Black' : 'White';
// Engine mode additions
let engineMode = 'tf';
let tfValueModel = null; let tfModelReady = false; let tfTrainingSamples = []; let tfGamesTrained = 0;
async function ensureTFModel(){
    if (tfModelReady) return tfValueModel;
    if (typeof tf === 'undefined') { console.warn('[tf-engine] tf.js not loaded, falling back to random'); engineMode='random'; return null; }
    // Simple tiny model (not trained) for demo; input = 64*12 + sideToMove (same as ml.js concept but simpler mapping)
    const existing = window.localStorage.getItem('tfEngineModelSaved');
    if (existing) {
        try {
            tfValueModel = await tf.loadLayersModel('indexeddb://tf-chess-eval');
            tfModelReady = true; return tfValueModel;
        } catch(e){ console.warn('[tf-engine] load failed', e); }
    }
    const model = tf.sequential();
    model.add(tf.layers.dense({inputShape:[773], units:96, activation:'relu'}));
    model.add(tf.layers.dense({units:48, activation:'relu'}));
    model.add(tf.layers.dense({units:1, activation:'tanh'}));
    model.compile({optimizer:'adam', loss:'meanSquaredError'});
    tfValueModel = model; tfModelReady = true;
    try { await model.save('indexeddb://tf-chess-eval'); localStorage.setItem('tfEngineModelSaved','1'); } catch(_) {}
    updateModelWeightsFromTF();
    return model;
}

function encodeBoardForTF(){
    // 773 features same mapping as ml.js encodeBoard
    const mapping = { Pawn:0, Knight:1, Bishop:2, Rook:3, Queen:4, King:5 };
    const arr = new Float32Array(773);
    for (let r=0;r<8;r++){
        for (let c=0;c<8;c++){
            const p = pieces[r][c];
            if (!p) continue;
            const [color, type] = p.split(' ');
            const base = mapping[type];
            const colorOffset = color === 'White' ? 0 : 6;
            const idx = (colorOffset + base) * 64 + (r*8+c);
            arr[idx] = 1;
        }
    }
    arr[768] = (turn === 'White') ? 1 : 0;
    // remaining indices unused (for parity with ml.js design up to 773 length)
    return arr;
}

async function evaluatePositionTF(){
    if (engineMode !== 'tf') return 0;
    const model = await ensureTFModel();
    if (!model) return 0;
    const enc = encodeBoardForTF();
    const pred = model.predict(tf.tensor2d([Array.from(enc)]));
    const data = await pred.data();
    pred.dispose();
    pred.dispose();
    return data[0];
}

async function selectMoveTF(allMoves){
    const model = await ensureTFModel();
    if (!model) return allMoves[Math.floor(Math.random()*allMoves.length)];
    let best = null; let bestScore = -Infinity;
    for (const mv of allMoves){
        // simulate move
        const pieceName = pieces[mv.fromR][mv.fromC];
        const captured = pieces[mv.toR][mv.toC];
        pieces[mv.toR][mv.toC] = pieceName;
        pieces[mv.fromR][mv.fromC] = null;
        const prevTurn = turn; turn = (turn==='White')?'Black':'White';
        const enc = encodeBoardForTF();
        const pred = tfValueModel.predict(tf.tensor2d([Array.from(enc)]));
        const score = (await pred.data())[0];
        pred.dispose();
        // undo
        turn = prevTurn;
        pieces[mv.fromR][mv.fromC] = pieceName;
        pieces[mv.toR][mv.toC] = captured;
        if (score > bestScore){ bestScore = score; best = mv; }
    }
    return best || allMoves[0];
}
// Track when an AI move is executing (for auto-promotion logic)
let aiMoveExecuting = false;
let aiAutoPromotion = null; // {row,col,finalPiece,letter}

function initClocks() {
    let stored = null; try { stored = localStorage.getItem('timeControlMinutes'); } catch(_) {}
    const urlParams = new URLSearchParams(window.location.search);
    const tcParam = urlParams.get('tc');
    let mins = parseInt(tcParam != null ? tcParam : (stored || '0'), 10);
    if (isNaN(mins) || mins < 0) mins = 0;
    baseMinutes = mins;
    if (baseMinutes === 0) return; // unlimited: leave clocks hidden
    whiteTimeMs = blackTimeMs = baseMinutes * 60 * 1000;
    if (clockWhiteEl) clockWhiteEl.style.display = 'flex';
    if (clockBlackEl) clockBlackEl.style.display = 'flex';
    updateClockDisplays();
    highlightActiveClock();
}

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function updateClockDisplays() {
    if (clockWhiteEl) clockWhiteEl.querySelector('.time').textContent = formatTime(whiteTimeMs);
    if (clockBlackEl) clockBlackEl.querySelector('.time').textContent = formatTime(blackTimeMs);
}

function highlightActiveClock() {
    if (baseMinutes === 0) return;
    clockWhiteEl.classList.toggle('active', turn === 'White');
    clockBlackEl.classList.toggle('active', turn === 'Black');
}

function startActiveClock() {
    if (baseMinutes === 0) return; // unlimited
    if (clockRunning) return;
    clockRunning = true;
    const startedTurn = turn; // capture whose clock to tick
    let last = performance.now();
    activeClockInterval = requestAnimationFrame(function tick(now){
        const dt = now - last; last = now;
        if (startedTurn === 'White') whiteTimeMs -= dt; else blackTimeMs -= dt;
        updateClockDisplays();
        // Flag when time <= 0 (simple loss on time)
        if ((startedTurn === 'White' && whiteTimeMs <= 0) || (startedTurn === 'Black' && blackTimeMs <= 0)) {
            endGameOnTime(startedTurn === 'White' ? 'Black' : 'White');
            return;
        }
        activeClockInterval = requestAnimationFrame(tick);
    });
}

function switchClockAfterMove() {
    if (baseMinutes === 0) return;
    // Stop current ticking frame; new one will start for next side when they move
    if (activeClockInterval) { cancelAnimationFrame(activeClockInterval); activeClockInterval = null; }
    clockRunning = false;
    highlightActiveClock();
    // Start new active clock (will tick for side to move)
    startActiveClock();
}

function endGameOnTime(winnerColor) {
    if (gameOver) return;
    gameOver = true;
    if (activeClockInterval) { cancelAnimationFrame(activeClockInterval); activeClockInterval = null; }
    clockRunning = false;
    const loser = winnerColor === 'White' ? 'Black' : 'White';
    if (resultBanner) resultBanner.textContent = winnerColor + ' wins on time';
    if (newGameBtn) newGameBtn.style.display = 'block';
    console.log('[clock] time over for', loser);
}

function isLegalMove(piece, fromRow, fromCol, toRow, toCol) {
    // Implement basic chess rules for legal moves
    if (piece.includes("Pawn")) {
        const direction = piece.includes("White") ? -1 : 1;
        const startRow = piece.includes("White") ? 6 : 1;
    const opponent = piece.includes("White") ? "Black" : "White";

        // Allow moving one square forward
        if (fromCol === toCol && toRow === fromRow + direction && !pieces[toRow][toCol]) {
            return true;
        }

        // Allow moving two squares forward on the first move
        if (fromCol === toCol && fromRow === startRow && toRow === fromRow + 2 * direction && !pieces[toRow][toCol]) {
            return true;
        }

        // Allow capturing diagonally
        if (Math.abs(toCol - fromCol) === 1 && toRow === fromRow + direction && pieces[toRow][toCol] &&
            pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White")) {
            return true;
        }

        // En passant capture: destination square empty, diagonal move, and target matches enPassant marker
        if (
            Math.abs(toCol - fromCol) === 1 &&
            toRow === fromRow + direction &&
            !pieces[toRow][toCol] &&
            enPassant &&
            enPassant.color === opponent &&
            enPassant.row === fromRow &&
            enPassant.col === toCol
        ) {
            return true;
        }
    } else if (piece.includes("Bishop")) {
        // Bishop moves diagonally
        if (Math.abs(toRow - fromRow) === Math.abs(toCol - fromCol)) {
            const rowStep = toRow > fromRow ? 1 : -1;
            const colStep = toCol > fromCol ? 1 : -1;
            let r = fromRow + rowStep;
            let c = fromCol + colStep;

            while (r !== toRow && c !== toCol) {
                if (pieces[r][c]) {
                    return false; // Path is blocked
                }
                r += rowStep;
                c += colStep;
            }

            // Ensure the destination is either empty or occupied by an opponent
            return !pieces[toRow][toCol] || pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White");
        }
    } else if (piece.includes("Knight")) {
        // Knight moves in an L shape
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        if ((rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2)) {
            // Ensure the destination is either empty or occupied by an opponent
            return !pieces[toRow][toCol] || pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White");
        }
    } else if (piece.includes("Rook")) {
        // Rook moves vertically or horizontally
        if (fromRow === toRow || fromCol === toCol) {
            const rowStep = fromRow === toRow ? 0 : (toRow > fromRow ? 1 : -1);
            const colStep = fromCol === toCol ? 0 : (toCol > fromCol ? 1 : -1);
            let r = fromRow + rowStep;
            let c = fromCol + colStep;

            while (r !== toRow || c !== toCol) {
                if (pieces[r][c]) {
                    return false; // Path is blocked
                }
                r += rowStep;
                c += colStep;
            }

            // Ensure the destination is either empty or occupied by an opponent
            return !pieces[toRow][toCol] || pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White");
        }
    } else if (piece.includes("Queen")) {
        // Queen moves diagonally, vertically, or horizontally
        if (fromRow === toRow || fromCol === toCol || Math.abs(toRow - fromRow) === Math.abs(toCol - fromCol)) {
            const rowStep = fromRow === toRow ? 0 : (toRow > fromRow ? 1 : -1);
            const colStep = fromCol === toCol ? 0 : (toCol > fromCol ? 1 : -1);
            let r = fromRow + rowStep;
            let c = fromCol + colStep;

            while (r !== toRow || c !== toCol) {
                if (pieces[r][c]) {
                    return false; // Path is blocked
                }
                r += rowStep;
                c += colStep;
            }

            // Ensure the destination is either empty or occupied by an opponent
            return !pieces[toRow][toCol] || pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White");
        }
    } else if (piece.includes("King")) {
        // King moves one square in any direction
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        if ((rowDiff <= 1 && colDiff <= 1) && !(rowDiff === 0 && colDiff === 0)) {
            return !pieces[toRow][toCol] || pieces[toRow][toCol].includes(piece.includes("White") ? "Black" : "White");
        }

        // Castling logic (player-initiated)
        if (fromRow === toRow && Math.abs(toCol - fromCol) === 2) {
            const rookCol = toCol > fromCol ? 7 : 0; // Kingside or Queenside
            const rookPiece = pieces[fromRow][rookCol];
            const opponent = piece.includes("White") ? "Black" : "White";

            if (
                rookPiece &&
                rookPiece.includes("Rook") &&
                !pieces[toRow][toCol] &&
                !pieces[fromRow][fromCol + (toCol > fromCol ? 1 : -1)] &&
                !pieces[fromRow][fromCol + (toCol > fromCol ? 2 : -2)]
            ) {
                // Ensure king not in check, squares passed over not attacked, and destination not attacked
                if (
                    !isSquareAttacked(pieces, fromRow, fromCol, opponent) &&
                    !isSquareAttacked(pieces, fromRow, fromCol + (toCol > fromCol ? 1 : -1), opponent) &&
                    !isSquareAttacked(pieces, toRow, toCol, opponent)
                ) {
                    return true;
                }
            }
        }
    }
    // Add rules for other pieces here
    return false;
}

// Compute all legal target squares for a piece at fromRow,fromCol
// Pseudo-legal moves (ignores self-check); used internally then filtered
function computePseudoLegalMoves(pieceName, fromRow, fromCol, board = pieces, enPassantState = enPassant) {
    // Optimized explicit generation for pawns to ensure diagonal captures appear
    if (pieceName.includes('Pawn')) {
        const moves = [];
        const direction = pieceName.includes('White') ? -1 : 1;
        const startRow = pieceName.includes('White') ? 6 : 1;
        const opponent = pieceName.includes('White') ? 'Black' : 'White';

        const oneStepRow = fromRow + direction;
        if (oneStepRow >= 0 && oneStepRow < 8) {
            // forward one if empty
            if (!pieces[oneStepRow][fromCol]) moves.push([oneStepRow, fromCol]);
            // forward two if starting row and path clear
            const twoStepRow = fromRow + 2 * direction;
            if (fromRow === startRow && twoStepRow >= 0 && twoStepRow < 8 && !pieces[oneStepRow][fromCol] && !pieces[twoStepRow][fromCol]) {
                moves.push([twoStepRow, fromCol]);
            }
            // captures
            const diagCols = [fromCol - 1, fromCol + 1];
            diagCols.forEach(dc => {
                if (dc >= 0 && dc < 8) {
                    const target = pieces[oneStepRow][dc];
                    if (target && target.includes(opponent)) {
                        moves.push([oneStepRow, dc]);
                    }
                }
            });
        }

        // En passant generation
        if (enPassantState && enPassantState.color === opponent) {
            // White pawn must be on row 3 (its 5th rank); Black pawn must be on row 4
            if (pieceName.includes('White') && fromRow === 3 && enPassantState.row === 3 && Math.abs(enPassantState.col - fromCol) === 1) {
                const targetRow = fromRow - 1; // direction -1
                if (!board[targetRow][enPassantState.col]) moves.push([targetRow, enPassantState.col]);
            } else if (pieceName.includes('Black') && fromRow === 4 && enPassantState.row === 4 && Math.abs(enPassantState.col - fromCol) === 1) {
                const targetRow = fromRow + 1; // direction +1
                if (!board[targetRow][enPassantState.col]) moves.push([targetRow, enPassantState.col]);
            }
        }
        return moves;
    }

    // Fallback: brute-force for other pieces (could be optimized later)
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (r === fromRow && c === fromCol) continue;
            if (isLegalMove(pieceName, fromRow, fromCol, r, c)) {
                moves.push([r, c]);
            }
        }
    }
    return moves;
}

// Determine if a square is attacked by any piece of attackerColor on given board
function isSquareAttacked(board, targetRow, targetCol, attackerColor) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (!piece || !piece.includes(attackerColor)) continue;
            const type = piece.split(' ')[1];
            switch (type) {
                case 'Pawn': {
                    const dir = attackerColor === 'White' ? -1 : 1;
                    if (r + dir === targetRow && Math.abs(c - targetCol) === 1) return true;
                    break;
                }
                case 'Knight': {
                    const dr = Math.abs(r - targetRow);
                    const dc = Math.abs(c - targetCol);
                    if ((dr === 2 && dc === 1) || (dr === 1 && dc === 2)) return true;
                    break;
                }
                case 'Bishop': {
                    if (Math.abs(r - targetRow) === Math.abs(c - targetCol)) {
                        const rs = targetRow > r ? 1 : -1;
                        const cs = targetCol > c ? 1 : -1;
                        let rr = r + rs, cc = c + cs, blocked = false;
                        while (rr !== targetRow && cc !== targetCol) {
                            if (board[rr][cc]) { blocked = true; break; }
                            rr += rs; cc += cs;
                        }
                        if (!blocked) return true;
                    }
                    break;
                }
                case 'Rook': {
                    if (r === targetRow || c === targetCol) {
                        const rs = r === targetRow ? 0 : (targetRow > r ? 1 : -1);
                        const cs = c === targetCol ? 0 : (targetCol > c ? 1 : -1);
                        let rr = r + rs, cc = c + cs, blocked = false;
                        while (rr !== targetRow || cc !== targetCol) {
                            if (board[rr][cc]) { blocked = true; break; }
                            rr += rs; cc += cs;
                        }
                        if (!blocked) return true;
                    }
                    break;
                }
                case 'Queen': {
                    if (r === targetRow || c === targetCol || Math.abs(r - targetRow) === Math.abs(c - targetCol)) {
                        const rs = r === targetRow ? 0 : (targetRow > r ? 1 : -1);
                        const cs = c === targetCol ? 0 : (targetCol > c ? 1 : -1);
                        let rr = r + rs, cc = c + cs, blocked = false;
                        while (rr !== targetRow || cc !== targetCol) {
                            if (board[rr][cc]) { blocked = true; break; }
                            rr += rs; cc += cs;
                        }
                        if (!blocked) return true;
                    }
                    break;
                }
                case 'King': {
                    if (Math.max(Math.abs(r - targetRow), Math.abs(c - targetCol)) === 1) return true;
                    break;
                }
            }
        }
    }
    return false;
}

function simulateMove(board, pieceName, fromRow, fromCol, toRow, toCol, enPassantState) {
    const newBoard = board.map(row => row.slice());
    const isPawn = pieceName.includes('Pawn');
    const direction = pieceName.includes('White') ? -1 : 1;
    let newEnPassant = null;
    let enPassantCapture = false;
    if (
        isPawn &&
        Math.abs(toCol - fromCol) === 1 &&
        toRow === fromRow + direction &&
        !board[toRow][toCol] &&
        enPassantState &&
        enPassantState.row === fromRow &&
        enPassantState.col === toCol &&
        enPassantState.color !== (pieceName.includes('White') ? 'White' : 'Black')
    ) {
        enPassantCapture = true;
    }
    if (enPassantCapture) {
        newBoard[fromRow][toCol] = null;
    }
    // Basic move
    newBoard[toRow][toCol] = pieceName; // Promotion power difference irrelevant for king safety
    newBoard[fromRow][fromCol] = null;
    // Handle castling rook move in simulation
    if (pieceName.includes('King') && Math.abs(toCol - fromCol) === 2) {
        const rookFromCol = toCol > fromCol ? 7 : 0;
        const rookToCol = toCol > fromCol ? toCol - 1 : toCol + 1;
        const rookPiece = board[fromRow][rookFromCol];
        if (rookPiece && rookPiece.includes('Rook')) {
            newBoard[fromRow][rookToCol] = rookPiece;
            newBoard[fromRow][rookFromCol] = null;
        }
    }
    // En passant availability
    if (isPawn && Math.abs(toRow - fromRow) === 2) {
        newEnPassant = { row: toRow, col: toCol, color: (pieceName.includes('White') ? 'White' : 'Black') };
    }
    return { board: newBoard, enPassant: newEnPassant };
}

function wouldLeaveKingInCheck(pieceName, fromRow, fromCol, toRow, toCol) {
    const color = pieceName.includes('White') ? 'White' : 'Black';
    const opponent = color === 'White' ? 'Black' : 'White';
    const { board: simBoard, enPassant: newEP } = simulateMove(pieces, pieceName, fromRow, fromCol, toRow, toCol, enPassant);
    // Locate king
    let kRow = -1, kCol = -1;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (simBoard[r][c] === color + ' King') { kRow = r; kCol = c; break; }
        }
        if (kRow !== -1) break;
    }
    if (kRow === -1) return true; // king missing -> invalid
    return isSquareAttacked(simBoard, kRow, kCol, opponent);
}

function getLegalMoves(pieceName, fromRow, fromCol) {
    const pseudo = computePseudoLegalMoves(pieceName, fromRow, fromCol);
    return pseudo.filter(([r,c]) => !wouldLeaveKingInCheck(pieceName, fromRow, fromCol, r, c));
}

function isKingInCheck(color) {
    // find king
    let kr = -1, kc = -1;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (pieces[r][c] === color + ' King') { kr = r; kc = c; break; }
        }
        if (kr !== -1) break;
    }
    if (kr === -1) return false;
    const opponent = color === 'White' ? 'Black' : 'White';
    return isSquareAttacked(pieces, kr, kc, opponent);
}

function sideHasAnyLegalMove(color) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = pieces[r][c];
            if (!piece || !piece.includes(color)) continue;
            const moves = getLegalMoves(piece, r, c);
            if (moves.length > 0) return true;
        }
    }
    return false;
}

function evaluateCheckState(updateLast = false) {
    if (gameOver) return;
    const colorToMove = turn; // side about to move
    const inCheck = isKingInCheck(colorToMove);
    const hasMove = sideHasAnyLegalMove(colorToMove);
    if (updateLast && moveHistory.length > 0) {
        const last = moveHistory[moveHistory.length - 1];
        // strip any trailing +/# first
        last.san = last.san.replace(/[+#]+$/, '');
        if (inCheck && !hasMove) {
            last.san += '#';
            if (resultBanner) {
                resultBanner.textContent = (last.color === 'White' ? 'White' : 'Black') + ' wins by checkmate';
                resultBanner.classList.add('visible');
            }
            if (newGameBtn) newGameBtn.style.display = 'block';
            gameOver = true;
        } else if (inCheck) {
            last.san += '+';
        } else if (!inCheck && !hasMove) {
            // stalemate
            if (resultBanner) {
                resultBanner.textContent = 'Draw by stalemate';
                resultBanner.classList.add('visible');
            }
            if (newGameBtn) newGameBtn.style.display = 'block';
            gameOver = true;
        }
        renderHistory();
    }
}

if (newGameBtn){
    newGameBtn.addEventListener('click', ()=>{
        // Optional: clear stored side so user chooses again
        try { localStorage.removeItem('playerColor'); } catch(_) {}
        window.location.href = 'landing.html';
    });
}

// Remove existing move indicators
function clearIndicators() {
    document.querySelectorAll('.move-indicator').forEach(el => el.remove());
}

// Show faded circle indicators on target squares; clicking indicator moves the piece
function showIndicators(moves, fromRow, fromCol, pieceName) {
    clearIndicators();
    // Clear old square-level capture targets
    document.querySelectorAll('.chessboard div.capture-target').forEach(sq => sq.classList.remove('capture-target'));
    moves.forEach(([r, c]) => {
        const sq = document.querySelector(`[data-row='${r}'][data-col='${c}']`);
        if (!sq) return;
        // Remove any previous indicator in this square to avoid layering
        const prev = sq.querySelector('.move-indicator');
        if (prev) prev.remove();
        const indicator = document.createElement('div');
        indicator.className = 'move-indicator';
        // mark captures differently
        let isCapture = !!pieces[r][c];
        // Detect en passant capture highlight (destination square empty but qualifies)
        if (!isCapture && pieceName && pieceName.includes('Pawn') && enPassant) {
            const direction = pieceName.includes('White') ? -1 : 1;
            if (
                Math.abs(c - fromCol) === 1 &&
                r === fromRow + direction &&
                !pieces[r][c] &&
                enPassant.col === c &&
                enPassant.row === fromRow &&
                enPassant.color === (pieceName.includes('White') ? 'Black' : 'White')
            ) {
                isCapture = true;
            }
        }
        if (isCapture) {
            indicator.classList.add('capture');
            // Inline styles to guarantee red ring even if CSS not refreshed
            indicator.style.background = 'radial-gradient(circle, rgba(200,40,40,0.15) 55%, transparent 56%)';
            indicator.style.border = '5px solid rgba(200,40,40,0.96)';
            indicator.style.width = '76%';
            indicator.style.height = '76%';
            indicator.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.92), 0 2px 10px rgba(0,0,0,0.45)';
            indicator.style.zIndex = '500';
            indicator.style.boxSizing = 'border-box';
            console.log('[capture-indicator] adding for', r, c, 'piece:', pieces[r][c]);
            // Add square-level ring class too
            sq.classList.add('capture-target');
        } else {
            console.log('[quiet-indicator] adding for', r, c);
        }
        indicator.dataset.toRow = r;
        indicator.dataset.toCol = c;
        indicator.dataset.fromRow = fromRow;
        indicator.dataset.fromCol = fromCol;

        // clicking an indicator moves the piece
        indicator.addEventListener('click', (e) => {
            e.stopPropagation();
            const toRow = parseInt(indicator.dataset.toRow);
            const toCol = parseInt(indicator.dataset.toCol);
            movePieceTo(fromRow, fromCol, toRow, toCol);
            clearIndicators();
        });

        // allow dragging a piece onto the indicator: forward drag events to the same move logic
        indicator.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        indicator.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // compute target coords and attempt move using the same move function
            const toRow = parseInt(indicator.dataset.toRow);
            const toCol = parseInt(indicator.dataset.toCol);
            const fromRow = parseInt(indicator.dataset.fromRow);
            const fromCol = parseInt(indicator.dataset.fromCol);

            // If a piece is currently being dragged, perform the move
            if (selectedPiece && isLegalMove(selectedPiece.dataset.piece, fromRow, fromCol, toRow, toCol)) {
                movePieceTo(fromRow, fromCol, toRow, toCol);
                clearIndicators();
            }
        });

        sq.appendChild(indicator);

        // Fallback: if for some reason indicator not in DOM (rare), add a square border
        setTimeout(() => {
            if (!sq.contains(indicator)) {
                console.warn('[indicator-missing] fallback border applied', r, c);
                if (pieces[r][c]) {
                    sq.classList.add('capture-target');
                } else {
                    sq.style.outline = '3px solid rgba(91,58,41,0.6)';
                }
            }
        }, 30);
    });
}

// Move piece logic reused by drag/drop and indicator click
function movePieceTo(fromRow, fromCol, toRow, toCol) {
    const fromSquare = document.querySelector(`[data-row='${fromRow}'][data-col='${fromCol}']`);
    const toSquare = document.querySelector(`[data-row='${toRow}'][data-col='${toCol}']`);
    const img = fromSquare ? fromSquare.querySelector('img') : null;
    if (!img) return;
    if (gameOver) return;

    // ensure move still legal (defensive)
    if (!isLegalMove(img.dataset.piece, fromRow, fromCol, toRow, toCol)) return;

    const isPawn = img.dataset.piece.includes('Pawn');
    const direction = img.dataset.piece.includes('White') ? -1 : 1;
    // Detect en passant capture (destination empty, diagonal pawn move, matches enPassant state)
    let enPassantCapture = false;
    if (
        isPawn &&
        Math.abs(toCol - fromCol) === 1 &&
        toRow === fromRow + direction &&
        !pieces[toRow][toCol] &&
        enPassant &&
        enPassant.row === fromRow &&
        enPassant.col === toCol &&
        enPassant.color !== (img.dataset.piece.includes('White') ? 'White' : 'Black')
    ) {
        enPassantCapture = true;
    }

    // capture
    let capturedPiece = null;
    if (pieces[toRow][toCol]) {
        capturedPiece = pieces[toRow][toCol];
        const captured = toSquare.querySelector('img');
        if (captured) captured.remove();
    } else if (enPassantCapture) {
        const capturedSquare = document.querySelector(`[data-row='${fromRow}'][data-col='${toCol}']`);
        const capturedImg = capturedSquare ? capturedSquare.querySelector('img') : null;
        if (capturedImg) capturedImg.remove();
        capturedPiece = pieces[fromRow][toCol];
        pieces[fromRow][toCol] = null;
    }

    // handle castling if king moves two squares
    if (img.dataset.piece.includes('King') && Math.abs(toCol - fromCol) === 2) {
        handleCastling(fromRow, fromCol, toRow, toCol);
    }

    toSquare.appendChild(img);
    pieces[toRow][toCol] = img.dataset.piece;
    pieces[fromRow][fromCol] = null;
    img.dataset.row = toRow;
    img.dataset.col = toCol;

    // pawn promotion
    if (isPawn) {
        handlePawnPromotion(toRow, toCol, img.dataset.piece);
    }

    // Update en passant state: set if a pawn just moved two squares; otherwise clear.
    const movedTwo = isPawn && Math.abs(toRow - fromRow) === 2;
    if (movedTwo) {
        enPassant = { row: toRow, col: toCol, color: (img.dataset.piece.includes('White') ? 'White' : 'Black') };
    } else {
        enPassant = null;
    }

    // Determine special notation (castling or en passant)
    let special = '';
    if (img.dataset.piece.includes('King') && Math.abs(toCol - fromCol) === 2) {
        special = toCol > fromCol ? 'O-O' : 'O-O-O';
    } else if (enPassantCapture) {
        special = 'ep';
    }

    // Record move before flipping turn
    recordMove(img.dataset.piece, fromRow, fromCol, toRow, toCol, capturedPiece, false, false, special);

    // Finalize any queued AI auto-promotion (promotion decided instantly by engine)
    if (aiAutoPromotion && aiAutoPromotion.row === toRow && aiAutoPromotion.col === toCol) {
        const finalPiece = aiAutoPromotion.finalPiece;
        pieces[toRow][toCol] = finalPiece;
        if (img) {
            img.src = pieceFilename(finalPiece);
            img.alt = finalPiece;
            img.dataset.piece = finalPiece;
        }
        const last = moveHistory[moveHistory.length -1];
        if (last && !/=/.test(last.san)) {
            const m = last.san.match(/([+#]+)$/);
            if (m) {
                last.san = last.san.slice(0, -m[0].length) + '=' + aiAutoPromotion.letter + m[0];
            } else {
                last.san += '=' + aiAutoPromotion.letter;
            }
            renderHistory();
        }
        aiAutoPromotion = null;
    }

    // Play move sound (capture vs normal)
    playMoveSound(!!capturedPiece || enPassantCapture);

    turn = turn === 'White' ? 'Black' : 'White';
    activeSelection = null;

    // cleanup any capture rings on board (they will be redrawn next selection)
    document.querySelectorAll('.capture-ring').forEach(r => r.remove());
    document.querySelectorAll('.chessboard div.capture-target').forEach(sq => sq.classList.remove('capture-target'));

    evaluateCheckState(true);
    // Save new position in history after evaluation (so check markers already applied to SAN)
    saveCurrentPositionFEN();
    currentPositionIndex = positionHistory.length - 1;
    // Update material balance after each completed move
    if (typeof updateMaterialBalance === 'function') {
        try { updateMaterialBalance(); } catch(_) {}
    }
    updateNavDisabled();
    // Switch and start clocks for next player
    switchClockAfterMove();

    // Trigger AI reply if enabled and it's now the AI's turn (supports AI as White or Black)
    if (!promotionPending && aiEnabled && turn === aiColor && currentPositionIndex === positionHistory.length -1) {
        setTimeout(()=> maybeTriggerAI(), 400);
    }
}

// Clear indicators when clicking outside
document.addEventListener('click', () => clearIndicators());

function setupBoard() {
    // Create file (a-h) labels
    const fileLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rankLabels = ['8', '7', '6', '5', '4', '3', '2', '1'];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.className = (row + col) % 2 === 0 ? 'white' : 'black';
            square.dataset.row = row;
            square.dataset.col = col;

            // Add file and rank labels
            if (row === 7) {
                const fileLabel = document.createElement('span');
                fileLabel.textContent = fileLabels[col];
                fileLabel.className = 'file-label';
                square.appendChild(fileLabel);
            }

            if (col === 0) {
                const rankLabel = document.createElement('span');
                rankLabel.textContent = rankLabels[row];
                rankLabel.className = 'rank-label';
                square.appendChild(rankLabel);
            }

            if (pieces[row] && pieces[row][col]) {
                const pieceName = pieces[row][col];
                const img = document.createElement('img');
                img.src = `sprites/${pieceName.replace(/ /g, '_')}.png`;
                img.alt = pieceName;
                img.draggable = true;
                img.dataset.piece = pieceName;
                img.dataset.row = row;
                img.dataset.col = col;

                img.addEventListener('dragstart', (e) => {
                    selectedPiece = e.target;
                    selectedSquare = square;
                    // Provide a custom drag image so rotation stacking doesn't flip the sprite
                    if (document.body.classList.contains('board-flipped') && e.dataTransfer) {
                        try {
                            const clone = e.target.cloneNode(true);
                            clone.style.transform = 'none';
                            clone.style.position = 'absolute';
                            clone.style.top = '-200px';
                            clone.style.left = '-200px';
                            clone.style.pointerEvents = 'none';
                            clone.style.width = e.target.clientWidth + 'px';
                            clone.style.height = e.target.clientHeight + 'px';
                            document.body.appendChild(clone);
                            e.dataTransfer.setDragImage(clone, clone.clientWidth/2, clone.clientHeight/2);
                            e.target._dragClone = clone;
                        } catch(_) {}
                    }
                });
                img.addEventListener('dragend', (e)=>{
                    if (e.target._dragClone) {
                        try { document.body.removeChild(e.target._dragClone); } catch(_) {}
                        delete e.target._dragClone;
                    }
                });

                // Click handler to show legal moves
                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (gameOver) return;
                    // Block interaction if not at the latest position (time-travel mode)
                    if (currentPositionIndex !== positionHistory.length - 1) return;
                    const pieceColor = img.dataset.piece.includes('White') ? 'White' : 'Black';
                    const fromRow = parseInt(img.dataset.row);
                    const fromCol = parseInt(img.dataset.col);

                    // If clicking an opponent piece while a selection is active, attempt capture
                    if (activeSelection && pieceColor !== turn && activeSelection.piece.includes(turn)) {
                        const targetRow = fromRow;
                        const targetCol = fromCol;
                        // See if target square is within the precomputed moves
                        const match = activeSelection.moves.some(([r,c]) => r === targetRow && c === targetCol);
                        if (match) {
                            movePieceTo(activeSelection.fromRow, activeSelection.fromCol, targetRow, targetCol);
                            clearIndicators();
                            updateMovePanel(activeSelection.piece, activeSelection.fromRow, activeSelection.fromCol, []);
                            return;
                        }
                    }

                    // Only allow (re)selecting own piece when it's your turn
                    if (pieceColor !== turn) return;

                    const legalMoves = getLegalMoves(img.dataset.piece, fromRow, fromCol);
                    activeSelection = { piece: img.dataset.piece, fromRow, fromCol, moves: legalMoves };

                    if (legalMoves.length > 0) {
                        showIndicators(legalMoves, fromRow, fromCol, img.dataset.piece);
                    } else {
                        clearIndicators();
                    }
                });

                square.appendChild(img);
            }

            square.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            square.addEventListener('drop', (e) => {
                e.preventDefault();
                if (gameOver) return;
                const toRow = parseInt(square.dataset.row);
                const toCol = parseInt(square.dataset.col);
                const fromRow = parseInt(selectedPiece.dataset.row);
                const fromCol = parseInt(selectedPiece.dataset.col);
                if (selectedPiece) {
                    if ((turn === 'White' && selectedPiece.dataset.piece.includes('White')) ||
                        (turn === 'Black' && selectedPiece.dataset.piece.includes('Black'))) {
                        if (isLegalMove(selectedPiece.dataset.piece, fromRow, fromCol, toRow, toCol)) {
                            movePieceTo(fromRow, fromCol, toRow, toCol);
                        } else {
                            // noop or feedback
                        }
                    }
                }
                selectedPiece = null;
                selectedSquare = null;
            });

            chessboard.appendChild(square);
        }
    }
}

// Legacy hook (previously updated side panel during selection). Provide harmless stub to avoid errors.
function updateMovePanel(){ /* intentionally empty; panel logic consolidated elsewhere */ }

function handleCastling(fromRow, fromCol, toRow, toCol) {
    if (Math.abs(toCol - fromCol) === 2) {
        const rookCol = toCol > fromCol ? 7 : 0; // Kingside or Queenside
        const rookTargetCol = toCol > fromCol ? toCol - 1 : toCol + 1;
        const rookPiece = pieces[fromRow][rookCol];

        if (rookPiece && rookPiece.includes("Rook")) {
            // Move the rook to its new position
            const rookSquare = document.querySelector(`[data-row='${fromRow}'][data-col='${rookCol}']`);
            const targetSquare = document.querySelector(`[data-row='${fromRow}'][data-col='${rookTargetCol}']`);

            const rookImg = rookSquare.querySelector('img');
            if (rookImg) {
                targetSquare.appendChild(rookImg);
                pieces[fromRow][rookTargetCol] = rookPiece;
                pieces[fromRow][rookCol] = null;
                // Update dataset so future interactions use the correct coordinates
                rookImg.dataset.row = fromRow;
                rookImg.dataset.col = rookTargetCol;
            }
        }
    }
}

function handlePawnPromotion(row, col, piece) {
    if ((piece.includes("White") && row === 0) || (piece.includes("Black") && row === 7)) {
        const color = piece.includes("White") ? "White" : "Black";
        // If it's the AI's pawn, auto-promote (always to Queen for now)
        if (aiMoveExecuting && color === aiColor) {
            aiAutoPromotion = { row, col, finalPiece: color + ' Queen', letter: 'Q' };
            return; // defer finalization until after recordMove
        }
        promotionPending = true;
        const promotionOptions = ["Queen", "Rook", "Bishop", "Knight"];
        const promotionScreen = document.createElement('div');
        promotionScreen.className = 'promotion-screen';
        promotionScreen.style.position = 'absolute';
        promotionScreen.style.top = '50%';
        promotionScreen.style.left = '50%';
        promotionScreen.style.transform = 'translate(-50%, -50%)';
        promotionScreen.style.backgroundColor = '#fff';
        promotionScreen.style.border = '2px solid black';
        promotionScreen.style.padding = '10px';
        promotionScreen.style.zIndex = '1000';
        promotionScreen.style.display = 'flex';
        promotionScreen.style.justifyContent = 'space-around';
        promotionScreen.style.alignItems = 'center';
        promotionScreen.style.width = '340px';

        promotionOptions.forEach(option => {
            const button = document.createElement('button');
            button.style.margin = '5px';
            button.style.border = '1px solid #ccc';
            button.style.background = '#fafafa';
            button.style.cursor = 'pointer';
            button.style.padding = '6px';
            button.style.display = 'flex';
            button.style.flexDirection = 'column';
            button.style.alignItems = 'center';
            button.setAttribute('aria-label', option);

            const img = document.createElement('img');
            const newPiece = `${piece.includes("White") ? "White" : "Black"} ${option}`;
            // encode the URI to handle spaces/special chars in filenames
            img.src = pieceFilename(newPiece);
            img.alt = newPiece;
            img.style.width = '56px';
            img.style.height = '56px';
            img.style.display = 'block';

            // If image fails to load, show the option text as fallback and log the error
            img.onerror = () => {
                console.error('Failed to load promotion sprite:', img.src);
                // remove broken img and show text label instead
                if (img.parentNode) img.parentNode.removeChild(img);
                const label = document.createElement('div');
                label.textContent = option;
                label.style.fontSize = '12px';
                label.style.color = '#333';
                button.appendChild(label);
            };

            // Keep a small text label under the sprite so you always see something
            const textLabel = document.createElement('div');
            textLabel.textContent = option;
            textLabel.style.fontSize = '12px';
            textLabel.style.marginTop = '4px';

            button.appendChild(img);
            button.appendChild(textLabel);

            button.addEventListener('click', () => {
                const finalPiece = `${piece.includes("White") ? "White" : "Black"} ${option}`;
                pieces[row][col] = finalPiece;
                const square = document.querySelector(`[data-row='${row}'][data-col='${col}']`);
                const pawnImg = square.querySelector('img');
                if (pawnImg) {
                    pawnImg.src = pieceFilename(finalPiece);
                    pawnImg.alt = finalPiece;
                    // Critical: update dataset so future move generation treats it as new piece type
                    pawnImg.dataset.piece = finalPiece;
                }
                // Update last move SAN to include promotion (e.g., e8=Q)
                if (moveHistory.length) {
                    const last = moveHistory[moveHistory.length -1];
                    // Only modify if it was a pawn move without existing = sign
                    if (!/=/.test(last.san)) {
                        const promoLetterMap = { Queen:'Q', Rook:'R', Bishop:'B', Knight:'N' };
                        const letter = promoLetterMap[option] || option[0].toUpperCase();
                        // Insert before check/mate symbols if present
                        const m = last.san.match(/([+#]+)$/);
                        if (m) {
                            last.san = last.san.slice(0, -m[0].length) + '=' + letter + m[0];
                        } else {
                            last.san = last.san + '=' + letter;
                        }
                        renderHistory();
                    }
                }
                // Re-evaluate check state in case promotion gives immediate check/mate
                evaluateCheckState(true);
                // Replace last FEN (position after move) with updated piece type
                if (positionHistory.length) {
                    positionHistory[positionHistory.length -1] = generateFEN();
                }
                document.body.removeChild(promotionScreen);
                promotionPending = false;
                // Promotion changes material balance
                if (typeof updateMaterialBalance === 'function') { try { updateMaterialBalance(); } catch(_) {} }
                // If it's AI's turn now, trigger its move after promotion resolution
                if (aiEnabled && turn === aiColor && !gameOver) {
                    setTimeout(()=> maybeTriggerAI(), 300);
                }
            });

            promotionScreen.appendChild(button);
        });

        document.body.appendChild(promotionScreen);
    }
}

function pieceFilename(name) {
    return 'sprites/' + name.replace(/ /g, '_') + '.png';
}

// Convert board coordinates to algebraic like 'd4'
function toAlgebraic(row, col) {
    const files = ['a','b','c','d','e','f','g','h'];
    const ranks = ['8','7','6','5','4','3','2','1'];
    return files[col] + ranks[row];
}

function recordMove(pieceName, fromRow, fromCol, toRow, toCol, capturedPiece, isCheck, isMate, special='') {
    const color = pieceName.includes('White') ? 'White' : 'Black';
    const pieceType = pieceName.split(' ')[1];
    const dest = toAlgebraic(toRow, toCol);
    let sanPiece = '';
    if (pieceType !== 'Pawn') {
        // Explicit mapping so Knight becomes N (not K which is King)
        const symbolMap = { King: 'K', Queen: 'Q', Rook: 'R', Bishop: 'B', Knight: 'N' };
        sanPiece = symbolMap[pieceType] || pieceType[0];
    }
    let san = '';
    if (special === 'O-O' || special === 'O-O-O') {
        san = special;
    } else {
        if (pieceType === 'Pawn' && capturedPiece) {
            san += toAlgebraic(fromRow, fromCol)[0];
        } else {
            san += sanPiece;
        }
        if (capturedPiece) san += 'x';
        san += dest;
        if (special === 'ep') san += ' e.p.';
    }
    if (isMate) san += '#'; else if (isCheck) san += '+';
    const ply = moveHistory.length + 1;
    const fullMoveNumber = Math.ceil(ply / 2);
    moveHistory.push({ ply, san, fullMoveNumber, color });
    renderHistory();
}

function renderHistory() {
    if (!historyBody) return;
    historyBody.innerHTML = '';
    for (let i = 0; i < moveHistory.length; i += 2) {
        const whiteMove = moveHistory[i];
        const blackMove = moveHistory[i + 1];
        const tr = document.createElement('tr');
    tr.className = 'odd:bg-[rgba(91,58,41,0.06)] even:bg-[rgba(245,245,220,0.55)]';
        const numTd = document.createElement('td');
        numTd.textContent = whiteMove.fullMoveNumber;
        const whiteTd = document.createElement('td');
        whiteTd.textContent = whiteMove ? whiteMove.san : '';
        const blackTd = document.createElement('td');
        blackTd.textContent = blackMove ? blackMove.san : '';
        // Clickable navigation: clicking white move goes to position after that ply; black move likewise.
        if (whiteMove) {
            whiteTd.style.cursor = 'pointer';
            whiteTd.addEventListener('click', () => {
                // position index equals ply number (since we stored initial position at index 0): ply -> index
                const targetIndex = whiteMove.ply; // after white move applied
                if (positionHistory[targetIndex]) {
                    currentPositionIndex = targetIndex;
                    loadPositionFromFEN(positionHistory[targetIndex]);
                    updateNavDisabled();
                    highlightSelectedRow(tr);
                }
            });
        }
        if (blackMove) {
            blackTd.style.cursor = 'pointer';
            blackTd.addEventListener('click', () => {
                const targetIndex = blackMove.ply; // after black move
                if (positionHistory[targetIndex]) {
                    currentPositionIndex = targetIndex;
                    loadPositionFromFEN(positionHistory[targetIndex]);
                    updateNavDisabled();
                    highlightSelectedRow(tr);
                }
            });
        }
        tr.appendChild(numTd);
        tr.appendChild(whiteTd);
        tr.appendChild(blackTd);
        historyBody.appendChild(tr);
    }
    // Auto-scroll to newest move
    if (historyWrapper) {
        // If user scrolled up significantly (>50px from bottom) don't force-scroll
        const distanceFromBottom = historyWrapper.scrollHeight - historyWrapper.scrollTop - historyWrapper.clientHeight;
        if (distanceFromBottom < 80) {
            requestAnimationFrame(() => {
                historyWrapper.scrollTop = historyWrapper.scrollHeight;
            });
        }
    }
}

setupBoard();

// Re-apply orientation after initial render (in case classes added before board DOM ready)
setTimeout(applyBoardOrientation, 0);

// -------------- FEN / Position History --------------
function pieceToFENChar(name) {
    const color = name.includes('White') ? 'w' : 'b';
    const type = name.split(' ')[1];
    const map = { King:'k', Queen:'q', Rook:'r', Bishop:'b', Knight:'n', Pawn:'p' };
    const ch = map[type] || '?';
    return color === 'w' ? ch.toUpperCase() : ch;
}

function generateFEN() {
    const rows = [];
    for (let r=0;r<8;r++) {
        let rowStr=''; let empty=0;
        for (let c=0;c<8;c++) {
            const p = pieces[r][c];
            if (!p) { empty++; continue; }
            if (empty>0){ rowStr += empty; empty=0; }
            rowStr += pieceToFENChar(p);
        }
        if (empty>0) rowStr+=empty;
        rows.push(rowStr);
    }
    const active = turn[0].toLowerCase();
    const castling = '-'; // castling rights not tracked yet
    let ep = '-';
    if (enPassant) {
        const epTargetRow = enPassant.color === 'White' ? enPassant.row + 1 : enPassant.row - 1;
        if (epTargetRow >=0 && epTargetRow <8) ep = toAlgebraic(epTargetRow, enPassant.col);
    }
    const halfmove = 0; // not tracked
    const fullmove = Math.ceil((moveHistory.length + 1)/2);
    return rows.join('/') + ' ' + active + ' ' + castling + ' ' + ep + ' ' + halfmove + ' ' + fullmove;
}

function saveCurrentPositionFEN() {
    const fen = generateFEN();
    if (positionHistory[positionHistory.length -1] !== fen) {
        positionHistory.push(fen);
    }
}

function fenCharToPiece(ch) {
    const isWhite = ch === ch.toUpperCase();
    const map = { k:'King', q:'Queen', r:'Rook', b:'Bishop', n:'Knight', p:'Pawn' };
    return (isWhite ? 'White ' : 'Black ') + map[ch.toLowerCase()];
}

function loadPositionFromFEN(fen) {
    const parts = fen.split(' ');
    const placement = parts[0];
    const active = parts[1];
    const rows = placement.split('/');
    for (let r=0;r<8;r++) {
        pieces[r] = new Array(8).fill(null);
        let file = 0;
        for (const ch of rows[r]) {
            if (/^[1-8]$/.test(ch)) { file += parseInt(ch,10); continue; }
            const pieceName = fenCharToPiece(ch);
            pieces[r][file] = pieceName;
            file++;
        }
    }
    turn = active === 'w' ? 'White' : 'Black';
    enPassant = null; // simplified (not reconstructing EP square)
    rerenderBoard();
    if (typeof updateMaterialBalance === 'function') { try { updateMaterialBalance(); } catch(_) {} }
}

function rerenderBoard() {
    document.querySelectorAll('.chessboard img').forEach(img => img.remove());
    for (let r=0;r<8;r++) {
        for (let c=0;c<8;c++) {
            const pieceName = pieces[r][c];
            if (!pieceName) continue;
            const square = document.querySelector(`[data-row='${r}'][data-col='${c}']`);
            if (!square) continue;
            const img = document.createElement('img');
            img.src = `sprites/${pieceName.replace(/ /g,'_')}.png`;
            img.alt = pieceName;
            img.draggable = true;
            img.dataset.piece = pieceName;
            img.dataset.row = r;
            img.dataset.col = c;
            img.addEventListener('dragstart', (e)=>{ selectedPiece = e.target; selectedSquare = square; });
            img.addEventListener('dragstart', (e) => {
                // Provide custom drag image when flipped (same logic as initial setup)
                if (document.body.classList.contains('board-flipped') && e.dataTransfer) {
                    try {
                        const clone = e.target.cloneNode(true);
                        clone.style.transform = 'none';
                        clone.style.position = 'absolute';
                        clone.style.top = '-200px';
                        clone.style.left = '-200px';
                        clone.style.pointerEvents = 'none';
                        clone.style.width = e.target.clientWidth + 'px';
                        clone.style.height = e.target.clientHeight + 'px';
                        document.body.appendChild(clone);
                        e.dataTransfer.setDragImage(clone, clone.clientWidth/2, clone.clientHeight/2);
                        e.target._dragClone = clone;
                    } catch(_) {}
                }
            });
            img.addEventListener('dragend', (e)=>{
                if (e.target._dragClone) {
                    try { document.body.removeChild(e.target._dragClone); } catch(_) {}
                    delete e.target._dragClone;
                }
            });
            img.addEventListener('click', (e)=>{
                e.stopPropagation();
                if (gameOver) return;
                if (currentPositionIndex !== positionHistory.length -1) return; // locked during review
                const pieceColor = img.dataset.piece.includes('White') ? 'White' : 'Black';
                const fromRow = parseInt(img.dataset.row);
                const fromCol = parseInt(img.dataset.col);
                if (activeSelection && pieceColor !== turn && activeSelection.piece.includes(turn)) {
                    const match = activeSelection.moves.some(([r2,c2]) => r2===fromRow && c2===fromCol);
                    if (match) {
                        movePieceTo(activeSelection.fromRow, activeSelection.fromCol, fromRow, fromCol);
                        clearIndicators();
                        return;
                    }
                }
                if (pieceColor !== turn) return;
                const legalMoves = getLegalMoves(img.dataset.piece, fromRow, fromCol);
                activeSelection = { piece: img.dataset.piece, fromRow, fromCol, moves: legalMoves };
                if (legalMoves.length>0) showIndicators(legalMoves, fromRow, fromCol, img.dataset.piece); else clearIndicators();
            });
            square.appendChild(img);
        }
    }
}

function updateNavDisabled() {
    if (!btnFirst) return;
    const atStart = currentPositionIndex === 0;
    const atEnd = currentPositionIndex === positionHistory.length -1;
    btnFirst.disabled = atStart; btnPrev.disabled = atStart;
    btnNext.disabled = atEnd; btnLast.disabled = atEnd;
}

// ---- Random AI Helper ----
function maybeTriggerAI(){
    if (!aiEnabled) return;
    if (turn !== aiColor) return; // wait until AI's turn
    // Gather all legal moves for AI color
    const aiPieces = [];
    for (let r=0;r<8;r++) {
        for (let c=0;c<8;c++) {
            const p = pieces[r][c];
            if (p && p.includes(aiColor)) aiPieces.push({p,r,c});
        }
    }
    const allMoves = [];
    aiPieces.forEach(obj => {
        const ms = getLegalMoves(obj.p, obj.r, obj.c);
        ms.forEach(([tr,tc]) => allMoves.push({fromR:obj.r, fromC:obj.c, toR:tr, toC:tc}));
    });
    if (!allMoves.length) return; // stalemate or checkmate handled elsewhere
    const go = async ()=>{
        let choice;
        if (engineMode === 'tf') {
            try { choice = await selectMoveTF(allMoves); } catch(e){ console.warn('[tf-engine] selection failed, fallback random', e); choice = allMoves[Math.floor(Math.random()*allMoves.length)]; }
        } else {
            choice = allMoves[Math.floor(Math.random() * allMoves.length)];
        }
        aiMoveExecuting = true;
        try { movePieceTo(choice.fromR, choice.fromC, choice.toR, choice.toC); } finally { aiMoveExecuting = false; }
        playMoveSound(false);
        if (engineMode==='tf') updateModelWeightsFromTF();
    };
    setTimeout(go, 250);
}

function highlightSelectedRow(rowEl) {
    if (!historyBody) return;
    historyBody.querySelectorAll('tr.selected-move').forEach(r=> r.classList.remove('selected-move'));
    if (rowEl) rowEl.classList.add('selected-move');
}

function attachNavHandlers() {
    if (!btnFirst) return;
    btnFirst.addEventListener('click', ()=>{ if (!positionHistory.length) return; currentPositionIndex=0; loadPositionFromFEN(positionHistory[0]); updateNavDisabled(); });
    btnPrev.addEventListener('click', ()=>{ if (currentPositionIndex>0){ currentPositionIndex--; loadPositionFromFEN(positionHistory[currentPositionIndex]); updateNavDisabled(); }});
    btnNext.addEventListener('click', ()=>{ if (currentPositionIndex < positionHistory.length-1){ currentPositionIndex++; loadPositionFromFEN(positionHistory[currentPositionIndex]); updateNavDisabled(); }});
    btnLast.addEventListener('click', ()=>{ if (!positionHistory.length) return; currentPositionIndex = positionHistory.length-1; loadPositionFromFEN(positionHistory[currentPositionIndex]); updateNavDisabled(); });
}

// Initialize history with starting position
saveCurrentPositionFEN();
attachNavHandlers();
updateNavDisabled();
initClocks();
// Start white's clock immediately for timed games
if (baseMinutes > 0) {
    highlightActiveClock();
    startActiveClock();
}

// If player chose Black, AI plays White and should move first.
try {
    const storedColor = localStorage.getItem('playerColor') || 'White';
    if (storedColor === 'Black') {
        // Ensure orientation already applied earlier.
        // AI is White; trigger its first move after slight delay.
        setTimeout(()=> {
            // Force attempt to unlock audio by simulating a silent play if still locked
            if (!audioUnlocked) {
                try {
                    moveAudio.volume = 0;
                    moveAudio.play().then(()=>{ moveAudio.pause(); moveAudio.currentTime=0; moveAudio.volume = 0.55; audioUnlocked=true; });
                } catch(_) {}
            }
            maybeTriggerAI();
        }, 500);
    }
} catch(_) {}

// ----- Model Parameters Panel Population (random engine placeholder) -----
(function populateModelWeights(){
    const tbody = document.getElementById('model-weight-body');
    if (!tbody) return;
    tbody.dataset.dynamic='1';
    const baseFeatures = ['Material','Mobility','KingSafety','CenterControl','PawnStructure','PieceActivity','Pawn','Knight','Bishop','Rook','Queen','King'];
    tbody.innerHTML='';
    baseFeatures.forEach(f=>{
        const tr=document.createElement('tr');
        const tdF=document.createElement('td'); tdF.textContent=f; tdF.dataset.feature=f;
        const tdW=document.createElement('td'); tdW.textContent='-'; tdW.dataset.weightCell='1';
        tr.appendChild(tdF); tr.appendChild(tdW); tbody.appendChild(tr);
    });
})();

function updateModelWeightsFromTF(){
    if (!tfValueModel) return;
    const tbody = document.getElementById('model-weight-body');
    if (!tbody) return;
    const firstLayer = tfValueModel.layers[0];
    if (!firstLayer) return;
    const w = firstLayer.getWeights()[0]; // kernel (inputDim x units)
    if (!w) return;
    const data = w.dataSync();
    const inputDim = w.shape[0];
    const units = w.shape[1];
    // Helper: average magnitude across rows [rs,re)
    function avgRows(rs,re){ let sum=0, count=0; for (let r=rs;r<re && r<inputDim;r++){ const base=r*units; for (let c=0;c<units;c++){ sum += Math.abs(data[base+c]); count++; } } return count? (sum/count):0; }
    // Planes mapping: 0..11 (6 white then 6 black) * 64 squares => 768 rows
    function planeStart(p){ return p*64; }
    function planeEnd(p){ return p*64+64; }
    function avgPlane(p){ return avgRows(planeStart(p), planeEnd(p)); }
    function combine(planes){ let sum=0, cnt=0; planes.forEach(pl=>{ const v=avgPlane(pl); sum+=v; cnt++; }); return cnt? sum/cnt:0; }
    const centerSquares = [27,28,35,36]; // within each plane
    function avgCenterAllPlanes(){ let sum=0, cnt=0; for (let plane=0;plane<12;plane++){ centerSquares.forEach(idx=>{ const row=plane*64+idx; if (row<inputDim){ const base=row*units; for (let c=0;c<units;c++){ sum += Math.abs(data[base+c]); cnt++; } } }); } return cnt? (sum/cnt):0; }
    const featureValues = {
        Material: avgRows(0,768),
        Mobility: combine([1,2,3,4,7,8,9,10]),
        KingSafety: combine([5,11]),
        CenterControl: avgCenterAllPlanes(),
        PawnStructure: combine([0,6]),
        PieceActivity: combine([0,1,2,3,4,6,7,8,9,10]),
        Pawn: combine([0,6]),
        Knight: combine([1,7]),
        Bishop: combine([2,8]),
        Rook: combine([3,9]),
        Queen: combine([4,10]),
        King: combine([5,11])
    };
    [...tbody.querySelectorAll('tr')].forEach(tr=>{
        const f = tr.querySelector('td[data-feature]');
        const wcell = tr.querySelector('td[data-weightCell]');
        if (f && wcell && featureValues[f.dataset.feature] !== undefined){
            wcell.textContent = featureValues[f.dataset.feature].toFixed(3);
        }
    });
    // Update meta text
    const meta = document.querySelector('#model-info-panel .model-meta');
    if (meta) meta.innerHTML = `Engine: TFValueNet<br><span class="note">Layer0 avg | rows:${inputDim} units:${units}</span>`;
}

// Early model load so weights appear without waiting for first AI move
if (engineMode === 'tf') {
    const meta = document.querySelector('#model-info-panel .model-meta');
    if (meta) meta.innerHTML = 'Engine: TFValueNet<br><span class="note">Loading model...</span>';
    ensureTFModel().then(()=> { try { updateModelWeightsFromTF(); } catch(_){} }).catch(()=>{});
}

// Allow manual refresh of weights (helpful if async load race)
document.addEventListener('click', (e)=>{
    const panel = document.getElementById('model-info-panel');
    if (!panel) return;
    if (panel.contains(e.target) && engineMode==='tf') {
        // If cells still '-', try again
        const anyDash = !!panel.querySelector('td[data-weightCell]') && Array.from(panel.querySelectorAll('td[data-weightCell]')).every(td=>td.textContent.trim()==='-');
        if (anyDash) { ensureTFModel().then(()=> updateModelWeightsFromTF()); }
    }
});

// ------- Material Balance (appended) -------
function updateMaterialBalance(){
    const diffEl = document.getElementById('material-diff');
    const capWhiteEl = document.getElementById('captured-by-white');
    const capBlackEl = document.getElementById('captured-by-black');
    if (!diffEl) return;
    const startCounts = { Pawn:8, Knight:2, Bishop:2, Rook:2, Queen:1 };
    const counts = { White:{ Pawn:0,Knight:0,Bishop:0,Rook:0,Queen:0 }, Black:{ Pawn:0,Knight:0,Bishop:0,Rook:0,Queen:0 } };
    for (let r=0;r<8;r++) {
        for (let c=0;c<8;c++) {
            const p = pieces[r][c];
            if (!p) continue;
            const [color,type] = p.split(' ');
            if (counts[color] && counts[color][type] !== undefined) counts[color][type]++;
        }
    }
    const values = { Pawn:1, Knight:3, Bishop:3, Rook:5, Queen:9 };
    let whiteScore=0, blackScore=0;
    Object.keys(values).forEach(t=>{ whiteScore += counts.White[t]*values[t]; blackScore += counts.Black[t]*values[t]; });
    const diff = whiteScore - blackScore;
    if (diff === 0){ diffEl.textContent='='; diffEl.classList.add('equal'); diffEl.style.color=''; }
    else { diffEl.classList.remove('equal'); diffEl.textContent=(diff>0?'+':'')+diff; diffEl.style.color = diff>0? '#2d6a2d' : '#8c1f1f'; }
    // Helper to append icons with optional grouping once duplicates exceed a threshold
    function renderCaptured(container, victimColorCounts, colorPrefix){
        container.innerHTML='';
        Object.keys(startCounts).forEach(t=>{
            const missing = startCounts[t] - victimColorCounts[t];
            if (missing <= 0) return;
            if (missing <= 6) { // show individually
                for (let i=0;i<missing;i++) {
                    const img=document.createElement('img');
                    img.src='sprites/'+colorPrefix+'_'+t+'.png';
                    img.alt='Captured '+t;
                    container.appendChild(img);
                }
            } else {
                // group icon + small count badge
                const img=document.createElement('div');
                img.style.position='relative';
                img.style.width='18px'; img.style.height='18px';
                img.style.flex='0 0 auto';
                img.style.background=`center/contain no-repeat url('sprites/${colorPrefix}_${t}.png')`;
                const badge=document.createElement('span');
                badge.textContent='x'+missing;
                badge.style.position='absolute';
                badge.style.right='-2px';
                badge.style.bottom='-6px';
                badge.style.fontSize='10px';
                badge.style.fontWeight='700';
                badge.style.background='rgba(0,0,0,0.55)';
                badge.style.color='#fff';
                badge.style.padding='0 2px';
                badge.style.borderRadius='4px';
                img.appendChild(badge);
                container.appendChild(img);
            }
        });
    }
    if (capWhiteEl) renderCaptured(capWhiteEl, counts.Black, 'Black');
    if (capBlackEl) renderCaptured(capBlackEl, counts.White, 'White');
}

// Initial material balance render attempt
try { updateMaterialBalance(); } catch(_) {}
