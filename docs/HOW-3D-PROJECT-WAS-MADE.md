# How the 3D Project Was Made

**Project:** `C:\Users\NEJMA\Documents\verge3d_apps\my_awesome_app`

**Phone / LAN URL:** <http://192.168.1.19:8012/my_awesome_app.html>

**Stack:** Verge3D 4.13.0 (Blender export), WebGL 2, plain JavaScript, Python + Pillow for the asset pipeline, Node.js for the static server.

> The villa/map assets were authored and exported from Verge3D. This document covers the engineering work that turned the exported scene into a fast web/mobile experience: scene assembly, mobile quality settings, LZMA compression, WebP texture variants, and LAN serving.

---

## 1. Result first

| Version | Cold transfer | Main idea |
|---|---:|---|
| Original export | ~253 MiB (~265 MB decimal) | Monolithic GLB + full-size textures |
| Desktop, compressed | **66.08 MiB** | LZMA geometry + original textures |
| Mobile, compressed | **46.05 MiB** | LZMA geometry + WebP textures |
| Reduction | **~5.5x smaller** | ~253 MiB → 46 MiB |

> Sizes in this document are binary megabytes (MiB, 1 MiB = 1,048,576 bytes), which is how the transfer measurements were recorded. The original package is often quoted as ~265 MB in decimal units.

At 100 KB/s the first load drops from roughly **43 minutes** to roughly **8 minutes**. Repeat visits are cached by the browser, so they are much faster.

The app chooses the mobile or desktop asset set automatically based on the user agent / touch capability.

---

## 2. Starting assets

The project already existed as a Verge3D app:

- `my_awesome_app.glb` — ~194 MB monolithic export (not used by the web player after optimization).
- `my_awesome_app.gltf` — 4.0 MB JSON scene.
- `my_awesome_app.bin` — 163.7 MB geometry buffer.
- 89 external images — 19.7 MB total, including two HDR environment maps.
- `map3d.glb` — ~71 MB standalone surrounding map: 7 meshes, 57.9 MB geometry, 9.8 MB textures (city, ground, trees, characters, benches).
- `v3d.js`, `visual_logic.js`, `my_awesome_app.js` — Verge3D runtime and application code.

The scene is heavy in both dimensions:

- ~1,450 meshes, so draw calls matter on phones.
- Large textures (several 2048–3000 px images) and large HDRIs.
- Two HDR environment maps: `environment.hdr` and `derelict_airfield_02_1k.hdr`.

---

## 3. Architecture

```
Browser
  └─ my_awesome_app.html
       ├─ v3d.js
       ├─ visual_logic.js          (Verge3D init options)
       └─ my_awesome_app.js
            ├─ applyVillasQuality(app)
            └─ loadSurroundingMap(app)
                 ├─ map3d_mobile.gltf.xz   (phone)
                 └─ map3d.gltf.xz          (desktop)
```

The main scene is loaded by Verge3D's own loader. The surrounding map is loaded separately with `v3d.GLTFLoader` and inserted into the same scene.

### 3.1 Main scene selection

In `my_awesome_app.js`:

```js
sceneURL: params.load || (IS_MOBILE ? 'my_awesome_app_mobile.gltf' : 'my_awesome_app.gltf')
```

Verge3D appends `.xz` when `useCompAssets` is enabled:

```js
sceneURL = initOptions.useCompAssets ? `${sceneURL}.xz` : sceneURL;
```

`visual_logic.js` contains:

```js
useCompAssets: true,
```

So on a phone the final URL is `my_awesome_app_mobile.gltf.xz`; on desktop it is `my_awesome_app.gltf.xz`.

### 3.2 Surrounding map

The map is placed in world space with a config object:

```js
const SURROUNDING_MAP = {
    url: IS_MOBILE ? 'map3d_mobile.gltf.xz' : 'map3d.gltf.xz',
    fallback: 'map3d.glb',
    scale: 100,
    centerX: 21648,
    centerZ: 6035,
    groundY: 18,
    gpCenterX: -227.7,
    gpCenterZ: -190.8,
    gpGroundY: 23.02,
};
```

Loading includes a fallback to the uncompressed GLB if `.xz` fails:

