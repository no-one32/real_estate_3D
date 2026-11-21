# FULL REPORT — 3D Project: Verge3D → Optimized GLB → Three.js Viewer

**Report date:** 2026-11-20  
**Primary model:** `C:\Users\NEJMA\3D Objects\TEST\1 A TEST V2.glb`  
**Active viewer:** `C:\Users\NEJMA\3D Objects\TEST\viewer\`  
**Live local URL:** `http://127.0.0.1:8015/viewer/`  
**LAN URLs:** `http://192.168.1.19:8015/viewer/` · `http://192.168.137.1:8015/viewer/`

> This report consolidates four earlier session documents found in `C:\Users\NEJMA\Downloads\md\`
> (`FINAL-GLB.md`, `HOW-3D-PROJECT-WAS-MADE.md`, `session-ses_e356.md`, `ZZZZf9.md`) with the
> current state of the project.

---

## 0. Executive summary (Arabic / ملخص)

- بدأنا بمشروع **Verge3D** (فيلا + خريطة 3D حولها)، وعدّلنا الإضاءة والضباب والظلال وجودة الهاتف.
- ثم انتقلنا إلى **Three.js مباشرة** لعرض ملف GLB بدون Verge3D، مع نفس إعدادات الجودة المتفق عليها.
- اكتشفنا أن الأسود المتقطّع في زوايا معيّنة **ليس مشكلة كاميرا**، بل/importer دفع قيمة خاطئة
  `anisotropyStrength = 1.333` (أكبر من 1) لكل الخامات. تم تعطيلها عند التحميل.
- تم إصلاح تداخل الأسطح (z-fighting) باستخدام `logarithmicDepthBuffer` مع `near/far` مضبوطين.
- تم استبدال الموديل الافتراضي بـ **`1 A TEST V2.glb`** الأسرع: **153.9 MB / 3.14M مثلث**
  بدل **201 MB / ~6.3M مثلث**.
- أضفنا **شريط تحريك الشمس** من الشروق (06:00) إلى الغروب (18:00) مع تغيير اللون والقوة والظلال.
- أصلحنا ظلال الهاتف: خطوط/ACNE اختفت، الدقة تحسّنت، واللاق قلّ (PCF + إطار ظل ديناميكي + تقليل DPR تلقائي).
- النسخة الحية تعمل الآن على `http://127.0.0.1:8015/viewer/` — اعمل **Ctrl + F5**.

---

## 1. Project history / timeline

### Phase 1 — Verge3D app (`my_awesome_app`)
- Stack: **Verge3D 4.13.0** (Blender export), WebGL 2, plain JS, Python + Pillow, Node static server.
- Scene: ~1,450 meshes; big textures; two HDR environment maps.
- Surrounding 3D map loaded separately: `map3d.glb` (~71 MB, 7 meshes).
- Quality target: make it look like the reference **Novoross** scene (AgX tone mapping, soft light fog,
  CSM shadows, physically-correct lights, PMREM environment).

### Phase 2 — Compression for web / phone
- Verge3D loader **rejects Draco and Meshopt** → used **LZMA (`.xz`)** instead.
- Split GLB → `.gltf` + `.bin` + external textures, compressed geometry.
- Generated WebP mobile texture variants (1024 px project / 2048 px map, quality 85).
- Result: original ~253 MiB → **66.08 MiB desktop / 46.05 MiB mobile** (~5.5× smaller).
- Served via a Node static server with correct MIME types and immutable caching for assets.

### Phase 3 — Move away from Verge3D to a pure Three.js GLB viewer
- Built `viewer/index.html` + `viewer/app.js` using Three.js r169 from jsDelivr.
- Agreed quality profile: light fog, AgX, mobile DPR 1 / no transmission / anisotropy 2,
  desktop DPR 1.5 / transmission / anisotropy 8.
- Added orientation-aware framing: the built area is detected, centered and normalized to radius 100.
- Added camera reset, fullscreen, loading progress and Arabic UI.

### Phase 4 — Current state (V2 + sun + shadows)
- Default model switched from `TEST.glb` to **`1 A TEST V2.glb`** (user-supplied optimized copy).
- Added a **sun slider** (sunrise → sunset) and time-driven light/fog/sky colors.
- Reworked shadows for clean, fast phone rendering.
- Live server moved to port **8015**.

