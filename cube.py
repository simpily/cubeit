import hashlib
import random
from collections import Counter

# kociemba is a C extension and only the solver page needs it. The daily
# challenge is pure move application, so a missing build must not break it.
try:
    import kociemba
except ImportError:  # pragma: no cover - depends on the host environment
    kociemba = None


CENTER_POSITIONS = {"U": 4, "R": 13, "F": 22, "D": 31, "L": 40, "B": 49}
SOLVED_STATE = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
FACES = list(CENTER_POSITIONS)
QUARTER_TURNS = {"": 1, "2": 2, "'": 3}
TURN_SUFFIX = {1: "", 2: "2", 3: "'"}


#Validation
def validate_state(state, label):
    if len(state) != 54:
        return f"{label} must be exactly 54 characters (got {len(state)})"

    counts = Counter(state)
    if len(counts) != 6 or any(n != 9 for n in counts.values()):
        return f"{label} is invalid: each of the 6 colors must appear exactly 9 times"

    centers = [state[pos] for pos in CENTER_POSITIONS.values()]
    if len(set(centers)) != 6:
        return f"{label} is invalid: the 6 center stickers must all be different colors"

    return None


def to_facelets(state, color_map):
    """Relabel a state's colors into kociemba's URFDLB facelet notation."""
    return "".join(color_map[ch] for ch in state)


def color_map_from_centers(state):
    return {state[pos]: face for face, pos in CENTER_POSITIONS.items()}


#Move Sequences
def parse_moves(text, limit=None):
    """Split and validate a move sequence like "R U2 F'".

    Raises ValueError on anything that is not a legal face turn, so untrusted
    input can be handed straight here.
    """
    moves = (text or "").split()
    if limit is not None and len(moves) > limit:
        raise ValueError(f"too many moves (max {limit})")

    for move in moves:
        if move[0] not in CENTER_POSITIONS or move[1:] not in QUARTER_TURNS:
            raise ValueError(f"'{move}' is not a face turn")
    return moves


def invert_sequence(moves):
    inverted = []
    for move in reversed(moves):
        face, suffix = move[0], move[1:]
        inverted.append(face + TURN_SUFFIX[(4 - QUARTER_TURNS[suffix]) % 4])
    return inverted


def simplify_moves(moves):
    """Collapse consecutive turns of the same face (R R' -> nothing, R R -> R2)."""
    stack = []
    for move in moves:
        face, quarters = move[0], QUARTER_TURNS[move[1:]]
        if stack and stack[-1][0] == face:
            quarters = (stack.pop()[1] + quarters) % 4
            if quarters == 0:
                continue
        stack.append((face, quarters))
    return [face + TURN_SUFFIX[quarters] for face, quarters in stack]


#Geometry
FACE_NORMALS = {
    "U": (0, 1, 0), "R": (1, 0, 0), "F": (0, 0, 1),
    "D": (0, -1, 0), "L": (-1, 0, 0), "B": (0, 0, -1),
}

MOVE_AXES = {
    "R": ("x", 1), "L": ("x", -1),
    "U": ("y", 1), "D": ("y", -1),
    "F": ("z", 1), "B": ("z", -1),
}
AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


def _build_sticker_index():
    """Map (cubie position, facing) -> facelet index, in kociemba's URFDLB order."""
    faces = [
        ("U", "y", 1, "x", 1, "z", 1),
        ("R", "x", 1, "z", -1, "y", -1),
        ("F", "z", 1, "x", 1, "y", -1),
        ("D", "y", -1, "x", 1, "z", -1),
        ("L", "x", -1, "z", 1, "y", -1),
        ("B", "z", -1, "x", -1, "y", -1),
    ]
    index = {}
    for name, axis, val, u_axis, u_sign, v_axis, v_sign in faces:
        for row in (-1, 0, 1):
            for col in (-1, 0, 1):
                coord = {"x": 0, "y": 0, "z": 0}
                coord[axis] = val
                coord[u_axis] = col * u_sign
                coord[v_axis] = row * v_sign
                index[((coord["x"], coord["y"], coord["z"]), name)] = len(index)
    return index


