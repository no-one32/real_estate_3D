# Session State — model-studio

Last updated: 2026-11-17 ~02:00

## Where things stand

Project: `C:\Users\NEJMA\Downloads\cdn.soft8soft.com\model-studio`
(Vite + Three.js r187 GLB/GLTF editor). Dev server: `http://127.0.0.1:5173/`.
Build: `npm run build` (passes).

### Verified working (headless Chrome, CDP port 9404)
- Load `model_lite.glb`: 1,460,209 triangles, 184 draw calls, load ~0.3–0.9 s.
- Bake: 56/59 meshes baked (3 glass/transparent skipped), 15 large-flat meshes
  subdivided, ~779k vertices, ~9.4 s on SwiftShader. Restore returns to
  0 basic materials / 0 vertex colors — clean.
- Texture status: `Textures: 73/73 WebP`, no warning class.
- ZIP export: `model_lite-project.zip` ~9.08 MB, Meshopt + 73 WebP textures.
- GLB export with Meshopt previously ~26.5 MB.

### Fixed this session
1. `src/bake.js`
   - Subdivision was unbounded → could freeze the tab on dense models.
     Now: only meshes with < 6000 triangles, flat (min dimension ≤ 12% of max),
     large edge (> 20% of max dimension), 1 tessellation iteration,
     6 s global budget, 400k vertex cap.
   - `restore()` no longer double-disposes geometries (it was disposing shared
     original geometries that restored meshes still used). Subdivided
     geometries are disposed only via `_geometrySwaps`.
   - Baked `MeshBasicMaterial`s are now actually disposed (recorded as
     `item.baked` at apply time; previously the original materials were
     inspected and the baked ones leaked).
2. `src/meshopt-export.js` — full rewrite, spec-correct:
   - Accepts `ArrayBuffer` or `Uint8Array` (export path passes `Uint8Array`;
     this was the "First argument to DataView constructor must be an
     ArrayBuffer" error).
   - Compressed `bufferView.byteLength` = **decompressed** length
     (`stride*count` for ATTRIBUTES, `count*4` for TRIANGLES).
   - `extensions.EXT_meshopt_compression.byteLength` = compressed length;
     `.byteOffset` points into buffer 0; `byteStride` only for ATTRIBUTES.
   - Indices converted to uint32 with `accessor.byteOffset = 0`.
   - Skips already-compressed views, multi-accessor non-strided views, and
     views mixing indices + attributes.
3. `src/main.js`
   - `#textureStatus` is now populated (`refreshTextureStatus()` on the Export
     tab + real report after export).
   - `prepareTexturesForExport({ dryRun: true })` for preview without mutating
     texture mime types.
   - `state.loadMs` + `#statusLoad` + load time in the toast.
4. `src/style.css` — `.hint.warn`.
5. `index.html`/`main.js` — export options renamed:
   "Meshopt compressed" (checked by default), "Project folder (.zip, compressed)".

## Open / next
- Re-run the Meshopt round-trip: export GLB → save to
  `%TEMP%\opencode\export-meshopt.glb` → re-import into model-studio and
  confirm it parses with the same triangle count. (Test script:
  `%TEMP%\opencode\meshopt-roundtrip.js`.) Last run got through load +
  texture status, then was interrupted before the export stage.
- Test-harness note: `window.confirm` blocks headless Chrome. Tests must
  enable `Page` domain and send `Page.handleJavaScriptDialog {accept:true}`
  on `Page.javascriptDialogOpening`.
- Update `MODEL-STUDIO-REPORT.md` for: Meshopt default, ZIP Deflate,
  glass exclusion, guarded subdivision, bake warning, performance panel
  (Draws/Load/Draw calls/Triangles), hotspot `alwaysFaceCamera` limitation,
  WebP status line.
- No real mid-range Android device test possible here (SwiftShader only).

## Files touched
- `model-studio/src/bake.js`
- `model-studio/src/meshopt-export.js`
- `model-studio/src/main.js`
- `model-studio/src/style.css`
- `model-studio/index.html`
- Temp test scripts: `%TEMP%\opencode\studio-final-test.js`,
  `%TEMP%\opencode\meshopt-roundtrip.js`,
  `%TEMP%\opencode\bake-test4.js`
