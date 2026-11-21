import './style.css';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Viewer } from './viewer.js';
import { ModelService, TEXTURE_SLOTS } from './model.js';
import { HotspotManager, HOTSPOT_SHAPES, HOTSPOT_ACTIONS } from './hotspots.js';
import { BakeService } from './bake.js';
import { createZip } from './zip.js';
import { compressGLB } from './meshopt-export.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ICON_FOCUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>';
const ICON_IMAGE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>';

let viewer;
try {
  viewer = new Viewer($('#viewport'), { onStats: updateStats });
} catch (error) {
  console.error(error);
  const detail = (error && (error.stack || error.message)) || String(error);
  document.body.innerHTML =
    '<div style="display:grid;place-items:center;height:100vh;font-family:Segoe UI,Arial;color:#e9edf5;text-align:center;padding:30px"><div style="max-width:720px"><h2>WebGL unavailable</h2><p style="color:#9aa3b5">Enable hardware acceleration or use a modern browser to run Model Studio.</p><pre style="text-align:left;white-space:pre-wrap;font-size:11px;color:#ff9a9a;background:rgba(0,0,0,.35);padding:10px;border-radius:8px;overflow:auto;max-height:40vh">' +
    detail.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
    '</pre></div></div>';
  throw error;
}

const model = new ModelService(viewer.renderer);
const bake = new BakeService(viewer, model);

const state = {
  env: { ...viewer.envState },
  sun: { ...viewer.sunState },
  exposure: 1,
  grid: true,
  autoRotate: false,
  shotScale: 2,
  shotTransparent: false,
  toneMapping: 'aces',
  renderScale: 1,
  fov: 45,
  ambient: 0.45,
  groundShadow: 0.3,
  quality: 'desktop',
  fog: { enabled: false, color: '#c9d5e2', strength: 35, distance: 1 },
  animation: { clip: '', speed: 1, playing: false },
  loadMs: 0,
};

let pending = null;
let isLoading = false;
let isExporting = false;
let pickingMaterial = false;
let pickedEntries = [];
let bakeWarningAccepted = false;
let selectedMaterialIds = [];
let materialApplyOpen = false;
let materialDeletePending = false;
let selectedObject = null;
let transformMode = 'translate';
let pickingObject = false;
const texturePreviewCache = new Map();

const hotspots = new HotspotManager(viewer, model, {
  onChange: () => {
    renderHotspotLists();
    renderHotspotEditor();
  },
  onSelect: () => {
    renderHotspotLists();
    renderHotspotEditor();
  },
  onPosition: (item) => updatePositionLabel(item),
  onPlacing: (active) => {
    $('#placementBanner').hidden = !active;
    $('#btnAddHotspot').classList.toggle('active', active);
  },
  onPopup: (item) => openPopup(item),
  onToast: toast,
});

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message, type = '') {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', `toast ${type}`.trim(), message);
  host.appendChild(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }, 3400);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadDataURL(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function showBusy(text) {
  $('#busyText').textContent = text;
  $('#busyOverlay').hidden = false;
}

function hideBusy() {
  $('#busyOverlay').hidden = true;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function kelvinToHex(kelvin) {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r;
  let g;
  let b;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  const toHex = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/* ------------------------------------------------------------------ */
/* Stats & tabs                                                        */
/* ------------------------------------------------------------------ */
function updateStats({ fps, dpr, drawCalls, triangles }) {
  const fpsEl = $('#statFps');
  fpsEl.textContent = fps;
  fpsEl.parentElement.classList.toggle('low', fps < 24);
  fpsEl.parentElement.classList.toggle('mid', fps >= 24 && fps < 45);
  $('#statusDpr').textContent = Number(dpr || 1).toFixed(1);
  if (drawCalls !== undefined) {
    $('#statDraw').textContent = formatNumber(drawCalls);
    $('#statusDraw').textContent = formatNumber(drawCalls);
  }
  if (triangles !== undefined) {
    $('#statusTris').textContent = formatNumber(triangles);
  }
  if (state.loadMs) $('#statusLoad').textContent = `${(state.loadMs / 1000).toFixed(2)} s`;
}

$('#statusRenderer').textContent = viewer.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1';

function showTab(name) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  $$('.tab-pane').forEach((pane) => pane.classList.toggle('active', pane.id === `tab-${name}`));
  if (name === 'io') refreshTextureStatus();
  if (name === 'objects') {
    refreshObjectList();
    updateObjectInspector();
  }
  if (name === 'materials') renderMaterialToolbar();
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

/* ------------------------------------------------------------------ */
/* Environment UI                                                      */
/* ------------------------------------------------------------------ */
function syncEnvUI() {
  $('#envIntensity').value = state.env.intensity;
  $('#envIntensityOut').textContent = Number(state.env.intensity).toFixed(2);
  $('#bgIntensity').value = state.env.backgroundIntensity;
  $('#bgIntensityOut').textContent = Number(state.env.backgroundIntensity).toFixed(2);
  $('#bgBlur').value = state.env.backgroundBlur;
  $('#bgBlurOut').textContent = Number(state.env.backgroundBlur).toFixed(2);
  $('#envRotation').value = state.env.rotation;
  $('#envRotationOut').textContent = `${Math.round(state.env.rotation)}°`;
  $('#envShowBg').checked = !!state.env.showBackground;
  $('#bgMode').value = state.env.backgroundMode || 'hdri';
  $('#bgColor').value = state.env.backgroundColor || '#0b0d12';
  $('#bgColorRow').hidden = (state.env.backgroundMode || 'hdri') !== 'solid';
  applyEnvLabels();
}

function applyEnvLabels() {
  const name = viewer.envState.fileName || 'Studio room';
  $('#envName').textContent = name;
  $('#statusEnv').textContent = name;
}

function applyEnv() {
  viewer.applyEnvironment(state.env);
  applyEnvLabels();
}

$('#envIntensity').addEventListener('input', (e) => {
  state.env.intensity = parseFloat(e.target.value);
  $('#envIntensityOut').textContent = state.env.intensity.toFixed(2);
  applyEnv();
});
$('#bgIntensity').addEventListener('input', (e) => {
  state.env.backgroundIntensity = parseFloat(e.target.value);
  $('#bgIntensityOut').textContent = state.env.backgroundIntensity.toFixed(2);
  applyEnv();
});
$('#bgBlur').addEventListener('input', (e) => {
  state.env.backgroundBlur = parseFloat(e.target.value);
  $('#bgBlurOut').textContent = state.env.backgroundBlur.toFixed(2);
  applyEnv();
});
$('#envRotation').addEventListener('input', (e) => {
  state.env.rotation = parseFloat(e.target.value);
  $('#envRotationOut').textContent = `${Math.round(state.env.rotation)}°`;
  applyEnv();
});
$('#envShowBg').addEventListener('change', (e) => {
  state.env.showBackground = e.target.checked;
  applyEnv();
});

$('#bgMode').addEventListener('change', (e) => {
  state.env.backgroundMode = e.target.value;
  $('#bgColorRow').hidden = e.target.value !== 'solid';
  applyEnv();
});

$('#bgColor').addEventListener('input', (e) => {
  state.env.backgroundColor = e.target.value;
  applyEnv();
});

$('#btnEnvBrowse').addEventListener('click', () => $('#envInput').click());
$('#envInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await loadEnvironment(file);
});

$('#btnEnvSample').addEventListener('click', async () => {
  try {
    const url = `${import.meta.env.BASE_URL}environments/sky.hdr`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Sample HDRI not found');
    const blob = await response.blob();
    const file = new File([blob], 'sky.hdr', { type: 'application/octet-stream' });
    await loadEnvironment(file);
  } catch (error) {
    console.error(error);
    toast('Could not load the sample HDRI', 'err');
  }
});

$('#btnEnvRoom').addEventListener('click', () => {
  viewer.useDefaultEnvironment();
  state.env.fileName = null;
  applyEnvLabels();
  toast('Environment reset to studio room');
});

async function loadEnvironment(file) {
  const allowed = /\.(hdr|exr)$/i.test(file.name);
  if (!allowed) {
    toast('Use an .hdr or .exr file', 'err');
    return;
  }
  const badge = $('#envName');
  const previous = badge.textContent;
  badge.textContent = `Loading ${file.name}…`;
  try {
    await viewer.setEnvironmentFile(file, (p) => {
      badge.textContent = `${file.name} ${Math.round(p * 100)}%`;
    });
    state.env.fileName = file.name;
    state.env.showBackground = true;
    $('#envShowBg').checked = true;
    viewer.applyEnvironment(state.env);
    applyEnvLabels();
    toast(`HDRI loaded: ${file.name}`, 'ok');
  } catch (error) {
    console.error(error);
    badge.textContent = previous;
    toast(`HDRI failed: ${error.message}`, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* Sun UI                                                              */
/* ------------------------------------------------------------------ */
function syncSunUI() {
  $('#sunAzimuth').value = state.sun.azimuth;
  $('#sunAzimuthOut').textContent = `${Math.round(state.sun.azimuth)}°`;
  $('#sunElevation').value = state.sun.elevation;
  $('#sunElevationOut').textContent = `${Math.round(state.sun.elevation)}°`;
  $('#sunIntensity').value = state.sun.intensity;
  $('#sunIntensityOut').textContent = Number(state.sun.intensity).toFixed(1);
  $('#sunColor').value = state.sun.color;
  $('#sunTemp').value = state.sun.temperature;
  $('#sunTempOut').textContent = `${Math.round(state.sun.temperature)}K`;
  $('#sunShadows').checked = !!state.sun.shadows;
  $('#sunQuality').value = String(state.sun.quality);
  $('#sunSoftness').value = state.sun.softness;
  $('#sunSoftnessOut').textContent = Number(state.sun.softness).toFixed(1);
  $('#statusShadows').textContent = state.sun.shadows ? 'On' : 'Off';
}

function applySun() {
  viewer.applySunState(state.sun);
  $('#statusShadows').textContent = state.sun.shadows ? 'On' : 'Off';
}

$('#sunAzimuth').addEventListener('input', (e) => {
  state.sun.azimuth = parseFloat(e.target.value);
  $('#sunAzimuthOut').textContent = `${Math.round(state.sun.azimuth)}°`;
  applySun();
});
$('#sunElevation').addEventListener('input', (e) => {
  state.sun.elevation = parseFloat(e.target.value);
  $('#sunElevationOut').textContent = `${Math.round(state.sun.elevation)}°`;
  applySun();
});
$('#sunIntensity').addEventListener('input', (e) => {
  state.sun.intensity = parseFloat(e.target.value);
  $('#sunIntensityOut').textContent = state.sun.intensity.toFixed(1);
  applySun();
});
$('#sunColor').addEventListener('input', (e) => {
  state.sun.color = e.target.value;
  applySun();
});
$('#sunTemp').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.sun.temperature = value;
  state.sun.color = kelvinToHex(value);
  $('#sunTempOut').textContent = `${Math.round(value)}K`;
  $('#sunColor').value = state.sun.color;
  applySun();
});
$('#sunShadows').addEventListener('change', (e) => {
  state.sun.shadows = e.target.checked;
  applySun();
});
$('#sunQuality').addEventListener('change', (e) => {
  state.sun.quality = parseInt(e.target.value, 10);
  applySun();
});
$('#sunSoftness').addEventListener('input', (e) => {
  state.sun.softness = parseFloat(e.target.value);
  $('#sunSoftnessOut').textContent = state.sun.softness.toFixed(1);
  applySun();
});

/* ------------------------------------------------------------------ */
/* Display controls                                                    */
/* ------------------------------------------------------------------ */
$('#exposure').addEventListener('input', (e) => {
  state.exposure = parseFloat(e.target.value);
  $('#exposureOut').textContent = state.exposure.toFixed(2);
  viewer.setExposure(state.exposure);
});
$('#toneMapping').addEventListener('change', (e) => {
  state.toneMapping = e.target.value;
  viewer.setToneMapping(state.toneMapping);
});
$('#renderScale').addEventListener('input', (e) => {
  state.renderScale = parseFloat(e.target.value);
  $('#renderScaleOut').textContent = `${state.renderScale.toFixed(2)}×`;
  viewer.setRenderScale(state.renderScale);
});
$('#cameraFov').addEventListener('input', (e) => {
  state.fov = parseFloat(e.target.value);
  $('#cameraFovOut').textContent = `${Math.round(state.fov)}°`;
  viewer.setFov(state.fov);
});
$('#ambientIntensity').addEventListener('input', (e) => {
  state.ambient = parseFloat(e.target.value);
  $('#ambientOut').textContent = state.ambient.toFixed(2);
  viewer.setHemisphereIntensity(state.ambient);
});
$('#groundShadow').addEventListener('input', (e) => {
  state.groundShadow = parseFloat(e.target.value);
  $('#groundShadowOut').textContent = state.groundShadow.toFixed(2);
  viewer.setGroundShadowOpacity(state.groundShadow);
});
$('#toggleGrid').addEventListener('change', (e) => {
  state.grid = e.target.checked;
  viewer.setGroundVisible(state.grid);
});
$('#toggleAutoRotate').addEventListener('change', (e) => {
  state.autoRotate = e.target.checked;
  viewer.setAutoRotate(state.autoRotate);
});

/* ------------------------------------------------------------------ */
/* Quality presets & atmosphere                                        */
/* ------------------------------------------------------------------ */
function syncQualityUI() {
  $$('[data-quality]').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === state.quality);
  });
  $('#qualityBadge').textContent = state.quality === 'mobile' ? 'Mobile' : 'Desktop';
}

