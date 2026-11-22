/* Copied from real-estate src/viewer/Visite360Engine.ts (types removed). */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
var Move;
(function (Move) {
    Move[Move["NONE"] = 0] = "NONE";
    Move[Move["PREPARING"] = 1] = "PREPARING";
    Move[Move["MOVING"] = 2] = "MOVING";
})(Move || (Move = {}));
// ------------------------------------------------------------------ shaders
/** Still: one cubemap projected from one point. */
const STILL_VS = /* glsl */ `
  uniform vec3 refPos;
  varying vec3 vDir;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - refPos;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const STILL_FS = /* glsl */ `
  uniform samplerCube tex;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    gl_FragColor = textureCube(tex, vec3(-d.x, d.y, d.z));
  }`;
/** Move: cubemap A projected from A, cubemap B from B, cross-faded by mixAB. */
const MOVE_VS = /* glsl */ `
  uniform vec3 refPosA;
  uniform vec3 refPosB;
  varying vec3 vDirA;
  varying vec3 vDirB;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDirA = w.xyz - refPosA;
    vDirB = w.xyz - refPosB;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const MOVE_FS = /* glsl */ `
  uniform samplerCube texA;
  uniform samplerCube texB;
  uniform float mixAB;
  varying vec3 vDirA;
  varying vec3 vDirB;
  void main() {
    vec3 a = normalize(vDirA);
    vec3 b = normalize(vDirB);
    gl_FragColor = mix(textureCube(texA, vec3(-a.x, a.y, a.z)),
                       textureCube(texB, vec3(-b.x, b.y, b.z)), mixAB);
  }`;
