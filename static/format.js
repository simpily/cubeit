// Kept apart from cube-engine.js so importing it doesn't pull in three.js —
// the practice timer needs the formatting and nothing else.

/** 12.345 or 1:23.456 — the way a stopwatch reads. Mirrors format_time(). */
export function formatTime(seconds) {
    if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const rest = seconds - minutes * 60;
        return minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(3);
    }
    return seconds.toFixed(3);
}