function applyQuality(mode) {
  state.quality = mode === 'mobile' ? 'mobile' : 'desktop';
  const mobile = state.quality === 'mobile';

  viewer.setPixelRatioCap(mobile ? 1 : 2);
  state.renderScale = 1;
  $('#renderScale').value = '1';
  $('#renderScaleOut').textContent = '1.00×';
  viewer.setRenderScale(1);

  state.sun.shadows = !mobile;
  state.sun.quality = mobile ? 1024 : 2048;
  syncSunUI();
  applySun();
  model.setQualityProfile(state.quality);
  syncQualityUI();
}

$$('[data-quality]').forEach((button) => {
  button.addEventListener('click', () => {
    applyQuality(button.dataset.quality);
    toast(`Quality profile: ${state.quality === 'mobile' ? 'Mobile' : 'Desktop'}`, 'ok');
  });
});

function updateFogHint() {
  const strength = Number(state.fog.strength) || 0;
  const distance = Number(state.fog.distance) || 1;
  const haze = Math.min(0.85, (strength / 200) * 0.85 / distance);
  const on = !!state.fog.enabled && strength > 0;
  const density = on ? Math.sqrt(-Math.log(1 - haze)) / Math.max(viewer.radius, 0.001) : 0;

  $('#fogHint').textContent = on
    ? `Model-edge haze ≈ ${Math.round(haze * 100)}% · density ${density.toExponential(2)} · capped at 85% so the screen never turns empty.`
    : 'Strength 0–200% and distance 0.25–6×. Haze is capped at 85% so the viewport never becomes an empty white screen.';
  $('#statusFog').textContent = on ? `${Math.round(strength)}% · ${distance.toFixed(2)}×` : 'Off';
  $('#fogBadge').textContent = on ? 'On' : 'Off';
}

function syncFogUI() {
  $('#fogEnabled').checked = !!state.fog.enabled;
  $('#fogColor').value = state.fog.color;
  $('#fogStrength').value = String(state.fog.strength);
  $('#fogStrengthOut').textContent = `${Math.round(state.fog.strength)}%`;
  $('#fogDistance').value = String(state.fog.distance);
  $('#fogDistanceOut').textContent = `${Number(state.fog.distance).toFixed(2)}×`;
  updateFogHint();
}

function applyFog() {
  viewer.applyFog(state.fog);
  updateFogHint();
}

$('#fogEnabled').addEventListener('change', (e) => {
  state.fog.enabled = e.target.checked;
  applyFog();
});
$('#fogColor').addEventListener('input', (e) => {
  state.fog.color = e.target.value;
  applyFog();
});
$('#fogStrength').addEventListener('input', (e) => {
  state.fog.strength = parseFloat(e.target.value);
  $('#fogStrengthOut').textContent = `${Math.round(state.fog.strength)}%`;
  applyFog();
});
$('#fogDistance').addEventListener('input', (e) => {
  state.fog.distance = parseFloat(e.target.value);
  $('#fogDistanceOut').textContent = `${state.fog.distance.toFixed(2)}×`;
  applyFog();
});

/* ------------------------------------------------------------------ */
/* Sun presets                                                         */
/* ------------------------------------------------------------------ */
const SUN_PRESETS = {
  dawn: { azimuth: 105, elevation: 12, intensity: 2.2, temperature: 3200, color: '#ffbb88', softness: 4 },
  noon: { azimuth: 145, elevation: 78, intensity: 3.2, temperature: 6200, color: '#fff5e8', softness: 1.5 },
  sunset: { azimuth: 250, elevation: 8, intensity: 2.4, temperature: 2400, color: '#ff9a5a', softness: 5 },
  studio: { azimuth: 45, elevation: 42, intensity: 2.6, temperature: 5600, color: '#ffe3b8', softness: 2 },
};

$$('[data-sun]').forEach((button) => {
  button.addEventListener('click', () => {
    const preset = SUN_PRESETS[button.dataset.sun];
    if (!preset) return;
    Object.assign(state.sun, preset);
    syncSunUI();
    applySun();
    toast(`Sun preset: ${button.textContent.trim()}`, 'ok');
  });
});

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */
function updateAnimationUI() {
  const clips = viewer.animClips || [];
  const section = $('#animSection');
  section.hidden = clips.length === 0;
  $('#animBadge').textContent = clips.length;
  if (!clips.length) return;

  const select = $('#animClip');
  select.innerHTML = '';
  clips.forEach((clip, index) => {
    const option = el('option', '', clip.name || `Clip ${index + 1}`);
    option.value = String(index);
    select.appendChild(option);
  });

  const index = Math.max(0, clips.findIndex((clip) => clip.name === state.animation.clip));
  select.value = String(index);
  if (!state.animation.clip) {
    state.animation.clip = clips[0].name;
    select.value = '0';
  }

  $('#animSpeed').value = String(state.animation.speed);
  $('#animSpeedOut').textContent = `${Number(state.animation.speed).toFixed(2)}×`;
  $('#btnAnimPlay').textContent = state.animation.playing ? 'Pause' : 'Play';
}

$('#animClip').addEventListener('change', (e) => {
  const index = parseInt(e.target.value, 10) || 0;
  const clip = viewer.playAnimation(index);
  if (!clip) return;
  state.animation.clip = clip.name || '';
  state.animation.playing = true;
  $('#btnAnimPlay').textContent = 'Pause';
});

$('#btnAnimPlay').addEventListener('click', () => {
  if (!viewer.animClips.length) return;
  if (!viewer.animAction) {
    const clip = viewer.playAnimation(parseInt($('#animClip').value, 10) || 0);
    if (clip) state.animation.clip = clip.name || '';
    state.animation.playing = true;
  } else {
    state.animation.playing = viewer.toggleAnimation();
  }
  $('#btnAnimPlay').textContent = state.animation.playing ? 'Pause' : 'Play';
});

$('#btnAnimStop').addEventListener('click', () => {
  viewer.stopAnimation();
  state.animation.playing = false;
  $('#btnAnimPlay').textContent = 'Play';
});

$('#animSpeed').addEventListener('input', (e) => {
  state.animation.speed = parseFloat(e.target.value);
  $('#animSpeedOut').textContent = `${state.animation.speed.toFixed(2)}×`;
  viewer.setAnimationSpeed(state.animation.speed);
});

function applyAnimationState(anim) {
  if (!anim) return;
  if (typeof anim.speed === 'number') {
    state.animation.speed = anim.speed;
    viewer.setAnimationSpeed(anim.speed);
  }
  if (anim.clip) {
    const index = (viewer.animClips || []).findIndex((clip) => clip.name === anim.clip);
    if (index >= 0) {
      viewer.playAnimation(index);
      state.animation.clip = anim.clip;
      state.animation.playing = true;
    }
  }
  if (anim.playing === false) {
    viewer.toggleAnimation();
    state.animation.playing = false;
  }
  updateAnimationUI();
}

/* ------------------------------------------------------------------ */
/* Model loading                                                       */
/* ------------------------------------------------------------------ */
let loadHideTimer = null;

function setLoadProgress(percent, text) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $('#loadWrap').hidden = false;
  $('#loadBar').style.width = `${value}%`;
  $('#loadPct').textContent = `${value}%`;
  if (text) $('#loadText').textContent = text;
}

function updateModelMeta(result) {
  const info = result.stats || model.stats;
  $('#modelName').textContent = result.fileName;
  $('#modelChip').classList.add('loaded');
  $('#metaName').textContent = result.fileName;
  $('#metaSize').textContent = formatBytes(model.fileSize);
  $('#metaMeshes').textContent = formatNumber(info.meshes);
  $('#metaMaterials').textContent = formatNumber(info.materials);
  $('#metaTris').textContent = formatNumber(info.triangles);
  $('#statTris').textContent = formatNumber(info.triangles);
  $('#statMeshes').textContent = formatNumber(info.meshes);
  $('#modelInfo').hidden = false;
}

$('#btnBrowseModel').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#modelBrowse').click();
});
$('#btnLoadLatest').addEventListener('click', (e) => {
  e.stopPropagation();
  loadLatestModel();
});
$('#dropzone').addEventListener('click', () => $('#modelBrowse').click());
$('#modelBrowse').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) await loadModelFiles(files);
});

async function loadModelFiles(files) {
  if (isLoading) {
    toast('A model is already loading…', 'err');
    return;
  }
  if (hotspots.items.length && !window.confirm('Loading a new model will remove the current hotspots. Continue?')) {
    return;
  }

  isLoading = true;
  const loadStart = performance.now();
  if (loadHideTimer) clearTimeout(loadHideTimer);
  hotspots.setPlacing(false);
  setPickingMaterial(false);
  setPickingObject(false);
  selectedMaterialIds = [];
  selectedObject = null;
  transform.detach();
  pickedEntries = [];
  renderPickedMaterials();
  if (bake.active) bake.restore();
  hotspots.detach();
  hotspots.reset();
  viewer.clearModel();
  model.reset();
  refreshObjectList();
  updateObjectInspector();

  document.body.classList.remove('has-model');
  $('#modelInfo').hidden = true;
  $('#modelChip').classList.remove('loaded');
  $('#modelName').textContent = 'Loading…';
  buildMaterialsUI();
  renderHotspotLists();
  renderHotspotEditor();
  updateAnimationUI();
  updateBakeUI();
  setLoadProgress(0, 'Preparing…');

  try {
    const result = await model.load(files, { onProgress: setLoadProgress });

    viewer.setModel(result.root);
    viewer.applyFog(state.fog);
    updateFogHint();
    model.setQualityProfile(state.quality);
    hotspots.attach(result.root);
    updateModelMeta(result);

    viewer.setAnimations(result.animations || []);
    state.animation = { clip: '', speed: state.animation.speed || 1, playing: false };
    if (viewer.animClips.length) {
      state.animation.clip = viewer.animAction ? viewer.animName : '';
      state.animation.playing = viewer.animPlaying;
      viewer.setAnimationSpeed(state.animation.speed);
    }
    updateAnimationUI();

    if (pending) {
      const todo = pending;
      pending = null;
      const hasWork = (todo.materials && todo.materials.length) || (todo.hotspots && todo.hotspots.length) || todo.camera;
      if (todo.materials && todo.materials.length) {
        await model.applyMaterialState(todo.materials);
      }
      if (todo.hotspots && todo.hotspots.length) {
        hotspots.loadState(todo.hotspots);
      }
      if (todo.camera) applyCameraState(todo.camera, false);
      if (todo.animation) applyAnimationState(todo.animation);
      if (hasWork) toast('Imported scene settings were applied to this model', 'ok');
    }

    buildMaterialsUI();
    renderHotspotLists();
    renderHotspotEditor();
    refreshObjectList();
    updateObjectInspector();

    document.body.classList.add('has-model');
    setLoadProgress(100, 'Ready');
    loadHideTimer = setTimeout(() => {
      $('#loadWrap').hidden = true;
    }, 900);

    state.loadMs = Math.round(performance.now() - loadStart);
    $('#statusLoad').textContent = `${(state.loadMs / 1000).toFixed(2)} s`;
    toast(`Loaded ${result.fileName} · ${formatNumber(model.stats.triangles)} triangles · ${(state.loadMs / 1000).toFixed(2)} s`, 'ok');
  } catch (error) {
    console.error(error);
    document.body.classList.remove('has-model');
    $('#modelChip').classList.remove('loaded');
    $('#modelName').textContent = 'No model loaded';
    $('#loadWrap').hidden = true;
    buildMaterialsUI();
    updateAnimationUI();
    toast(error && error.message ? error.message : 'Could not load the model', 'err');
  } finally {
    isLoading = false;
  }
}

