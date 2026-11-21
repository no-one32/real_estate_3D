import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { initHotspots } from './hotspots.js?v=1';

/* ------------------------------------------------------------------ *
 *  Device profile — same agreed settings as the previous viewer
 * ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const FORCE_MOBILE = params.get('mobile') === '1';
const IS_MOBILE = FORCE_MOBILE || (() => {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(ua) ||
        (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
})();

const MAX_DPR = IS_MOBILE ? 1 : 1.5;
const ANISOTROPY = IS_MOBILE ? 2 : 8;
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
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = ENABLE_SHADOWS;
/* PCFSoft costs extra taps; the phone gets the cheaper PCF filter. */
renderer.shadowMap.type = IS_MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

/* ------------------------------------------------------------------ *
 *  Scene, sky and fog — the agreed light fog
 * ------------------------------------------------------------------ */
const scene = new THREE.Scene();

const HORIZON = 0xc2d2e2;
scene.fog = new THREE.FogExp2(HORIZON, 0.00055);

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
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
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
const SUNSET_COLOR = new THREE.Color(0xffa463);  /* warm but not orange-red */
const GOLDEN_COLOR = new THREE.Color(0xffd6a0);
const NOON_COLOR = new THREE.Color(0xfff7ea);
const DUSK_FOG = new THREE.Color(0xe9b98d);
const DAY_FOG = new THREE.Color(0xc2d2e2);

const SUN = {
    t: 0.38,                                    /* 0 = sunrise, 1 = sunset */
    dir: new THREE.Vector3(0, 1, 0),
    maxElevation: THREE.MathUtils.degToRad(70)
};

const sun = new THREE.DirectionalLight(NOON_COLOR, 6.0);
sun.target.position.set(0, 0, 0);
sun.castShadow = ENABLE_SHADOWS;
if (ENABLE_SHADOWS) {
    const mapSize = IS_MOBILE ? 1024 : 2048;
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.bias = -0.00006;
    sun.shadow.normalBias = 0.08;
    sun.shadow.radius = 1.6;
    /* shadows lighter than pure black, like real daylight (the sky lights the shade) */
    sun.shadow.intensity = 0.78;
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
const hemi = new THREE.HemisphereLight(0xdfeaf7, 0x8a7f70, 0.6);
scene.add(hemi);

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = 0.8;

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
const _sunColor = new THREE.Color();

function sunDirectionFromTime(t) {
    /* never lower than 12°: a sun on the horizon left whole streets in black shadow */
    const elev = THREE.MathUtils.degToRad(12) + Math.sin(Math.PI * t) * (SUN.maxElevation - THREE.MathUtils.degToRad(12));
    const az = Math.PI * t;                        /* east -> south -> west */
    const ce = Math.cos(elev);
    return new THREE.Vector3(ce * Math.cos(az), Math.sin(elev), ce * Math.sin(az));
}

let shadowFrustumDist = -1;
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

    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(SUN.dir, lightDist);
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
    const texel = (2 * R) / sun.shadow.mapSize.x;
    sun.shadow.normalBias = Math.max(0.03, texel * 1.4);
    sun.shadow.bias = -0.00006;

    shadowFrustumDist = dist;
    shadowFrustumTarget.copy(controls.target);
}

function applySun(t, forceShadow) {
    SUN.t = THREE.MathUtils.clamp(t, 0, 1);
    const k = Math.sin(Math.PI * SUN.t);           /* 0 at the horizon, 1 at noon */

    SUN.dir.copy(sunDirectionFromTime(SUN.t));

    if (k < 0.5) _sunColor.copy(SUNSET_COLOR).lerp(GOLDEN_COLOR, k / 0.5);
    else _sunColor.copy(GOLDEN_COLOR).lerp(NOON_COLOR, (k - 0.5) / 0.5);
    sun.color.copy(_sunColor);

    /* softer swing between morning and noon: morning / evening stay readable, noon is not burnt */
    sun.intensity = 2.2 + 1.6 * Math.pow(k, 0.75);
    hemi.intensity = 0.45 + 0.2 * k;
    scene.environmentIntensity = 0.6 + 0.3 * k;
    scene.backgroundIntensity = 0.6 + 0.4 * k;
    scene.fog.color.copy(DUSK_FOG).lerp(DAY_FOG, Math.min(1, k * 1.7));

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
loader.setDRACOLoader(draco);

const TEXTURE_SLOTS = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
    'sheenColorMap', 'sheenRoughnessMap', 'specularMap',
    'iridescenceMap', 'transmissionMap', 'thicknessMap'
];

const MODEL_URL = params.get('model') || '/models/FINAL.glb';
const loadStart = performance.now();
let hotspots = null;

loader.load(
    MODEL_URL,
    (gltf) => {
        const root = gltf.scene;
        scene.add(root);

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

        /* place the sun for the loaded scene and fit the shadow frustum */
        applySun(SUN.t, true);

        const loadMs = Math.round(performance.now() - loadStart);

        /* diagnostics + first frame */
        window.__viewer = {
            scene, camera, renderer, controls, model, root,
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
            barEl.style.width = '100%';
            pctEl.textContent = '100%';
            document.body.classList.add('ready');
            window.__VIEWER_READY__ = true;
            console.log('VIEWER_INFO', JSON.stringify(window.__viewer.info));
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(markReady);
        });
        setTimeout(markReady, 1500);
    },
    (xhr) => {
        if (xhr && xhr.total) {
            const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
            barEl.style.width = pct + '%';
            pctEl.textContent = pct + '%';
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
    if (!hotspots || !hotspots.isFlying()) controls.update();
    hotspots?.update();
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
