import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from flask import Flask, abort, g, jsonify, redirect, render_template, request, url_for

import cube

DB_PATH = Path(__file__).parent / "leaderboard.db"

# One post per browser per day hangs off this cookie. Clearing it (or going
# incognito) buys another go — the daily limit is an honour system.
PLAYER_COOKIE = "cubeit_player"
COOKIE_MAX_AGE = 400 * 24 * 60 * 60  # 400 days, the ceiling browsers allow.

# Salts the daily scramble so it can't be worked out from the date alone.
# Changing it only affects future days; played days keep their stored scramble.
SCRAMBLE_SALT = os.environ.get("CUBEIT_SALT", "cubeit")

# Bounds how much work an untrusted submission can ask for. A flailing
# beginner stays well under it.
MAX_SOLVE_MOVES = 10_000

app = Flask(__name__)


#time check
def utc_now():
    return datetime.now(timezone.utc)


def today_utc():
    """The current leaderboard day. Rolls over at 00:00 UTC."""
    return utc_now().strftime("%Y-%m-%d")


def seconds_until_reset():
    now = utc_now()
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int((tomorrow - now).total_seconds())


def format_time(seconds):
    """12.345 or 1:23.456 — the way a stopwatch reads."""
    seconds = float(seconds)
    if seconds >= 60:
        minutes, rest = divmod(seconds, 60)
        return f"{int(minutes)}:{rest:06.3f}"
    return f"{seconds:.3f}"


def format_day(day):
    """2026-07-29 -> Wed 29 Jul 2026"""
    try:
        return datetime.strptime(day, "%Y-%m-%d").strftime("%a %d %b %Y")
    except ValueError:
        return day


app.jinja_env.filters["fmt_time"] = format_time
app.jinja_env.filters["fmt_day"] = format_day


#database
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS entries (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL,
                score     REAL    NOT NULL,
                created   TEXT    NOT NULL DEFAULT (datetime('now')),
                day       TEXT    NOT NULL DEFAULT '',
                token     TEXT    NOT NULL DEFAULT '',
                moves     INTEGER NOT NULL DEFAULT 0,
                solution  TEXT    NOT NULL DEFAULT ''
            )
            """
        )

        # Scrambles are stored, not recomputed, so changing the salt or the
        # generator can never rewrite the puzzle a past day was played on.
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS days (
                day      TEXT PRIMARY KEY,
                scramble TEXT NOT NULL,
                state    TEXT NOT NULL
            )
            """
        )

        columns = {row[1] for row in db.execute("PRAGMA table_info(entries)")}
        if "day" not in columns:
            db.execute("ALTER TABLE entries ADD COLUMN day TEXT NOT NULL DEFAULT ''")
        # Entries predating the daily limit have no browser attached; an empty
        # token is one todays_entry() never matches.
        if "token" not in columns:
            db.execute("ALTER TABLE entries ADD COLUMN token TEXT NOT NULL DEFAULT ''")
        # Entries predating the cube have no moves; 0 renders as an em dash.
        if "moves" not in columns:
            db.execute("ALTER TABLE entries ADD COLUMN moves INTEGER NOT NULL DEFAULT 0")
        if "solution" not in columns:
            db.execute("ALTER TABLE entries ADD COLUMN solution TEXT NOT NULL DEFAULT ''")

        db.execute("UPDATE entries SET day = substr(created, 1, 10) WHERE day = ''")

        db.execute("DROP INDEX IF EXISTS idx_score")
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_day_score ON entries (day, score ASC)"
        )
        # Backs the "has this browser played today?" lookup on every page load.
        db.execute("CREATE INDEX IF NOT EXISTS idx_day_token ON entries (day, token)")


#player identity
@app.before_request
def load_player():
    """Every browser carries an opaque token; it is the whole identity model."""
    token = request.cookies.get(PLAYER_COOKIE)
    g.player = token or uuid4().hex
    g.player_is_new = token is None


@app.after_request
def persist_player(response):
    if getattr(g, "player_is_new", False):
        response.set_cookie(
            PLAYER_COOKIE,
            g.player,
            max_age=COOKIE_MAX_AGE,
            httponly=True,
            samesite="Lax",
            secure=request.is_secure,
        )
    return response


def todays_entry(token):
    """The row this browser already posted today, if it has played."""
    if not token:
        return None
    return get_db().execute(
        "SELECT id, name, score, moves FROM entries WHERE day = ? AND token = ?",
        (today_utc(), token),
    ).fetchone()