/* ------------------------------------------------------------------ */
/* Bundled latest model                                                */
/* ------------------------------------------------------------------ */
const LATEST_MODEL_URL = './models/1%20A%20TEST%20V2.glb';
const LATEST_MODEL_NAME = '1 A TEST V2.glb';

async function loadLatestModel() {
  if (isLoading) {
    toast('A model is already loading…', 'err');
    return;
  }

  try {
    setLoadProgress(0, 'Downloading latest model…');
    const response = await fetch(LATEST_MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${LATEST_MODEL_URL}`);

    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    let blob;

    if (reader) {
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const mb = (loaded / 1048576).toFixed(1);
        const totalMb = total ? (total / 1048576).toFixed(1) : '?';
        setLoadProgress(total ? (loaded / total) * 100 : 0,
          `Downloading latest model — ${mb} / ${totalMb} MB`);
      }
      blob = new Blob(chunks, { type: 'model/gltf-binary' });
    } else {
      blob = await response.blob();
    }

    const file = new File([blob], LATEST_MODEL_NAME, { type: 'model/gltf-binary' });
    await loadModelFiles([file]);
  } catch (error) {
    console.error(error);
    $('#loadWrap').hidden = true;
    toast(`Could not load ${LATEST_MODEL_NAME}`, 'err');
  }
}

/* ------------------------------------------------------------------ */
/* Materials UI                                                        */
/* ------------------------------------------------------------------ */
function addMaterialRange(body, entry, prop, label, max, step, format = (v) => Number(v).toFixed(2), onChange) {
  const mat = entry.material;
  const wrap = el('label', 'ctrl');
  const head = el('span', 'ctrl-head');
  head.appendChild(el('span', '', label));
  const out = el('output');
  const supported = typeof mat[prop] === 'number';
  const value = supported ? mat[prop] : 0;
  out.textContent = format(value);
  head.appendChild(out);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  if (!supported) {
    input.disabled = true;
    wrap.classList.add('mat-disabled');
  }
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    model.setMaterialValue(entry.id, prop, v);
    out.textContent = format(v);
    if (onChange) onChange(v);
  });

  wrap.append(head, input);
  body.appendChild(wrap);
}

function addMaterialToggle(body, entry, prop, label, checked, onChange, supportedOverride) {
  const supported = supportedOverride !== undefined ? supportedOverride : typeof entry.material[prop] === 'boolean';
  const row = el('label', 'switch-row');
  row.appendChild(el('span', '', label));
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  if (!supported) {
    input.disabled = true;
    row.classList.add('mat-disabled');
  }
  const knob = el('i', 'switch');
  input.addEventListener('change', () => {
    onChange(input.checked);
  });
  row.append(input, knob);
  body.appendChild(row);
}

function addMaterialColor(body, entry, prop, label, onChanged) {
  const mat = entry.material;
  const supported = !!mat[prop] && mat[prop].isColor;
  const row = el('div', 'color-row');
  row.appendChild(el('span', '', label));
  const input = document.createElement('input');
  input.type = 'color';
  input.value = supported ? `#${mat[prop].getHexString()}` : '#000000';
  if (!supported) {
    input.disabled = true;
    row.classList.add('mat-disabled');
  }
  input.addEventListener('input', () => {
    model.setMaterialValue(entry.id, prop, input.value);
    if (onChanged) onChanged(input.value);
  });
  row.appendChild(input);
  body.appendChild(row);
}

/* ---- texture previews -------------------------------------------- */
function texturePreviewURL(texture) {
  if (!texture || !texture.image) return '';
  const cached = texturePreviewCache.get(texture.uuid);
  if (cached !== undefined) return cached;

  let url = '';
  try {
    const image = texture.image;
    const width = image.width || image.videoWidth || 0;
    const height = image.height || image.videoHeight || 0;
    if (width && height) {
      const max = 128;
      const scale = Math.min(1, max / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      url = canvas.toDataURL('image/png');
    }
  } catch (error) {
    url = '';
  }
  texturePreviewCache.set(texture.uuid, url);
  return url;
}

function textureSizeLabel(texture) {
  const image = texture && texture.image;
  if (!image) return '';
  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  return width && height ? `${width}×${height}` : '';
}

function slotLabel(slot) {
  const found = TEXTURE_SLOTS.find(([key]) => key === slot);
  return found ? found[1] : slot;
}

/* ---- material selection ------------------------------------------- */
function isMaterialSelected(id) {
  return selectedMaterialIds.includes(id);
}

function refreshMaterialSelection() {
  $$('.mat-card').forEach((card) => {
    const on = isMaterialSelected(card.dataset.matId);
    card.classList.toggle('selected', on);
    const check = $('.mat-check', card);
    if (check) {
      check.classList.toggle('on', on);
      check.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
}

function toggleMaterialSelection(id) {
  if (isMaterialSelected(id)) selectedMaterialIds = selectedMaterialIds.filter((item) => item !== id);
  else selectedMaterialIds.push(id);
  materialDeletePending = false;
  materialApplyOpen = false;
  refreshMaterialSelection();
  renderMaterialToolbar();
}

function deleteMaterials(ids, deleteObjects) {
  let removed = 0;
  let objects = 0;
  for (const id of ids) {
    const result = model.deleteMaterial(id, { deleteObjects });
    if (result.ok) {
      removed++;
      objects += result.deletedObjects;
    }
  }
  selectedMaterialIds = selectedMaterialIds.filter((id) => !!model.getMaterial(id));
  materialDeletePending = false;
  materialApplyOpen = false;
  afterSceneStructureChange();
  toast(
    `${removed} material${removed === 1 ? '' : 's'} deleted${deleteObjects ? ` · ${objects} object${objects === 1 ? '' : 's'} removed` : ''}`,
    'ok'
  );
}

function renderMaterialToolbar() {
  const host = $('#matToolbar');
  if (!host) return;

  selectedMaterialIds = selectedMaterialIds.filter((id) => !!model.getMaterial(id));
  host.innerHTML = '';
  host.hidden = selectedMaterialIds.length === 0;
  if (!selectedMaterialIds.length) return;

  const entries = selectedMaterialIds.map((id) => model.getMaterial(id));
  const row = el('div', 'mat-toolbar-row');
  row.appendChild(el('span', 'mat-toolbar-label', `${entries.length} selected`));

  const applyBtn = el('button', 'btn subtle', 'Apply to object');
  applyBtn.type = 'button';
  applyBtn.disabled = entries.length !== 1;
  applyBtn.title = 'Assign the selected material to a mesh';
  applyBtn.addEventListener('click', () => {
    materialApplyOpen = !materialApplyOpen;
    materialDeletePending = false;
    renderMaterialToolbar();
  });

  const mergeBtn = el('button', 'btn subtle', 'Merge');
  mergeBtn.type = 'button';
  mergeBtn.disabled = entries.length !== 2;
  mergeBtn.title =
    entries.length === 2 ? `Merge “${entries[1].name}” into “${entries[0].name}”` : 'Select exactly two materials';
  mergeBtn.addEventListener('click', () => {
    const [target, source] = entries;
    const count = model.mergeMaterials(source.id, target.id);
    selectedMaterialIds = [];
    materialDeletePending = false;
    materialApplyOpen = false;
    afterSceneStructureChange();
    toast(`Merged “${source.name}” into “${target.name}” · ${count} object${count === 1 ? '' : 's'} updated`, 'ok');
  });

  const deleteBtn = el('button', 'btn subtle danger', 'Delete');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => {
    materialDeletePending = true;
    materialApplyOpen = false;
    renderMaterialToolbar();
  });

  const clearBtn = el('button', 'btn subtle', 'Clear');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', () => {
    selectedMaterialIds = [];
    materialDeletePending = false;
    materialApplyOpen = false;
    refreshMaterialSelection();
    renderMaterialToolbar();
  });

  row.append(applyBtn, mergeBtn, deleteBtn, clearBtn);
  host.appendChild(row);

  if (materialApplyOpen && entries.length === 1) {
    const entry = entries[0];
    const applyRow = el('div', 'mat-toolbar-row');
    const select = el('select', 'select');
    const targets = model.getMeshTargets();
    targets.forEach((target, index) => {
      const option = el('option', '', target.label);
      option.value = String(index);
      select.appendChild(option);
    });
    if (!targets.length) select.disabled = true;

    const applyNow = el('button', 'btn accent', 'Apply');
    applyNow.type = 'button';
    applyNow.disabled = !targets.length;
    applyNow.addEventListener('click', () => {
      const target = targets[Number(select.value)];
      if (!target) return;
      const count = model.assignMaterialToObject(target.object, entry.id);
      materialApplyOpen = false;
      renderMaterialToolbar();
      refreshObjectList();
      toast(`“${entry.name}” applied to ${count} mesh${count === 1 ? '' : 'es'}`, 'ok');
    });

    const cancel = el('button', 'btn subtle', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      materialApplyOpen = false;
      renderMaterialToolbar();
    });

    applyRow.append(select, applyNow, cancel);
    host.appendChild(applyRow);
    host.appendChild(el('div', 'mat-toolbar-text', `Target for “${entry.name}”. Groups apply to every mesh inside them.`));
  }

  if (materialDeletePending) {
    const usage = entries.reduce((sum, entry) => sum + model.getMaterialUsage(entry.id), 0);
    const confirmRow = el('div', 'mat-toolbar-row');
    const keep = el('button', 'btn subtle', 'Keep objects');
    keep.type = 'button';
    keep.addEventListener('click', () => deleteMaterials(selectedMaterialIds.slice(), false));

    const removeObjects = el('button', 'btn subtle danger', `Also delete ${usage} object${usage === 1 ? '' : 's'}`);
    removeObjects.type = 'button';
    removeObjects.addEventListener('click', () => deleteMaterials(selectedMaterialIds.slice(), true));

    const cancel = el('button', 'btn subtle', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      materialDeletePending = false;
      renderMaterialToolbar();
    });

    confirmRow.append(keep, removeObjects, cancel);
    host.appendChild(confirmRow);
    host.appendChild(
      el('div', 'mat-toolbar-text', `Delete ${entries.length} material${entries.length === 1 ? '' : 's'}? “Keep objects” gives them a neutral default material.`)
    );
  }
}

function buildMaterialCard(entry) {
  const mat = entry.material;
  const card = el('details', 'mat-card');
  card.dataset.name = `${entry.name} ${entry.type}`.toLowerCase();
  card.dataset.matId = entry.id;
  card.classList.toggle('selected', isMaterialSelected(entry.id));

  const summary = el('summary');

  const check = el('button', 'mat-check');
  check.type = 'button';
  check.title = 'Select this material (for merge / apply / delete)';
  check.setAttribute('aria-pressed', isMaterialSelected(entry.id) ? 'true' : 'false');
  check.classList.toggle('on', isMaterialSelected(entry.id));
  check.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMaterialSelection(entry.id);
  });

  const swatch = el('span', 'mat-swatch');
  const updateSwatch = () => {
    swatch.style.background = mat.color ? `#${mat.color.getHexString()}` : 'rgba(255,255,255,0.12)';
  };
  updateSwatch();
  const nameSpan = el('span', 'mat-name', entry.name);
  summary.append(check, swatch, nameSpan, el('span', 'mat-type', entry.type));

  const body = el('div', 'mat-body');

  const nameRow = el('label', 'ctrl');
  const nameHead = el('span', 'ctrl-head');
  nameHead.appendChild(el('span', '', 'Name'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'text-input';
  nameInput.value = entry.name;
  nameInput.spellcheck = false;
  nameInput.addEventListener('change', () => {
    const next = nameInput.value.trim();
    if (!next || !model.renameMaterial(entry.id, next)) {
      nameInput.value = entry.name;
      return;
    }
    nameSpan.textContent = entry.name;
    card.dataset.name = `${entry.name} ${entry.type}`.toLowerCase();
    applyMaterialFilter();
    toast(`Renamed to “${entry.name}”`, 'ok');
  });
  nameRow.append(nameHead, nameInput);
  body.appendChild(nameRow);

  if (mat.color) addMaterialColor(body, entry, 'color', 'Color tint', updateSwatch);

  addMaterialRange(body, entry, 'roughness', 'Roughness', 1, 0.01);
  addMaterialRange(body, entry, 'metalness', 'Metalness', 1, 0.01);
  addMaterialRange(body, entry, 'opacity', 'Opacity', 1, 0.01, (v) => Number(v).toFixed(2), (v) => {
    if (v < 1) model.setMaterialValue(entry.id, 'transparent', true);
  });
  if (typeof mat.envMapIntensity === 'number') {
    addMaterialRange(body, entry, 'envMapIntensity', 'Env intensity', 5, 0.05);
  }

  addMaterialToggle(body, entry, 'transparent', 'Transparent', !!mat.transparent, (checked) => {
    model.setMaterialValue(entry.id, 'transparent', checked);
  });
  if ('wireframe' in mat) {
    addMaterialToggle(body, entry, 'wireframe', 'Wireframe', !!mat.wireframe, (checked) => {
      model.setMaterialValue(entry.id, 'wireframe', checked);
    });
  }
  if ('side' in mat) {
    addMaterialToggle(body, entry, 'side', 'Double-sided', mat.side === THREE.DoubleSide, (checked) => {
      model.setMaterialValue(entry.id, 'side', checked ? THREE.DoubleSide : THREE.FrontSide);
    }, true);
  }

  if (mat.emissive) {
    addMaterialColor(body, entry, 'emissive', 'Emissive color');
    if (typeof mat.emissiveIntensity === 'number') {
      addMaterialRange(body, entry, 'emissiveIntensity', 'Emissive strength', 6, 0.05, (v) => Number(v).toFixed(2));
    }
  }

  /* ---- texture section ---- */
  const head = el('div', 'ctrl-head');
  head.style.marginTop = '12px';
  head.appendChild(el('span', '', 'Texture'));
  body.appendChild(head);

  const texRow = el('div', 'tex-row');
  const slotSelect = el('select', 'select');
  for (const [slot, label] of TEXTURE_SLOTS) {
    const option = el('option', '', label);
    option.value = slot;
    slotSelect.appendChild(option);
  }
  const firstPresent = TEXTURE_SLOTS.find(([slot]) => mat[slot]);
  slotSelect.value = firstPresent ? firstPresent[0] : 'map';

  const replaceBtn = el('button', 'btn subtle', 'Replace');
  replaceBtn.type = 'button';
  const removeBtn = el('button', 'btn subtle danger', 'Remove');
  removeBtn.type = 'button';
  removeBtn.title = 'Remove the uploaded override and go back to the original texture';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;

  texRow.append(slotSelect, replaceBtn, removeBtn);
  body.append(texRow, fileInput);

  const preview = el('div', 'tex-preview');
  const previewImg = document.createElement('img');
  previewImg.alt = 'Texture preview';
  const previewEmpty = el('div', 'tex-preview-empty', 'No texture in this slot');
  const previewBadge = el('span', 'tex-preview-badge', 'Original');
  preview.append(previewImg, previewEmpty, previewBadge);

  const texMeta = el('div', 'tex-meta', '');
  const thumbs = el('div', 'tex-thumbs');

  const refreshTextureView = () => {
    const slot = slotSelect.value;
    const texture = mat[slot];
    const url = texture ? texturePreviewURL(texture) : '';
    const info = entry.overrides[slot];

    previewImg.hidden = !url;
    previewEmpty.hidden = !!url;
    if (url) previewImg.src = url;
    else previewEmpty.textContent = texture ? 'Preview unavailable for this texture format' : 'No texture in this slot';

    previewBadge.hidden = !texture;
    previewBadge.textContent = info ? 'Override' : 'Original';
    previewBadge.classList.toggle('override', !!info);

    const size = textureSizeLabel(texture);
    texMeta.textContent = texture
      ? `${slotLabel(slot)}${size ? ` · ${size}` : ''}${info ? ` · ${info.name}` : ''}`
      : `${slotLabel(slot)} · empty`;

    removeBtn.disabled = !info;
    thumbs.innerHTML = '';
    let count = 0;
    for (const [otherSlot, label] of TEXTURE_SLOTS) {
      if (!mat[otherSlot]) continue;
      count++;
      const thumb = el('button', 'tex-thumb');
      thumb.type = 'button';
      thumb.title = label;
      thumb.classList.toggle('active', otherSlot === slot);
      const img = document.createElement('img');
      const thumbUrl = texturePreviewURL(mat[otherSlot]);
      if (thumbUrl) img.src = thumbUrl;
      img.alt = label;
      thumb.append(img, el('span', '', label));
      thumb.addEventListener('click', () => {
        slotSelect.value = otherSlot;
        refreshTextureView();
      });
      thumbs.appendChild(thumb);
    }
    if (!count) thumbs.hidden = true;
    else thumbs.hidden = false;
  };

  body.append(preview, texMeta, thumbs);
  refreshTextureView();

  slotSelect.addEventListener('change', refreshTextureView);
  replaceBtn.addEventListener('click', () => fileInput.click());
  removeBtn.addEventListener('click', () => {
    model.removeTextureOverride(entry.id, slotSelect.value);
    texturePreviewCache.clear();
    refreshTextureView();
    toast(`Override removed on “${entry.name}”`, 'ok');
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    replaceBtn.disabled = true;
    const oldText = replaceBtn.textContent;
    replaceBtn.textContent = '…';
    try {
      await model.replaceTexture(entry.id, slotSelect.value, file);
      texturePreviewCache.clear();
      refreshTextureView();
      toast(`Texture replaced on “${entry.name}”`, 'ok');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Texture failed', 'err');
    } finally {
      replaceBtn.disabled = false;
      replaceBtn.textContent = oldText;
    }
  });

  /* ---- actions ---- */
  const actions = el('div', 'mat-actions');
  actions.style.gap = '6px';
  const copyBtn = el('button', 'btn subtle small', 'Copy to all');
  copyBtn.type = 'button';
  copyBtn.title = 'Copy this material’s look to every material';
  copyBtn.addEventListener('click', () => {
    const count = model.copyMaterialSettings(entry.id);
    buildMaterialsUI();
    toast(`Copied to ${count} material${count === 1 ? '' : 's'}`, 'ok');
  });
  const resetBtn = el('button', 'btn subtle small', 'Reset');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    model.revertMaterial(entry.id);
    buildMaterialsUI();
    toast(`“${entry.name}” reset`, 'ok');
  });
  const deleteBtn = el('button', 'btn subtle small danger', 'Delete');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => {
    const usage = model.getMaterialUsage(entry.id);
    const confirm = el('div', 'mat-confirm');
    confirm.appendChild(
      el('div', 'mat-confirm-text', `Delete “${entry.name}”? It is used by ${usage} object${usage === 1 ? '' : 's'}.`)
    );
    const row = el('div', 'btn-row');
    const keep = el('button', 'btn subtle tiny', 'Keep objects');
    keep.type = 'button';
    keep.addEventListener('click', () => deleteMaterials([entry.id], false));
    const removeObjects = el('button', 'btn subtle tiny danger', `Delete objects too`);
    removeObjects.type = 'button';
    removeObjects.disabled = usage === 0;
    removeObjects.addEventListener('click', () => deleteMaterials([entry.id], true));
    const cancel = el('button', 'btn subtle tiny', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => confirm.remove());
    row.append(keep, removeObjects, cancel);
    confirm.appendChild(row);
    body.appendChild(confirm);
    confirm.scrollIntoView({ block: 'nearest' });
  });

  actions.append(copyBtn, resetBtn, deleteBtn);
  body.appendChild(actions);

  card.append(summary, body);
  return card;
}

