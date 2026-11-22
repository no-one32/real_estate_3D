import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { initHotspots } from './hotspots.js?v=34';
import { initVillas, isVillaShape } from './villas.js?v=7';

/* ------------------------------------------------------------------ *
 *  Device profile — same agreed settings as the previous viewer
 * ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const FORCE_MOBILE = params.get('mobile') === '1';
const IS_MOBILE = FORCE_MOBILE || (() => {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(ua) ||
        (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900) ||
        /*
         * Tablets: every touch-first device (iPad Pro 12.9" says "Macintosh" and has a 1024 px wide screen,
         * so the checks above missed it and it got the heavy desktop profile → slow, hot, sometimes reloaded
         * by Safari). A laptop with a touch screen keeps the desktop profile (its main pointer is the mouse).
         */
        (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
})();

/* phone: 1.5 (was 1, looked blurry on 2x/3x screens); the frame-rate guard below lowers it if the phone is slow */
const MAX_DPR = 1.5;
const ANISOTROPY = IS_MOBILE ? 4 : 8;
const ENABLE_SHADOWS = params.get('shadows') === '0' ? false : true;
const ENABLE_TRANSMISSION = params.get('trans') === '1'
    ? true
    : params.get('trans') === '0'
        ? false
        : !IS_MOBILE;
const USE_LOG_DEPTH = params.get('logdepth') !== '0';

/* ------------------------------------------------------------------ *
 *  DOM helpers
 * ------------------------------------------------------------------ */
const container = document.getElementById('app');
const loaderEl = document.getElementById('loader');
const barEl = document.getElementById('bar');
const pctEl = document.getElementById('pct');
const resetBtn = document.getElementById('reset');
const fsBtn = document.getElementById('fs');
const sunRangeEl = document.getElementById('sunRange');
const sunTimeEl = document.getElementById('sunTime');

function fail(message) {
    document.body.classList.add('error');
    const el = document.getElementById('fatal');
    if (message) el.textContent = message;
    if (loaderEl) loaderEl.style.opacity = '1';
    console.error(message || 'viewer error');
}

/* ------------------------------------------------------------------ *
 *  Renderer
 * ------------------------------------------------------------------ */
