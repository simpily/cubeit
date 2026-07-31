// The daily challenge: solve today's scramble, and the clock stops the moment
// the cube comes together.
//
// The clock starts on the first turn rather than on a button, so studying the
// scramble is free and the timed part is only the solve itself.

import {
    SOLVED_STATE, FACE_ORDER, applyMoveToState, mountCube, formatTime
} from './cube-engine.js';

const game = document.getElementById('game');
// Absent once this browser has posted today; the server drops the whole form.
if (game) {
    const display = document.getElementById('display');
    const hint = document.getElementById('hint');
    const stagePlay = document.getElementById('stage-play');
    const stageName = document.getElementById('stage-name');
    const nameInput = document.getElementById('name');
    const scoreField = document.getElementById('score');
    const movesField = document.getElementById('moves');
    const moveCount = document.getElementById('moveCount');
    const buttons = document.getElementById('moveButtons');

    const IDLE = 'idle';
    const RUNNING = 'running';
    const DONE = 'done';

    let state = game.dataset.state;
    let phase = IDLE;
    let startedAt = 0;
    let frame = null;
    const played = [];

    // Reveal before mounting: three.js sizes itself from the container, and a
    // container inside a `hidden` element measures 0x0.
    game.hidden = false;
    const cube = mountCube('canvas-container', state);

    // Turns are animated, but the logical state moves the instant a key is
    // pressed — so a fast solve is never held up by, or lost to, the animation.
    const queue = [];
    let animating = false;

    async function drainQueue() {
        if (animating) return;
        animating = true;
        while (queue.length) {
            const { move, after } = queue.shift();
            await cube.animateMove(move, 130);
            cube.setColors(after);
        }
        animating = false;
    }

    function elapsed() {
        return (performance.now() - startedAt) / 1000;
    }

    function tick() {
        display.textContent = formatTime(elapsed());
        frame = requestAnimationFrame(tick);
    }

    function finish(time) {
        cancelAnimationFrame(frame);
        frame = null;
        phase = DONE;

        // Shown and submitted values are rounded identically, so the player
        // posts exactly the time they saw.
        display.textContent = formatTime(time);
        scoreField.value = time.toFixed(3);
        movesField.value = played.join(' ');

        stagePlay.hidden = true;
        stageName.hidden = false;
        // Only required once it is on screen — a hidden required field would
        // block submission with nothing for the browser to focus.
        nameInput.required = true;
        nameInput.focus();
    }

    function doMove(move) {
        if (phase === DONE) return;

        if (phase === IDLE) {
            phase = RUNNING;
            startedAt = performance.now();
            hint.textContent = 'Solve it. The clock stops on its own.';
            frame = requestAnimationFrame(tick);
        }

        state = applyMoveToState(state, move);
        played.push(move);
        moveCount.textContent = played.length;

        queue.push({ move, after: state });
        drainQueue();

        if (state === SOLVED_STATE) {
            // Timed from this keypress, not from the end of the animation.
            finish(elapsed());
        }
    }

    FACE_ORDER.forEach(face => {
        const row = document.createElement('div');
        row.className = 'move-row';
        [face, face + "'", face + '2'].forEach(move => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = move;
            btn.addEventListener('click', () => {
                btn.blur(); // Keep the keyboard shortcuts off this button.
                doMove(move);
            });
            row.appendChild(btn);
        });
        buttons.appendChild(row);
    });

    document.addEventListener('keydown', event => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        const face = event.key.toUpperCase();
        if (!FACE_ORDER.includes(face)) return;

        event.preventDefault();
        // Shift is the standard prime modifier: r turns R, R turns R'.
        doMove(event.shiftKey ? face + "'" : face);
    });

    document.getElementById('restart').addEventListener('click', () => {
        // Nothing is committed until a solve is posted, and the page can be
        // reloaded anyway, so a reload is the honest way to start over.
        location.reload();
    });
}