function buildMaterialsUI() {
  const host = $('#materialList');
  const openIds = new Set($$('.mat-card[open]', host).map((card) => card.dataset.matId));
  const scroller = $('.panel-scroll');
  const scrollTop = scroller ? scroller.scrollTop : 0;
  host.innerHTML = '';
  const mats = model.materials;
  $('#matCount').textContent = mats.length;
  $('#materialEmpty').hidden = mats.length > 0;
  $('#bakeNotice').hidden = !bake.active;
  if (!mats.length) {
    $('#materialEmpty').textContent = model.root
      ? 'This model has no materials.'
      : 'Load a model to edit its materials.';
    renderMaterialToolbar();
    return;
  }
  for (const entry of mats) {
    const card = buildMaterialCard(entry);
    if (openIds.has(entry.id)) card.open = true;
    host.appendChild(card);
  }
  applyMaterialFilter();
  applyPickedHighlight();
  renderMaterialToolbar();
  if (scroller) requestAnimationFrame(() => { scroller.scrollTop = scrollTop; });
}

function applyPickedHighlight() {
  $$('.mat-card', $('#materialList')).forEach((card) => {
    card.classList.toggle('picked', pickedEntries.some((entry) => entry.id === card.dataset.matId));
  });
}

function renderPickedMaterials() {
  const host = $('#pickedMaterials');
  host.innerHTML = '';
  if (!pickedEntries.length) return;

  const label = el('div', 'picked-label');
  const source = pickedEntries.sourceMesh ? pickedEntries.sourceMesh.name || 'mesh' : 'model';
  label.textContent = `Picked from ${source}`;
  host.appendChild(label);
  for (const entry of pickedEntries) {
    const card = buildMaterialCard(entry);
    card.classList.add('picked');
    card.open = true;
    host.appendChild(card);
  }
}

function setPickingMaterial(active) {
  pickingMaterial = !!active;
  document.body.classList.toggle('picking-material', pickingMaterial);
  $('#btnPickMaterial').classList.toggle('active', pickingMaterial);
  if (pickingMaterial) {
    hotspots.setPlacing(false);
    hotspots.hideTooltip();
    toast('Material picker: click the model (Esc to cancel)', 'ok');
  }
}

$('#btnPickMaterial').addEventListener('click', () => {
  if (!model.root) {
    toast('Load a model first', 'err');
    return;
  }
  setPickingMaterial(!pickingMaterial);
});

window.addEventListener('pointerdown', (event) => {
  if (!pickingMaterial) return;
  if (event.target !== viewer.renderer.domElement) return;
  event.preventDefault();
  event.stopPropagation();

  const hit = viewer.pickModelObject(event);
  setPickingMaterial(false);
  if (!hit) {
    toast('No material found at that point', 'err');
    return;
  }
  const entries = model.getMaterialEntriesForObject(hit.object);
  if (!entries.length) {
    toast('That object has no editable material', 'err');
    return;
  }
  pickedEntries = entries;
  pickedEntries.sourceMesh = hit.object;
  renderPickedMaterials();
  applyPickedHighlight();
  showTab('materials');
  viewer.flashObject(hit.object);
  toast(`Picked ${entries.length === 1 ? entries[0].name : `${entries.length} materials`}`, 'ok');
}, true);

function applyMaterialFilter() {
  const query = ($('#matSearch').value || '').trim().toLowerCase();
  $$('.mat-card', $('#materialList')).forEach((card) => {
    card.hidden = !!query && !card.dataset.name.includes(query);
  });
}

$('#matSearch').addEventListener('input', applyMaterialFilter);
$('#btnRevertAll').addEventListener('click', () => {
  model.revertAll();
  buildMaterialsUI();
  toast('All material edits reverted', 'ok');
});

/* ------------------------------------------------------------------ */
/* Objects & transforms                                                */
/* ------------------------------------------------------------------ */
const transform = new TransformControls(viewer.camera, viewer.renderer.domElement);
transform.setSize(0.85);
transform.setSpace('world');
transform.addEventListener('dragging-changed', (event) => {
  viewer.controls.enabled = !event.value;
});
transform.addEventListener('objectChange', () => {
  syncTransformInputs();
  viewer.refreshSelection();
});
transform.addEventListener('change', () => viewer.refreshSelection());
viewer.scene.add(transform.getHelper());

