// The any-to-any solver, carried over from the standalone cube project: edit a
// cube and a target pattern, then watch the sequence between them play out.

import {
    COLOR_MAP, FACE_ORDER, SOLVED_STATE,
    applyMoveToState, invertMove, stateFromMoves, isStateValid,
    mountCube, renderFaces
} from './cube-engine.js';

// Derived from move sequences rather than hard-coded facelet strings, so every
// preset is guaranteed to be a reachable state with valid sticker counts.
const PRESET_PATTERNS = [
    { name: 'Checkerboard', moves: "R2 L2 U2 D2 F2 B2" },
    { name: 'Four Spots', moves: "F2 B2 U D' R2 L2 U D'" },
    { name: 'Six Spots', moves: "U D' R L' F B' U D'" },
    { name: 'Cube in a Cube', moves: "F L F U' R U F2 L2 U' L' B D' B' L2 U" },
    { name: 'Cube in a Cube in a Cube', moves: "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'" },
    { name: 'Superflip', moves: "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2" },
    { name: 'Cross', moves: "R2 L' D F2 R' D' R' L U' D R D B2 R' U D2" },
    { name: 'Python', moves: "F2 R' B' U R' L F' L F' B D' R B L2" },
    { name: 'Tetris', moves: "L R F B U' D' L' R'" }
].map(p => ({ name: p.name, state: stateFromMoves(p.moves) }));

let currentState = "DUUBULDBFRBFRRULLLBRDFFFBLURDBFDFDRFRULBLUFDURRBLBDUDL";
let targetState = SOLVED_STATE;
let selectedColor = 'U';

let isAnimating = false;
let solvingMode = false;
let isPaused = false;
let solutionMoves = [];
let currentStepIndex = 0;

const resultDiv = document.getElementById('result');
const targetLabel = document.getElementById('targetLabel');
const solutionControls = document.getElementById('solutionControls');
const stepProgress = document.getElementById('stepProgress');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pauseBtn = document.getElementById('pauseBtn');

const cube = mountCube('canvas-container', currentState);

function drawCurrent() {
    renderFaces('currentFaces', currentState, (cell, index) => {
        if (solvingMode || isAnimating) return;
        currentState = currentState.slice(0, index) + selectedColor + currentState.slice(index + 1);
        cube.setColors(currentState);
        drawCurrent();
    });
}

function drawTarget() {
    renderFaces('targetFaces', targetState, (cell, index) => {
        if (solvingMode || isAnimating) return;
        targetState = targetState.slice(0, index) + selectedColor + targetState.slice(index + 1);
        targetLabel.textContent = 'Custom';
        drawTarget();
    });
}

function updateProgress() {
    stepProgress.textContent = `Step ${currentStepIndex} / ${solutionMoves.length}`;
    prevBtn.disabled = (currentStepIndex === 0 || isAnimating);
    nextBtn.disabled = (currentStepIndex >= solutionMoves.length || isAnimating);
    pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
}

async function runMove(move, duration) {
    await cube.animateMove(move, duration);
    currentState = applyMoveToState(currentState, move);
    cube.setColors(currentState);
    drawCurrent();
}

async function doMove(move) {
    if (solvingMode || isAnimating) return;
    isAnimating = true;
    await runMove(move, 300);
    isAnimating = false;
}

async function executeNextStep() {
    if (currentStepIndex >= solutionMoves.length) {
        finishSolving();
        return;
    }
    if (isAnimating) return;

    isAnimating = true;
    updateProgress();
    await runMove(solutionMoves[currentStepIndex], 300);
    currentStepIndex++;
    isAnimating = false;
    updateProgress();

    if (!isPaused && currentStepIndex < solutionMoves.length) {
        setTimeout(executeNextStep, 100);
    } else if (currentStepIndex >= solutionMoves.length) {
        finishSolving();
    }
}

async function executePrevStep() {
    if (currentStepIndex <= 0 || isAnimating) return;

    isAnimating = true;
    updateProgress();
    await runMove(invertMove(solutionMoves[currentStepIndex - 1]), 300);
    currentStepIndex--;
    isAnimating = false;
    updateProgress();
}

function finishSolving() {
    solvingMode = false;
    isAnimating = false;
    isPaused = false;
    updateProgress();
    resultDiv.innerHTML += '<br><em>Playback finished. You can still step through it.</em>';
}

