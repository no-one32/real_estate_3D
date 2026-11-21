import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const TMP_SIZE = new THREE.Vector3();
const TMP_CENTER = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();
const TMP_SPHERE = new THREE.Sphere();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function makeGradientBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#1a2230');
  g.addColorStop(0.45, '#11161f');
  g.addColorStop(1, '#080a0e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function readAsArrayBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

function disposeMaterial(material, textureSet) {
  if (!material) return;
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && value.isTexture) textureSet.add(value);
  }
  const list = Array.isArray(material) ? material : [material];
  for (const mat of list) {
    if (mat && typeof mat.dispose === 'function') mat.dispose();
  }
}

export class Viewer {
  constructor(container, { onStats } = {}) {
    this.container = container;
    this.onStats = onStats;
    this.frameCallbacks = new Set();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderScale = 1;
    this.pixelRatioCap = 2;
    this.basePixelRatio = this._baseRatio();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.bgTexture = makeGradientBackground();
    this.hiddenBackground = new THREE.Color(0x07090d);
    this.scene.background = this.bgTexture;

    this.camera = new THREE.PerspectiveCamera(45, this.aspect(), 0.1, 1000);
    this.camera.position.set(6, 4.2, 8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 1000;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.target.set(0, 0, 1);

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2b241c, 0.45);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe3b8, 2.6);
    this.sun.name = '__studio_sun';
    this.sun.castShadow = true;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.roomScene = new RoomEnvironment();
    this.envRT = null;
    this.envTexture = null;

