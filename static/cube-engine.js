// Cube state maths and the three.js cube, shared by the daily challenge and
// the solver page.
//
// `applyMoveToState` is the exact mirror of `apply_move` in cube.py — the
// browser tracks the state locally so a solve is detected the instant it
// happens, and the server replays the same moves to verify it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Re-exported so callers that already have the engine don't need a second import.
export { formatTime } from './format.js';

export const COLOR_MAP = {
    'U': '#FFFFFF',
    'R': '#FF0000',
    'F': '#00FF00',
    'D': '#FFFF00',
    'L': '#FFA500',
    'B': '#0000FF'
};
export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
export const SOLVED_STATE = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

const FACE_NORMALS = {
    'U': [0, 1, 0], 'R': [1, 0, 0], 'F': [0, 0, 1],
    'D': [0, -1, 0], 'L': [-1, 0, 0], 'B': [0, 0, -1]
};
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const MOVE_AXES = {
    'R': ['x', 1], 'L': ['x', -1],
    'U': ['y', 1], 'D': ['y', -1],
    'F': ['z', 1], 'B': ['z', -1]
};
const MATERIAL_INDEX = { 'R': 0, 'L': 1, 'U': 2, 'D': 3, 'F': 4, 'B': 5 };

function buildStickerIndex() {
    const map = {};
    const faces = [
        { name: 'U', axis: 'y', val: 1, u: 'x', v: 'z', uSign: 1, vSign: 1 },
        { name: 'R', axis: 'x', val: 1, u: 'z', v: 'y', uSign: -1, vSign: -1 },
        { name: 'F', axis: 'z', val: 1, u: 'x', v: 'y', uSign: 1, vSign: -1 },
        { name: 'D', axis: 'y', val: -1, u: 'x', v: 'z', uSign: 1, vSign: -1 },
        { name: 'L', axis: 'x', val: -1, u: 'z', v: 'y', uSign: 1, vSign: -1 },
        { name: 'B', axis: 'z', val: -1, u: 'x', v: 'y', uSign: -1, vSign: -1 }
    ];
    let globalIdx = 0;
    faces.forEach(face => {
        for (let row = -1; row <= 1; row++) {
            for (let col = -1; col <= 1; col++) {
                const coord = { x: 0, y: 0, z: 0 };
                coord[face.axis] = face.val;
                coord[face.u] = col * face.uSign;
                coord[face.v] = row * face.vSign;
                map[`${coord.x},${coord.y},${coord.z},${face.name}`] = globalIdx;
                globalIdx++;
            }
        }
    });
    return map;
}

const STICKER_INDEX = buildStickerIndex();
const NORMAL_TO_FACE = {};
for (const [face, normal] of Object.entries(FACE_NORMALS)) {
    NORMAL_TO_FACE[normal.join(',')] = face;
}
const STICKERS = [];
for (const [key, idx] of Object.entries(STICKER_INDEX)) {
    const parts = key.split(',');
    STICKERS[idx] = { pos: [+parts[0], +parts[1], +parts[2]], face: parts[3] };
}

function rotateVec(vec, axis, quarters) {
    let [x, y, z] = vec;
    const turns = ((quarters % 4) + 4) % 4;
    for (let i = 0; i < turns; i++) {
        if (axis === 'x') { [y, z] = [-z, y]; }
        else if (axis === 'y') { [x, z] = [z, -x]; }
        else { [x, y] = [-y, x]; }
    }
    return [x, y, z];
}

export function parseMove(move) {
    const base = move[0].toUpperCase();
    if (!(base in MOVE_AXES)) return null;
    const [axis, layer] = MOVE_AXES[base];
    let turns = 1;
    if (move.includes("'")) turns = 3;
    else if (move.includes('2')) turns = 2;
    let quarters = ((-turns * layer) % 4 + 4) % 4;
    if (quarters === 3) quarters = -1;
    return { axis, layer, quarters };
}

export function applyMoveToState(state, move) {
    const m = parseMove(move);
    if (!m) return state;
    const next = state.split('');
    for (let i = 0; i < 54; i++) {
        const sticker = STICKERS[i];
        if (sticker.pos[AXIS_INDEX[m.axis]] !== m.layer) continue;
        const pos = rotateVec(sticker.pos, m.axis, m.quarters);
        const normal = rotateVec(FACE_NORMALS[sticker.face], m.axis, m.quarters);
        next[STICKER_INDEX[`${pos.join(',')},${NORMAL_TO_FACE[normal.join(',')]}`]] = state[i];
    }
    return next.join('');
}

export function applyMovesToState(state, moves) {
    return moves.reduce((acc, move) => applyMoveToState(acc, move), state);
}

export function invertMove(move) {
    if (move.endsWith("'")) return move.slice(0, -1);
    if (move.endsWith('2')) return move;
    return move + "'";
}

export function stateFromMoves(moves, from = SOLVED_STATE) {
    return moves.split(/\s+/).filter(m => m.length > 0)
        .reduce((state, move) => applyMoveToState(state, move), from);
}

export function isStateValid(stateStr) {
    if (stateStr.length !== 54) return false;
    const counts = {};
    for (let ch of stateStr) {
        counts[ch] = (counts[ch] || 0) + 1;
    }
    if (Object.keys(counts).length !== 6) return false;
    for (let cnt of Object.values(counts)) {
        if (cnt !== 9) return false;
    }
    const centers = [stateStr[4], stateStr[13], stateStr[22], stateStr[31], stateStr[40], stateStr[49]];
    return new Set(centers).size === 6;
}