---

## 2. Assets on disk

| File | Size / detail | Role |
|---|---|---|
| `C:\Users\NEJMA\3D Objects\TEST\1 A TEST V2.glb` | **161,372,668 B (153.90 MB)** | **Current default model** |
| `C:\Users\NEJMA\3D Objects\TEST\TEST.glb` | ~201 MB, ~6.3M tris | Previous model (still available via `?model=`) |
| `C:\Users\NEJMA\3D Objects\TEST\VVV.glb`, `VVV-world.glb` | — | Other source variants |
| `C:\Users\NEJMA\3D Objects\TEST\viewer\index.html` | ~7.2 KB | Viewer shell + sun slider UI, `app.js?v=8` |
| `C:\Users\NEJMA\3D Objects\TEST\viewer\app.js` | ~559 lines | All rendering logic |
| `C:\Users\NEJMA\3D Objects\TEST\viewer\sky.hdr` | — | HDR sky/environment (falls back to gradient) |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\vvv-server.js` | — | Static server on `0.0.0.0:8015` |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\verify.js` | — | Headless CDP verification + screenshots |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\acne.js` | — | Low-sun shadow stress test |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\fps.js` | — | FPS / renderer stats probe |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\inspect-v2.js` | — | GLB structure audit |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\launch-edge.ps1` | — | Headless Edge CDP launcher (port 9334) |
| `C:\Users\NEJMA\AppData\Local\Temp\opencode\open-link.ps1` | — | Opens the viewer in the default browser |

### V2 GLB audit (from `inspect-v2.js`)

```
size                 161372668 bytes (153.90 MB)
magic/version        glTF 2
generator            glTF-Transform v4.4.2
nodes / meshes       104 / 104
materials            94
images / textures    57 / 57 (all image/webp)
accessors            390
extensionsUsed       EXT_texture_webp, KHR_materials_anisotropy,
                     KHR_materials_emissive_strength, KHR_materials_ior,
                     KHR_materials_sheen, KHR_materials_transmission,
                     KHR_texture_transform
extensionsRequired   EXT_texture_webp, KHR_texture_transform
materials w/ anisotropy  80 (all value 1.333 — invalid, neutralized at load)
triangles            3,140,845
vertices             4,544,278
```

> V2 is a genuine optimization of the same scene: **−47 MB** and **~50% fewer triangles**.
> The original file is left untouched; the fixes are applied in the viewer at load time.

---

## 3. Current viewer architecture

```
index.html (RTL Arabic UI)
 ├─ importmap → three@0.169.0 (jsDelivr)
 ├─ loader overlay, reset/fullscreen buttons
 ├─ sun slider panel (#sunRange / #sunTime)
 └─ app.js?v=8
      ├─ device detection + query overrides
      ├─ WebGLRenderer (AgX, log depth, PCF/PCFSoft)
      ├─ Scene + gradient sky + HDR sky + exponential fog
      ├─ PerspectiveCamera + OrbitControls
      ├─ Sun (time-driven) + HemisphereLight + PMREM environment
      ├─ GLTFLoader → 1 A TEST V2.glb → normalize → fix materials
      ├─ dynamic shadow frustum
      ├─ UI handlers (reset, fullscreen, sun slider)
      └─ render loop + adaptive DPR
```

### 3.1 Quality profile (agreed settings)

| Setting | Desktop | Mobile |
|---|---|---|
| DPR (max) | 1.5 | **1.0** (adaptive floor 0.8) |
| Antialias | on | off |
| Anisotropy | 8 | **2** |
| Transmission | on | **off** (glass becomes translucent basic) |
| Shadow map | 2048 | **1024** |
| Shadow filter | PCFSoft | **PCF** |
| Shadow radius | 1.6 | 1.6 (frustum-driven bias) |
| Logarithmic depth | on | on |
| Tone mapping | AgX | AgX |
| Exposure | 1.08 | 1.08 |
| Fog | `FogExp2(0xc2d2e2, 0.00055)` tinted by time | same |

### 3.2 Query flags