function isInScene(object) {
  let found = false;
  viewer.modelGroup.traverse((node) => {
    if (node === object) found = true;
  });
  return found;
}

function syncTransformInputs() {
  if (!selectedObject) return;
  const object = selectedObject;
  $$('.vec-row[data-vec="position"] input').forEach((input) => {
    input.value = Number(object.position[input.dataset.axis] || 0).toFixed(3);
  });
  $$('.vec-row[data-vec="rotation"] input').forEach((input) => {
    input.value = THREE.MathUtils.radToDeg(object.rotation[input.dataset.axis] || 0).toFixed(1);
  });
  $$('.vec-row[data-vec="scale"] input').forEach((input) => {
    input.value = Number(object.scale[input.dataset.axis] || 1).toFixed(3);
  });
}

function updateObjectInspector() {
  const inspector = $('#objectInspector');
  if (!inspector) return;
  inspector.hidden = !selectedObject;
  if (!selectedObject) return;
  $('#objSelectedName').textContent = selectedObject.name || selectedObject.type || 'Object';
  syncTransformInputs();
}

function refreshObjectList() {
  const host = $('#objectList');
  if (!host) return;
  const scrollTop = host.scrollTop;
  const query = ($('#objSearch').value || '').trim().toLowerCase();
  const targets = model.getMeshTargets();
  $('#objCount').textContent = targets.length;
  host.innerHTML = '';
  $('#objectEmpty').hidden = targets.length > 0;
  if (!targets.length) {
    $('#objectEmpty').textContent = model.root ? 'This model has no meshes.' : 'Load a model to edit its objects.';
    return;
  }

  let shown = 0;
  for (const target of targets) {
    const label = target.object.name || 'Mesh';
    if (query && !target.label.toLowerCase().includes(query)) continue;
    shown++;

    const row = el('div', 'object-row');
    row.classList.toggle('active', selectedObject === target.object);
    row.appendChild(el('span', 'obj-name', label));

    const geometry = target.object.geometry;
    const count = geometry
      ? geometry.index
        ? geometry.index.count
        : geometry.attributes.position
          ? geometry.attributes.position.count
          : 0
      : 0;
    row.appendChild(el('span', 'obj-tag', formatNumber(Math.floor(count / 3))));

    const del = el('button', 'obj-del');
    del.type = 'button';
    del.title = 'Delete this object';
    del.innerHTML = ICON_TRASH;
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteObject(target.object);
    });
    row.appendChild(del);

    row.addEventListener('click', () => selectObject(target.object));
    host.appendChild(row);
  }

  if (!shown) {
    const empty = el('div', 'empty-small', 'No object matches the search.');
    host.appendChild(empty);
  }
  host.scrollTop = scrollTop;
}

function selectObject(object) {
  selectedObject = object || null;
  if (selectedObject) {
    if (selectedObject === model.root) {
      selectedObject = null;
      transform.detach();
      viewer.setSelection(null);
    } else {
      transform.attach(selectedObject);
      transform.setMode(transformMode);
      viewer.setSelection(selectedObject);
    }
  } else {
    transform.detach();
    viewer.setSelection(null);
  }
  refreshObjectList();
  updateObjectInspector();
  if (selectedObject) {
    const inspector = $('#objectInspector');
    const panel = $('#panel').getBoundingClientRect();
    const rect = inspector.getBoundingClientRect();
    if (rect.bottom > panel.bottom || rect.top < panel.top) inspector.scrollIntoView({ block: 'nearest' });
  }
}

function setPickingObject(active) {
  pickingObject = !!active;
  document.body.classList.toggle('picking-object', pickingObject);
  $('#btnPickObject').classList.toggle('active', pickingObject);
  if (pickingObject) {
    setPickingMaterial(false);
    hotspots.setPlacing(false);
    hotspots.hideTooltip();
    toast('Object picker: click a mesh (Esc to cancel)', 'ok');
  }
}

function deleteObject(object) {
  if (!object) return;
  const name = object.name || 'object';
  const meshes = model.deleteObject(object);
  if (selectedObject === object) {
    selectedObject = null;
    transform.detach();
    viewer.setSelection(null);
  }
  afterSceneStructureChange();
  toast(`Deleted “${name}” · ${meshes} mesh${meshes === 1 ? '' : 'es'} removed`, 'ok');
}

function afterSceneStructureChange() {
  if (selectedObject && !isInScene(selectedObject)) {
    selectedObject = null;
    transform.detach();
    viewer.setSelection(null);
  }
  buildMaterialsUI();
  refreshObjectList();
  updateObjectInspector();
  if (model.root) updateModelMeta({ fileName: model.fileName, stats: model.stats });
}

$('#btnPickObject').addEventListener('click', () => {
  if (!model.root) {
    toast('Load a model first', 'err');
    return;
  }
  setPickingObject(!pickingObject);
});

window.addEventListener('pointerdown', (event) => {
  if (!pickingObject) return;
  if (event.target !== viewer.renderer.domElement) return;
  event.preventDefault();
  event.stopPropagation();
  const hit = viewer.pickModelObject(event);
  setPickingObject(false);
  if (!hit) {
    toast('No object at that point', 'err');
    return;
  }
  selectObject(hit.object);
  toast(`Selected “${hit.object.name || 'mesh'}”`, 'ok');
}, true);

$$('#transformModes [data-transform]').forEach((button) => {
  button.addEventListener('click', () => {
    transformMode = button.dataset.transform;
    $$('#transformModes [data-transform]').forEach((item) => item.classList.toggle('active', item === button));
    if (selectedObject) transform.setMode(transformMode);
  });
});

$('#objSearch').addEventListener('input', refreshObjectList);

$$('.vec-row').forEach((row) => {
  const kind = row.dataset.vec;
  $$('input', row).forEach((input) => {
    input.addEventListener('input', () => {
      if (!selectedObject) return;
      const value = parseFloat(input.value);
      if (!Number.isFinite(value)) return;
      const axis = input.dataset.axis;
      if (kind === 'rotation') selectedObject.rotation[axis] = THREE.MathUtils.degToRad(value);
      else if (kind === 'scale') selectedObject.scale[axis] = value === 0 ? 0.0001 : value;
      else selectedObject[kind][axis] = value;
      selectedObject.updateMatrixWorld(true);
      viewer.refreshSelection();
    });
  });
});

$('#btnObjFocus').addEventListener('click', () => {
  if (selectedObject) viewer.focusObject(selectedObject);
});

$('#btnObjReset').addEventListener('click', () => {
  if (!selectedObject) return;
  selectedObject.position.set(0, 0, 0);
  selectedObject.rotation.set(0, 0, 0);
  selectedObject.scale.set(1, 1, 1);
  selectedObject.updateMatrixWorld(true);
  viewer.refreshSelection();
  syncTransformInputs();
  toast('Transform reset', 'ok');
});

$('#btnObjDelete').addEventListener('click', () => {
  if (selectedObject) deleteObject(selectedObject);
});

/* ------------------------------------------------------------------ */
/* Hotspots UI                                                         */
/* ------------------------------------------------------------------ */
function startPlacing() {
  if (!model.root) {
    toast('Load a model first', 'err');
    return;
  }
  showTab('hotspots');
  hotspots.beginPlacing();
}

$('#btnAddHotspot').addEventListener('click', startPlacing);
$('#btnAddHotspot2').addEventListener('click', startPlacing);
$('#btnCancelPlacing').addEventListener('click', () => hotspots.setPlacing(false));

function renderHotspotLists() {
  const items = hotspots.items;
  $('#hsCount').textContent = items.length;
  $('#dockCount').textContent = items.length;
  $('#dockEmpty').hidden = items.length > 0;
  const dock = $('#hotspotDockList');
  dock.innerHTML = '';

  for (const item of items) {
    const row = el('div', `dock-item${item.id === hotspots.selectedId ? ' active' : ''}`);
    const dot = el('span', 'hs-dot');
    dot.style.background = item.color;
    dot.style.color = item.color;

    const text = el('div', 'dock-item-text');
    text.append(el('b', '', item.label), el('span', '', hotspots.actionLabel(item.action)));

    const actions = el('div', 'dock-item-actions');
    const focus = el('button', 'hs-action-btn', '');
    focus.type = 'button';
    focus.title = 'Focus camera';
    focus.innerHTML = ICON_FOCUS;
    focus.addEventListener('click', (e) => {
      e.stopPropagation();
      focusHotspot(item);
    });
    const remove = el('button', 'hs-action-btn danger', '');
    remove.type = 'button';
    remove.title = 'Delete hotspot';
    remove.innerHTML = ICON_TRASH;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      hotspots.deleteItem(item.id);
    });
    actions.append(focus, remove);

    row.append(dot, text, actions);
    row.addEventListener('click', () => {
      hotspots.select(item.id);
      showTab('hotspots');
      renderHotspotEditor();
    });
    dock.appendChild(row);
  }
}

function renderHotspotEditor() {
  const items = hotspots.items;
  $('#hsCount').textContent = items.length;
  $('#hotspotEmpty').hidden = items.length > 0;
  const host = $('#hotspotEditor');
  const openIds = new Set($$('.hs-card[open]', host).map((card) => card.dataset.id));
  const scroller = $('.panel-scroll');
  const scrollTop = scroller ? scroller.scrollTop : 0;
  host.innerHTML = '';
  for (const item of items) {
    const card = buildHotspotCard(item);
    if (openIds.has(item.id) && card.dataset.id !== hotspots.selectedId) card.open = true;
    host.appendChild(card);
  }
  if (scroller) requestAnimationFrame(() => { scroller.scrollTop = scrollTop; });
}

function formatCoord(value) {
  return Math.abs(value) < 0.005 ? '0.00' : Number(value).toFixed(2);
}

function updatePositionLabel(item) {
  const card = $(`.hs-card[data-id="${item.id}"]`, $('#hotspotEditor'));
  if (!card) return;
  const pos = $('.hs-pos', card);
  if (pos) pos.textContent = item.position.map(formatCoord).join('   ·   ');
}

function field(label, node, extraClass = '') {
  const wrap = el('label', `field ${extraClass}`.trim());
  wrap.appendChild(el('span', '', label));
  wrap.appendChild(node);
  return wrap;
}

function makeInput(value, placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  input.placeholder = placeholder;
  return input;
}

function makeSelect(options, value) {
  const select = el('select');
  for (const [id, label] of options) {
    const option = el('option', '', label);
    option.value = id;
    select.appendChild(option);
  }
  if (value !== undefined) select.value = value;
  return select;
}