#daily cube
def todays_cube():
    """Today's scramble, minted once and then read back for everyone."""
    db = get_db()
    day = today_utc()

    row = db.execute("SELECT * FROM days WHERE day = ?", (day,)).fetchone()
    if row is not None:
        return row

    moves = cube.scramble_for_day(day, salt=SCRAMBLE_SALT)
    db.execute(
        "INSERT OR IGNORE INTO days (day, scramble, state) VALUES (?, ?, ?)",
        (day, " ".join(moves), cube.apply_moves(cube.SOLVED_STATE, moves)),
    )
    db.commit()
    # Re-read rather than trusting what we generated: a concurrent request may
    # have won the insert, and everyone must play the row that actually landed.
    return db.execute("SELECT * FROM days WHERE day = ?", (day,)).fetchone()


def cube_for_day(day):
    """A past day's scramble, or None if that day predates the cube."""
    return get_db().execute("SELECT * FROM days WHERE day = ?", (day,)).fetchone()


#lb rankings
def get_leaderboard(day, limit=100):
    """A single day's times, fastest first — one row per posted run.

    Not folded together by name: a browser gets one post per day, so two people
    who pick the same name are two players, and merging them would silently
    discard the slower one's time.
    """
    rows = get_db().execute(
        """
        SELECT id, name, score, moves
        FROM entries
        WHERE day = ?
        ORDER BY score ASC, created ASC
        LIMIT ?
        """,
        (day, limit),
    ).fetchall()

    if not rows:
        return []

    best = rows[0]["score"]
    board = []
    rank = 0
    previous = None

    for i, row in enumerate(rows):
        # Ranking method (ties share a spot)
        if row["score"] != previous:
            rank = i + 1
            previous = row["score"]

        board.append(
            {
                "id": row["id"],
                "rank": rank,
                "name": row["name"],
                "score": row["score"],
                "moves": row["moves"],
                "gap": row["score"] - best,
            }
        )
    return board


def get_archive_days():
    """Every finished day, newest first, with that day's winner."""
    return get_db().execute(
        """
        SELECT totals.day,
               totals.best,
               totals.players,
               (
                   -- Ties break on the earlier solve, matching how
                   -- get_leaderboard() ranks that same day's board.
                   SELECT e.name
                   FROM entries e
                   WHERE e.day = totals.day AND e.score = totals.best
                   ORDER BY e.created ASC
                   LIMIT 1
               ) AS champion
        FROM (
            SELECT day,
                   MIN(score) AS best,
                   COUNT(*)   AS players
            FROM entries
            WHERE day < ?
            GROUP BY day
        ) AS totals
        ORDER BY totals.day DESC
        """,
        (today_utc(),),
    ).fetchall()


#routes - daily challenge
@app.route("/")
def index():
    today = todays_cube()
    board = get_leaderboard(today_utc())
    mine = todays_entry(g.player)

    rank = None
    if mine is not None:
        rank = next((e["rank"] for e in board if e["id"] == mine["id"]), None)

    return render_template(
        "index.html",
        day=today_utc(),
        scramble=today["scramble"],
        scrambled_state=today["state"],
        solved_state=cube.SOLVED_STATE,
        board=board,
        mine=mine,
        my_rank=rank,
        reset_in=seconds_until_reset(),
        archive_count=len(get_archive_days()),
        error=request.args.get("error"),
        just_posted=request.args.get("posted") == "1",
    )