| Flag | Effect |
|---|---|
| `?mobile=1` | Force mobile profile (for testing on desktop) |
| `?shadows=0` / `?shadows=1` | Disable / force shadows |
| `?trans=0` / `?trans=1` | Force transmission off / on |
| `?logdepth=0` | Disable logarithmic depth buffer |
| `?model=...` | Load a different GLB (URL-encoded) |

---

## 4. Bugs found and fixed (root-cause analysis)

### 4.1 Black / disappearing surfaces at certain camera angles
- **Symptom:** half the building black, normal from another angle; thought to be camera or z-fighting.
- **Root cause:** exporter stamped `KHR_materials_anisotropy` with `anisotropyStrength = 1.333`
  (spec max is 1) on **80 of 94 materials**, plus black `sheen` and `ior = 1.6`.
- **Fix in `app.js` at load:**

```js
if (mat.anisotropy) { mat.anisotropy = 0; mat.anisotropyRotation = 0; }
if (mat.sheen) { mat.sheen = 0; if (mat.sheenColor) mat.sheenColor.setRGB(0,0,0); }
if (mat.ior && mat.ior !== 1.5) mat.ior = 1.5;
mat.needsUpdate = true;
```

- **A/B proof:** before fix → black roofs/parapets; after → roofs normal and trees green again.

### 4.2 Z-fighting / overlapping half-shown models
- **Fix:** keep `logarithmicDepthBuffer: true` and set camera `near/far` from the fitted scene:

```js
camera.near = Math.max(distance / 4000, 0.5);
camera.far  = Math.max(distance * 20, 15000);
```

- This preserves precision for the very large source coordinates (GLB bounds ≈ 4.6M × 5.2M units)
  after normalization to a 100-unit scene.

### 4.3 Phone shadows: stripes/acne, bad resolution, lag
Four combined fixes:

1. **Cheaper filter:** `PCFShadowMap` on mobile instead of `PCFSoftShadowMap`.
2. **Tight dynamic frustum** around the orbit target:

```js
const R = clamp(ceil((dist * 0.95) / 16) * 16, 16, 160);  // quantized: no "breathing"
const lightDist = max(R * 2.5, 260);
sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
sc.near = max(1, lightDist - R * 2.2);
sc.far  = lightDist + R * 2.2 + 60;
```

3. **Bias derived from one shadow texel in world units:**

```js
const texel = (2 * R) / sun.shadow.mapSize.x;
sun.shadow.normalBias = max(0.03, texel * 1.4);
sun.shadow.bias = -0.00006;
```

4. **Exclude huge terrain from casting** (it still receives shadows):

```js
const hugeDiag = totalDiag * normScale * 0.25;
obj.castShadow = ENABLE_SHADOWS && !isHuge;
```

5. **Adaptive DPR:** if FPS < 28 (mobile) / 35 (desktop) for 4 s, reduce DPR by 0.15 down to 0.8 / 1.

- **Stress test result** (close mobile view, low sun):
  `map [1024,1024]`, `bias -0.00006`, `normalBias 0.0437`,
  `bounds [-16,16,16,-16]`, `near 224.8`, `far 355.2`, `type 1`, no exceptions, no stripes.

### 4.4 Verge3D fog hiding the whole scene (historical)
- In the old Verge3D app, copying Novoross fog density `7e-5` into a scene whose camera is ~67,000
  units away caused full fog occlusion (only sky visible).
- Fixed by scaling density to `8e-6` for that scene's unit scale. The current Three.js viewer uses
  a much lighter `0.00055` with a normalized 100-unit scene.

---

## 5. Sun / time-of-day control

### UI
- `#sunpanel` fixed top-right (Arabic tooltip `موضع الشمس`), `☀` icon, range `0..1000`, time label.
- Mobile: narrower slider (92 px); fades in with `body.ready`.

### Mapping
| Slider | Time | Sun position | Color | Character |
|---:|---|---|---|---|
| 0 | 06:00 | East, elevation ≈ 4° | `#ff6f2c` | sunrise, long shadows |
| 380 (default) | 10:34 | South-east, elevation ≈ 68° | near noon | default |
| 500 | 12:00 | South, elevation ≈ 74° | `#fff7ea` | noon, shortest shadows |
| 1000 | 18:00 | West, elevation ≈ 4° | `#ff6f2c` | sunset, long shadows |

