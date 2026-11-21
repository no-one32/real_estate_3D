# FINAL — Axis Studio · WebGL / Model Studio

**Project:** Axis Studio — Model Studio (Vite + Three.js)
**Location:** `D:\Axis Studio\webgl`
**Bundled model:** `public/models/1 A TEST V2.glb` (153.90 MB)
**Status:** Working — verified on dev and production build
**Last updated:** 2026-11-20

---

## 1. What this project is

A single, self-contained WebGL studio that:

- loads large GLB/GLTF models in the browser (drag & drop, file picker, or the **Latest** button),
- renders them with a tuned Three.js pipeline (AgX tone mapping, light fog, HDR environments),
- lets you edit materials, bake lighting into vertex colors, place hotspots, and export the
  whole project as a ZIP,
- ships with a mobile quality profile (DPR 1, no transmission, anisotropy 2) while desktop keeps
  the full profile (DPR 1.5, transmission, anisotropy 8),
- includes a sun / time-of-day control (sunrise → sunset) with clean, fast phone shadows.

The current model — `1 A TEST V2.glb` — is a villa complex inside a large terrain. The viewer is
configured to frame the **built area**, not the empty surrounding terrain.

---

## 2. Structure

```
D:\Axis Studio\webgl\
├── index.html                  Model Studio UI
├── package.json                scripts & dependencies
├── package-lock.json
├── vite.config.js
├── serve-viewer.cjs            standalone viewer static server (port 8015)
├── FINAL.md                    ← this file
├── README.md                   Arabic quick guide
├── src\
│   ├── main.js                 UI, loading, export, "Latest" button
│   ├── viewer.js               Three.js renderer / camera / lights
│   ├── model.js                GLB loading & material preparation
│   ├── bake.js                 lighting bake (vertex colors)
│   ├── hotspots.js             hotspots & markers
│   ├── meshopt-export.js       Meshopt compression on export
│   ├── zip.js                  ZIP packaging
│   └── style.css
├── public\
│   ├── basis\                  KTX2 / Basis transcoder
│   ├── draco\                  Draco decoder
│   ├── environments\           ready-made HDR environments
│   ├── viewer\                 ← standalone 3D viewer source
│   │   ├── index.html          UI + import map
│   │   ├── app.js              Three.js viewer (sun slider, profiles)
│   │   └── sky.hdr             HDR sky
│   └── models\
│       └── 1 A TEST V2.glb     ← latest model
├── docs\                       full documentation set
├── node_modules\               pre-installed (ready to run)
├── dist\                       production build (includes the model)
└── .gitignore
```

---

## 3. Quick start

### Development
```bat
cd /d "D:\Axis Studio\webgl"
npm run dev -- --host 0.0.0.0
```
Open: <http://127.0.0.1:5173/>

### Production
```bat
cd /d "D:\Axis Studio\webgl"
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```
Open: <http://127.0.0.1:4173/>

### From a phone on the same network
Use the machine IP, for example `http://192.168.1.19:5173/` (dev) or
`http://192.168.1.19:4173/` (preview). Allow the port through the firewall.

> `node_modules` is already installed — no `npm install` needed.

---

## 4. Loading the latest model

- In the **Model** panel press **Latest** next to **Browse**.
- The site downloads `public/models/1 A TEST V2.glb` with a real progress bar, then runs it
  through the normal load/prepare pipeline.
- Dragging and dropping the file onto the page works the same way.

### Model specifications

| | |
|---|---|
| File | `1 A TEST V2.glb` |
| Size | **153.90 MB** (161,372,668 bytes) |
| Triangles | **3,140,845** |
| Vertices | 4,544,278 |
| Meshes / Nodes | 104 / 104 |
| Materials | 94 |
| Textures | 57 (WebP) |
| Exporter | glTF-Transform v4.4.2 |

---

## 5. Key fixes and features

| # | Item | Where | Why it matters |
|---|------|-------|----------------|
| 1 | Material neutralization | `src/model.js` | The model carries `KHR_materials_anisotropy: 1.333` on 80 materials (invalid — max is 1), plus black sheen and non-default IOR. These are reset at load (`anisotropy = 0`, `sheen = 0`, `ior = 1.5`), which removes the black surfaces seen from certain angles. Applied before originals are captured, so **Reset** restores the neutral state too. |
| 2 | Camera focus fix | `src/viewer.js` → `computeFocusBox()` | The built area is only ~1.4% of the total scene diagonal (the rest is terrain). The old lower guard (2%) fell back to the whole terrain and the villas looked tiny. Lowered to 0.5% so the camera frames the built area. |
| 3 | **Latest** button | `index.html`, `src/main.js`, `src/style.css` | One-click load of the bundled model with download progress. |
| 4 | Quality profiles | `src/viewer.js` | Mobile: DPR 1, no transmission, anisotropy 2. Desktop: DPR 1.5, transmission, anisotropy 8. |
| 5 | Sun / time-of-day | viewer | Sunrise → sunset slider driving the directional light and shadows. |
| 6 | Phone shadows | viewer | Clean and fast: tight shadow camera, tuned bias/normal bias, no terrain acne. |