function iconButton(icon, title, danger, onClick) {
  const btn = el('button', `hs-action-btn${danger ? ' danger' : ''}`, '');
  btn.type = 'button';
  btn.title = title;
  btn.innerHTML = icon;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function buildHotspotCard(item) {
  const card = el('details', 'hs-card');
  card.dataset.id = item.id;
  card.open = item.id === hotspots.selectedId;

  const summary = el('summary');
  const dot = el('span', 'hs-dot');
  dot.style.background = item.color;
  dot.style.color = item.color;
  const title = el('span', 'hs-title', item.label);
  const badge = el('span', 'hs-badge', hotspots.actionLabel(item.action));

  const actions = el('span', 'hs-summary-actions');
  actions.append(
    iconButton(ICON_FOCUS, 'Focus hotspot', false, () => focusHotspot(item)),
    iconButton(ICON_TRASH, 'Delete hotspot', true, () => hotspots.deleteItem(item.id))
  );

  summary.append(dot, title, badge, actions);
  summary.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (hotspots.selectedId !== item.id) {
      hotspots.select(item.id);
      showTab('hotspots');
    }
  });

  const body = el('div', 'hs-body');

  const labelInput = makeInput(item.label, 'Hotspot label');
  labelInput.addEventListener('input', () => {
    hotspots.updateItem(item.id, { label: labelInput.value || 'Untitled' });
    title.textContent = labelInput.value || 'Untitled';
    renderHotspotLists();
  });
  body.appendChild(field('Label', labelInput));

  const iconWrap = el('div', 'field');
  iconWrap.appendChild(el('span', '', 'Marker image'));
  if (item.icon) {
    const preview = el('div', 'image-preview');
    const img = document.createElement('img');
    img.src = item.icon;
    img.alt = 'Hotspot marker';
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.title = 'Remove marker image';
    remove.addEventListener('click', async () => {
      await hotspots.setIcon(item.id, null);
      renderHotspotEditor();
    });
    preview.append(img, remove);
    iconWrap.appendChild(preview);
  }
  const iconInput = document.createElement('input');
  iconInput.type = 'file';
  iconInput.accept = 'image/*';
  iconInput.hidden = true;
  const iconBtn = el('button', 'btn subtle small', item.icon ? 'Replace image' : 'Upload image');
  iconBtn.type = 'button';
  iconBtn.style.marginTop = '6px';
  iconBtn.addEventListener('click', () => iconInput.click());
  iconInput.addEventListener('change', async () => {
    const file = iconInput.files && iconInput.files[0];
    iconInput.value = '';
    if (!file) return;
    try {
      const dataUrl = await readImageFile(file);
      await hotspots.setIcon(item.id, dataUrl);
      renderHotspotEditor();
    } catch (error) {
      toast('Could not use that image', 'err');
    }
  });
  iconWrap.append(iconBtn, iconInput);
  body.appendChild(iconWrap);

  const hoverSelect = makeSelect(
    [
      ['none', 'None'],
      ['fade', 'Fade in'],
      ['scale', 'Scale up'],
      ['pulse', 'Pulse'],
    ],
    item.hoverAnim || 'scale'
  );
  hoverSelect.addEventListener('change', () => {
    hotspots.updateItem(item.id, { hoverAnim: hoverSelect.value });
  });
  body.appendChild(field('Hover animation', hoverSelect));

  const shapeSelect = makeSelect(HOTSPOT_SHAPES, item.shape);
  shapeSelect.addEventListener('change', () => {
    hotspots.updateItem(item.id, { shape: shapeSelect.value });
  });

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = item.color;
  colorInput.addEventListener('input', () => {
    hotspots.updateItem(item.id, { color: colorInput.value });
    dot.style.background = colorInput.value;
    dot.style.color = colorInput.value;
    renderHotspotLists();
  });

  const shapeField = field('Shape', shapeSelect);
  const colorField = field('Color', colorInput);
  const grid = el('div', 'field-grid');
  grid.append(shapeField, colorField);
  body.appendChild(grid);

  const sizeWrap = el('label', 'ctrl');
  const sizeHead = el('span', 'ctrl-head');
  sizeHead.appendChild(el('span', '', 'Marker size'));
  const sizeOut = el('output', '', Number(item.size).toFixed(2));
  sizeHead.appendChild(sizeOut);
  const sizeInput = document.createElement('input');
  sizeInput.type = 'range';
  sizeInput.min = '0.35';
  sizeInput.max = '3';
  sizeInput.step = '0.05';
  sizeInput.value = String(item.size);
  sizeInput.addEventListener('input', () => {
    const size = parseFloat(sizeInput.value);
    hotspots.updateItem(item.id, { size });
    sizeOut.textContent = size.toFixed(2);
  });
  sizeWrap.append(sizeHead, sizeInput);
  body.appendChild(sizeWrap);

  const pos = el('div', 'hs-pos', item.position.map(formatCoord).join('   ·   '));
  body.appendChild(pos);

  const actionSelect = makeSelect(HOTSPOT_ACTIONS, item.action.type);
  actionSelect.addEventListener('change', () => {
    hotspots.setAction(item.id, defaultActionFor(actionSelect.value, item));
  });
  body.appendChild(field('On click', actionSelect));

  const config = el('div', 'action-config');
  const type = item.action.type;
  if (type === 'popup') config.appendChild(renderPopupConfig(item));
  else if (type === 'camera') config.appendChild(renderCameraConfig(item));
  else if (type === 'material') config.appendChild(renderMaterialConfig(item));
  else if (type === 'visibility') config.appendChild(renderVisibilityConfig(item));
  body.appendChild(config);

  card.append(summary, body);
  return card;
}

function renderPopupConfig(item) {
  const action = item.action;
  const wrap = el('div');

  if (action.image) {
    const preview = el('div', 'image-preview');
    const img = document.createElement('img');
    img.src = action.image;
    img.alt = 'Hotspot image';
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.title = 'Remove image';
    remove.addEventListener('click', () => {
      item.action.image = null;
      renderHotspotEditor();
    });
    preview.append(img, remove);
    wrap.appendChild(preview);
  }

  const titleInput = makeInput(action.title || item.label, 'Popup title');
  titleInput.addEventListener('input', () => {
    item.action.title = titleInput.value;
  });
  wrap.appendChild(field('Popup title', titleInput));

  const textArea = document.createElement('textarea');
  textArea.value = action.text || '';
  textArea.placeholder = 'Description shown in the popup…';
  textArea.addEventListener('input', () => {
    item.action.text = textArea.value;
  });
  wrap.appendChild(field('Popup text', textArea));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  const uploadBtn = el('button', 'btn subtle small', action.image ? 'Replace image' : 'Upload image');
  uploadBtn.type = 'button';
  uploadBtn.style.marginTop = '2px';
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      item.action.image = await readImageFile(file);
      renderHotspotEditor();
    } catch (error) {
      toast('Could not read image', 'err');
    }
  });
  wrap.append(uploadBtn, fileInput);

  return wrap;
}

function renderCameraConfig(item) {
  const action = item.action;
  const wrap = el('div');
  const hasView = Array.isArray(action.position) && Array.isArray(action.target);
  const info = el(
    'p',
    'hint',
    hasView
      ? `Saved view: ${action.position.map((v) => formatCoord(v)).join(', ')}`
      : 'No camera view saved yet. Position the camera, then capture it.'
  );
  wrap.appendChild(info);

  const row = el('div', 'hs-inline-btn');
  const setBtn = el('button', 'btn subtle small', 'Set from current view');
  setBtn.type = 'button';
  setBtn.addEventListener('click', () => {
    const cam = viewer.getCameraState();
    hotspots.setAction(item.id, { ...item.action, position: cam.position, target: cam.target });
    toast('Camera view saved to hotspot', 'ok');
  });
  row.appendChild(setBtn);

  if (hasView) {
    const preview = el('button', 'btn subtle small', 'Preview');
    preview.type = 'button';
    preview.addEventListener('click', () => {
      viewer.flyTo(new THREE.Vector3().fromArray(action.position), new THREE.Vector3().fromArray(action.target), 900);
    });
    row.appendChild(preview);
  }
  wrap.appendChild(row);
  return wrap;
}

function renderMaterialConfig(item) {
  const action = item.action;
  const wrap = el('div');
  if (!model.root) {
    wrap.appendChild(el('p', 'hint', 'Load a model to configure a material action.'));
    return wrap;
  }

  const meshes = model.getMeshTargets();
  const materialChoices = model.getMaterialChoices();

  const meshSelect = el('select');
  meshSelect.appendChild(new Option('— choose a mesh —', ''));
  for (const target of meshes) {
    const option = new Option(target.label, JSON.stringify(target.path));
    meshSelect.appendChild(option);
  }
  if (action.targetPath && action.targetPath.length) {
    meshSelect.value = JSON.stringify(action.targetPath);
  }
  meshSelect.addEventListener('change', () => {
    const target = meshes.find((m) => JSON.stringify(m.path) === meshSelect.value);
    if (!target) return;
    hotspots.setAction(item.id, { ...item.action, targetPath: target.path, targetLabel: target.label });
  });
  wrap.appendChild(field('Target mesh', meshSelect));

  const matSelect = el('select');
  matSelect.appendChild(new Option('— choose a material —', ''));
  for (const choice of materialChoices) {
    const option = new Option(`${choice.name} (${choice.type || 'material'})`, choice.name);
    matSelect.appendChild(option);
  }
  if (action.materialName) matSelect.value = action.materialName;
  matSelect.addEventListener('change', () => {
    const choice = materialChoices.find((c) => c.name === matSelect.value);
    if (!choice) return;
    hotspots.setAction(item.id, {
      ...item.action,
      materialName: choice.name,
      materialIndex: choice.index,
      materialId: choice.id,
    });
  });
  wrap.appendChild(field('Replace with material', matSelect));

  wrap.appendChild(
    el('p', 'hint', 'Clicking this marker assigns the chosen material to the target mesh. Tint any material in the Materials tab first.')
  );
  return wrap;
}

function renderVisibilityConfig(item) {
  const action = item.action;
  const wrap = el('div');
  if (!model.root) {
    wrap.appendChild(el('p', 'hint', 'Load a model to configure visibility.'));
    return wrap;
  }

  const objects = model.getObjectTargets();
  const targetSelect = el('select');
  targetSelect.appendChild(new Option('— choose an object —', ''));
  for (const target of objects) {
    targetSelect.appendChild(new Option(target.label, JSON.stringify(target.path)));
  }
  if (action.targetPath && action.targetPath.length) {
    targetSelect.value = JSON.stringify(action.targetPath);
  }
  targetSelect.addEventListener('change', () => {
    const target = objects.find((o) => JSON.stringify(o.path) === targetSelect.value);
    if (!target) return;
    hotspots.setAction(item.id, { ...item.action, targetPath: target.path, targetLabel: target.label });
  });
  wrap.appendChild(field('Target object', targetSelect));

  const modeSelect = makeSelect(
    [
      ['toggle', 'Toggle visibility'],
      ['show', 'Show'],
      ['hide', 'Hide'],
    ],
    action.mode
  );
  modeSelect.addEventListener('change', () => {
    hotspots.setAction(item.id, { ...item.action, mode: modeSelect.value });
  });
  wrap.appendChild(field('Mode', modeSelect));
  return wrap;
}

function defaultActionFor(type, item) {
  if (type === 'camera') {
    const cam = viewer.getCameraState();
    return { type, position: cam.position, target: cam.target };
  }
  if (type === 'material') {
    const mesh = model.getMeshTargets()[0];
    const choice = model.getMaterialChoices()[0];
    return {
      type,
      targetPath: mesh ? mesh.path : [],
      targetLabel: mesh ? mesh.label : '',
      materialName: choice ? choice.name : '',
      materialIndex: choice ? choice.index : undefined,
      materialId: choice ? choice.id : '',
    };
  }
  if (type === 'visibility') {
    const target = model.getObjectTargets()[0];
    return {
      type,
      targetPath: target ? target.path : [],
      targetLabel: target ? target.label : '',
      mode: 'toggle',
    };
  }
  return { type: 'popup', title: item.label, text: '', image: null };
}