    this.focus = new THREE.Vector3(0, 0, 0);
    this.radius = 5;
    this.bbox = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));
    this.modelRoot = null;
    this.modelGroup = new THREE.Group();
    this.modelGroup.name = '__model_root';
    this.scene.add(this.modelGroup);

    this.ground = new THREE.Group();
    this.ground.name = '__ground';
    this.scene.add(this.ground);
    this.groundVisible = true;
    this.groundOpacity = 0.3;
    this.grid = null;
    this.shadowPlane = null;
    this.buildGround(5);

    this.envState = {
      intensity: 0.85,
      backgroundIntensity: 1,
      backgroundBlur: 0,
      rotation: 0,
      showBackground: true,
      backgroundMode: 'hdri',
      backgroundColor: '#0b0d12',
      fileName: null,
    };
    this.sunState = {
      azimuth: 45,
      elevation: 42,
      intensity: 2.6,
      color: '#ffe3b8',
      temperature: 5600,
      shadows: true,
      quality: 2048,
      softness: 2,
    };

    this.solidBackground = new THREE.Color(this.envState.backgroundColor);
    this.fogState = {
      enabled: false,
      color: '#c9d5e2',
      strength: 35,
      distance: 1,
    };
    this.fogInfo = { density: 0, haze: 0 };

    this.useDefaultEnvironment();
    this.applySunState();

    this._tween = null;
    this._clock = new THREE.Clock();
    this._frames = 0;
    this._lastStats = performance.now();
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this.mixer = null;
    this.animClips = [];
    this.animAction = null;
    this.animSpeed = 1;
    this.animPlaying = false;
    this.animName = '';

    this.renderer.domElement.addEventListener('pointerdown', () => {
      this._tween = null;
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(this._onResize, 200));
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);

    this.renderer.setAnimationLoop(() => this.loop());
  }

  aspect() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return Math.max(w, 1) / Math.max(h, 1);
  }

  _baseRatio() {
    return Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = Math.max(w, 1) / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.basePixelRatio = this._baseRatio();
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale);
    this.renderer.setSize(w, h);
  }

  setRenderScale(scale) {
    this.renderScale = THREE.MathUtils.clamp(Number(scale) || 1, 0.25, 3);
    this.basePixelRatio = this._baseRatio();
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale);
    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight
    );
  }

  setPixelRatioCap(cap) {
    this.pixelRatioCap = THREE.MathUtils.clamp(Number(cap) || 2, 0.5, 4);
    this.basePixelRatio = this._baseRatio();
    this.renderer.setPixelRatio(this.basePixelRatio * this.renderScale);
    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight
    );
  }

  addFrameCallback(fn) {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);

    if (this._tween) {
      const t = Math.min((performance.now() - this._tween.start) / this._tween.duration, 1);
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(this._tween.fromPos, this._tween.toPos, e);
      this.controls.target.lerpVectors(this._tween.fromTarget, this._tween.toTarget, e);
      if (t >= 1) this._tween = null;
    }

    if (this.mixer) this.mixer.update(dt);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    for (const fn of this.frameCallbacks) fn(dt);

    this._frames++;
    const now = performance.now();
    if (now - this._lastStats >= 500) {
      const fps = (this._frames * 1000) / (now - this._lastStats);
      this._frames = 0;
      this._lastStats = now;
      if (this.onStats) {
        this.onStats({
          fps: Math.round(fps),
          drawCalls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          dpr: this.renderer.getPixelRatio(),
        });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Environment                                                      */
  /* ---------------------------------------------------------------- */
  useDefaultEnvironment() {
    const rt = this.pmrem.fromScene(this.roomScene, 0.04);
    this.replaceEnvRT(rt);
    if (this.envTexture) {
      this.envTexture.dispose();
      this.envTexture = null;
    }
    this.envState.fileName = null;
    this.applyEnvironment();
    return 'Studio room';
  }

  replaceEnvRT(rt) {
    const old = this.envRT;
    this.envRT = rt;
    this.scene.environment = rt.texture;
    if (old && old !== rt) old.dispose();
  }

  async setEnvironmentFile(file, onProgress) {
    const buffer = await readAsArrayBuffer(file, onProgress);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let texture;
    if (ext === 'exr') {
      texture = new EXRLoader().createDataTexture(buffer);
    } else if (ext === 'hdr') {
      texture = new RGBELoader().createDataTexture(buffer);
    } else {
      throw new Error('Unsupported HDRI format. Use .hdr or .exr');
    }

    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;

    const rt = this.pmrem.fromEquirectangular(texture);
    this.replaceEnvRT(rt);
    if (this.envTexture && this.envTexture !== texture) this.envTexture.dispose();
    this.envTexture = texture;
    this.envState.fileName = file.name;
    this.applyEnvironment();
    return file.name;
  }

  applyEnvironment(patch = {}) {
    Object.assign(this.envState, patch);
    const state = this.envState;
    const rot = THREE.MathUtils.degToRad(state.rotation || 0);

    this.scene.environmentIntensity = state.intensity;
    if ('environmentRotation' in this.scene) {
      this.scene.environmentRotation.set(0, rot, 0);
    }

    if (!state.showBackground) {
      this.scene.background = this.hiddenBackground;
      return;
    }

    const mode = state.backgroundMode || 'hdri';
    this.solidBackground.set(state.backgroundColor || '#0b0d12');

    if (mode === 'solid') {
      this.scene.background = this.solidBackground;
      this.scene.backgroundIntensity = 1;
      this.scene.backgroundBlurriness = 0;
      if ('backgroundRotation' in this.scene) this.scene.backgroundRotation.set(0, 0, 0);
    } else if (mode === 'gradient' || !this.envTexture) {
      this.scene.background = this.bgTexture;
      this.scene.backgroundIntensity = 1;
      this.scene.backgroundBlurriness = 0;
      if ('backgroundRotation' in this.scene) this.scene.backgroundRotation.set(0, 0, 0);
    } else {
      this.scene.background = this.envTexture;
      this.scene.backgroundIntensity = state.backgroundIntensity;
      this.scene.backgroundBlurriness = state.backgroundBlur;
      if ('backgroundRotation' in this.scene) this.scene.backgroundRotation.set(0, rot, 0);
    }
  }

  setExposure(value) {
    this.renderer.toneMappingExposure = value;
  }

  setToneMapping(key) {
    const mappings = {
      aces: THREE.ACESFilmicToneMapping,
      agx: THREE.AgXToneMapping,
      neutral: THREE.NeutralToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      cineon: THREE.CineonToneMapping,
      linear: THREE.LinearToneMapping,
      none: THREE.NoToneMapping,
    };
    this.renderer.toneMapping = mappings[key] ?? THREE.ACESFilmicToneMapping;
  }

  setHemisphereIntensity(value) {
    this.hemi.intensity = Math.max(0, Number(value) || 0);
  }

  setFov(value) {
    const fov = THREE.MathUtils.clamp(Number(value) || 45, 10, 120);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setGroundShadowOpacity(value) {
    this.groundOpacity = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    if (this.shadowPlane && this.shadowPlane.material) {
      this.shadowPlane.material.opacity = this.groundOpacity;
    }
  }

  applyFog(patch = {}) {
    Object.assign(this.fogState, patch);
    const state = this.fogState;
    const strength = THREE.MathUtils.clamp(Number(state.strength) || 0, 0, 300);
    const distance = THREE.MathUtils.clamp(Number(state.distance) || 1, 0.25, 6);

    if (!state.enabled || strength <= 0) {
      this.scene.fog = null;
      this.fogInfo = { density: 0, haze: 0 };
      return this.fogInfo;
    }

    // Haze is capped at 85% so strong fog can never blank the whole viewport:
    // the model always keeps a readable silhouette instead of vanishing.
    const haze = THREE.MathUtils.clamp((strength / 200) * 0.85 / distance, 0, 0.85);
    const radius = Math.max(this.radius, 0.001);
    const density = Math.sqrt(-Math.log(1 - haze)) / radius;

    if (!this.scene.fog || !this.scene.fog.isFogExp2) {
      this.scene.fog = new THREE.FogExp2(state.color, density);
    } else {
      this.scene.fog.color.set(state.color);
      this.scene.fog.density = density;
    }
    this.fogInfo = { density, haze };
    return this.fogInfo;
  }

  setSelection(object) {
    if (this._selectionHelper) {
      this.scene.remove(this._selectionHelper);
      this._selectionHelper.geometry.dispose();
      this._selectionHelper.material.dispose();
      this._selectionHelper = null;
    }
    if (!object) return;
    const helper = new THREE.BoxHelper(object, 0x6fb2ff);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.95;
    helper.renderOrder = 999;
    helper.name = '__studio_selection';
    this.scene.add(helper);
    this._selectionHelper = helper;
  }

  refreshSelection() {
    if (this._selectionHelper) this._selectionHelper.update();
  }

  focusObject(object) {
    if (!object) return null;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.05);

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fit = radius / Math.sin(Math.max(0.08, Math.min(vFov, hFov) / 2));
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0.72, 1);
    dir.normalize();
    const position = center.clone().addScaledVector(dir, Math.max(fit * 1.15, radius * 1.6));
    this.flyTo(position, center, 700);
    return { center, radius };
  }

  /* ---------------------------------------------------------------- */
  /* Animations                                                       */
  /* ---------------------------------------------------------------- */
  setAnimations(clips = []) {
    this._disposeMixer();
    this.animClips = Array.isArray(clips) ? clips : [];
    if (!this.animClips.length || !this.modelRoot) return this.animClips;

    this.mixer = new THREE.AnimationMixer(this.modelRoot);
    const first = this.animClips[0];
    this.playAnimation(0);
    this.animName = first.name || '';
    return this.animClips;
  }

  _disposeMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.modelRoot) {
        try {
          this.mixer.uncacheRoot(this.modelRoot);
        } catch (error) {
          /* noop */
        }
      }
    }
    this.mixer = null;
    this.animAction = null;
    this.animPlaying = false;
    this.animName = '';
  }

  playAnimation(index) {
    if (!this.mixer || !this.animClips.length) return null;
    const clip = this.animClips[index] || this.animClips[0];
    if (!clip) return null;
    if (this.animAction) this.animAction.stop();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setEffectiveTimeScale(this.animSpeed);
    action.setEffectiveWeight(1);
    action.play();
    this.animAction = action;
    this.animPlaying = true;
    this.animName = clip.name || '';
    return clip;
  }

  toggleAnimation() {
    if (!this.animAction) return false;
    this.animPlaying = !this.animPlaying;
    this.animAction.paused = !this.animPlaying;
    return this.animPlaying;
  }

  stopAnimation() {
    if (!this.animAction) return;
    this.animAction.stop();
    this.animAction = null;
    this.animPlaying = false;
  }

  setAnimationSpeed(value) {
    this.animSpeed = THREE.MathUtils.clamp(Number(value) || 1, 0.05, 5);
    if (this.animAction) this.animAction.setEffectiveTimeScale(this.animSpeed);
  }

  /* ---------------------------------------------------------------- */
  /* Sun                                                              */
  /* ---------------------------------------------------------------- */
  applySunState(patch = {}) {
    Object.assign(this.sunState, patch);
    const s = this.sunState;

    this.sun.color.set(s.color);
    this.sun.intensity = s.intensity;
    this.sun.castShadow = !!s.shadows;

    const az = THREE.MathUtils.degToRad(s.azimuth);
    const el = THREE.MathUtils.degToRad(Math.max(0.1, Math.min(89.9, s.elevation)));
    TMP_DIR.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

    const dist = Math.max(this.radius * 5, 5);
    this.sun.position.copy(this.focus).addScaledVector(TMP_DIR, dist);
    this.sun.target.position.copy(this.focus);
    this.sun.target.updateMatrixWorld();

    const shadow = this.sun.shadow;
    const quality = Number(s.quality) || 2048;
    if (shadow.mapSize.x !== quality) {
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
      shadow.mapSize.set(quality, quality);
    }
    shadow.radius = s.softness;
    shadow.blurSamples = Math.max(4, Math.min(32, Math.round(4 + s.softness * 2)));
    shadow.bias = 0;
    shadow.normalBias = Math.max(this.radius * 0.0015, 0.002);

    const cam = shadow.camera;
    const extent = Math.max(this.radius * 1.55, 0.5);
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = Math.max(dist * 0.08, 0.01);
    cam.far = dist * 2.2 + this.radius * 2;
    cam.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- */
  /* Ground & model                                                   */
  /* ---------------------------------------------------------------- */
  buildGround(radius) {
    this.ground.clear();
    const size = Math.max(radius * 4.5, 4);
    const cx = this.focus.x;
    const cz = this.focus.z;

    this.grid = new THREE.GridHelper(size, 44, 0x4a576d, 0x1e2632);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.5;
    this.grid.material.depthWrite = false;
    this.grid.position.set(cx, this.bbox.min.y, cz);
    this.ground.add(this.grid);

    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: this.groundOpacity, depthWrite: false })
    );
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.set(cx, this.bbox.min.y + 0.002, cz);
    this.shadowPlane.receiveShadow = true;
    this.ground.add(this.shadowPlane);

    this.ground.visible = this.groundVisible;
  }

  computeFocusBox(root) {
    const totalDiag = this.bbox.getSize(TMP_SIZE).length();
    if (!totalDiag) return this.bbox;

    const focus = new THREE.Box3();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();

    root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      box.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
      const diag = box.getSize(size).length();
      if (diag < totalDiag * 0.17) focus.union(box);
    });

    if (focus.isEmpty()) return this.bbox;
    const focusDiag = focus.getSize(size).length();
    /*
     * Some site models ship a huge surrounding terrain and a much smaller
     * built area. The built area can be ~1% of the total diagonal, so the
     * lower guard must be small enough to still frame the project instead
     * of the empty terrain. 0.5% still rejects a stray tiny object.
     */
    if (focusDiag > totalDiag * 0.6 || focusDiag < totalDiag * 0.005) return this.bbox;
    return focus;
  }

  setGroundVisible(visible) {
    this.groundVisible = !!visible;
    this.ground.visible = this.groundVisible;
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = !!enabled;
  }

  setModel(root) {
    this.clearModel();

    root.updateMatrixWorld(true);
    this.bbox.setFromObject(root);
    if (this.bbox.isEmpty()) {
      this.bbox.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    }
    this.bbox.getSize(TMP_SIZE);
    this.bbox.getCenter(TMP_CENTER);

    const focusBox = this.computeFocusBox(root);
    focusBox.getCenter(this.focus);
    focusBox.getBoundingSphere(TMP_SPHERE);
    const focusSize = focusBox.getSize(new THREE.Vector3());
    this.radius = Math.max(TMP_SPHERE.radius, focusSize.length() * 0.5, 0.05);

    this.modelRoot = root;
    this.modelGroup.add(root);

    this.camera.near = Math.max(this.radius / 2000, 0.001);
    this.camera.far = Math.max(this.radius * 120, 50);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(this.radius * 0.02, 0.02);
    this.controls.maxDistance = Math.max(this.radius * 30, 10);

    this.buildGround(this.radius);
    this.applySunState();
    this.applyFog();
    this.presetView('iso', false);

    return {
      radius: this.radius,
      size: TMP_SIZE.clone(),
      center: this.focus.clone(),
      min: this.bbox.min.clone(),
      max: this.bbox.max.clone(),
    };
  }

  clearModel() {
    this._disposeMixer();
    this.animClips = [];
    this.animName = '';
    this.setSelection(null);
    if (this.modelRoot) {
      this.modelGroup.remove(this.modelRoot);
      this.disposeObject(this.modelRoot);
      this.modelRoot = null;
    }
    this.focus.set(0, 0, 0);
    this.radius = 5;
    this.bbox.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));
    this.buildGround(5);
    this.applySunState();
    this.applyFog();
  }

  disposeObject(root) {
    const textures = new Set();
    const materials = new Set();
    const geometries = new Set();
    root.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry);
      if (obj.material) {
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        list.forEach((mat) => materials.add(mat));
      }
    });
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) disposeMaterial(mat, textures);
    for (const tex of textures) tex.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                           */
  /* ---------------------------------------------------------------- */
  presetView(name, animate = true) {
    const dirs = {
      front: [0, 0.05, 1],
      back: [0, 0.05, -1],
      left: [-1, 0.05, 0],
      right: [1, 0.05, 0],
      top: [0, 1, 0.0008],
      bottom: [0, -1, 0.0008],
      iso: [1, 0.72, 1],
    };
    const arr = dirs[name] || dirs.iso;
    const dir = new THREE.Vector3(arr[0], arr[1], arr[2]).normalize();

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fit = this.radius / Math.sin(Math.max(0.08, Math.min(vFov, hFov) / 2));
    const dist = Math.max(fit * 0.92, this.radius * 1.15);

    const target = this.focus.clone();
    const position = target.clone().addScaledVector(dir, dist);

    if (animate) {
      this.flyTo(position, target, 850);
    } else {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    }
    return { position, target };
  }

  fitCurrentView(animate = true) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0.72, 1);
    dir.normalize();

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fit = this.radius / Math.sin(Math.max(0.08, Math.min(vFov, hFov) / 2));
    const position = this.focus.clone().addScaledVector(dir, Math.max(fit * 0.92, this.radius * 1.15));
    const target = this.focus.clone();

    if (animate) this.flyTo(position, target, 850);
    else {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    }
    return { position, target };
  }

  flyTo(position, target, duration = 900) {
    this._tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration: Math.max(120, duration),
    };
  }

  getCameraState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fov: this.camera.fov,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Picking & screenshot                                             */
  /* ---------------------------------------------------------------- */
  setPointerFromEvent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    return this._raycaster;
  }

  raycast(event, objects) {
    if (!objects || !objects.length) return [];
    const raycaster = this.setPointerFromEvent(event);
    return raycaster.intersectObjects(objects, false);
  }

  pickModelObject(event) {
    const meshes = [];
    this.modelGroup.traverse((obj) => {
      if (obj.isMesh && obj.visible) meshes.push(obj);
    });
    const hits = this.raycast(event, meshes);
    return hits.length ? hits[0] : null;
  }

  flashObject(object, ms = 1400) {
    if (!object) return;
    if (this._flashHelper) {
      this.scene.remove(this._flashHelper);
      this._flashHelper.geometry.dispose();
      this._flashHelper.material.dispose();
      this._flashHelper = null;
    }
    const helper = new THREE.BoxHelper(object, 0xffb454);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.9;
    helper.renderOrder = 1000;
    this.scene.add(helper);
    this._flashHelper = helper;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this.scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      if (this._flashHelper === helper) this._flashHelper = null;
    }, ms);
  }

  captureImage(multiplier = 2, { transparent = false } = {}) {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const maxDim = Math.min(16384, this.renderer.capabilities.maxTextureSize || 8192);
    const maxPixels = 64 * 1000 * 1000;
    let scale = Math.max(1, Number(multiplier) || 1);
    scale = Math.min(scale, maxDim / width, maxDim / height, Math.sqrt(maxPixels / (width * height)));
    scale = Math.max(1, Math.floor(scale * 100) / 100);

    const oldRatio = this.renderer.getPixelRatio();
    const oldBackground = this.scene.background;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    if (transparent) this.scene.background = null;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    if (transparent) this.scene.background = oldBackground;

    this.renderer.setPixelRatio(oldRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);

    return dataUrl;
  }
}