### Verification results

```
3,140,845 triangles · 104 meshes · 94 materials
anisotropy > 0 : 0
sheen > 0      : 0
ior ≠ 1.5      : 0
load time      : ~0.6 s (local)
HTTP           : 200 · content-length 161,372,668 (dev + preview)
```

Tested on:
- **Dev** — `http://127.0.0.1:5173/`
- **Production preview** — `http://127.0.0.1:4173/`

Both load the model, render the villa complex, lake, trees and surrounding city with no black
surfaces.

---

## 6. Reports / documentation

- `docs/FULL-REPORT.md` — comprehensive report covering every project stage
  (Verge3D → optimized GLB → Three.js → V2, plus Phase 5: project organization).
- `docs/MODEL-STUDIO-REPORT.md` — Model Studio features: material picker, bake, hotspots,
  full project export, verification.
- `docs/SESSION-STATE.md` — technical state of the previous session and the performance
  improvements made.
- `docs/HOW-3D-PROJECT-WAS-MADE.md` — how the original project was rebuilt and compressed
  (architecture, mobile profile, compression pipeline, WebP textures, static server,
  rebuild checklist).

---

## 7. Notes

- **Do not delete `node_modules`** unless you intend to reinstall with `npm install`.
- The model lives in `public/models` so Vite serves it directly in dev and copies it into `dist`
  on build.
- `dist` is large (~160 MB) because it contains the model — this is expected.
- After editing `src`, Vite hot-reloads; refresh the page if needed.
- The **Latest** button feeds the model in as a `File`, so it follows the exact same
  load/prepare path as a manual upload.
- The original model at `C:\Users\NEJMA\3D Objects\TEST\1 A TEST V2.glb` was not modified —
  the project holds a copy.

---

## 8. Adding a new 3D model later

Because the fixes live in the app (not in the file), a new model inherits them automatically:
material neutralization, shadow setup, sun control and the mobile profile.

Per-model tuning that may still be needed:

1. **Camera focus** — confirm `computeFocusBox()` frames the intended area (adjust the ratio
   guard if the built area is a very different fraction of the scene).
2. **Terrain exclusion** — make sure huge ground meshes don't cause shadow acne and are excluded
   from shadow casting/receiving where appropriate.
3. **Scale and fog** — fog strength and light distances may need adjusting depending on whether
   the model is authored in centimeters or meters.

Then rebuild and re-verify with the checklist in `docs/FULL-REPORT.md` §9.

---

## 9. Standalone 3D viewer (added 2026-11-20)

The simple viewer — the one with the sun/time slider, **not** Model Studio — has been moved into
this project as well, so **all source code is now in `D:\Axis Studio\webgl`**.

### Source

```
public\viewer\
├── index.html      UI, import map (Three.js 0.169 via CDN)
├── app.js          renderer, camera, materials, sun control
└── sky.hdr         HDR environment
serve-viewer.cjs    static server rooted at public/ (port 8015)
```

`app.js` loads the model from `/models/1 A TEST V2.glb` — the same bundled file used by Model
Studio — so there is only one copy of the 154 MB model on disk.

### Run it

```bat
cd /d "D:\Axis Studio\webgl"
node serve-viewer.cjs
```

| Entry point | URL |
|---|---|
| Standalone viewer (port 8015) | <http://127.0.0.1:8015/viewer/> |
| Vite dev | <http://127.0.0.1:5173/viewer/index.html> |
| Vite production preview | <http://127.0.0.1:4173/viewer/> |
| Phone (WiFi / hotspot) | `http://192.168.1.19:8015/viewer/` · `http://192.168.137.1:8015/viewer/` |

### Verified

- Viewer serves from `:8015`, `:5173` and `:4173`; model returns HTTP 200 with
  `content-length: 161372668` on all servers.
- Headless render: 104 meshes, 104 materials, shadows ON, transmission ON, sun 10:34,
  load ~0.75 s, progress 100%, no errors.
- `npm run build` copies `public/viewer` into `dist/viewer`, so the production build contains both
  the editor and the standalone viewer.

The old copy at `C:\Users\NEJMA\3D Objects\TEST\viewer` is left untouched as a backup.

---

**End of document.**
