// A speedmat, and nothing else: hold space, wait for green, release to start,
// then hit anything to stop.
//
// Standalone — it times solves on a real cube in your hands and never posts to
// the leaderboard. Scrambles are the daily challenge's business, not this page's.

import { formatTime } from './format.js';

const ARM_KEY = ' ';
// How long space must be held before the timer arms, matching the pause a
// competition timer wants before it shows green.
const READY_AFTER_MS = 550;
const STORE_KEY = 'cubeit.timer.session';

const IDLE = 'idle';
const HOLDING = 'holding';   // space down, not yet armed
const READY = 'ready';       // armed — releasing starts the clock
const RUNNING = 'running';

const display = document.getElementById('display');
const status = document.getElementById('status');
const timesEl = document.getElementById('times');
const statsEl = document.getElementById('stats');
const panel = document.getElementById('timer-panel');

let phase = IDLE;
let startedAt = 0;
let frame = null;
let readyTimer = null;

let times = loadSession();


// --- session storage ------------------------------------------------------
function loadSession() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY));
        return Array.isArray(raw) ? raw.filter(t => typeof t === 'number') : [];
    } catch {
        return [];
    }
}

function saveSession() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(times));
    } catch {
        // A full or blocked store only costs history, not the timer itself.
    }
}


// --- statistics -----------------------------------------------------------
function mean(list) {
    return list.reduce((a, b) => a + b, 0) / list.length;
}

/** WCA average: drop the fastest and slowest, mean the rest. */
function average(list) {
    if (list.length < 3) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return mean(sorted.slice(1, -1));
}

function averageOfLast(n) {
    if (times.length < n) return null;
    return average(times.slice(-n));
}

function renderStats() {
    if (!times.length) {
        statsEl.textContent = 'No solves yet this session.';
        return;
    }
    const parts = [
        `solves ${times.length}`,
        `best ${formatTime(Math.min(...times))}`,
        `mean ${formatTime(mean(times))}`,
    ];
    const ao5 = averageOfLast(5);
    const ao12 = averageOfLast(12);
    if (ao5 !== null) parts.push(`ao5 ${formatTime(ao5)}`);
    if (ao12 !== null) parts.push(`ao12 ${formatTime(ao12)}`);
    statsEl.textContent = parts.join('  ·  ');
}

function renderTimes() {
    timesEl.innerHTML = '';
    if (!times.length) {
        renderStats();
        return;
    }
    const best = Math.min(...times);
    // Newest first, but numbered by the order they were solved in.
    times.forEach((t, i) => {
        const li = document.createElement('li');
        li.textContent = `${i + 1}. ${formatTime(t)}`;
        if (t === best) li.className = 'best';
        timesEl.prepend(li);
    });
    renderStats();
}


// --- the clock ------------------------------------------------------------
function elapsed() {
    return (performance.now() - startedAt) / 1000;
}

function tick() {
    display.textContent = formatTime(elapsed());
    frame = requestAnimationFrame(tick);
}

function setPhase(next, message) {
    phase = next;
    panel.dataset.phase = next;
    status.textContent = message;
}

function startRunning() {
    startedAt = performance.now();
    setPhase(RUNNING, 'Solving — press any key to stop.');
    frame = requestAnimationFrame(tick);
}

function stopRunning() {
    cancelAnimationFrame(frame);
    frame = null;

    const time = elapsed();
    // Shown and stored values are rounded identically.
    display.textContent = formatTime(time);
    times.push(Number(time.toFixed(3)));
    saveSession();
    renderTimes();

    setPhase(IDLE, 'Hold space to arm the timer.');
}

function cancelReady() {
    clearTimeout(readyTimer);
    readyTimer = null;
}


// --- input ----------------------------------------------------------------
/** Lone Shift/Ctrl/Alt/Cmd presses aren't a hand landing on the timer. */
function isModifierKey(key) {
    return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta';
}

document.addEventListener('keydown', event => {
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (phase === RUNNING) {
        // Anything stops the clock, the way slapping a real timer does — but
        // not a bare modifier, and not a browser/system shortcut like Cmd-R.
        if (isModifierKey(event.key) || event.metaKey || event.ctrlKey) return;
        if (event.key === ARM_KEY) event.preventDefault();
        stopRunning();
        return;
    }

    if (event.key !== ARM_KEY) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    event.preventDefault(); // Space would otherwise scroll the page.
    // Holding a key repeats keydown; only the first press is a new touch.
    if (event.repeat) return;

    if (phase === IDLE) {
        display.textContent = '0.000';
        setPhase(HOLDING, 'Hold it…');
        readyTimer = setTimeout(() => {
            setPhase(READY, 'Ready — release to start.');
        }, READY_AFTER_MS);
    }
});

document.addEventListener('keyup', event => {
    if (event.key !== ARM_KEY) return;

    if (phase === READY) {
        // Lifting off an armed timer is the start signal.
        cancelReady();
        startRunning();
    } else if (phase === HOLDING) {
        // Let go too early: the timer never armed.
        cancelReady();
        setPhase(IDLE, 'Released too early. Hold space until it says ready.');
    }
    // Releasing the space that just stopped the clock lands here in IDLE,
    // where it correctly does nothing.
});

// Space can "stick" down if focus leaves mid-hold, so stand down on blur.
window.addEventListener('blur', () => {
    if (phase === HOLDING || phase === READY) {
        cancelReady();
        setPhase(IDLE, 'Hold space to arm the timer.');
    }
});

document.getElementById('clearTimes').addEventListener('click', event => {
    event.target.blur();
    times = [];
    saveSession();
    renderTimes();
});

document.getElementById('dropLast').addEventListener('click', event => {
    event.target.blur();
    times.pop();
    saveSession();
    renderTimes();
});

setPhase(IDLE, 'Hold space to arm the timer.');
renderTimes();