function focusHotspot(item) {
  if (!item.sprite) return;
  const world = item.sprite.getWorldPosition(new THREE.Vector3());
  const dir = viewer.camera.position.clone().sub(viewer.controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize();
  const distance = Math.max(viewer.radius * 0.55, 0.35);
  viewer.flyTo(world.clone().addScaledVector(dir, distance), world, 800);
}

/* ------------------------------------------------------------------ */
/* Popup                                                               */
/* ------------------------------------------------------------------ */
function openPopup(item) {
  const action = item.action || {};
  $('#popupTitle').textContent = action.title || item.label || 'Hotspot';
  $('#popupText').textContent = action.text || '';
  const image = $('#popupImage');
  if (action.image) {
    image.src = action.image;
    image.hidden = false;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
  }
  $('#popupOverlay').hidden = false;
}

function closePopup() {
  $('#popupOverlay').hidden = true;
}

$('#btnClosePopup').addEventListener('click', closePopup);
$('#btnPopupOk').addEventListener('click', closePopup);
$('#popupOverlay').addEventListener('click', (e) => {
  if (e.target === $('#popupOverlay')) closePopup();
});

/* ------------------------------------------------------------------ */
/* Camera presets                                                      */
/* ------------------------------------------------------------------ */
$$('[data-view]').forEach((button) => {
  button.addEventListener('click', () => viewer.presetView(button.dataset.view));
});
$('#btnFrameFit').addEventListener('click', () => viewer.fitCurrentView());

/* ------------------------------------------------------------------ */
/* Screenshot / export / settings                                     */
/* ------------------------------------------------------------------ */
function safeName(name, fallback = 'model') {
  return (name || fallback).replace(/\.(glb|gltf)$/i, '').replace(/[^\w\-]+/g, '-');
}

async function takeScreenshot() {
  if (isExporting) return;
  isExporting = true;
  state.shotScale = parseInt($('#shotScale').value, 10) || 2;
  state.shotTransparent = !!$('#shotTransparent').checked;
  showBusy('Rendering screenshot…');
  await new Promise((resolve) => setTimeout(resolve, 60));
  try {
    const dataUrl = viewer.captureImage(state.shotScale, { transparent: state.shotTransparent });
    const blob = await (await fetch(dataUrl)).blob();
    downloadBlob(blob, `screenshot-${timestamp()}.png`);
    toast(`Screenshot saved at ${state.shotScale}×${state.shotTransparent ? ' · transparent' : ''}`, 'ok');
  } catch (error) {
    console.error(error);
    toast('Screenshot failed', 'err');
  } finally {
    hideBusy();
    isExporting = false;
  }
}

$('#btnScreenshot').addEventListener('click', takeScreenshot);
$('#btnShot2').addEventListener('click', takeScreenshot);
$('#shotScale').addEventListener('change', (e) => {
  state.shotScale = parseInt(e.target.value, 10) || 2;
});
$('#shotTransparent').addEventListener('change', (e) => {
  state.shotTransparent = e.target.checked;
});

function updateBakeUI() {
  $('#bakeBadge').textContent = bake.active ? 'Baked' : 'Off';
  $('#btnBake').hidden = bake.active;
  $('#btnBakeRestore').hidden = !bake.active;
  $('#bakeNotice').hidden = !bake.active;
  $('#bakeHint').textContent = bake.active
    ? 'Baked preview is active. Export uses these unlit materials with baked vertex colors.'
    : 'Bakes sun, sky and environment into vertex colors and turns materials unlit. Glass/transmission materials are excluded automatically; large flat surfaces are subdivided first. Preview it here before exporting.';
}

function toggleBake() {
  if (!model.root) {
    toast('Load a model first', 'err');
    return;
  }
  if (bake.active) {
    bake.restore();
    toast('Original materials restored', 'ok');
  } else {
    if (!bakeWarningAccepted) {
      const ok = window.confirm(
        'Lighting bake warning:\n\nThis converts lighting to vertex colors and makes materials unlit. It is intended for distant views / weak mobile devices, not for a final luxury presentation. Glass and transparent materials are excluded automatically. Large flat surfaces are subdivided to capture gradients.\n\nContinue?'
      );
      if (!ok) return;
      bakeWarningAccepted = true;
    }
    const stats = bake.apply();
    toast(
      `Lighting baked · ${formatNumber(stats ? stats.meshes : 0)} meshes${stats && stats.subdivided ? ` · ${stats.subdivided} subdivided` : ''}${stats && stats.glassExcluded ? ` · ${stats.glassExcluded} glass skipped` : ''}${stats ? ` · ${stats.ms} ms` : ''}`,
      'ok'
    );
  }
  updateBakeUI();
  buildMaterialsUI();
}

$('#btnBake').addEventListener('click', toggleBake);
$('#btnBakeRestore').addEventListener('click', toggleBake);

function disposeMarkers(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  });
}

function buildMarkerGroup() {
  if (!hotspots.items.length) return null;
  const group = new THREE.Group();
  group.name = '__hotspot_markers';
  const size = Math.max(viewer.radius * 0.06, 0.04);
  const cameraPos = viewer.camera.position.clone();
  const localToWorld = (item) =>
    hotspots.root ? hotspots.root.localToWorld(new THREE.Vector3().fromArray(item.position)) : new THREE.Vector3().fromArray(item.position);

  for (const item of hotspots.items) {
    const texture = item.texture ? item.texture.clone() : null;
    if (texture) texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      name: `hotspot-${item.id}`,
      map: texture,
      color: texture ? 0xffffff : new THREE.Color(item.color),
      transparent: true,
      alphaTest: 0.02,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const markerSize = size * (item.size || 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(markerSize, markerSize), material);
    mesh.name = `hotspot_${item.label.replace(/[^\w]+/g, '_')}`;
    mesh.position.copy(localToWorld(item));
    mesh.lookAt(cameraPos);
    mesh.userData.hotspot = {
      id: item.id,
      label: item.label,
      position: item.position.slice(),
      color: item.color,
      size: item.size,
      shape: item.shape,
      hoverAnim: item.hoverAnim || 'scale',
      iconEmbedded: !!item.icon,
      alwaysFaceCamera: true,
      action: JSON.parse(JSON.stringify(item.action)),
    };
    group.add(mesh);
  }
  return group;
}

async function exportProject(format) {
  if (isExporting) return;
  if (!model.root) {
    toast('Load a model first', 'err');
    return;
  }

  isExporting = true;
  showBusy(format === 'zip' ? 'Packing project…' : 'Exporting…');
  await detectWebPSupport();

  const includeHotspots = $('#exportHotspots').checked;
  const maxTextureSize = Number($('#exportTextureSize').value) || 0;
  const useMeshopt = $('#exportMeshopt').checked;
  const textureReport = prepareTexturesForExport();
  const textureStatus = $('#textureStatus');
  if (textureStatus) {
    if (!textureReport.total) {
      textureStatus.textContent = 'Textures: none';
    } else if (textureReport.png > 0) {
      textureStatus.textContent = `Textures: ${textureReport.png} as PNG (WebP unsupported in this browser)`;
    } else {
      textureStatus.textContent = `Textures: ${textureReport.webp}/${textureReport.total} WebP${textureReport.converted ? ` · ${textureReport.converted} converted` : ''}`;
    }
    textureStatus.classList.toggle('warn', textureReport.png > 0);
  }
  const markers = includeHotspots ? buildMarkerGroup() : null;
  const groupParent = hotspots.group.parent;
  if (groupParent) groupParent.remove(hotspots.group);

  const settings = buildSettings();
  settings.exportedAt = new Date().toISOString();
  settings.bakedPreview = bake.active;
  model.root.userData.__modelStudio = settings;

  await new Promise((resolve) => setTimeout(resolve, 60));

  const baseName = safeName(model.fileName);
  let outputBlob = null;
  let outputName = '';

  try {
    const exporter = new GLTFExporter();
    const input = markers ? [model.root, markers] : model.root;
    const parseOptions = {
      binary: format !== 'gltf',
      onlyVisible: false,
      embedImages: true,
      includeCustomExtensions: true,
    };
    if (maxTextureSize) parseOptions.maxTextureSize = maxTextureSize;
    const result = await new Promise((resolve, reject) => {
      exporter.parse(input, resolve, reject, parseOptions);
    });

    let exportBytes = null;
    let meshoptInfo = null;
    if (format !== 'gltf') {
      exportBytes = new Uint8Array(await new Blob([result], { type: 'model/gltf-binary' }).arrayBuffer());
      if (useMeshopt) {
        showBusy('Compressing geometry (Meshopt)…');
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
          const compressed = await compressGLB(exportBytes);
          if (compressed.compressed) {
            meshoptInfo = compressed;
            exportBytes = compressed.buffer;
          } else {
            meshoptInfo = { compressed: 0, total: 0, skipped: compressed.skipped || 0 };
          }
        } catch (error) {
          console.error('[ModelStudio] Meshopt compression failed', error);
          meshoptInfo = { error: error.message || String(error) };
          toast('Meshopt compression failed — exporting uncompressed', 'err');
        }
      }
    }

    if (format === 'zip') {
      const settingsBytes = new TextEncoder().encode(JSON.stringify(settings, null, 2));
      const zip = await createZip([
        { name: `${baseName}.glb`, bytes: exportBytes || new Uint8Array(result) },
        { name: 'scene-settings.json', bytes: settingsBytes },
      ]);
      outputBlob = zip;
      outputName = `${baseName}-project.zip`;
      downloadBlob(zip, outputName);
      const compressedNote = meshoptInfo && meshoptInfo.compressed
        ? ` · Meshopt ${meshoptInfo.compressed}/${meshoptInfo.total}`
        : '';
      toast(`Project bundle exported (GLB + settings)${compressedNote}`, 'ok');
    } else if (format === 'gltf') {
      const json = JSON.stringify(result, null, 2);
      outputBlob = new Blob([json], { type: 'model/gltf+json' });
      outputName = `${baseName}-project.gltf`;
      downloadBlob(outputBlob, outputName);
      toast('glTF exported with embedded images and hotspot metadata (no Meshopt)', 'ok');
    } else {
      outputBlob = new Blob([exportBytes || result], { type: 'model/gltf-binary' });
      outputName = `${baseName}-edited.glb`;
      downloadBlob(outputBlob, outputName);
      const compressedNote = meshoptInfo && meshoptInfo.compressed
        ? ` · Meshopt ${meshoptInfo.compressed}/${meshoptInfo.total} buffer views`
        : '';
      toast(`GLB exported with materials and hotspots${compressedNote}`, 'ok');
    }
    window.__lastExport = {
      name: outputName,
      format,
      blob: outputBlob,
      meshopt: meshoptInfo,
      textures: textureReport,
      size: outputBlob ? outputBlob.size : 0,
    };
  } catch (error) {
    console.error(error);
    toast(`Export failed: ${error.message || error}`, 'err');
  } finally {
    delete model.root.userData.__modelStudio;
    if (groupParent) groupParent.add(hotspots.group);
    disposeMarkers(markers);
    hideBusy();
    isExporting = false;
  }
}

let textureFormatSupport = null;

async function detectWebPSupport() {
  if (textureFormatSupport !== null) return textureFormatSupport;
  textureFormatSupport = await new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.toBlob((blob) => resolve(!!blob && blob.type === 'image/webp'), 'image/webp');
  });
  return textureFormatSupport;
}

async function refreshTextureStatus() {
  const status = $('#textureStatus');
  if (!status) return;
  if (!model.root) {
    status.textContent = 'Textures: load a model first';
    status.classList.remove('warn');
    return;
  }
  await detectWebPSupport();
  const report = prepareTexturesForExport({ dryRun: true });
  if (!report.total) {
    status.textContent = 'Textures: none';
  } else if (report.png > 0) {
    status.textContent = `Textures: ${report.png} as PNG (WebP unsupported in this browser)`;
  } else {
    status.textContent = `Textures: ${report.webp}/${report.total} WebP${report.converted ? ` · ${report.converted} will be converted` : ''}`;
  }
  status.classList.toggle('warn', report.png > 0);
}

function prepareTexturesForExport(options = {}) {
  const seen = new Set();
  let total = 0;
  let alreadyWebP = 0;
  const failed = [];

  const visit = (material) => {
    if (!material) return;
    for (const [slot] of TEXTURE_SLOTS) {
      const texture = material[slot];
      if (!texture || seen.has(texture.uuid)) continue;
      seen.add(texture.uuid);
      total++;
      if (texture.userData && texture.userData.mimeType === 'image/webp') {
        alreadyWebP++;
      } else if (textureFormatSupport !== false) {
        if (!options.dryRun) {
          texture.userData = texture.userData || {};
          texture.userData.mimeType = 'image/webp';
        }
      } else {
        if (!options.dryRun) {
          texture.userData = texture.userData || {};
          texture.userData.mimeType = 'image/png';
        }
        failed.push(texture.name || texture.uuid);
      }
    }
  };

  if (model.root) {
    model.root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach(visit);
    });
  }

  const report = {
    total,
    webp: alreadyWebP + (textureFormatSupport !== false ? total - alreadyWebP : 0),
    png: textureFormatSupport === false ? total : 0,
    converted: textureFormatSupport === false ? 0 : total - alreadyWebP,
    unsupported: failed,
  };

  if (options.dryRun) {
    return {
      total,
      webp: alreadyWebP + (textureFormatSupport !== false ? total - alreadyWebP : 0),
      png: textureFormatSupport === false ? total : 0,
      converted: textureFormatSupport === false ? 0 : total - alreadyWebP,
      unsupported: failed,
    };
  }

  if (textureFormatSupport === false) {
    console.warn('[ModelStudio] WebP encoding is not supported by this browser; textures export as PNG.', failed);
    toast(`WebP is not supported by this browser — ${total} textures will export as PNG`, 'err');
  } else if (report.converted) {
    console.info(`[ModelStudio] WebP export prepared: ${report.webp}/${total} textures, ${report.converted} forced.`);
  }

  return report;
}