### Implementation
- `sunDirectionFromTime(t)`: elevation = `4° + 70°·sin(πt)`, azimuth = `πt` (east → south → west).
- `applySun(t)` also drives sun intensity, hemisphere fill, environment intensity, background intensity
  and fog color (`DUSK_FOG → DAY_FOG`).
- `updateShadowFrustum(true)` is called on every slider change so the shadow camera follows the new sun.
- HDR load callback calls `applySun(SUN.t, true)` again so swapping the background does not reset ambience.

### Verified sun states (headless)
```
SUN sunrise time=06:00 color=#ff6f2c intensity=1.2 pos=[259.4, 18.8, 0]
SUN noon     time=12:00 color=#fff7ea intensity≈5.8 pos near [0, high, 260]
SUN sunset   time=18:00 color=#ff6f2c intensity=1.2 pos=[-259.4, 18.8, 0]
```

---

## 6. Verification results

### 6.1 Load — desktop and mobile

```
DESKTOP  mats=104 aniso=0 sheen=0 isMobile=false shadows=true transmission=true  loadMs≈746
MOBILE   mats=104 aniso=0 sheen=0 isMobile=true  shadows=true transmission=false loadMs≈751
```

No console exceptions. Both V2 and the old model load correctly.

### 6.2 Geometry / render stats (`fps.js`)

```
DESKTOP  fps 165.0  triangles 6,281,714  calls 210  textures 65  geometries 129  dpr 1
MOBILE   fps 164.5  triangles 3,214,703  calls 108  textures 63  geometries 129  dpr 1
```

> Reported triangles include the shadow pass (roughly 2× the 3.14M scene triangles on desktop).
> Headless FPS is not representative of a real phone, but the reduction in draw calls is real.

### 6.3 Visual checks
- `v2-home.png`, `v2-closeA.png`, `v2-closeB.png`, `v2-grazing.png`: no black roofs after fix.
- `v2m-*.png`: mobile profile, clean shadows at portrait 390×844.
- `acne-80/150/850/920.png`: clean at low sun angles (06:48 / 07:48 / 16:48 / 17:48).
- Remaining pure-black pixels at some close angles are the window glass material
  (`Material #26`, `baseColorFactor [0,0,0,1]`, `KHR_materials_transmission 0.709`,
  mesh `GLASSES`) — intentional, not the fixed defect.

### 6.4 URL availability
```
200  7183       http://127.0.0.1:8015/viewer/
200  161372668  http://127.0.0.1:8015/1%20A%20TEST%20V2.glb
```

---

## 7. How to run / maintain

### Start the server (if port 8015 is dead)
```bat
node C:\Users\NEJMA\AppData\Local\Temp\opencode\vvv-server.js
```

### Restart headless Edge for verification (if CDP 9334 is dead)
```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\NEJMA\AppData\Local\Temp\opencode\launch-edge.ps1
```

### Run checks
```bat
cd C:\Users\NEJMA\AppData\Local\Temp\opencode
node check-url.js
node verify.js
node acne.js
node fps.js
node inspect-v2.js
```

### Open the viewer
```bat
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\NEJMA\AppData\Local\Temp\opencode\open-link.ps1
```

> After code changes, bump the cache-busting query in `index.html`
> (`app.js?v=8` → `v=9`, etc.) and hard-refresh with **Ctrl + F5**.

---

## 8. Known limitations / possible next steps

1. **Real-phone performance is unmeasured.** Headless FPS is high, but the 153.9 MB GLB and
   57 WebP textures are still a heavy first download on mobile data.
2. **No night cycle.** Slider is sunrise → sunset only (06:00–18:00). Extending into dusk/night
   requires new color/intensity curves in `applySun`.
3. **Junk PBR extensions remain inside V2.** The viewer neutralizes them at runtime; baking a
   cleaned copy of the GLB (remove `KHR_materials_anisotropy`, `sheen`, bad `ior`) would make the
   file behave correctly in other viewers too.