let renderer;
try {
    renderer = new THREE.WebGLRenderer({
        antialias: !IS_MOBILE,
        alpha: false,
        stencil: false,
        logarithmicDepthBuffer: USE_LOG_DEPTH,
        powerPreference: 'high-performance'
    });
} catch (err) {
    fail('المتصفح لا يدعم WebGL. جرّب متصفحًا حديثًا أو فعّل تسريع الرسوميات.');
    throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
/*
 * Neutral (Khronos PBR Neutral) instead of AgX: AgX greys out and darkens the colours,
 * Neutral keeps the real colours of the materials (white walls stay white, grass stays green).
 */
/*
 * Light and shadows = his reference picture (WhatsApp 12.06.08, taken from the viewer of the morning of
 * 22/11, commit 3a5eb23): Neutral tone mapping, exposure 1.25, high sun. Only the fog differs (the
 * light Model Studio fog he approved later).
 */
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = ENABLE_SHADOWS;
/* PCFSoft costs extra taps; the phone gets the cheaper PCF filter. */
renderer.shadowMap.type = IS_MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

/* ------------------------------------------------------------------ *
 *  Scene, sky and fog — the agreed light fog
 * ------------------------------------------------------------------ */
const scene = new THREE.Scene();

const HORIZON = 0xc9d5e2;
/*
 * Light distance haze only, copied from Model Studio (fog strength 4 %, distance 1.45×):
 * ≈ 1.2 % haze at the edge of the model. The project is normalised to a 100 unit radius,
 * so density = sqrt(-ln(1 - 0.0117)) / 100. No ground mist any more.
 */
const FOG = { density: 0.00109 };
scene.fog = new THREE.FogExp2(HORIZON, FOG.density);

function makeSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, '#6f9ed3');
    g.addColorStop(0.42, '#a9c4e2');
    g.addColorStop(0.72, '#d2deea');
    g.addColorStop(1.00, '#e9eef3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}
scene.background = makeSkyTexture();

/* ------------------------------------------------------------------ *
 *  Camera + controls
 * ------------------------------------------------------------------ */
const camera = new THREE.PerspectiveCamera(
    45, window.innerWidth / window.innerHeight, 0.1, 8000
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
/*
 * How long the view keeps gliding after the mouse / finger is released. 0.07 glided ~14× the last
 * movement (it went too far past where you stopped); 0.18 keeps a short, soft glide (~5×).
 */
controls.dampingFactor = 0.18;
/* calmer, steadier handling (like the reference site): less turn / zoom per mouse movement */
controls.rotateSpeed = 0.42;
controls.zoomSpeed = 0.6;
controls.panSpeed = 0.55;
controls.screenSpacePanning = false;
controls.minPolarAngle = 0.06;
controls.maxPolarAngle = Math.PI * 0.495;

let homePosition = new THREE.Vector3(180, 150, 220);
let homeTarget = new THREE.Vector3(0, 0, 0);

function applyHomeView() {
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    camera.updateProjectionMatrix();
    controls.update();
}
applyHomeView();

/* ------------------------------------------------------------------ *
 *  Lighting
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 *  Sun — travels from sunrise to sunset via the slider
 * ------------------------------------------------------------------ */
/* reference sun colour: between golden and noon white (as at 38 % of the day in the morning version) */
const NOON_COLOR = new THREE.Color(0xffd6a0).lerp(new THREE.Color(0xfff7ea), 0.86);

const SUN = {
    t: 0.38,                                    /* 0 = sunrise, 1 = sunset */
    dir: new THREE.Vector3(0, 1, 0),
    maxElevation: THREE.MathUtils.degToRad(70)
};

const SUN_FIXED_DIR = (() => {
    /*
     * Asked: the sun placed low like at sunset (long shadows that clearly show), but the light kept as
     * bright and white as at midday. 18° above the horizon, from the front-right of the opening view,
     * so the shadows fall across the streets on the side the camera sees.
     */
    const el = THREE.MathUtils.degToRad(18), az = THREE.MathUtils.degToRad(-19);
    return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
})();

const sun = new THREE.DirectionalLight(NOON_COLOR, 6.0);
sun.target.position.set(0, 0, 0);
sun.castShadow = ENABLE_SHADOWS;
if (ENABLE_SHADOWS) {
    const mapSize = 2048; /* same on the phone: 1024 made the house shadows blurry / faint */
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.bias = -0.00006;
    sun.shadow.normalBias = 0.08;
    sun.shadow.radius = 1.6;
    /* clearly visible house shadows (the sky light still keeps them from being black) */
    sun.shadow.intensity = 0.9; /* clearly visible, not black (the sky still lights the shade) */
    const sc = sun.shadow.camera;
    sc.left = -100;
    sc.right = 100;
    sc.top = 100;
    sc.bottom = -100;
    sc.near = 1;
    sc.far = 800;
    sc.updateProjectionMatrix();
}
scene.add(sun);
scene.add(sun.target);

/* Cool sky bounce, kept low so the sun keeps the contrast. */
/* sky / ground fill: enough that the sides away from the sun are not black */
const hemi = new THREE.HemisphereLight(0xdfeaf7, 0x8a7f70, 0.83);  /* reference picture values */
scene.add(hemi);

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = 1.12;

new RGBELoader().load(
    './sky.hdr',
    (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = hdr;
        scene.backgroundBlurriness = 0.08;
        scene.backgroundIntensity = 1.0;
        scene.environment = pmrem.fromEquirectangular(hdr).texture;
        envRT.dispose();
        /* re-apply so swapping in the HDR does not reset the ambience */
        applySun(SUN.t, true);
    },
    undefined,
    () => console.warn('HDR sky failed to load, keeping gradient background')
);

/* ------------------------------------------------------------------ *
 *  Time of day: sunrise (t = 0) -> noon (0.5) -> sunset (t = 1)
 * ------------------------------------------------------------------ */


let shadowFrustumDist = -1;
const _lf = new THREE.Vector3(), _lu = new THREE.Vector3(), _lr = new THREE.Vector3(), _lc = new THREE.Vector3();
const shadowFrustumTarget = new THREE.Vector3(Infinity, Infinity, Infinity);

/*
 * Keep the shadow camera wrapped tightly around whatever the user is looking
 * at. A tight frustum gives small shadow texels (crisp shadows, no stripes)
 * and far fewer casters (less lag) than one box covering the whole map.
 */
function updateShadowFrustum(force) {
    if (!ENABLE_SHADOWS) return;

    const dist = camera.position.distanceTo(controls.target);
    const targetMoved = controls.target.distanceToSquared(shadowFrustumTarget) > 0.25;
    if (!force && Math.abs(dist - shadowFrustumDist) < 0.5 && !targetMoved) return;

    /* quantise the radius so the shadow map does not "breathe" while zooming */
    const R = THREE.MathUtils.clamp(Math.ceil((dist * 0.95) / 16) * 16, 16, 160);
    const lightDist = Math.max(R * 2.5, 260);

    /*
     * Snap the shadow centre to the shadow map's pixel grid (seen from the sun). Without this the
     * shadow map slides by a fraction of a pixel at every move and all shadow edges crawl / shimmer
     * while the camera moves.
     */
    const texelSize = (2 * R) / sun.shadow.mapSize.x;
    _lf.copy(SUN.dir).negate();
    _lu.set(0, 1, 0);
    if (Math.abs(_lf.y) > 0.999) _lu.set(0, 0, 1);
    _lr.crossVectors(_lf, _lu).normalize();
    _lu.crossVectors(_lr, _lf).normalize();
    const t = controls.target;
    const a = Math.round(t.dot(_lr) / texelSize) * texelSize;
    const b = Math.round(t.dot(_lu) / texelSize) * texelSize;
    _lc.copy(_lr).multiplyScalar(a).addScaledVector(_lu, b).addScaledVector(_lf, t.dot(_lf));

    sun.target.position.copy(_lc);
    sun.position.copy(_lc).addScaledVector(SUN.dir, lightDist);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();

    const sc = sun.shadow.camera;
    sc.left = -R;
    sc.right = R;
    sc.top = R;
    sc.bottom = -R;
    sc.near = Math.max(1, lightDist - R * 2.2);
    sc.far = lightDist + R * 2.2 + 60;
    sc.updateProjectionMatrix();

    /* bias scaled to the real world size of one shadow texel (kills acne) */
    /*
     * Offset that stops shadow "acne". 1.4 texels (~1 m on the overall view) cut the house shadows short;
     * 0.6 texel keeps them full size, the small depth bias still keeps the walls clean.
     */
    sun.shadow.normalBias = Math.max(0.03, texelSize * 1.4);
    sun.shadow.bias = -0.00006;

    shadowFrustumDist = dist;
    shadowFrustumTarget.copy(controls.target);
}

function applySun(t, forceShadow) {
    SUN.t = THREE.MathUtils.clamp(t, 0, 1);

    /* fixed sun of the reference picture (see SUN_FIXED_DIR) */
    SUN.dir.copy(SUN_FIXED_DIR);
    sun.color.copy(NOON_COLOR);

    /*
     * Midday brightness with a low sun: a low sun lights roofs and streets much less, so it is stronger
     * (4.1 → 5.0) and the sky light a little brighter (1.03 → 1.12) to keep the bright noon look.
     */
    sun.intensity = 5.0;
    hemi.intensity = 0.83;
    scene.environmentIntensity = 1.12;
    scene.backgroundIntensity = 0.97;

    updateShadowFrustum(true);

    if (sunTimeEl) {
        const mins = Math.round(360 + SUN.t * 720);    /* 06:00 -> 18:00 */
        sunTimeEl.textContent = String(Math.floor(mins / 60)).padStart(2, '0') + ':' +
            String(mins % 60).padStart(2, '0');
    }
}

/* ------------------------------------------------------------------ *
 *  Load the merged model
 * ------------------------------------------------------------------ */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
/* FINAL.glb is Draco-compressed: decoder files live in /draco/ */
const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
/* unpack the meshes on more CPU cores at once: never fewer than the default 4, up to 8 on big computers */
draco.setWorkerLimit(Math.min(8, Math.max(4, (navigator.hardwareConcurrency || 4) - 1)));
draco.preload();
loader.setDRACOLoader(draco);

const TEXTURE_SLOTS = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
    'sheenColorMap', 'sheenRoughnessMap', 'specularMap',
    'iridescenceMap', 'transmissionMap', 'thicknessMap'
];

/* Interactive.glb = the same model + one invisible shape per villa (hover / click, villas.js) */
const MODEL_URL = params.get('model') || '/models/Interactive.glb';

/* after the download: creep from 90% to 99% while the model is unpacked, with a message, so it never looks stuck */
let unpackTimer = null;
function startUnpacking() {
    if (unpackTimer) return;
    let p = 90;
    pctEl.textContent = '90% · جارٍ تجهيز المشهد…';
    unpackTimer = setInterval(() => {
        p += (99 - p) * 0.12;
        barEl.style.width = p.toFixed(1) + '%';
        pctEl.textContent = Math.floor(p) + '% · جارٍ تجهيز المشهد…';
    }, 250);
}
const loadStart = performance.now();
let hotspots = null;
let villas = null;
let compiling = false;

loader.load(
    MODEL_URL,
    (gltf) => {
        const root = gltf.scene;
        scene.add(root);
        /* no drawing until the shaders are ready (see compileAsync below), so the page never freezes */
        compiling = true;

        root.updateMatrixWorld(true);
        const totalBox = new THREE.Box3().setFromObject(root);
        const totalDiag = totalBox.getSize(new THREE.Vector3()).length();

        /*
         * The scene can ship with a very large surrounding ground/terrain.
         * Find the dense built area (small pieces) so the camera frames the
         * project itself instead of the empty surroundings.
         */
        const focusBox = new THREE.Box3();
        root.traverse((obj) => {
            if (!obj.isMesh || !obj.geometry) return;
            obj.geometry.computeBoundingBox();
            const bb = obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld);
            const diag = bb.getSize(new THREE.Vector3()).length();
            if (diag < totalDiag * 0.17) focusBox.union(bb);
        });
        if (focusBox.isEmpty()) focusBox.copy(totalBox);

        /* center the model on the built area */
        const center = focusBox.getCenter(new THREE.Vector3());
        root.position.sub(center);

        /* normalize the built area to a 100-unit radius scene */
        root.updateMatrixWorld(true);
        const focusLocal = focusBox.clone().translate(center.clone().negate());
        const sphere = focusLocal.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1e-6);
        const normScale = 100 / radius;

        const model = new THREE.Group();
        model.add(root);
        model.scale.setScalar(normScale);
        scene.add(model);
        model.updateMatrixWorld(true);

        /* materials — agreed quality profile */
        const maxAniso = Math.min(ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
        let meshCount = 0, materialCount = 0;
        /*
         * The surrounding terrain is enormous and flat: rendering it into the
         * shadow map costs a lot and only produces acne. It still receives the
         * building shadows, it just no longer casts any.
         */
        const hugeDiag = totalDiag * normScale * 0.25;

        root.traverse((obj) => {
            if (!obj.isMesh) return;
            /* villa shapes: not part of the drawn model (villas.js gives them their own material) */
            if (isVillaShape(obj)) {
                obj.castShadow = false;
                obj.receiveShadow = false;
                return;
            }
            meshCount++;

            obj.geometry.computeBoundingBox();
            const bb = obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld);
            const isHuge = bb.getSize(new THREE.Vector3()).length() > hugeDiag;

            obj.castShadow = ENABLE_SHADOWS && !isHuge;
            obj.receiveShadow = ENABLE_SHADOWS;

            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of materials) {
                if (!mat) continue;
                materialCount++;
                if ('envMapIntensity' in mat) mat.envMapIntensity = 1.0;

                /*
                 * FINAL.glb marks wood, plastic, rubber and some large surfaces as 100 % metal
                 * (metallicFactor 1). A metal has no colour of its own and only mirrors its
                 * surroundings, so those parts came out dark / black. Only real metals stay metal.
                 */
                if (mat.metalness > 0.2 && !/metal|metall|gold|ring|alum|steel|chrome|铝/i.test(mat.name || '')) {
                    mat.metalness = 0;
                    mat.metalnessMap = null;
                }

                /*
                 * The glTF was re-exported by an editor that stamped the same
                 * PBR extensions onto every single material:
                 *
                 *   KHR_materials_anisotropy  anisotropyStrength = 1.333  (invalid: > 1)
                 *   KHR_materials_sheen       sheen colour = black
                 *   KHR_materials_ior         1.6
                 *
                 * Three.js feeds that anisotropy straight into the anisotropic
                 * specular lobe, and a strength above 1 makes a surface snap to
                 * solid black the moment the viewing angle changes, then look
                 * normal again from another angle. That is the "half shows,
                 * half disappears / black on one angle" defect. Reset them to
                 * the neutral defaults so the base colour and the texture are
                 * what actually gets shaded.
                 */
                if (mat.anisotropy) {
                    mat.anisotropy = 0;
                    mat.anisotropyRotation = 0;
                }
                if (mat.sheen) {
                    mat.sheen = 0;
                    if (mat.sheenColor) mat.sheenColor.setRGB(0, 0, 0);
                }
                if (mat.ior && mat.ior !== 1.5) mat.ior = 1.5;

                if (!ENABLE_TRANSMISSION && mat.transmission) {
                    mat.transmission = 0;
                    mat.thickness = 0;
                    mat.transparent = true;
                    mat.opacity = Math.min(mat.opacity ?? 1, 0.5);
                    mat.depthWrite = false;
                }

                for (const slot of TEXTURE_SLOTS) {
                    const tex = mat[slot];
                    if (tex) {
                        tex.anisotropy = maxAniso;
                        tex.needsUpdate = true;
                    }
                }
                mat.needsUpdate = true;
            }
        });

        /* fit camera to the built area */
        const size = focusLocal.getSize(new THREE.Vector3()).multiplyScalar(normScale);
        const aspect = camera.aspect;
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const distV = (size.y * 0.5) / Math.tan(vFov / 2);
        const distH = (Math.max(size.x, size.z) * 0.5) / Math.tan(hFov / 2);
        const distance = Math.max(distV, distH) * 1.2 + Math.max(size.x, size.z) * 0.06;

        const viewDir = new THREE.Vector3(0.85, 1.0, 1.05).normalize();
        homePosition = viewDir.multiplyScalar(distance);
        homeTarget = new THREE.Vector3(0, size.y * 0.08, 0);

        camera.near = Math.max(distance / 4000, 0.5);
        camera.far = Math.max(distance * 20, 15000);
        camera.updateProjectionMatrix();

        controls.minDistance = Math.max(size.length() * 0.04, 0.5);
        controls.maxDistance = distance * 2.6;
        controls.target.copy(homeTarget);
        applyHomeView();

        /* pins over the mosque, school, park, villas… (hotspots.js) */
        hotspots = initHotspots({
            THREE, camera, controls, renderer, root, normScale,
            homeView: () => ({ position: homePosition, target: homeTarget }),
            editMode: params.get('edit') === '1',
        });

        /* villas: hover colour, eye, 1st click approach, 2nd click inside (villas.js) */
        villas = initVillas({ THREE, scene, camera, controls, renderer, root, normScale, hotspots });

        /* place the sun for the loaded scene and fit the shadow frustum */
        applySun(SUN.t, true);

        const loadMs = Math.round(performance.now() - loadStart);
        startUnpacking(); /* in case no progress event reported the end of the download */

        /* diagnostics + first frame */
        window.__viewer = {
            scene, camera, renderer, controls, model, root, hotspots, villas,
            info: {
                isMobile: IS_MOBILE,
                radius,
                normScale,
                size: size.toArray(),
                distance,
                meshes: meshCount,
                materials: materialCount,
                shadows: ENABLE_SHADOWS,
                transmission: ENABLE_TRANSMISSION,
                loadMs,
                triangles: renderer.info.render.triangles
            }
        };

        let ready = false;
        const markReady = () => {
            if (ready) return;
            ready = true;
            clearInterval(unpackTimer);
            barEl.style.width = '100%';
            pctEl.textContent = '100%';
            document.body.classList.add('ready');
            window.__VIEWER_READY__ = true;
            console.log('VIEWER_INFO', JSON.stringify(window.__viewer.info));
        };

        /*
         * The model uses ~29 different shaders (one per kind of material). Before, they were all built
         * on the first frame, which froze the page for a few seconds (the bar stuck at ~95%).
         * compileAsync builds them in parallel in the background, then the model is shown.
         */
        let revealed = false;
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            compiling = false;
            requestAnimationFrame(() => requestAnimationFrame(markReady));
        };
        renderer.compileAsync(scene, camera).then(reveal, reveal);
        setTimeout(reveal, 20000); /* safety net */
    },
    (xhr) => {
        /*
         * The host sends the model compressed, so the browser often gets no total size and only the
         * MB counter moved (0.1, 0.2 …). Fall back to the known size of the file to show a percentage.
         */
        if (unpackTimer) return;
        const total = (xhr && xhr.total) || (MODEL_URL.endsWith('Interactive.glb') ? 14075636 : MODEL_URL.endsWith('FINAL.glb') ? 14049276 : 0);
        if (xhr && total) {
            /* the download fills the bar to 90%; the last 10% is unpacking the model (can take a few seconds) */
            const pct = Math.min(90, Math.round((xhr.loaded / total) * 90));
            barEl.style.width = pct + '%';
            pctEl.textContent = pct + '%';
            if (xhr.loaded >= total && !window.__dlDone) {
                window.__dlDone = performance.now();
                startUnpacking();
            }
        } else if (xhr && xhr.loaded) {
            const mb = (xhr.loaded / 1048576).toFixed(1);
            pctEl.textContent = mb + ' MB';
        }
    },
    (err) => {
        console.error(err);
        fail('تعذّر تحميل النموذج. تحقّق من اتصال الإنترنت ثم أعد تحميل الصفحة.');
    }
);

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
resetBtn.addEventListener('click', () => {
    if (hotspots) {
        hotspots.close();
        hotspots.goHome();
    } else applyHomeView();
});