@app.post("/submit")
def submit():
    # Checked first: a double-clicked button or a replayed POST must not land a
    # second run, whatever the client believes.
    if todays_entry(g.player) is not None:
        return redirect(url_for("index", error="You've already posted today."))

    name = (request.form.get("name") or "").strip()
    raw_score = (request.form.get("score") or "").strip()

    try:
        score = float(raw_score)
    except ValueError:
        return redirect(url_for("index", error="Solve the cube before posting."))

    if score <= 0:
        return redirect(url_for("index", error="That time didn't register. Try again."))
    if score > 86_400:
        return redirect(url_for("index", error="That time is longer than a day."))

    # A claimed time means nothing alone, so the moves behind it are replayed
    # against today's scramble. Only a sequence that really solves it can post.
    try:
        moves = cube.parse_moves(request.form.get("moves"), limit=MAX_SOLVE_MOVES)
    except ValueError as exc:
        return redirect(url_for("index", error=f"Unreadable solve: {exc}."))

    if not moves:
        return redirect(url_for("index", error="Solve the cube before posting."))

    today = todays_cube()
    if cube.apply_moves(today["state"], moves) != cube.SOLVED_STATE:
        return redirect(
            url_for("index", error="That sequence doesn't solve today's cube.")
        )

    # The name is asked for last, so it is validated after the run itself.
    if not name:
        return redirect(url_for("index", error="Enter a name to post your time."))
    if len(name) > 24:
        return redirect(url_for("index", error="Names cap at 24 characters."))

    db = get_db()
    db.execute(
        """
        INSERT INTO entries (name, score, day, token, moves, solution)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, round(score, 3), today_utc(), g.player, len(moves), " ".join(moves)),
    )
    db.commit()

    return redirect(url_for("index", posted="1"))


#routes - archive
@app.route("/archive")
def archive():
    return render_template("archive.html", days=get_archive_days())


@app.route("/archive/<day>")
def archive_day(day):
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        abort(404)

    if day >= today_utc():
        # Today isn't archived yet; it's still live on the front page.
        return redirect(url_for("index"))

    board = get_leaderboard(day)
    if not board:
        abort(404)

    days = [row["day"] for row in get_archive_days()]
    position = days.index(day) if day in days else None
    puzzle = cube_for_day(day)

    return render_template(
        "archive_day.html",
        day=day,
        board=board,
        scramble=puzzle["scramble"] if puzzle else None,
        # `days` is newest-first, so the next-older day sits at a higher index.
        newer=days[position - 1] if position not in (None, 0) else None,
        older=days[position + 1] if position is not None and position + 1 < len(days) else None,
    )


#routes - speedmat
@app.route("/timer")
def timer():
    """A practice stopwatch for a real cube. Deliberately has no leaderboard:
    nothing about a solve away from the 3D cube can be verified."""
    return render_template("timer.html")


#routes - solver
@app.route("/solver")
def solver():
    return render_template(
        "solver.html",
        solver_available=cube.kociemba is not None,
        default_state=cube.SOLVED_STATE,
    )


@app.route("/random_state")
def random_state():
    return jsonify({"state": cube.generate_random_state()})


@app.post("/solve")
def solve():
    data = request.get_json(silent=True)
    if not data or "cube_state" not in data:
        return jsonify({"error": "Missing cube_state"}), 400
    cube_state = data["cube_state"].strip()

    err = cube.validate_state(cube_state, "cube_state")
    if err:
        return jsonify({"error": err}), 400

    try:
        moves = cube.solve_state(
            cube.to_facelets(cube_state, cube.color_map_from_centers(cube_state))
        )
    except cube.SolverUnavailable as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": f"Invalid cube state: {exc}"}), 400

    moves = cube.simplify_solution(cube_state, moves)

    return jsonify({"solution": " ".join(moves), "steps": len(moves)})


@app.post("/solve_custom")
def solve_custom():
    data = request.get_json(silent=True)
    if not data or "current_state" not in data or "target_state" not in data:
        return jsonify({"error": "Missing current_state or target_state"}), 400
    current = data["current_state"].strip()
    target = data["target_state"].strip()

    for state, label in ((current, "Current state"), (target, "Target pattern")):
        err = cube.validate_state(state, label)
        if err:
            return jsonify({"error": err}), 400

    # Face turns never move a centre, so a target whose centres differ from the
    # cube in hand is unreachable no matter what sequence we look for.
    mismatched = [
        face for face, pos in cube.CENTER_POSITIONS.items() if current[pos] != target[pos]
    ]
    if mismatched:
        return jsonify({"error": "Target pattern is unreachable: face turns never move the centre "
                                 "stickers, so the target must keep the same centres as the current "
                                 f"cube. Differing centres: {', '.join(mismatched)}."}), 400

    # Both states share their centres, so one colour->facelet map normalises both.
    color_map = cube.color_map_from_centers(current)
    try:
        current_to_solved = cube.solve_state(cube.to_facelets(current, color_map))
        target_to_solved = cube.solve_state(cube.to_facelets(target, color_map))
    except cube.SolverUnavailable as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": f"Invalid cube state: {exc}"}), 400

    # Solve the cube, then run the target's own solution backwards to build the
    # pattern back up: current -> solved -> target.
    moves = cube.simplify_moves(current_to_solved + cube.invert_sequence(target_to_solved))

    moves = cube.trim_solution(current, moves, target)

    if cube.apply_moves(current, moves) != target:
        return jsonify({"error": "Internal error: computed sequence does not reach the target"}), 500

    return jsonify({"solution": " ".join(moves), "steps": len(moves)})


# At import, not just under __main__: a WSGI server (gunicorn, uWSGI) imports
# this module rather than running it, so leaving this in the block below would
# mean a fresh deploy serves 500s until someone ran the file by hand. It is
# idempotent — every statement is CREATE IF NOT EXISTS or a guarded ALTER.
init_db()


if __name__ == "__main__":
    app.run(debug=True)