function exitSolvingMode() {
    solvingMode = false;
    isAnimating = false;
    isPaused = false;
    solutionMoves = [];
    currentStepIndex = 0;
    solutionControls.hidden = true;
    updateProgress();
}

function startSolvingControls(moves) {
    solutionMoves = moves;
    currentStepIndex = 0;
    solvingMode = true;
    isAnimating = false;
    isPaused = false;
    solutionControls.hidden = false;
    updateProgress();
    setTimeout(executeNextStep, 100);
}

function togglePause() {
    if (!solvingMode && solutionMoves.length === 0) return;
    isPaused = !isPaused;
    updateProgress();
    if (!isPaused && currentStepIndex < solutionMoves.length) {
        executeNextStep();
    }
}

// --- wiring ---------------------------------------------------------------
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = btn.dataset.color;
    });
});

const moveButtons = document.getElementById('moveButtons');
FACE_ORDER.forEach(face => {
    const row = document.createElement('div');
    row.className = 'move-row';
    [face, face + "'", face + '2'].forEach(move => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = move;
        btn.addEventListener('click', () => doMove(move));
        row.appendChild(btn);
    });
    moveButtons.appendChild(row);
});

document.getElementById('scrambleBtn').addEventListener('click', async () => {
    if (solvingMode || isAnimating) return;
    if (solutionMoves.length > 0) exitSolvingMode();
    isAnimating = true;
    const suffixes = ['', "'", '2'];
    let lastFace = '';
    for (let i = 0; i < 20; i++) {
        let face;
        do {
            face = FACE_ORDER[Math.floor(Math.random() * FACE_ORDER.length)];
        } while (face === lastFace);
        lastFace = face;
        await runMove(face + suffixes[Math.floor(Math.random() * suffixes.length)], 120);
    }
    isAnimating = false;
});

document.getElementById('resetBtn').addEventListener('click', () => {
    if (solvingMode || isAnimating) return;
    if (solutionMoves.length > 0) exitSolvingMode();
    currentState = SOLVED_STATE;
    cube.setColors(currentState);
    drawCurrent();
});

document.getElementById('surpriseBtn').addEventListener('click', () => {
    if (solvingMode || isAnimating) return;
    let idx = Math.floor(Math.random() * PRESET_PATTERNS.length);
    if (PRESET_PATTERNS[idx].state === targetState) {
        idx = (idx + 1) % PRESET_PATTERNS.length;
    }
    targetState = PRESET_PATTERNS[idx].state;
    targetLabel.textContent = PRESET_PATTERNS[idx].name;
    drawTarget();
});

document.getElementById('solveBtn').addEventListener('click', async () => {
    if (isAnimating) {
        resultDiv.textContent = 'Wait for the current animation to finish.';
        return;
    }
    if (solutionMoves.length > 0) exitSolvingMode();

    if (!isStateValid(targetState)) {
        resultDiv.innerHTML = '<strong>Error:</strong> Target pattern is invalid. Each of the 6 colors must appear exactly 9 times and the centres must all differ.';
        return;
    }
    if (!isStateValid(currentState)) {
        resultDiv.innerHTML = '<strong>Error:</strong> Current state is invalid. Each of the 6 colors must appear exactly 9 times and the centres must all differ.';
        return;
    }

    resultDiv.textContent = 'Calculating…';
    try {
        const resp = await fetch('/solve_custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_state: currentState, target_state: targetState })
        });
        const data = await resp.json();
        if (data.error) {
            resultDiv.innerHTML = `<strong>Error:</strong> ${data.error}`;
            return;
        }
        const moves = data.solution.split(/\s+/).filter(m => m.length > 0);
        if (moves.length === 0) {
            resultDiv.innerHTML = '<strong>Nothing to do:</strong> the cube already matches the target pattern.';
            return;
        }
        resultDiv.innerHTML =
            `<strong>Solution to "${targetLabel.textContent}" (${data.steps} moves):</strong><br>${data.solution}`;
        startSolvingControls(moves);
    } catch (err) {
        resultDiv.innerHTML = `<strong>Request failed:</strong> ${err.message}`;
    }
});

prevBtn.addEventListener('click', executePrevStep);
nextBtn.addEventListener('click', executeNextStep);
pauseBtn.addEventListener('click', togglePause);

drawCurrent();
drawTarget();
updateProgress();