/* sun position: 0 = sunrise, 1000 = sunset */
if (sunRangeEl) {
    sunRangeEl.addEventListener('input', () => {
        applySun(parseFloat(sunRangeEl.value) / 1000, true);
    });
}

fsBtn.addEventListener('click', () => {
    const doc = document;
    const el = document.documentElement;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (isFs) {
        (doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen).call(doc);
    } else {
        (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el)
            .catch?.(() => {});
    }
});

/* ------------------------------------------------------------------ *
 *  Resize
 * ------------------------------------------------------------------ */
function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 250));

/* ------------------------------------------------------------------ *
 *  Render loop (with a small adaptive-quality guard)
 * ------------------------------------------------------------------ */
let frames = 0;
let lastCheck = performance.now();
let slowTime = 0;
let currentDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

renderer.setAnimationLoop(() => {
    if (compiling) return;
    /* inside a villa the 3D view is covered: stop drawing it (the 360 tour has its own WebGL) */
    if (document.getElementById('villa-tour')?.classList.contains('open')) return;
    if (!hotspots || !hotspots.isFlying()) controls.update();
    hotspots?.update();
    villas?.update();
    updateShadowFrustum();
    renderer.render(scene, camera);

    frames++;
    const now = performance.now();
    if (now - lastCheck > 2000) {
        const fps = (frames * 1000) / (now - lastCheck);
        const minDpr = IS_MOBILE ? 0.8 : 1;
        if (fps < (IS_MOBILE ? 28 : 35) && currentDpr > minDpr) {
            slowTime += now - lastCheck;
            if (slowTime > 4000) {
                currentDpr = Math.max(minDpr, currentDpr - 0.15);
                renderer.setPixelRatio(currentDpr);
                renderer.setSize(window.innerWidth, window.innerHeight);
                slowTime = 0;
            }
        } else {
            slowTime = 0;
        }
        frames = 0;
        lastCheck = now;
    }
});

/* expose a few things for debugging */
window.__THREE = THREE;