```js
function loadSurroundingMap(app) {
    const loader = new v3d.GLTFLoader();
    const load = (url, allowFallback) => loader.load(url, gltf => {
        const map = gltf.scene;
        map.name = 'SurroundingMap';
        map.scale.setScalar(SURROUNDING_MAP.scale);
        map.position.set(
            SURROUNDING_MAP.centerX - SURROUNDING_MAP.gpCenterX * SURROUNDING_MAP.scale,
            SURROUNDING_MAP.groundY - SURROUNDING_MAP.gpGroundY * SURROUNDING_MAP.scale,
            SURROUNDING_MAP.centerZ - SURROUNDING_MAP.gpCenterZ * SURROUNDING_MAP.scale
        );
        map.updateMatrixWorld(true);
        app.scene.add(map);

        const whiteBox = map.getObjectByName('GP_WB');
        if (whiteBox) whiteBox.visible = false;

        applyMapQuality(app, map);
    }, onProgress, err => {
        if (allowFallback && SURROUNDING_MAP.fallback) {
            load(SURROUNDING_MAP.fallback, false);
        } else {
            console.error('Failed to load the surrounding 3D map', err);
        }
    });

    load(SURROUNDING_MAP.url, true);
}
```

The `GP_WB` mesh is a white box helper and is always hidden.

---

## 4. Mobile profile

### 4.1 Detection

No reliable Verge3D `isMobile` helper was present, so the app uses a small local detector:

```js
const IS_MOBILE = (() => {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|IEMobile|Mobile/i.test(ua) ||
        (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
})();
```

This is evaluated once at startup and used for both quality settings and asset selection.

### 4.2 Quality settings

| Setting | Desktop | Mobile |
|---|---|---|
| Pixel ratio | 1.5 | **1.0** |
| Postprocessing composer ratio | 1.5 | 1.0 |
| Realtime shadows | CSM, 4096 map | **Disabled** |
| Shadow type | PCF Poisson | PCF (configured, unused) |
| Sun shadow far | 150,000 | 80,000 |
| Sun normal bias | 2 | 1 |
| Sun shadow radius | 4 | 1 |
| CSM max distance | 60,000 | 35,000 |
| Map receives/casts shadows | Yes | **No** |
| Texture anisotropy | 8 | **2** |
| Fog density | 5e-6 | 5e-6 |

Realtime shadows were disabled entirely on mobile. At ~1,450 meshes, the shadow pass roughly doubles draw calls and was the biggest FPS cost. The mobile screenshot is slightly flatter but much smoother.

`renderer.setPixelRatio(1)` is another large win on phones with DPR 2–3. The drawing buffer stays at CSS resolution.

The final mobile diagnostics confirmed:

```json
{
  "mobile": true,
  "pixelRatio": 1,
  "drawingSize": [390, 844],
  "shadowEnabled": false,
  "sunCastShadow": false,
  "shadowMapSize": [1024, 1024],
  "map": true
}
```

### 4.3 Map quality

The map gets its own pass:

```js
const maxAnisotropy = Math.min(IS_MOBILE ? 2 : 8, renderer.capabilities.getMaxAnisotropy());

map.traverse(obj => {
    if (!obj.isMesh) return;
    obj.receiveShadow = !IS_MOBILE;
    obj.castShadow = !IS_MOBILE && !noCast.test(obj.name);
    // set envMapIntensity = 0.4 and texture.anisotropy
});
```

`Map`, `GP`, and `GP_Razmetka` never cast shadows even on desktop.

---

## 5. Compression pipeline

### 5.1 Why LZMA and not Draco?

The Verge3D loader explicitly rejects Draco and Meshopt:

```
v3d.GLTFLoader: Draco compression is not supported, please use LZMA compression.
v3d.GLTFLoader: Mesh optimization is not supported, please use LZMA compression.
```

So the supported path is to serve an LZMA-compressed glTF (`.gltf.xz`) with an LZMA-compressed buffer (`.bin.xz`). Verge3D decompresses XZ inside the loader; no extra library or server-side decompression is needed.

### 5.2 Split the GLB into glTF + BIN + textures

The scene was exported as `.gltf` with external images. For the surrounding map, the monolithic GLB was split:

1. Parse the GLB JSON and BIN chunks.
2. Extract every `images[i].bufferView` to `map3d_tex_i.jpg/png/webp`.
3. Set `images[i].uri` to the extracted file and remove `bufferView`.
4. Remove image buffer views from the BIN, repack it with 4-byte alignment, and update buffer view offsets.
5. Write `map3d.gltf` + `map3d.bin`.

This keeps external textures cacheable and avoids embedding image bytes inside the LZMA buffer.

### 5.3 Compress with LZMA

```python
import lzma, os

def xz_file(src, dst, preset=6):
    with open(src, 'rb') as f, lzma.open(dst, 'wb', preset=preset) as out:
        while True:
            chunk = f.read(4 * 1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
```

Preset 6 was used for a good size/speed balance. Preset 9 would compress slightly more, but needs a much larger dictionary and more RAM during decompression on phones.

### 5.4 Compression results