4. **Glass is black at some angles** because its base color is literally `[0,0,0]`. Could be changed
   in a patched GLB if desired.
5. **`?shadows=0`** is available as an emergency fallback if a specific phone still lags.
6. **Old Verge3D assets remain on disk** (`.gltf.xz`, `.bin.xz`, `map3d*`, WebP variants) but are no
   longer used by the current viewer.
7. **LAN URLs require the phone and PC on the same network.** No public internet deployment exists
   yet; an earlier request for an online link was never completed.

---

## 9. Rebuild checklist (current Three.js viewer)

1. Keep `1 A TEST V2.glb` next to the `TEST` folder root (or pass `?model=`).
2. Verify `viewer/index.html` points to the desired `app.js?v=N`.
3. Verify `MODEL_URL` in `app.js` is `../1%20A%20TEST%20V2.glb`.
4. Ensure `logarithmicDepthBuffer`, material neutralization, and `updateShadowFrustum()` are present.
5. Ensure `#sunRange` exists in HTML and its listener calls `applySun(value / 1000, true)`.
6. Start server on 8015, run `check-url.js`, `verify.js`, `acne.js`, `fps.js`.
7. Open `http://127.0.0.1:8015/viewer/` and hard-refresh.

---

## 10. Source documents consulted

- `C:\Users\NEJMA\Downloads\md\FINAL-GLB.md` — Verge3D mobile-quality iteration, fog/shadow tuning,
  CSM settings, final glTF patch, live link `8010`.
- `C:\Users\NEJMA\Downloads\md\HOW-3D-PROJECT-WAS-MADE.md` — full compression pipeline, WebP mobile
  variants, static server, verification numbers (66.08 / 46.05 MiB), rebuild checklist.
- `C:\Users\NEJMA\Downloads\md\session-ses_e356.md` — early CDP harness, camera/fog investigation,
  discovered the unit-scale fog problem.
- `C:\Users\NEJMA\Downloads\md\ZZZZf9.md` — transition from Verge3D to a plain-GLB Three.js viewer,
  request for an online lightweight link, map/GLB follow-ups.

## 11. Phase 5 — Project organized into `D:\Axis Studio\webgl` (2026-11-20)

The Model Studio website and the latest 3D model were consolidated into one clean folder.

### Structure
```
D:\Axis Studio\webgl\
├── index.html
├── package.json / package-lock.json / vite.config.js
├── src\                 (main, viewer, model, bake, hotspots, meshopt-export, zip, style)
├── public\
│   ├── basis\ draco\ environments\
│   └── models\1 A TEST V2.glb
├── docs\                (FULL-REPORT, MODEL-STUDIO-REPORT, SESSION-STATE, HOW-3D-PROJECT-WAS-MADE)
├── node_modules\        (pre-installed)
├── dist\                (production build, includes the model)
├── README.md
└── .gitignore
```

### Changes made during the move
1. **`Latest` button** in the Model dropzone → downloads and loads `public/models/1 A TEST V2.glb`
   with a real progress bar, then goes through the normal load/prepare pipeline.
2. **Material neutralization in `src/model.js`** — same fix as the Three.js viewer:
   `anisotropy = 0`, `sheen = 0`, `ior = 1.5`, applied before originals are captured so Reset
   also restores the neutral state.
3. **Camera focus fix in `src/viewer.js`** — `computeFocusBox()` lower guard changed from
   `2%` to `0.5%` of the total diagonal. This model's built area is ~1.4% of the total scene
   (the rest is terrain), so the old guard fell back to the whole terrain and the villa complex
   appeared tiny. Now the camera frames the built area.

### Verification
- Dev: `http://127.0.0.1:5173/` — Latest loads in ~0.6 s (local), 3,140,845 triangles,
  104 meshes, 94 materials, `anisotropy > 0 = 0`, `sheen > 0 = 0`, `ior ≠ 1.5 = 0`.
- Production: `npm run build` + `npm run preview -- --port 4173` — same result,
  screenshot confirms the villa complex, lake, trees and surrounding city are visible.
- The 154 MB model is served with HTTP 200 and `content-length: 161372668` from both dev
  and preview servers.

**End of report.**