// --------------------------------------------------------------------------
// 3D cube
// --------------------------------------------------------------------------
export class RubikCube3D {
    constructor() {
        this.group = new THREE.Group();
        this.cubies = [];
        this.faceColors = null;
        this.cubieSize = 0.9;
        this.gap = 0.05;
        this._createCubies();
    }

    _createCubies() {
        const size = this.cubieSize;
        const offset = size + this.gap;

        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    if (x === 0 && y === 0 && z === 0) continue;

                    const geometry = new THREE.BoxGeometry(size, size, size);
                    const materials = [];
                    for (let i = 0; i < 6; i++) {
                        // Prussian Blue for the inward faces, so the gaps between
                        // cubies read as shadow instead of grey plastic.
                        materials.push(new THREE.MeshStandardMaterial({ color: 0x1b263b, roughness: 0.4 }));
                    }
                    const cubie = new THREE.Mesh(geometry, materials);
                    cubie.position.set(x * offset, y * offset, z * offset);
                    cubie.userData = { gridPos: new THREE.Vector3(x, y, z) };
                    this.group.add(cubie);
                    this.cubies.push(cubie);
                }
            }
        }
    }

    setColors(stateStr) {
        this.faceColors = stateStr;
        const faceMap = this._getFaceMap();
        this.reset();

        this.cubies.forEach(cubie => {
            const grid = cubie.userData.gridPos;
            const faceInfo = faceMap[`${grid.x},${grid.y},${grid.z}`];
            if (!faceInfo) return;

            faceInfo.forEach((colorChar, i) => {
                const hex = colorChar ? parseInt(COLOR_MAP[colorChar].slice(1), 16) : 0x1b263b;
                cubie.material[i].color.setHex(hex);
            });
        });
    }

    reset() {
        const offset = this.cubieSize + this.gap;
        this.cubies.forEach(cubie => {
            const grid = cubie.userData.gridPos;
            cubie.position.set(grid.x * offset, grid.y * offset, grid.z * offset);
            cubie.quaternion.identity();
        });
    }

    _getFaceMap() {
        const map = {};
        const colors = this.faceColors;
        if (!colors || colors.length !== 54) return map;

        for (const [key, idx] of Object.entries(STICKER_INDEX)) {
            const parts = key.split(',');
            const face = parts[3];
            const posKey = parts.slice(0, 3).join(',');
            if (!map[posKey]) {
                map[posKey] = [null, null, null, null, null, null];
            }
            map[posKey][MATERIAL_INDEX[face]] = colors[idx];
        }
        return map;
    }

    async rotateLayer(axis, layer, angle, duration = 300) {
        const threshold = 0.4;
        const offset = this.cubieSize + this.gap;
        const cubiesToRotate = this.cubies.filter(
            c => Math.abs(c.position[axis] - layer * offset) < threshold
        );

        if (cubiesToRotate.length === 0) return;

        const pivotGroup = new THREE.Group();
        this.group.add(pivotGroup);
        cubiesToRotate.forEach(c => pivotGroup.attach(c));

        const startTime = performance.now();

        return new Promise(resolve => {
            const animateRotation = (now) => {
                const progress = Math.min((now - startTime) / duration, 1);
                pivotGroup.rotation[axis] = angle * progress;
                if (progress < 1) {
                    requestAnimationFrame(animateRotation);
                } else {
                    cubiesToRotate.forEach(c => {
                        const worldPos = c.getWorldPosition(new THREE.Vector3());
                        const worldQuat = c.getWorldQuaternion(new THREE.Quaternion());
                        this.group.attach(c);
                        c.position.copy(worldPos);
                        c.quaternion.copy(worldQuat);
                    });
                    this.group.remove(pivotGroup);
                    resolve();
                }
            };
            requestAnimationFrame(animateRotation);
        });
    }

    animateMove(move, duration = 300) {
        const m = parseMove(move);
        if (!m) return Promise.resolve();
        return this.rotateLayer(m.axis, m.layer, m.quarters * Math.PI / 2, duration);
    }

    async applyMoves(moveStr, duration = 300) {
        const moves = moveStr.split(/\s+/).filter(m => m.length > 0);
        for (const move of moves) {
            await this.animateMove(move, duration);
        }
    }
}


/** Wire a three.js scene into `containerId` and return the cube in it. */
export function mountCube(containerId, state) {
    const container = document.getElementById(containerId);
    // A container inside a `hidden` ancestor measures 0x0, which would make the
    // aspect ratio NaN and render nothing. Fall back to a square until the
    // ResizeObserver below reports real dimensions.
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const scene = new THREE.Scene();
    // Ink Black, so the canvas reads as part of the page rather than a window.
    scene.background = new THREE.Color(0x0d1b2a);

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    camera.position.set(5, 5, 8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.8;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    const rubikCube = new RubikCube3D();
    scene.add(rubikCube.group);
    rubikCube.setColors(state);

    (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    })();

    // Tracks the container itself rather than the window, so the canvas is
    // sized correctly however it got there — revealed after being hidden,
    // reflowed by the flex layout, or an actual window resize.
    new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }).observe(container);

    return rubikCube;
}


/** Render the six 3x3 face grids into `containerId`. */
export function renderFaces(containerId, stateStr, onCellClick) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    let idx = 0;
    for (const face of FACE_ORDER) {
        const faceDiv = document.createElement('div');
        faceDiv.className = 'face';
        for (let i = 0; i < 9; i++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.style.backgroundColor = COLOR_MAP[stateStr[idx]];
            cell.dataset.index = idx;
            cell.dataset.color = stateStr[idx];
            if (onCellClick) {
                const at = idx;
                cell.addEventListener('click', () => onCellClick(cell, at));
            }
            faceDiv.appendChild(cell);
            idx++;
        }
        container.appendChild(faceDiv);
    }
}