| File | Original | LZMA `.xz` |
|---|---:|---:|
| `my_awesome_app.gltf` | 4.0 MB | 0.086 MB |
| `my_awesome_app.bin` | 163.7 MB | 20.4 MB |
| `map3d.gltf` | 0.02 MB | 0.004 MB |
| `map3d.bin` | 57.9 MB | 16.8 MB |
| `environment.hdr` | 1.0 MB | 0.5 MB |
| `derelict_airfield_02_1k.hdr` | 1.6 MB | 1.1 MB |

Geometry compresses extremely well: 163.7 MB → 20.4 MB and 57.9 MB → 16.8 MB.

When the scene URL ends in `.gltf.xz`, the loader resolves sidecar resources automatically:

- `my_awesome_app.bin` → `my_awesome_app.bin.xz`
- HDR URIs → `.hdr.xz` variants exist, although this loader path ultimately fetched the raw HDRs (see limitations)
- Normal images are fetched directly

### 5.5 Import options

`visual_logic.js`:

```js
initOptions: {
    useCompAssets: true,
    // ...
}
```

This single flag is what turns `my_awesome_app.gltf` into `my_awesome_app.gltf.xz` and enables the compressed sidecar behavior.

---

## 6. Mobile texture variants

Geometry was compressed, but the original textures still dominated the download. The desktop scene should keep its full-quality images, so mobile uses a separate glTF that points at WebP variants.

### 6.1 Generate WebP files

Rules used:

- Skip HDR files.
- Preserve alpha when present.
- Project textures: resize so the largest side is 1024 px, WebP quality 85.
- Map textures: largest side 2048 px, WebP quality 85.
- Write new files with a `mob_` / `mobmap_` prefix rather than overwriting originals.

```python
from PIL import Image

def webp_variant(src, dst, maxdim, quality):
    im = Image.open(src)
    im.load()
    w, h = im.size
    if max(w, h) > maxdim:
        scale = maxdim / max(w, h)
        im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    has_alpha = im.mode in ('RGBA', 'LA') or (
        im.mode == 'P' and 'transparency' in im.info
    )
    if has_alpha:
        im.save(dst, 'WEBP', quality=quality, method=6)
    else:
        im.convert('RGB').save(dst, 'WEBP', quality=quality, method=6)
```

Then clone the glTF JSON, rewrite every non-HDR `images[i].uri` / `mimeType`, and compress the JSON with LZMA:

- `my_awesome_app_mobile.gltf` + `.xz`
- `map3d_mobile.gltf` + `.xz`

The mobile glTFs still reference the shared `my_awesome_app.bin.xz` and `map3d.bin.xz`; only textures differ.

### 6.2 Texture results

| Set | Original | Mobile WebP |
|---|---:|---:|
| Project, 87 textures | 17.1 MB | 5.1 MB |
| Map, 5 textures | 9.8 MB | 1.0 MB |

### 6.3 Runtime selection

```js
sceneURL: params.load || (IS_MOBILE ? 'my_awesome_app_mobile.gltf' : 'my_awesome_app.gltf')
```

and

```js
url: IS_MOBILE ? 'map3d_mobile.gltf.xz' : 'map3d.gltf.xz'
```

Desktop keeps the original JPEG/PNG textures. Phones download WebP only.

---

## 7. Static server

Python's `http.server` was fine for testing, but it does not set useful cache headers. A small Node server was added on port 8012:

- Streams files with `fs.createReadStream`.
- Correct MIME types for `.gltf`, `.glb`, `.bin`, `.xz`, `.hdr`, `.webp`, `.wasm`.
- `Cache-Control: no-cache` for `.html`, `.js`, `.css` so code updates are picked up.
- `Cache-Control: public, max-age=604800, immutable` for geometry, textures, HDRs, and `.xz` files.
- Binds to `0.0.0.0` for LAN access.
- Blocks path traversal.

Core headers:

```js
const ext = path.extname(filePath).toLowerCase();
const isCode = ext === '.html' || ext === '.js' || ext === '.css';

const headers = {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': isCode
        ? 'no-cache'
        : 'public, max-age=604800, immutable'
};
```

Run it with:

```bat
cd C:\Users\NEJMA\Documents\verge3d_apps\my_awesome_app
node tools\serve_phone.js
```

Then open on a phone connected to the same network:

```
http://192.168.1.19:8012/my_awesome_app.html
```

The first load downloads the assets. Later loads are served from the browser cache.

---

## 8. Verification

Verification was done with headless Chrome through the DevTools Protocol, using an iPhone profile:

- Viewport: 390 × 844
- DPR: 3 (emulated), app forced to pixel ratio 1
- Cache disabled for cold-load tests
- Screenshots captured before and after the changes
- Console errors monitored