// ---------------------------------------------------------------- constants
// All of these are the values used by the NHC engine.
const FOV_MIN = 0.3; // rad (vertical) — max zoom-in
const FOV_MAX = 2; // rad — max zoom-out
const FOV_SLOPE = -0.41145490454246214; // default fov = slope * aspect + intercept
const FOV_INTERCEPT = 1.831443383805135;
const WHEEL_FOV_STEP = 0.025; // rad per wheel event
const PITCH_LIMIT = (0.8 * Math.PI) / 2; // ±72°
const INERTIA_DECAY = 0.85; // velocity multiplier per 20 ms
const TAP_MAX_MOVE = 10; // px — like Babylon's DragMovementThreshold
const TAP_MAX_MS = 500;
const DOUBLE_TAP_WINDOW = 1; // s after a move started
const TEX_CACHE_MAX = 12;
const CUBE_FACES = ["px", "nx", "py", "ny", "pz", "nz"]; // three.js order
const RING_DIAMETER = 0.38; // m — one standard size for every ring (hovered one included)
const RING_THICKNESS = 0.012;
const DOT_RADIUS = 0.04;
const CURSOR_RADIUS = 0.05;
const RING_HIT_RADIUS = 0.34; // m — a click this close to a ring's centre goes to that ring
// -------------------------------------------------------------------- easing
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const wrapAngle = (a) => {
    const t = Math.PI * 2;
    return ((a % t) + t) % t;
};
/** Shortest signed difference a − b. */
const deltaAngle = (a, b) => {
    let d = wrapAngle(a) - wrapAngle(b);
    if (d > Math.PI)
        d -= Math.PI * 2;
    if (d < -Math.PI)
        d += Math.PI * 2;
    return d;
};
const isMobileUA = () => typeof navigator !== "undefined" &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
// --------------------------------------------------------------------- engine
export class Visite360Engine {
    constructor(opts) {
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene(); // drawn on top (Babylon renderingGroupId 1)
        this.raycaster = new THREE.Raycaster();
        this.cams = [];
        this.pickables = [];
        this.houseMeshes = [];
        // camera rig state (cameraParent in NHC)
        this.rigPos = new THREE.Vector3();
        this.rigQuat = new THREE.Quaternion();
        this.prevPos = new THREE.Vector3();
        this.prevQuat = new THREE.Quaternion();
        this.desiredQuat = new THREE.Quaternion();
        this.prevCamera = 0; // camera we're at (or leaving)
        this.desiredCam = 0; // camera we're heading to
        this.status = Move.NONE;
        this.moveDone = 0;
        this.interDist = 1;
        this.moveStartTime = -1;
        this.currentTex = null;
        this.nextTex = null;
        this.texCache = new Map();
        this.texLoading = new Map();
        this.prefetchHandle = null;
        // markers
        this.floorAnchors = new Map();
        this.floorMarkers = [];
        this.floorLabels = [];
        this.floorEligible = [];
        this.hoverDest = null;
        this.markersSuppressed = false;
        this.walking = false; // rings hidden during a walk, shown again on arrival
        this.hotspots = [];
        this.infoBox = null;
        // measuring
        this.measureMode = false;
        this.measurePending = null;
        this.measurements = [];
        // input
        this.pointers = new Map();
        this.dragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.velX = 0;
        this.velY = 0;
        this.velT = 0;
        this.inertia = false;
        this.pinchDist = 0;
        this.pinchStartA = null;
        this.pinchStartB = null;
        this.hoverX = -1;
        this.hoverY = -1;
        this.hoverDirty = false;
        this.ready = { mesh: false, tex: false, first: false };
        this.aspect = 1;
        this.raf = 0;
        this.lastFrame = 0;
        this.disposed = false;
        this.cleanups = [];
        this.arrivalListeners = [];
        this.rotationToken = 0;
        /**
         * Where to face after a jump. Uses the camera's look-at when it was authored;
         * otherwise faces the most open direction (36 horizontal rays, smoothed over ±20°)
         * so a rail jump never lands nose-against-a-wall.
         */
        this.viewTargets = new Map();
        this.lastTapTime = 0;
        this.o = opts;
        this.s = opts.tour.unitScale ?? 0.01;
        this.unitStep = 150 * this.s;
        this.moveSpeedStep = 4 * this.s;
        this.cams = opts.tour.cameras.map((c) => ({
            id: c.n,
            alias: c.a,
            label: c.lb,
            floor: c.floor,
            pos: this.toWorld(c.p),
            lookat: this.toWorld(c.l),
            // Layama writes a placeholder look-at (1 cm along −X) for every camera.
            authoredLook: !(Math.abs(c.p[0] - c.l[0] - 1) < 0.05 &&
                Math.abs(c.p[1] - c.l[1]) < 0.05 &&
                Math.abs(c.p[2] - c.l[2]) < 0.05),
            vis: c.c ? c.c.map((v) => v !== 0) : undefined,
        }));
        const start = Math.max(0, this.cams.findIndex((c) => c.id === opts.tour.startCamera));
        this.prevCamera = this.desiredCam = start;
        this.renderer = new THREE.WebGLRenderer({
            canvas: opts.canvas,
            antialias: true,
            preserveDrawingBuffer: true, // screenshots
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.autoClear = false;
        this.renderer.setClearColor(new THREE.Color(0.067, 0.067, 0.067), 1);
        this.camera = new THREE.PerspectiveCamera(60, 1, 5 * this.s, 1000);
        this.stillMat = new THREE.ShaderMaterial({
            uniforms: { tex: { value: null }, refPos: { value: new THREE.Vector3() } },
            vertexShader: STILL_VS,
            fragmentShader: STILL_FS,
            side: THREE.DoubleSide,
        });
        this.moveMat = new THREE.ShaderMaterial({
            uniforms: {
                texA: { value: null },
                texB: { value: null },
                refPosA: { value: new THREE.Vector3() },
                refPosB: { value: new THREE.Vector3() },
                mixAB: { value: 0 },
            },
            vertexShader: MOVE_VS,
            fragmentShader: MOVE_FS,
            side: THREE.DoubleSide,
        });
        // initial pose: at the start camera, looking at its look-at point
        const c0 = this.cams[start];
        this.rigPos.copy(c0.pos);
        this.rigQuat.copy(this.lookQuat(c0.pos, c0.lookat, false));
        this.prevPos.copy(this.rigPos);
        this.prevQuat.copy(this.rigQuat);
        this.desiredQuat.copy(this.rigQuat);
        this.syncCamera();
        this.buildMarkers();
        this.buildHotspots();
        this.resize(true);
        this.bindInput();
    }
    // ============================================================ public API
    async start() {
        const { tour, baseUrl } = this.o;
        try {
            // 1) first panorama
            const firstPath = this.texPath(this.desiredCam);
            this.loadCube(firstPath)
                .then((t) => {
                this.currentTex = t;
                this.stillMat.uniforms.tex.value = t;
                this.stillMat.uniforms.refPos.value.copy(this.cams[this.desiredCam].pos);
                this.ready.tex = true;
                this.prefetchNeighbors(this.desiredCam);
                this.prefetchFloorStarts();
                this.maybeFirstFrame();
            })
                .catch((e) => this.fail(`Panorama failed to load (${String(e)})`));
            // 2) house mesh (Draco-compressed glb exported by Layama)
            const draco = new DRACOLoader().setDecoderPath(this.o.dracoPath ?? "/draco/");
            const loader = new GLTFLoader().setDRACOLoader(draco);
            const gltf = await loader.loadAsync(`${baseUrl}/${tour.mesh}`);
            draco.dispose();
            if (this.disposed)
                return;
            const root = new THREE.Group();
            root.scale.setScalar(this.s);
            root.add(gltf.scene);
            this.scene.add(root);
            root.updateMatrixWorld(true);
            const bounds = new THREE.Box3();
            gltf.scene.traverse((obj) => {
                const m = obj;
                if (!m.isMesh)
                    return;
                m.material = this.stillMat;
                m.frustumCulled = false;
                m.geometry.boundsTree = new MeshBVH(m.geometry);
                m.raycast = acceleratedRaycast;
                m.matrixAutoUpdate = false;
                this.houseMeshes.push(m);
                this.pickables.push(m);
                bounds.expandByObject(m);
            });
            // Background box around everything: fills sky / holes with the same projection.
            const size = bounds.getSize(new THREE.Vector3()).addScalar(1);
            const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), this.stillMat);
            box.position.copy(bounds.getCenter(new THREE.Vector3()));
            box.updateMatrixWorld(true);
            box.matrixAutoUpdate = false;
            this.scene.add(box);
            this.houseMeshes.push(box);
            this.pickables.push(box);
            this.camera.far = 5 + size.length();
            this.camera.updateProjectionMatrix();
            this.computeMissingVisibilities();
            this.updateFloorMarkers();
            this.updateHotspotVisibility();
            this.ready.mesh = true;
            this.maybeFirstFrame();
        }
        catch (e) {
            this.fail(`3D mesh failed to load (${e instanceof Error ? e.message : String(e)})`);
        }
        this.lastFrame = performance.now();
        const loop = (t) => {
            if (this.disposed)
                return;
            this.raf = requestAnimationFrame(loop);
            this.frame(t);
        };
        this.raf = requestAnimationFrame(loop);
    }
    getCameras() {
        return this.cams.map((c, i) => ({ id: c.id, index: i, label: c.label, floor: c.floor }));
    }
    getCurrentId() {
        return this.cams[this.prevCamera]?.id;
    }
    isMoving() {
        return this.status !== Move.NONE;
    }
    /** Same as NHC fnTeleportToCamera: fly if in line of sight, else jump + cross-fade. */
    teleportTo(id) {
        const e = this.cams.findIndex((c) => c.id === id || c.alias === id);
        if (e < 0 || e === this.desiredCam || this.disposed)
            return;
        const dest = this.cams[e].pos;
        const from = this.camera.position.clone();
        const dir = dest.clone().sub(from);
        const dist = dir.length();
        const blocked = !!this.pick(from, dir.normalize(), dist);
        this.desiredCam = e;
        this.desiredQuat = this.clampPitch(this.lookQuat(dest, this.viewTarget(e), false));
        this.hideHover();
        const path = this.texPath(e);
        this.loadCube(path)
            .then((tex) => {
            if (this.disposed || this.texPath(e) !== path || this.desiredCam !== e)
                return;
            // Move the camera only once the destination panorama is ready: jumping first (e.g. to the
            // roof) would show the current panorama smeared from the wrong spot while the image loads.
            let refA;
            if (blocked) {
                // wall in between: cut to destination and cross-fade in place (~0.6 s)
                this.interDist = this.unitStep;
                this.rigPos.copy(dest);
                refA = dest.clone();
            }
            else {
                this.interDist = Math.max(this.unitStep, dist);
                refA = this.rigPos.clone();
            }
            this.prevPos.copy(this.rigPos);
            this.prevQuat.copy(this.rigQuat);
            this.nextTex = tex;
            if (this.currentTex)
                this.useMoveMaterial(refA, dest, this.currentTex, tex);
            this.moveDone = 0;
            this.status = Move.MOVING;
            this.setWalking();
            this.o.onCameraChange?.(this.cams[e].id, e);
        })
            .catch((err) => console.error("Visite360: teleport texture failed", err));
    }
    /** Resolves once the camera has arrived at `id` (used by the auto tour). */
    teleportToAsync(id, timeoutMs = 30000) {
        return new Promise((resolve) => {
            const idx = this.cams.findIndex((c) => c.id === id);
            if (idx < 0 || this.disposed)
                return resolve();
            if (this.prevCamera === idx && this.status === Move.NONE) {
                this.teleportTo(id);
                return resolve();
            }
            const done = () => {
                clearTimeout(timer);
                this.arrivalListeners = this.arrivalListeners.filter((l) => l !== listener);
                resolve();
            };
            const listener = (arrived) => arrived === id && done();
            const timer = setTimeout(done, timeoutMs);
            this.arrivalListeners.push(listener);
            this.teleportTo(id);
        });
    }
    /** Smooth yaw turn (auto tour). Positive = turn right. */
    animateRotation(deltaYawDeg, durationMs) {
        const token = ++this.rotationToken;
        const from = this.rigQuat.clone();
        const to = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-deltaYawDeg * Math.PI) / 180)
            .multiply(from);
        const t0 = performance.now();
        const dur = Math.max(1, durationMs);
        return new Promise((resolve) => {
            const step = () => {
                if (this.disposed || token !== this.rotationToken)
                    return resolve();
                const f = Math.min(1, (performance.now() - t0) / dur);
                const p = f * f * (3 - 2 * f);
                this.setRotation(from.clone().slerp(to, p));
                if (f < 1)
                    requestAnimationFrame(step);
                else
                    resolve();
            };
            requestAnimationFrame(step);
        });
    }
    cancelAutoAnimation() {
        this.rotationToken++;
    }
    setMeasureMode(on) {
        if (this.measureMode === on)
            return;
        this.measureMode = on;
        if (!on && this.measurePending) {
            this.measurePending.dot.remove();
            this.measurePending = null;
        }
        this.updateFloorMarkers();
        this.o.canvas.style.cursor = on ? "crosshair" : "";
    }
    clearMeasurements() {
        for (const m of this.measurements) {
            this.overlayScene.remove(m.line);
            m.line.geometry.dispose();
            m.dotA.remove();
            m.dotB.remove();
            m.label.remove();
        }
        this.measurements = [];
        this.measurePending?.dot.remove();
        this.measurePending = null;
        this.o.onMeasurementsChange?.(0);
    }
    setFloorMarkersVisible(v) {
        this.markersSuppressed = !v;
        this.refreshFloorMarkers();
    }
    snapshot(name = "Visite 360") {
        this.render();
        this.o.canvas.toBlob((blob) => {
            if (!blob)
                return;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${name} ${new Date().toISOString().slice(0, 19).replace(/:/g, ".")}.jpg`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, "image/jpeg", 0.9);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        if (this.prefetchHandle !== null)
            clearTimeout(this.prefetchHandle);
        this.cleanups.forEach((f) => f());
        this.clearMeasurements();
        for (const t of this.texCache.values())
            t.dispose();
        this.texCache.clear();
        this.floorLabels.forEach((l) => l.remove());
        this.hoverLabel?.remove();
        this.hotspots.forEach((h) => h.el.remove());
        this.infoBox?.remove();
        this.scene.traverse((o) => {
            const m = o;
            if (m.isMesh) {
                m.geometry.boundsTree = undefined;
                m.geometry.dispose();
            }
        });
        this.overlayScene.traverse((o) => o.isMesh && o.geometry.dispose());
        this.stillMat.dispose();
        this.moveMat.dispose();
        this.renderer.dispose();
    }
    // ====================================================== coordinates
    /** Layama cm (Babylon LH) → three.js world metres. */
    toWorld(p) {
        return new THREE.Vector3(-p[0] * this.s, p[1] * this.s, p[2] * this.s);
    }
    /** three.js world metres → Layama cm (for logging hotspot positions). */
    toLayama(v) {
        const r = (x) => Math.round(x * 100) / 100;
        return [r(-v.x / this.s), r(v.y / this.s), r(v.z / this.s)];
    }
    lookQuat(from, to, clamp = true) {
        const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        return clamp ? this.clampPitch(q) : q;
    }
    yawPitch(q) {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        return { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)) };
    }
    fromYawPitch(yaw, pitch) {
        return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    }
    clampPitch(q) {
        const { yaw, pitch } = this.yawPitch(q);
        if (Math.abs(pitch) <= PITCH_LIMIT)
            return q;
        return this.fromYawPitch(yaw, Math.sign(pitch) * PITCH_LIMIT);
    }
    // ============================================================ raycasting
    pick(origin, dir, far = Infinity) {
        if (!this.pickables.length)
            return null;
        this.raycaster.set(origin, dir);
        this.raycaster.near = 0;
        this.raycaster.far = far;
        this.raycaster.firstHitOnly = true;
        const hits = this.raycaster.intersectObjects(this.pickables, false);
        const h = hits[0];
        if (!h)
            return null;
        let normal = null;
        if (h.face)
            normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        return { point: h.point.clone(), normal, distance: h.distance };
    }
    pickScreen(clientX, clientY) {
        const r = this.o.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        return this.pick(this.raycaster.ray.origin.clone(), this.raycaster.ray.direction.clone());
    }
    /** World direction under a screen point for a given camera orientation. */
    screenDir(clientX, clientY, q) {
        const r = this.o.canvas.getBoundingClientRect();
        const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
        v.applyMatrix4(this.camera.projectionMatrixInverse).normalize();
        return v.applyQuaternion(q);
    }
    viewTarget(i) {
        const cam = this.cams[i];
        if (cam.authoredLook || !this.pickables.length)
            return cam.lookat;
        const cached = this.viewTargets.get(i);
        if (cached)
            return cached;
        const N = 36;
        const dirs = [];
        const dist = [];
        for (let k = 0; k < N; k++) {
            const a = (k / N) * Math.PI * 2;
            const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            dirs.push(d);
            dist.push(this.pick(cam.pos, d, 30)?.distance ?? 30);
        }
        let best = 0;
        let bestScore = -1;
        for (let k = 0; k < N; k++) {
            let s = 0;
            for (let j = -2; j <= 2; j++)
                s += dist[(k + j + N) % N];
            if (s > bestScore) {
                bestScore = s;
                best = k;
            }
        }
        const t = cam.pos.clone().add(dirs[best]);
        this.viewTargets.set(i, t);
        return t;
    }
    // ===================================================== visibility graph
    /** For cameras without a `c` row: reachable if nothing is in between. */
    computeMissingVisibilities() {
        const n = this.cams.length;
        for (let i = 0; i < n; i++) {
            if (this.cams[i].vis)
                continue;
            const row = [];
            for (let j = 0; j < n; j++) {
                if (i === j)
                    row[j] = true;
                else {
                    const d = this.cams[j].pos.clone().sub(this.cams[i].pos);
                    row[j] = !this.pick(this.cams[i].pos, d.clone().normalize(), d.length());
                }
            }
            this.cams[i].vis = row;
        }
    }
    // ============================================================== textures
    texPath(index) {
        const res = this.o.tour.resolutions?.length ? this.o.tour.resolutions : ["2048", "1024"];
        let r = 0;
        if (isMobileUA() || window.innerWidth < 800 || window.innerHeight < 800)
            r = 1;
        r = Math.min(r, res.length - 1);
        return `${this.o.imageBaseUrl ?? this.o.baseUrl}/${res[r]}/${this.cams[index].id}`;
    }
    loadCube(path) {
        const cached = this.texCache.get(path);
        if (cached)
            return Promise.resolve(cached);
        const pending = this.texLoading.get(path);
        if (pending)
            return pending;
        const ext = this.o.tour.imageExt || ".jpg";
        const p = new Promise((resolve, reject) => {
            new THREE.CubeTextureLoader().load(CUBE_FACES.map((f) => `${path}_${f}${ext}`), (tex) => {
                this.texLoading.delete(path);
                if (this.disposed) {
                    tex.dispose();
                    return reject(new Error("disposed"));
                }
                // Raw colours, no mipmaps — same as Babylon CubeTexture(noMipmap).
                tex.colorSpace = THREE.NoColorSpace;
                tex.generateMipmaps = false;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.needsUpdate = true;
                this.texCache.set(path, tex);
                resolve(tex);
            }, undefined, (err) => {
                this.texLoading.delete(path);
                reject(err);
            });
        });
        this.texLoading.set(path, p);
        return p;
    }
    /** Preload the first room of every floor, so the Ground / First / Roof buttons open instantly. */
    prefetchFloorStarts() {
        const ids = (this.o.tour.floors ?? []).map((f) => f.rooms?.[0]).filter((id) => !!id);
        const run = () => {
            for (const id of ids) {
                const i = this.cams.findIndex((c) => c.id === id);
                if (i < 0 || i === this.desiredCam)
                    continue;
                const p = this.texPath(i);
                if (!this.texCache.has(p) && !this.texLoading.has(p))
                    this.loadCube(p).catch(() => { });
            }
        };
        window.setTimeout(run, 400);
    }
    /** After arriving, quietly preload every camera reachable from here. */
    prefetchNeighbors(index) {
        if (this.prefetchHandle !== null)
            clearTimeout(this.prefetchHandle);
        const vis = this.cams[index]?.vis;
        if (!vis)
            return;
        const todo = vis.map((v, j) => (v && j !== index ? j : -1)).filter((j) => j >= 0);
        const run = () => {
            this.prefetchHandle = null;
            for (const j of todo) {
                const p = this.texPath(j);
                if (!this.texCache.has(p) && !this.texLoading.has(p))
                    this.loadCube(p).catch(() => { });
            }
        };
        const ric = window
            .requestIdleCallback;
        if (ric)
            ric(run, { timeout: 1500 });
        else
            this.prefetchHandle = window.setTimeout(run, 250);
    }
    evictCache() {
        if (this.texCache.size <= TEX_CACHE_MAX)
            return;
        const keep = new Set([this.texPath(this.prevCamera), this.texPath(this.desiredCam)]);
        this.cams[this.prevCamera].vis?.forEach((v, j) => v && keep.add(this.texPath(j)));
        for (const [k, t] of this.texCache) {
            if (this.texCache.size <= TEX_CACHE_MAX)
                break;
            if (keep.has(k) || t === this.currentTex || t === this.nextTex)
                continue;
            t.dispose();
            this.texCache.delete(k);
        }
    }
    useMoveMaterial(a, b, ta, tb) {
        const u = this.moveMat.uniforms;
        u.refPosA.value.copy(a);
        u.refPosB.value.copy(b);
        u.texA.value = ta;
        u.texB.value = tb;
        u.mixAB.value = 0;
        for (const m of this.houseMeshes)
            m.material = this.moveMat;
    }
    useStillMaterial(pos, tex) {
        this.stillMat.uniforms.tex.value = tex;
        this.stillMat.uniforms.refPos.value.copy(pos);
        for (const m of this.houseMeshes)
            m.material = this.stillMat;
    }
    // ===================================================== choosing a target
    pointToLine(p, a, b) {
        const dir = b.clone().sub(a).normalize();
        const proj = a.clone().add(dir.multiplyScalar(p.clone().sub(a).dot(dir)));
        return proj.distanceTo(p);
    }
    /** Destination within ±90° of where you're looking. */
    angleOk(target) {
        const cur = this.yawPitch(this.rigQuat).yaw;
        const to = this.yawPitch(this.lookQuat(this.camera.position, target, false)).yaw;
        return Math.abs(deltaAngle(cur, to)) <= Math.PI / 2;
    }
    chooseDestination(hit, fullMove, checkAngle) {
        const here = this.camera.position;
        const toPoint = hit.point.distanceTo(here);
        const vis = this.cams[this.prevCamera].vis;
        const cands = [];
        this.cams.forEach((c, i) => {
            if (vis && vis[i] === false)
                return;
            const dis = hit.point.distanceTo(c.pos);
            if (dis >= toPoint || (checkAngle && !this.angleOk(c.pos)))
                return;
            const inter = here.distanceTo(c.pos);
            let score;
            if (fullMove) {
                score = dis;
                if (inter > toPoint)
                    score = 2 * (score + 4 * (inter - toPoint));
            }
            else {
                score = Math.hypot(this.pointToLine(c.pos, here, hit.point), inter * 0.25);
            }
            cands.push({ dis, score, index: i });
        });
        cands.sort((a, b) => a.score - b.score);
        for (const c of cands) {
            const p = this.cams[c.index].pos;
            const dir = hit.point.clone().sub(p).normalize();
            const h = this.pick(p, dir, c.dis + 10 * this.s);
            if (h && h.distance + 10 * this.s > c.dis)
                return c.index; // clicked spot is visible from there
        }
        return this.desiredCam;
    }
    /** The ring nearest to the clicked point wins — this is what clicks actually do. */
    /**
     * Ring under the screen point, if any. Rings are drawn on top of everything, so a
     * ring can sit visually over a sofa, a stair or a glass panel: we test the click ray
     * against each ring's own floor level instead of trusting the surface it hits.
     */
    ringAtScreen(clientX, clientY) {
        const r = this.o.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const o = this.raycaster.ray.origin;
        const d = this.raycaster.ray.direction;
        if (Math.abs(d.y) < 1e-4)
            return null;
        let best = null;
        let bestT = Infinity;
        this.floorEligible.forEach((ok, i) => {
            if (!ok || this.walking || this.markersSuppressed)
                return;
            const a = this.floorAnchor(i);
            const t = (a.y - o.y) / d.y;
            if (t <= 0 || t >= bestT)
                return;
            const px = o.x + d.x * t - a.x;
            const pz = o.z + d.z * t - a.z;
            if (Math.hypot(px, pz) <= RING_HIT_RADIUS) {
                bestT = t;
                best = i;
            }
        });
        return best;
    }
    nearestReachable(point) {
        let best = -1;
        let bestD = Infinity;
        this.floorEligible.forEach((ok, i) => {
            if (!ok)
                return;
            const a = this.floorAnchor(i);
            const d = a.distanceTo(point);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        return best >= 0 ? best : null;
    }
    /**
     * fullMove: score by distance to the clicked point (right click) instead of "on the way".
     * rotMode: 0 keep heading, 1 turn a little towards the click (max 15°), 2 face the click.
     * keyboard: a key press that finds nothing does nothing (no turn-in-place).
     */
    startMove(fullMove, rotMode, checkAngle, keyboard, hit, ring = null) {
        if (this.status !== Move.NONE)
            return;
        if (ring !== null) {
            // clicked a ring: go exactly there; "look point" = straight ahead along the walk
            const here = this.camera.position;
            const dest = this.cams[ring].pos;
            const dir = new THREE.Vector3(dest.x - here.x, 0, dest.z - here.z);
            if (dir.lengthSq() < 1e-6)
                dir.set(0, 0, -1).applyQuaternion(this.rigQuat).setY(0);
            hit = { point: dest.clone().addScaledVector(dir.normalize(), 3), normal: null, distance: 0 };
        }
        if (!hit)
            return;
        this.moveStartTime = performance.now() / 1000;
        this.status = Move.PREPARING;
        if (ring !== null)
            this.desiredCam = ring;
        else {
            this.desiredCam = this.chooseDestination(hit, fullMove, checkAngle);
            const near = this.nearestReachable(hit.point);
            if (near !== null)
                this.desiredCam = near;
        }
        const here = this.camera.position.clone();
        const dest = this.cams[this.desiredCam].pos;
        this.interDist = THREE.MathUtils.clamp(here.distanceTo(dest), this.unitStep, this.unitStep * 24);
        if (this.desiredCam === this.prevCamera) {
            if (keyboard) {
                this.status = Move.NONE;
                return;
            }
            this.desiredQuat = this.clampPitch(this.lookQuat(dest, hit.point, false)); // just turn
        }
        else if (rotMode === 0) {
            this.desiredQuat = this.rigQuat.clone();
        }
        else {
            this.desiredQuat = this.lookQuat(dest, hit.point, false);
            if (rotMode === 1) {
                const cur = this.yawPitch(this.rigQuat);
                const want = this.yawPitch(this.desiredQuat).yaw;
                const toClick = this.yawPitch(this.lookQuat(here, hit.point, false)).yaw;
                const turn = THREE.MathUtils.clamp(deltaAngle(cur.yaw, want), -Math.PI / 6, Math.PI / 6);
                const side = deltaAngle(cur.yaw, toClick);
                const yaw = (side <= 0 && turn < 0) || (side >= 0 && turn > 0) ? cur.yaw - turn * 0.5 : cur.yaw;
                this.desiredQuat = this.fromYawPitch(yaw, cur.pitch);
            }
            this.desiredQuat = this.clampPitch(this.desiredQuat);
        }
        this.prevPos.copy(this.rigPos);
        this.prevQuat.copy(this.rigQuat);
        if (this.desiredCam === this.prevCamera) {
            this.nextTex = this.currentTex;
            this.moveDone = 0;
            this.status = Move.MOVING;
            this.setWalking();
            return;
        }
        const target = this.desiredCam;
        const path = this.texPath(target);
        this.loadCube(path)
            .then((tex) => {
            if (this.disposed || this.desiredCam !== target)
                return;
            this.nextTex = tex;
            if (this.currentTex)
                this.useMoveMaterial(this.cams[this.prevCamera].pos, dest, this.currentTex, tex);
            this.moveDone = 0;
            this.status = Move.MOVING;
            this.setWalking();
            this.o.onCameraChange?.(this.cams[target].id, target);
        })
            .catch((e) => {
            console.error("Visite360: cube texture load failed", e);
            this.status = Move.NONE;
        });
    }
    // ================================================================ frame
    frame(now) {
        const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        const frames60 = dt * 60; // NHC advances per frame at 60 Hz; we normalise to time.
        this.applyDrag();
        if (this.status === Move.MOVING) {
            if (this.moveDone >= 1)
                this.arrive();
            else {
                const t = this.moveDone;
                // longer walks get a stronger ease so they accelerate / brake more
                const d = this.interDist <= this.unitStep * 2
                    ? easeInOutSine(t)
                    : this.interDist <= this.unitStep * 8
                        ? easeInOutQuad(t)
                        : this.interDist <= this.unitStep * 16
                            ? easeInOutCubic(t)
                            : easeInOutQuart(t);
                const rot = (d + d * d) / 2; // rotation lags the translation a little
                this.rigPos.lerpVectors(this.prevPos, this.cams[this.desiredCam].pos, d);
                this.rigQuat.slerpQuaternions(this.prevQuat, this.desiredQuat, rot);
                this.moveMat.uniforms.mixAB.value = easeInOutQuad(d);
                let step = this.moveSpeedStep;
                if (this.interDist > 3 * this.unitStep)
                    step *= Math.sqrt(this.interDist / (3 * this.unitStep));
                this.moveDone = Math.min(1, this.moveDone + (step / this.interDist) * frames60);
            }
        }
        this.syncCamera();
        if (this.hoverDirty) {
            this.hoverDirty = false;
            this.updateHover();
        }
        this.render();
        this.positionOverlays();
    }
    arrive() {
        this.status = Move.NONE;
        this.walking = false;
        const i = this.desiredCam;
        this.rigPos.copy(this.cams[i].pos);
        this.rigQuat.copy(this.desiredQuat);
        if (this.nextTex) {
            this.currentTex = this.nextTex;
            this.useStillMaterial(this.cams[i].pos, this.currentTex);
        }
        this.prevCamera = i;
        const id = this.cams[i].id;
        this.arrivalListeners.slice().forEach((l) => l(id));
        this.o.onArrive?.(id, i);
        this.evictCache();
        this.prefetchNeighbors(i);
        this.syncCamera();
        this.updateHotspotVisibility();
        this.updateFloorMarkers();
    }
    syncCamera() {
        this.camera.position.copy(this.rigPos);
        this.camera.quaternion.copy(this.rigQuat);
        this.camera.updateMatrixWorld();
    }
    render() {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth();
        this.renderer.render(this.overlayScene, this.camera);
    }
    maybeFirstFrame() {
        if (this.ready.first || !this.ready.mesh || !this.ready.tex)
            return;
        this.ready.first = true;
        this.o.onFirstFrame?.();
    }
    fail(msg) {
        console.error("Visite360:", msg);
        this.o.onError?.(msg);
    }
    // ============================================================== resize
    defaultFov(aspect) {
        return FOV_SLOPE * aspect + FOV_INTERCEPT;
    }
    get fovRad() {
        return THREE.MathUtils.degToRad(this.camera.fov);
    }
    setFov(rad) {
        this.camera.fov = THREE.MathUtils.radToDeg(THREE.MathUtils.clamp(rad, FOV_MIN, FOV_MAX));
        this.camera.updateProjectionMatrix();
    }
    resize(initial = false) {
        const c = this.o.canvas;
        const w = c.clientWidth || 1;
        const h = c.clientHeight || 1;
        this.renderer.setSize(w, h, false);
        const a = w / h;
        // Keep the user's zoom ratio but adapt fov to the new shape (NHC formula).
        const fov = initial ? this.defaultFov(a) : (this.fovRad * this.defaultFov(a)) / this.defaultFov(this.aspect);
        this.aspect = a;
        this.camera.aspect = a;
        this.setFov(fov);
    }
    // =============================================================== input
    bindInput() {
        const c = this.o.canvas;
        const on = (el, type, fn, opts) => {
            el.addEventListener(type, fn, opts);
            this.cleanups.push(() => el.removeEventListener(type, fn, opts));
        };
        const ro = new ResizeObserver(() => this.resize());
        ro.observe(c);
        this.cleanups.push(() => ro.disconnect());
        on(c, "contextmenu", (e) => e.preventDefault());
        on(c, "pointerdown", (e) => this.onDown(e));
        on(c, "pointermove", (e) => this.onMove(e));
        on(c, "pointerup", (e) => this.onUp(e));
        on(c, "pointercancel", (e) => this.onUp(e, true));
        on(c, "pointerleave", () => {
            if (!this.pointers.size)
                this.hideHover();
        });
        on(c, "wheel", (e) => this.onWheel(e), { passive: false });
        on(window, "keydown", (e) => this.onKey(e));
    }
    onDown(e) {
        this.o.canvas.setPointerCapture?.(e.pointerId);
        this.pointers.set(e.pointerId, {
            x: e.clientX,
            y: e.clientY,
            sx: e.clientX,
            sy: e.clientY,
            t: performance.now(),
            button: e.button,
        });
        this.inertia = false;
        if (this.pointers.size === 1) {
            this.dragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
            this.velX = this.velY = 0;
        }
        else if (this.pointers.size === 2) {
            this.dragging = false; // two fingers: pinch-zoom or swipe-to-walk
            const [a, b] = [...this.pointers.values()];
            this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
            this.pinchStartA = new THREE.Vector2(a.x, a.y);
            this.pinchStartB = new THREE.Vector2(b.x, b.y);
        }
    }
    onMove(e) {
        const p = this.pointers.get(e.pointerId);
        if (!p) {
            // plain hover (mouse, no button): show where a click would take you
            this.hoverX = e.clientX;
            this.hoverY = e.clientY;
            this.hoverDirty = true;
            return;
        }
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size === 2 && this.status === Move.NONE)
            this.onTwoFinger();
    }
    onTwoFinger() {
        const [a, b] = [...this.pointers.values()];
        const A = new THREE.Vector2(a.x, a.y);
        const B = new THREE.Vector2(b.x, b.y);
        const sa = this.pinchStartA;
        const sb = this.pinchStartB;
        const both = (da, db) => (da > 25 && db > 25) || (da < -25 && db < -25);
        if (sa && sb && (both(A.x - sa.x, B.x - sb.x) || both(A.y - sa.y, B.y - sb.y))) {
            // both fingers swipe the same way → walk (pull the world towards you)
            const dy = A.y - sa.y + B.y - sb.y;
            const dx = A.x - sa.x + B.x - sb.x;
            const ang = Math.atan2(dx, dy);
            const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rigQuat);
            fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
            this.pinchStartA = this.pinchStartB = null;
            this.startMove(false, 2, true, false, this.pick(this.camera.position, fwd));
            return;
        }
        if (sa && sb && (Math.abs(B.x - sb.x) > 50 || Math.abs(A.x - sa.x) > 50))
            this.pinchStartB = null;
        const d = A.distanceTo(B);
        this.setFov(this.fovRad + (this.pinchDist - d) / this.o.canvas.clientWidth);
        this.pinchDist = d;
    }
    onUp(e, cancelled = false) {
        const p = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        if (!p)
            return;
        if (this.pointers.size === 0) {
            this.dragging = false;
            if (Math.abs(this.velX) > 0.5 || Math.abs(this.velY) > 0.5) {
                this.inertia = true;
                this.velT = performance.now();
            }
        }
        else if (this.pointers.size === 1) {
            // lifting one finger of a pinch: carry on dragging with the other
            const rest = [...this.pointers.values()][0];
            this.dragging = true;
            this.lastX = rest.x;
            this.lastY = rest.y;
            this.velX = this.velY = 0;
            return;
        }
        if (cancelled)
            return;
        const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
        if (moved > TAP_MAX_MOVE || performance.now() - p.t > TAP_MAX_MS)
            return;
        this.inertia = false;
        this.onTap(e.clientX, e.clientY, p.button);
    }
    onTap(x, y, button) {
        const ctl = this.o.tour.controls ?? {};
        const now = performance.now() / 1000;
        const isDouble = now - this.lastTapTime < 0.3;
        this.lastTapTime = now;
        if (this.measureMode)
            return this.measureClick(x, y);
        this.hideHover();
        const hit = this.pickScreen(x, y);
        if (this.o.debugPick && hit) {
            console.info("[Visite360] clicked point (Layama cm):", JSON.stringify(this.toLayama(hit.point)));
        }
        if (isDouble && now - this.moveStartTime < DOUBLE_TAP_WINDOW) {
            // double tap = "go all the way and face it" (re-targets the running move)
            this.status = Move.NONE;
            this.startMove(ctl.altMove ?? true, ctl.altRot ?? 2, true, false, hit);
            this.moveStartTime = -1;
            return;
        }
        if (this.status !== Move.NONE)
            return;
        const ring = this.ringAtScreen(x, y);
        if (button === 0)
            this.startMove(ctl.defMove ?? false, ctl.defRot ?? 1, true, false, hit, ring);
        else
            this.startMove(ctl.altMove ?? true, ctl.altRot ?? 2, true, false, hit, ring);
    }
    onWheel(e) {
        e.preventDefault();
        if (!e.deltaY)
            return;
        this.setFov(this.fovRad + (e.deltaY > 0 ? WHEEL_FOV_STEP : -WHEEL_FOV_STEP));
        this.updateHotspotVisibility();
    }
    onKey(e) {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
            return;
        if (!this.o.canvas.isConnected || this.status !== Move.NONE)
            return;
        const k = e.key.toLowerCase();
        const map = {
            arrowup: 0,
            w: 0,
            arrowdown: Math.PI,
            s: Math.PI,
            arrowleft: Math.PI / 2,
            a: Math.PI / 2,
            arrowright: -Math.PI / 2,
            d: -Math.PI / 2,
        };
        if (!(k in map))
            return;
        e.preventDefault();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rigQuat);
        fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), map[k]);
        // keyboard keeps your heading (rotMode 0) and never just turns
        this.startMove(false, 0, false, true, this.pick(this.camera.position, fwd.normalize()));
    }
    /** "Grab the world" drag + inertia, evaluated once per frame like NHC. */
    applyDrag() {
        let tx = null;
        let ty = null;
        if (this.dragging && this.pointers.size === 1) {
            const p = [...this.pointers.values()][0];
            if (p.x === this.lastX && p.y === this.lastY) {
                this.velX = this.velY = 0;
                return;
            }
            tx = p.x;
            ty = p.y;
            this.velX = p.x - this.lastX;
            this.velY = p.y - this.lastY;
        }
        else if (this.inertia) {
            if (Math.abs(this.velX) <= 0.5 && Math.abs(this.velY) <= 0.5) {
                this.inertia = false;
                return;
            }
            tx = this.lastX + this.velX;
            ty = this.lastY + this.velY;
            const now = performance.now();
            const k = Math.pow(INERTIA_DECAY, (now - this.velT) / 20);
            this.velX *= k;
            this.velY *= k;
            this.velT = now;
        }
        if (tx === null || ty === null)
            return;
        const q = this.rigQuat;
        const d0 = this.screenDir(this.lastX, this.lastY, q);
        const d1 = this.screenDir(tx, ty, q);
        const az = (d) => Math.atan2(-d.x, -d.z);
        const el = (d) => Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
        const { yaw, pitch } = this.yawPitch(q);
        const nYaw = yaw + deltaAngle(az(d0), az(d1));
        const nPitch = THREE.MathUtils.clamp(pitch + el(d0) - el(d1), -PITCH_LIMIT, PITCH_LIMIT);
        this.setRotation(this.fromYawPitch(nYaw, nPitch));
        if (this.dragging) {
            this.lastX = tx;
            this.lastY = ty;
        }
    }
    /** Dragging during a walk takes over the rotation (NHC sets prev/desired too). */
    setRotation(q) {
        this.rigQuat.copy(q);
        this.prevQuat.copy(q);
        this.desiredQuat.copy(q);
    }
    // ======================================================== floor markers
    ringMesh(name) {
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        });
        const dotMat = ringMat.clone();
        dotMat.opacity = 0.7;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_DIAMETER / 2, RING_THICKNESS / 2, 8, 64).rotateX(Math.PI / 2), ringMat);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(DOT_RADIUS, 32).rotateX(-Math.PI / 2), dotMat);
        ring.add(dot);
        ring.name = name;
        ring.visible = false;
        ring.renderOrder = 10;
        dot.renderOrder = 10;
        this.overlayScene.add(ring);
        return ring;
    }
    pill() {
        const el = document.createElement("div");
        el.className = "v360-pill";
        el.style.display = "none";
        this.o.overlay.appendChild(el);
        return el;
    }
    buildMarkers() {
        this.cams.forEach((_, i) => {
            this.floorMarkers.push(this.ringMesh(`floorMarker_${i}`));
            this.floorLabels.push(this.pill());
            this.floorEligible.push(false);
        });
        // Destination ring: bigger, solid and filled so you see exactly where a click goes.
        this.hoverMarker = this.ringMesh("hoverMarker");
        // same size as the other rings: hovering a spot must not make it grow
        this.hoverMarker.traverse((o) => {
            const m = o.material;
            if (m)
                m.opacity = 1;
        });
        const fill = new THREE.Mesh(new THREE.CircleGeometry(RING_DIAMETER / 2, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        }));
        fill.renderOrder = 9;
        this.hoverMarker.add(fill);
        this.hoverLabel = this.pill();
        this.surfaceCursor = new THREE.Mesh(new THREE.CircleGeometry(CURSOR_RADIUS, 12), new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        }));
        this.surfaceCursor.visible = false;
        this.surfaceCursor.renderOrder = 11;
        this.overlayScene.add(this.surfaceCursor);
    }
    /** Point on the floor under a camera (+2 cm), cached. */
    floorAnchor(i) {
        let a = this.floorAnchors.get(i);
        if (a)
            return a;
        const p = this.cams[i].pos;
        const down = new THREE.Vector3(0, -1, 0);
        const h = this.pick(p, down, 50);
        a = h ? h.point.clone().add(new THREE.Vector3(0, 0.02, 0)) : new THREE.Vector3(p.x, p.y - 1.5, p.z);
        // Panoramas are shot ~1.46 m above the floor. A much shorter drop means furniture
        // (e.g. the kitchen island) is under the camera: put the ring on the nearest clear floor beside it.
        const M = 100 * this.s; // one metre in world units
        const floorDrop = 1.46 * M;
        if (h && p.y - h.point.y < floorDrop - 0.3 * M) {
            const floorY = p.y - floorDrop;
            let best = null;
            for (let r = 0.3; r <= 2.0 && !best; r += 0.1) {
                for (let k = 0; k < 24; k++) {
                    const ang = (k / 24) * Math.PI * 2;
                    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
                    // no wall between the camera and the spot (checked at eye height, above the furniture)
                    if (this.pick(p, dir, r * M + 0.15 * M))
                        continue;
                    const top = p.clone().addScaledVector(dir, r * M);
                    const hit = this.pick(top, down, 50);
                    if (hit && Math.abs(hit.point.y - floorY) < 0.15 * M) {
                        best = hit.point.clone().add(new THREE.Vector3(0, 0.02, 0));
                        break;
                    }
                }
            }
            if (best)
                a = best;
        }
        this.floorAnchors.set(i, a);
        return a;
    }
    /** A ring is shown for every reachable camera whose floor spot you can actually see. */
    updateFloorMarkers() {
        if (!this.pickables.length)
            return;
        const vis = this.cams[this.prevCamera]?.vis;
        const eye = this.camera.position;
        for (let i = 0; i < this.cams.length; i++) {
            let ok = !this.measureMode && i !== this.prevCamera && !(vis && vis[i] === false);
            if (ok) {
                const a = this.floorAnchor(i);
                const d = a.clone().sub(eye);
                ok = !this.pick(eye, d.clone().normalize(), d.length() - 0.5 * this.s);
                if (ok)
                    this.floorMarkers[i].position.copy(a);
            }
            this.floorEligible[i] = ok;
        }
        this.refreshFloorMarkers();
    }
    refreshFloorMarkers() {
        this.floorMarkers.forEach((m, i) => {
            m.visible = !this.markersSuppressed && !this.walking && this.floorEligible[i] && i !== this.hoverDest;
            if (!m.visible)
                this.floorLabels[i].style.display = "none";
        });
    }
    setWalking() {
        this.walking = true;
        this.hideHover();
        this.refreshFloorMarkers();
    }
    setHoverDest(i) {
        if (this.hoverDest === i)
            return;
        this.hoverDest = i;
        this.refreshFloorMarkers();
    }
    updateHover() {
        if (this.measureMode || this.status !== Move.NONE || this.pointers.size || this.hoverX < 0) {
            if (this.status !== Move.NONE || this.pointers.size)
                this.hideHover();
            return;
        }
        const hit = this.pickScreen(this.hoverX, this.hoverY);
        if (!hit)
            return this.hideHover();
        // little disc glued to the surface under the mouse
        const n = (hit.normal ?? new THREE.Vector3(0, 1, 0)).normalize();
        if (n.dot(this.camera.position.clone().sub(hit.point)) < 0)
            n.negate();
        this.surfaceCursor.position.copy(hit.point).addScaledVector(n, 0.005);
        this.surfaceCursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        this.surfaceCursor.visible = true;
        this.o.canvas.style.cursor = "none";
        // where a click would take you
        const saveP = this.prevPos.clone();
        const saveQ = this.prevQuat.clone();
        const ctl = this.o.tour.controls ?? {};
        const chosen = this.chooseDestination(hit, ctl.defMove ?? false, true);
        this.prevPos.copy(saveP);
        this.prevQuat.copy(saveQ);
        const dest = this.ringAtScreen(this.hoverX, this.hoverY) ?? this.nearestReachable(hit.point) ?? chosen;
        if (dest === null || dest === this.prevCamera) {
            this.setHoverDest(null);
            this.hoverMarker.visible = false;
            this.hoverLabel.style.display = "none";
            return;
        }
        this.setHoverDest(dest);
        this.hoverMarker.position.copy(this.floorAnchor(dest));
        this.hoverMarker.visible = true;
        const label = this.cams[dest].label;
        if (label) {
            this.hoverLabel.textContent = label;
            this.hoverLabel.style.display = "block";
        }
        else
            this.hoverLabel.style.display = "none";
    }
    hideHover() {
        this.hoverMarker.visible = false;
        this.surfaceCursor.visible = false;
        this.hoverLabel.style.display = "none";
        this.setHoverDest(null);
        this.o.canvas.style.cursor = this.measureMode ? "crosshair" : "";
    }
    // ============================================================== hotspots
    buildHotspots() {
        const scale = isMobileUA() ? 0.75 : 1;
        for (const def of this.o.tour.hotspots ?? []) {
            const el = document.createElement("button");
            el.type = "button";
            el.className = `v360-hotspot v360-hotspot--m${def.mode}`;
            el.style.setProperty("--hs-scale", String(scale));
            el.setAttribute("aria-label", def.title ?? def.name);
            if (def.icon)
                el.style.backgroundImage = `url("${def.icon}")`;
            el.innerHTML = `<span class="v360-hotspot-ring"></span><span class="v360-hotspot-core"></span>${def.title ? `<span class="v360-hotspot-title"></span>` : ""}`;
            const titleEl = el.querySelector(".v360-hotspot-title");
            if (titleEl)
                titleEl.textContent = def.title ?? "";
            el.style.display = "none";
            el.addEventListener("pointerdown", (e) => e.stopPropagation());
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.hotspotClicked(def);
            });
            this.o.overlay.appendChild(el);
            this.hotspots.push({ def, pos: this.toWorld(def.pos), el, visible: false });
        }
    }
    hotspotClicked(def) {
        if (def.mode === 5 && def.url)
            this.teleportTo(def.url);
        else if (def.mode === 2 && def.url)
            window.open(def.url, "_self");
        else if (def.mode === 3 && def.url)
            window.open(def.url, "_blank", "noopener");
        else if (def.mode === 1)
            this.showInfo(def);
    }
    showInfo(def) {
        this.infoBox?.remove();
        const box = document.createElement("div");
        box.className = "v360-info";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "v360-info-close";
        close.textContent = "×";
        close.onclick = () => box.remove();
        const h = document.createElement("strong");
        h.textContent = def.title ?? def.name;
        const p = document.createElement("p");
        p.textContent = def.text ?? "";
        box.append(close, h, p);
        box.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.o.overlay.appendChild(box);
        this.infoBox = box;
    }
    /** Hide hotspots behind walls / beyond maxDistance. */
    updateHotspotVisibility() {
        if (!this.hotspots.length || !this.pickables.length)
            return;
        const eye = this.camera.position;
        for (const h of this.hotspots) {
            const d = h.pos.clone().sub(eye);
            const dist = d.length();
            const max = (h.def.maxDistance ?? 0) * this.s;
            h.visible =
                !(max > 0 && dist > max) && !this.pick(eye, d.normalize(), dist - 1 * this.s);
            if (!h.visible)
                h.el.style.display = "none";
        }
    }
    // =============================================================== measure
    measureClick(x, y) {
        const hit = this.pickScreen(x, y);
        if (!hit)
            return;
        if (this.measurePending) {
            this.addMeasurement(this.measurePending.pos, hit.point);
            this.measurePending.dot.remove();
            this.measurePending = null;
        }
        else {
            const dot = document.createElement("div");
            dot.className = "v360-measure-dot is-pending";
            this.o.overlay.appendChild(dot);
            this.measurePending = { pos: hit.point.clone(), dot };
        }
    }
    addMeasurement(a, b) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0x4fc3f7, depthTest: false, depthWrite: false }));
        line.renderOrder = 12;
        this.overlayScene.add(line);
        const mk = (cls) => {
            const d = document.createElement("div");
            d.className = cls;
            this.o.overlay.appendChild(d);
            return d;
        };
        const m = a.distanceTo(b) / (this.s * 100); // world metres → real metres
        const label = mk("v360-measure-label");
        label.textContent = m >= 1 ? `${m.toFixed(2)} م` : `${(m * 100).toFixed(0)} سم`;
        this.measurements.push({ a, b, line, dotA: mk("v360-measure-dot"), dotB: mk("v360-measure-dot"), label });
        this.o.onMeasurementsChange?.(this.measurements.length);
    }
    // ============================================================ DOM overlay
    project(v) {
        const view = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
        if (view.z >= 0)
            return null; // behind the camera
        const p = v.clone().project(this.camera);
        const c = this.o.canvas;
        return {
            x: c.offsetLeft + ((p.x + 1) / 2) * c.clientWidth,
            y: c.offsetTop + ((1 - p.y) / 2) * c.clientHeight,
        };
    }
    place(el, at) {
        if (!at) {
            if (el.style.display !== "none")
                el.style.display = "none";
            return;
        }
        if (el.style.display !== "block")
            el.style.display = "block";
        el.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) translate(-50%, -50%)`;
    }
    positionOverlays() {
        for (const h of this.hotspots) {
            if (!h.visible)
                continue;
            this.place(h.el, this.project(h.pos));
        }
        for (const m of this.measurements) {
            this.place(m.dotA, this.project(m.a));
            this.place(m.dotB, this.project(m.b));
            this.place(m.label, this.project(m.a.clone().add(m.b).multiplyScalar(0.5)));
        }
        if (this.measurePending)
            this.place(this.measurePending.dot, this.project(this.measurePending.pos));
        if (this.hoverDest !== null && this.hoverLabel.style.display !== "none") {
            this.place(this.hoverLabel, this.project(this.floorAnchor(this.hoverDest)));
        }
        this.floorMarkers.forEach((m, i) => {
            const el = this.floorLabels[i];
            const label = this.cams[i].label;
            if (!m.visible || !label) {
                if (el.style.display !== "none")
                    el.style.display = "none";
                return;
            }
            if (el.textContent !== label)
                el.textContent = label;
            this.place(el, this.project(m.position));
        });
    }
}