$('#btnExportGlb').addEventListener('click', async () => {
  await detectWebPSupport();
  await exportProject('glb');
});
$('#btnExportProject').addEventListener('click', async () => {
  await detectWebPSupport();
  await exportProject($('#exportFormat').value);
});

function buildSettings() {
  return {
    app: 'Model Studio',
    version: 1,
    createdAt: new Date().toISOString(),
    model: model.fileName ? { name: model.fileName, stats: { ...model.stats } } : null,
    camera: viewer.getCameraState(),
    environment: {
      intensity: state.env.intensity,
      backgroundIntensity: state.env.backgroundIntensity,
      backgroundBlur: state.env.backgroundBlur,
      rotation: state.env.rotation,
      showBackground: state.env.showBackground,
      backgroundMode: state.env.backgroundMode,
      backgroundColor: state.env.backgroundColor,
      fileName: viewer.envState.fileName || null,
    },
    sun: { ...state.sun },
    display: {
      exposure: state.exposure,
      grid: state.grid,
      autoRotate: state.autoRotate,
      shotScale: state.shotScale,
      shotTransparent: state.shotTransparent,
      toneMapping: state.toneMapping,
      renderScale: state.renderScale,
      fov: state.fov,
      ambient: state.ambient,
      groundShadow: state.groundShadow,
      quality: state.quality,
      fog: { ...state.fog },
    },
    animation: {
      clip: state.animation.clip,
      speed: state.animation.speed,
      playing: state.animation.playing,
    },
    materials: model.getMaterialState(),
    hotspots: hotspots.toJSON(),
  };
}

function saveSettings() {
  const data = buildSettings();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `scene-settings-${timestamp()}.json`);
  toast('Scene settings saved', 'ok');
}

$('#btnSave').addEventListener('click', saveSettings);
$('#btnSave2').addEventListener('click', saveSettings);
$('#btnImport').addEventListener('click', () => $('#settingsInput').click());
$('#btnImport2').addEventListener('click', () => $('#settingsInput').click());
$('#settingsInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await importSettingsFile(file);
});

function applyCameraState(cameraState, animate = true) {
  if (!cameraState || !Array.isArray(cameraState.position) || !Array.isArray(cameraState.target)) return;
  const pos = new THREE.Vector3().fromArray(cameraState.position);
  const target = new THREE.Vector3().fromArray(cameraState.target);
  viewer.flyTo(pos, target, animate ? 900 : 0);
}

async function importSettingsFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await applySettings(data);
    toast('Scene settings imported', 'ok');
  } catch (error) {
    console.error(error);
    toast(`Could not import settings: ${error.message}`, 'err');
  }
}

async function applySettings(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid settings file');
  pending = pending || {};

  if (data.environment) {
    state.env.intensity = Number(data.environment.intensity ?? state.env.intensity);
    state.env.backgroundIntensity = Number(data.environment.backgroundIntensity ?? state.env.backgroundIntensity);
    state.env.backgroundBlur = Number(data.environment.backgroundBlur ?? state.env.backgroundBlur);
    state.env.rotation = Number(data.environment.rotation ?? state.env.rotation);
    state.env.showBackground = data.environment.showBackground !== undefined ? !!data.environment.showBackground : state.env.showBackground;
    if (data.environment.backgroundMode) state.env.backgroundMode = data.environment.backgroundMode;
    if (data.environment.backgroundColor) state.env.backgroundColor = data.environment.backgroundColor;
    viewer.applyEnvironment(state.env);
    syncEnvUI();
    if (data.environment.fileName && data.environment.fileName !== viewer.envState.fileName) {
      toast(`Re-upload “${data.environment.fileName}” to restore the HDRI`, '');
    }
  }

  if (data.sun) {
    Object.assign(state.sun, data.sun);
    state.sun.quality = Number(state.sun.quality) || 2048;
    state.sun.softness = Number(state.sun.softness) || 0;
    viewer.applySunState(state.sun);
    syncSunUI();
  }

  if (data.display) {
    if (data.display.exposure !== undefined) {
      state.exposure = Number(data.display.exposure);
      $('#exposure').value = state.exposure;
      $('#exposureOut').textContent = state.exposure.toFixed(2);
      viewer.setExposure(state.exposure);
    }
    if (data.display.grid !== undefined) {
      state.grid = !!data.display.grid;
      $('#toggleGrid').checked = state.grid;
      viewer.setGroundVisible(state.grid);
    }
    if (data.display.autoRotate !== undefined) {
      state.autoRotate = !!data.display.autoRotate;
      $('#toggleAutoRotate').checked = state.autoRotate;
      viewer.setAutoRotate(state.autoRotate);
    }
    if (data.display.shotScale) {
      state.shotScale = Number(data.display.shotScale) || 2;
      $('#shotScale').value = String(state.shotScale);
    }
    if (data.display.shotTransparent !== undefined) {
      state.shotTransparent = !!data.display.shotTransparent;
      $('#shotTransparent').checked = state.shotTransparent;
    }
    if (data.display.toneMapping) {
      state.toneMapping = data.display.toneMapping;
      $('#toneMapping').value = state.toneMapping;
      viewer.setToneMapping(state.toneMapping);
    }
    if (data.display.renderScale !== undefined) {
      state.renderScale = Number(data.display.renderScale) || 1;
      $('#renderScale').value = String(state.renderScale);
      $('#renderScaleOut').textContent = `${state.renderScale.toFixed(2)}×`;
      viewer.setRenderScale(state.renderScale);
    }
    if (data.display.fov !== undefined) {
      state.fov = Number(data.display.fov) || 45;
      $('#cameraFov').value = String(state.fov);
      $('#cameraFovOut').textContent = `${Math.round(state.fov)}°`;
      viewer.setFov(state.fov);
    }
    if (data.display.ambient !== undefined) {
      state.ambient = Number(data.display.ambient);
      $('#ambientIntensity').value = String(state.ambient);
      $('#ambientOut').textContent = state.ambient.toFixed(2);
      viewer.setHemisphereIntensity(state.ambient);
    }
    if (data.display.groundShadow !== undefined) {
      state.groundShadow = Number(data.display.groundShadow);
      $('#groundShadow').value = String(state.groundShadow);
      $('#groundShadowOut').textContent = state.groundShadow.toFixed(2);
      viewer.setGroundShadowOpacity(state.groundShadow);
    }
    if (data.display.quality) {
      state.quality = data.display.quality === 'mobile' ? 'mobile' : 'desktop';
      viewer.setPixelRatioCap(state.quality === 'mobile' ? 1 : 2);
      model.setQualityProfile(state.quality);
      syncQualityUI();
    }
    if (data.display.fog) {
      state.fog = { ...state.fog, ...data.display.fog };
      syncFogUI();
      applyFog();
    }
  }

  if (data.camera) {
    if (model.root) applyCameraState(data.camera, true);
    else pending.camera = data.camera;
  }

  if (Array.isArray(data.materials) && data.materials.length) {
    if (model.root) {
      await model.applyMaterialState(data.materials);
      buildMaterialsUI();
    } else {
      pending.materials = data.materials;
    }
  }

  if (Array.isArray(data.hotspots)) {
    if (model.root) {
      hotspots.loadState(data.hotspots);
      renderHotspotLists();
      renderHotspotEditor();
    } else {
      pending.hotspots = data.hotspots;
    }
  }

  if (data.animation) {
    if (viewer.animClips.length) applyAnimationState(data.animation);
    else pending.animation = data.animation;
  }

  if (model.root) pending = null;
  else if (!pending.materials && !pending.hotspots && !pending.camera && !pending.animation) pending = null;
}

/* ------------------------------------------------------------------ */
/* File drag & drop                                                    */
/* ------------------------------------------------------------------ */
function hasFiles(event) {
  const dt = event.dataTransfer;
  if (!dt) return false;
  return Array.from(dt.types || []).includes('Files');
}

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  $('#dropOverlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('#dropOverlay').hidden = true;
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  const files = Array.from(event.dataTransfer.files || []);
  if (files.length) handleDroppedFiles(files);
});

async function handleDroppedFiles(files) {
  const json = files.find((f) => /\.json$/i.test(f.name));
  const hdri = files.find((f) => /\.(hdr|exr)$/i.test(f.name));
  const modelFiles = files.filter((f) => !/\.(json|hdr|exr)$/i.test(f.name));
  const hasModel = modelFiles.some((f) => /\.(glb|gltf)$/i.test(f.name));

  if (hasModel) await loadModelFiles(modelFiles);
  if (hdri) await loadEnvironment(hdri);
  if (json) await importSettingsFile(json);
  if (!hasModel && !hdri && !json) {
    toast('No .glb, .gltf, .hdr, .exr or .json found in the drop', 'err');
  }
}

/* ------------------------------------------------------------------ */
/* Fullscreen, keyboard, help                                          */
/* ------------------------------------------------------------------ */
$('#btnFullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});

window.addEventListener('keydown', (event) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);

  if (event.key === 'Escape') {
    if (!$('#popupOverlay').hidden) closePopup();
    else if (hotspots.placing) hotspots.setPlacing(false);
    else if (pickingObject) setPickingObject(false);
    else if (pickingMaterial) setPickingMaterial(false);
    return;
  }

  if (typing) return;

  if ((event.key === 'Delete' || event.key === 'Backspace') && hotspots.selectedId) {
    event.preventDefault();
    hotspots.deleteSelected();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObject && $('#tab-objects').classList.contains('active')) {
    event.preventDefault();
    deleteObject(selectedObject);
  } else if (event.key === 'f' || event.key === 'F') {
    viewer.presetView('iso');
  } else if (event.key === 'g' || event.key === 'G') {
    state.grid = !state.grid;
    $('#toggleGrid').checked = state.grid;
    viewer.setGroundVisible(state.grid);
  } else if (event.key === 'r' || event.key === 'R') {
    state.autoRotate = !state.autoRotate;
    $('#toggleAutoRotate').checked = state.autoRotate;
    viewer.setAutoRotate(state.autoRotate);
  } else if (event.code === 'Space' && tag !== 'BUTTON') {
    if (!viewer.animClips.length) return;
    event.preventDefault();
    if (!viewer.animAction) {
      const clip = viewer.playAnimation(parseInt($('#animClip').value, 10) || 0);
      if (clip) state.animation.clip = clip.name || '';
      state.animation.playing = true;
    } else {
      state.animation.playing = viewer.toggleAnimation();
    }
    $('#btnAnimPlay').textContent = state.animation.playing ? 'Pause' : 'Play';
  }
});

/* ------------------------------------------------------------------ */
/* Initialize                                                          */
/* ------------------------------------------------------------------ */
syncEnvUI();
syncSunUI();
$('#exposureOut').textContent = Number(state.exposure).toFixed(2);
$('#shotScale').value = String(state.shotScale);
$('#shotTransparent').checked = state.shotTransparent;
$('#toneMapping').value = state.toneMapping;
viewer.setToneMapping(state.toneMapping);
$('#renderScale').value = String(state.renderScale);
$('#renderScaleOut').textContent = `${state.renderScale.toFixed(2)}×`;
viewer.setRenderScale(state.renderScale);
$('#cameraFov').value = String(state.fov);
$('#cameraFovOut').textContent = `${Math.round(state.fov)}°`;
viewer.setFov(state.fov);
$('#ambientIntensity').value = String(state.ambient);
$('#ambientOut').textContent = state.ambient.toFixed(2);
viewer.setHemisphereIntensity(state.ambient);
$('#groundShadow').value = String(state.groundShadow);
$('#groundShadowOut').textContent = state.groundShadow.toFixed(2);
viewer.setGroundShadowOpacity(state.groundShadow);
syncQualityUI();
syncFogUI();
applyFog();
updateBakeUI();
$('#materialEmpty').textContent = 'Load a model to edit its materials.';
$('#hotspotEmpty').textContent = 'No hotspots yet.';
buildMaterialsUI();
renderHotspotLists();
renderHotspotEditor();
refreshObjectList();
updateObjectInspector();
updateAnimationUI();
applyEnv();
viewer.setGroundVisible(state.grid);
viewer.setAutoRotate(state.autoRotate);
viewer.setExposure(state.exposure);

window.__studio = { viewer, model, hotspots, state, bake, exportProject, transform, selectObject, refreshObjectList };