Measured with `performance.getEntriesByType('resource')` and `transferSize`:

| Test | Transfer |
|---|---:|
| Desktop compressed | **66.08 MiB** |
| Mobile compressed + WebP | **46.05 MiB** |

Both variants loaded the full scene, including the surrounding map, with no fallback to the uncompressed GLB. Desktop screenshots confirmed the original texture quality remained intact.

Mobile diagnostics:

```json
{
  "mobile": true,
  "pixelRatio": 1,
  "drawingSize": [390, 844],
  "shadowEnabled": false,
  "sunCastShadow": false,
  "shadowMapSize": [1024, 1024],
  "shadowFar": 80000,
  "map": true
}
```

Syntax was also checked with:

```bat
node --check my_awesome_app.js
```

---

## 9. What is on disk

| File | Size | Purpose |
|---|---:|---|
| `my_awesome_app.glb` | 185.4 MiB | Original monolithic export (reference) |
| `my_awesome_app.gltf` | 4.0 MiB | Desktop scene JSON |
| `my_awesome_app.bin` | 163.7 MiB | Desktop geometry |
| `my_awesome_app.gltf.xz` | 82 KiB | Compressed desktop scene |
| `my_awesome_app.bin.xz` | 20.5 MiB | Compressed desktop geometry |
| `my_awesome_app_mobile.gltf` | 2.0 MiB | Mobile scene JSON (WebP URIs) |
| `my_awesome_app_mobile.gltf.xz` | 70 KiB | Compressed mobile scene |
| `map3d.glb` | 67.7 MiB | Original map |
| `map3d.gltf` / `.xz` | 20.4 KiB / 3.7 KiB | Desktop map scene |
| `map3d.bin` / `.xz` | 57.9 MiB / 16.8 MiB | Map geometry |
| `map3d_mobile.gltf` / `.xz` | 20.4 KiB / 3.7 KiB | Mobile map scene |
| `mob_*.webp` (87 files) | ~5.1 MiB | Mobile project textures |
| `mobmap_*.webp` (5 files) | ~1.0 MiB | Mobile map textures |
| `environment.hdr` / `.xz` | 1.0 MiB / 480 KiB | HDRI |
| `derelict_airfield_02_1k.hdr` / `.xz` | 1.6 MiB / 1.1 MiB | HDRI |
| `tools/compress_assets.py` | — | GLB split + LZMA pipeline |
| `tools/make_mobile.py` | — | WebP mobile variants |
| `tools/serve_phone.js` | — | Node static server with caching |

The large uncompressed GLB/BIN files are kept as source/fallback, but the browser uses the compressed variants.

---

## 10. Rebuild checklist

1. Export from Verge3D as `.gltf` + `.bin` + external textures.
2. Split the surrounding map from GLB into `map3d.gltf` + `.bin` + extracted images.
3. LZMA-compress:
   - `my_awesome_app.gltf` → `.gltf.xz`
   - `my_awesome_app.bin` → `.bin.xz`
   - `map3d.gltf` → `.gltf.xz`
   - `map3d.bin` → `.bin.xz`
   - HDR files → `.hdr.xz`
4. Generate WebP variants and `*_mobile.gltf` files.
5. Set `useCompAssets: true` in `visual_logic.js`.
6. Use mobile detection for scene/map selection and quality settings.
7. Serve with proper MIME and cache headers.
8. Verify cold transfer and check for `.xz` fallback messages.

The helper scripts are in `my_awesome_app/tools/`:

```bat
cd C:\Users\NEJMA\Documents\verge3d_apps\my_awesome_app
python tools\compress_assets.py
python tools\make_mobile.py
node tools\serve_phone.js
```

---

## 11. Known limitations / next wins

- **46 MiB is still significant on a 100 KB/s link.** The remaining cost is mostly geometry: ~37 MiB of compressed BIN data.
- **LZMA decompression costs CPU and memory.** On low-end phones the first load takes a few seconds even after download.
- **HDR files were ultimately fetched uncompressed** by this loader path (~2.6 MB total), even though `.hdr.xz` files exist.
- **Draco and Meshopt are not usable** with this Verge3D loader.
- **Possible future reductions:**
  - Geometry simplification/decimation for the villas (VILLAS alone is ~96.6 MB raw).
  - Quantized positions/UVs (`KHR_mesh_quantization`), if the loader path is validated.
  - Dropping or simplifying the OSM city on phones.
  - KTX2/Basis textures instead of WebP.
- **First load only:** subsequent loads use the 7-day immutable cache.
- **The phone and PC must be on the same network** for the `192.168.1.19:8012` URL.