STICKER_INDEX = _build_sticker_index()
STICKERS = [key for key, _ in sorted(STICKER_INDEX.items(), key=lambda kv: kv[1])]
NORMAL_TO_FACE = {normal: face for face, normal in FACE_NORMALS.items()}


def _rotate(vec, axis, quarters):
    x, y, z = vec
    for _ in range(quarters % 4):
        if axis == "x":
            y, z = -z, y
        elif axis == "y":
            x, z = z, -x
        else:
            x, y = -y, x
    return (x, y, z)


def apply_move(state, move):
    """Apply a single face turn to a 54-character facelet string."""
    face, quarters = move[0], QUARTER_TURNS[move[1:]]
    axis, layer = MOVE_AXES[face]

    turns = (-quarters * layer) % 4

    chars = list(state)
    for i, (pos, facing) in enumerate(STICKERS):
        if pos[AXIS_INDEX[axis]] != layer:
            continue
        new_pos = _rotate(pos, axis, turns)
        new_facing = NORMAL_TO_FACE[_rotate(FACE_NORMALS[facing], axis, turns)]
        chars[STICKER_INDEX[(new_pos, new_facing)]] = state[i]
    return "".join(chars)


def apply_moves(state, moves):
    for move in moves:
        state = apply_move(state, move)
    return state


#scrambles
def random_moves(rng, length=20):
    """A scramble that never turns the same face twice in a row."""
    moves = []
    last_face = None
    for _ in range(length):
        face = rng.choice([f for f in FACES if f != last_face])
        last_face = face
        moves.append(face + rng.choice(["", "'", "2"]))
    return moves


def generate_random_state():
    """A random *reachable* state: the solved cube with 20 random face turns applied."""
    return apply_moves(SOLVED_STATE, random_moves(random.Random()))


def scramble_for_day(day, salt="", length=20):
    """The scramble everyone gets on `day` — same date in, same cube out.

    Seeded off the date so the puzzle is shared without needing to be handed
    out, and salted so it isn't computable from the date alone by anyone who
    has not seen the salt.
    """
    digest = hashlib.sha256(f"{salt}:{day}".encode()).hexdigest()
    rng = random.Random(int(digest, 16))

    for _ in range(10):
        moves = random_moves(rng, length)
        if apply_moves(SOLVED_STATE, moves) != SOLVED_STATE:
            return moves
    raise RuntimeError("could not generate a scrambled state")


#solving
class SolverUnavailable(RuntimeError):
    """Raised when the kociemba extension is not installed."""


def solve_state(facelets):
    """Return the move list that takes `facelets` to the solved cube."""
    if kociemba is None:
        raise SolverUnavailable(
            "The kociemba solver is not installed. Run: pip install kociemba"
        )
    solution = kociemba.solve(facelets)
    if solution is None or solution.startswith("Error"):
        raise ValueError(solution or "no solution found")
    return solution.split()



def trim_solution(state: str, moves: list[str], target: str = SOLVED_STATE) -> list[str]:
    """
    Mock moves, when state matches target then stop and return the previous move list.
    if origin state matches target, return blank list
    if moves all done but state doesn't match target，return origin moves
    """
    if state == target:
        return []
    result = []
    for move in moves:
        state = apply_move(state, move)
        result.append(move)
        if state == target:
            return result
    return result


# Simplify for origin state
def simplify_solution(state: str, moves: list[str]) -> list[str]:
    return trim_solution(state, moves, SOLVED_STATE)



# def simplify_solution(state: str, moves: list[str]) -> list[str]:
#     """Mock the moves, if state becomes SOLVED_STATE then return the simplified moves up to that point."""
#     result = []
#     for move in moves:
#         state = apply_move(state, move)
#         result.append(move)
#         if state == SOLVED_STATE:
#             return result
#     return result  # if not solved, return the full steps
#
#
# def simplify_solution_from_str(state: str, moves_str: str) -> str:
#     """Build str simplify_solution"""
#     moves = moves_str.strip().split()
#     simplified = simplify_solution(state, moves)
#     return ' '.join(simplified)
