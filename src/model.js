import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL || '/';

export const TEXTURE_SLOTS = [
  ['map', 'Base color'],
  ['normalMap', 'Normal'],
  ['roughnessMap', 'Roughness'],
  ['metalnessMap', 'Metalness'],
  ['emissiveMap', 'Emissive'],
  ['aoMap', 'AO'],
  ['alphaMap', 'Opacity / Alpha'],
  ['bumpMap', 'Bump'],
  ['displacementMap', 'Displacement'],
  ['clearcoatMap', 'Clearcoat'],
  ['clearcoatNormalMap', 'Clearcoat normal'],
  ['clearcoatRoughnessMap', 'Clearcoat rough'],
  ['sheenColorMap', 'Sheen color'],
  ['sheenRoughnessMap', 'Sheen rough'],
  ['specularMap', 'Specular'],
  ['transmissionMap', 'Transmission'],
  ['thicknessMap', 'Thickness'],
  ['iridescenceMap', 'Iridescence'],
];

const COLOR_TEXTURE_SLOTS = new Set(['map', 'emissiveMap', 'sheenColorMap', 'specularColorMap']);

function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total, event.loaded, event.total);
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read model file'));
    reader.readAsArrayBuffer(file);
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

export class ModelService {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'desktop';
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    this.draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
    this.ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);

    this.root = null;
    this.fileName = null;
    this.fileSize = 0;
    this.meshes = [];
    this.materials = [];
    this.objects = [];
    this.stats = { meshes: 0, materials: 0, triangles: 0, vertices: 0, objects: 0 };
    this.originalTextures = new Set();
    this.modelInfo = null;
  }

  reset() {
    this.root = null;
    this.fileName = null;
    this.fileSize = 0;
    this.meshes = [];
    this.materials = [];
    this.objects = [];
    this.stats = { meshes: 0, materials: 0, triangles: 0, vertices: 0, objects: 0 };
    this.originalTextures.clear();
    this.modelInfo = null;
    this.fallbackMaterial = null;
  }

  /*
   * Mobile profile parity with the standalone viewer:
   *   desktop -> texture anisotropy 8, transmission kept
   *   mobile  -> texture anisotropy 2, transmission disabled
   * Applied to already-loaded materials and to materials loaded later
   * (createMaterialEntry uses this.maxAniso).
   */
  setQualityProfile(mode) {
    this.quality = mode === 'mobile' ? 'mobile' : 'desktop';
    const mobile = this.quality === 'mobile';
    this.maxAniso = mobile ? 2 : Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    for (const entry of this.materials) {
      const mat = entry.material;
      if (mobile) {
        if (typeof mat.transmission === 'number' && mat.transmission > 0) {
          entry.profileTransmission = mat.transmission;
          mat.transmission = 0;
        }
      } else if (entry.profileTransmission) {
        mat.transmission = entry.profileTransmission;
        entry.profileTransmission = 0;
      }
      for (const [slot] of TEXTURE_SLOTS) {
        const tex = mat[slot];
        if (tex && tex.isTexture && tex.anisotropy !== this.maxAniso) {
          tex.anisotropy = this.maxAniso;
          tex.needsUpdate = true;
        }
      }
      mat.needsUpdate = true;
    }
  }

  createLoader(manager) {
    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(this.draco);
    loader.setKTX2Loader(this.ktx2);
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
  }

  async load(files, { onProgress } = {}) {
    const list = Array.from(files || []);
    const glb = list.find((f) => /\.glb$/i.test(f.name));
    const gltfs = list
      .filter((f) => /\.gltf$/i.test(f.name))
      .sort((a, b) => b.size - a.size);
    const main = glb || gltfs[0];

    if (!main) {
      throw new Error('No .glb or .gltf file found. Add the model file (and its textures/bin files).');
    }

    this.reset();
    this.fileName = main.name;
    this.fileSize = main.size;

    onProgress?.(1, `Reading ${main.name}`);

    const buffer = await readFileWithProgress(main, (p, loaded, total) => {
      const mb = (loaded / 1048576).toFixed(1);
      const totalMb = (total / 1048576).toFixed(1);
      onProgress?.(2 + p * 76, `Reading ${main.name} — ${mb} / ${totalMb} MB`);
    });

    const fileMap = new Map();
    for (const f of list) {
      if (f === main) continue;
      const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/').replace(/^\.\//, '');
      fileMap.set(rel.toLowerCase(), f);
      const base = f.name.toLowerCase();
      if (!fileMap.has(base)) fileMap.set(base, f);
    }

    const blobUrls = [];
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (!url || /^(data:|blob:|https?:)/i.test(url)) return url;
      const clean = decodeURIComponent(url.split('?')[0].split('#')[0]).replace(/^\.\//, '').replace(/^\//, '');
      const lower = clean.toLowerCase();
      let file = fileMap.get(lower);
      if (!file) file = fileMap.get(lower.split('/').pop());
      if (!file) {
        for (const [key, candidate] of fileMap) {
          if (key.endsWith('/' + lower) || lower.endsWith('/' + key)) {
            file = candidate;
            break;
          }
        }
      }
      if (!file) return url;
      const blobUrl = URL.createObjectURL(file);
      blobUrls.push(blobUrl);
      return blobUrl;
    });

    let depLoaded = 0;
    let depTotal = 0;
    manager.onProgress = (url, loaded, total) => {
      depLoaded = loaded;
      depTotal = total;
      const ratio = total ? loaded / total : 0;
      onProgress?.(78 + ratio * 19, `Parsing assets — ${loaded}/${total}`);
    };
    manager.onError = (url) => {
      console.warn('[ModelStudio] asset failed to load:', url);
    };

    onProgress?.(78, 'Parsing scene…');

    const loader = this.createLoader(manager);
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });

    setTimeout(() => {
      for (const url of blobUrls) URL.revokeObjectURL(url);
    }, 1500);

    onProgress?.(98, 'Preparing scene…');

    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) throw new Error('The file does not contain a scene.');

    this.root = root;
    this.prepare(root);
    onProgress?.(100, 'Ready');

    return {
      gltf,
      animations: gltf.animations || [],
      root,
      ...this.modelInfo,
    };
  }

  prepare(root) {
    root.updateMatrixWorld(true);
    const meshList = [];
    const materialMap = new Map();

    root.traverse((obj) => {
      if (obj.isMesh) {
        meshList.push(obj);
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.geometry) obj.geometry.computeBoundingBox();
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of list) {
          if (!mat || materialMap.has(mat.uuid)) continue;
          materialMap.set(mat.uuid, mat);
        }
      }
    });

    let triangles = 0;
    let vertices = 0;
    for (const mesh of meshList) {
      const geo = mesh.geometry;
      if (!geo) continue;
      const count = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
      triangles += Math.floor(count / 3);
      vertices += geo.attributes.position ? geo.attributes.position.count : 0;
    }

    this.meshes = meshList;
    this.objects = [];
    this.buildObjectPaths(root);

    this.materials = [];
    for (const mat of materialMap.values()) {
      this.materials.push(this.createMaterialEntry(mat));
    }

    this.stats = {
      meshes: meshList.length,
      materials: this.materials.length,
      triangles,
      vertices,
      objects: this.objects.length,
    };

    let minY = Infinity;
    for (const mesh of meshList) {
      mesh.updateWorldMatrix(true, false);
      const box = mesh.geometry?.boundingBox;
      if (!box) continue;
      const worldBox = box.clone().applyMatrix4(mesh.matrixWorld);
      if (worldBox.min.y < minY) minY = worldBox.min.y;
    }
    this.modelInfo = {
      fileName: this.fileName,
      fileSize: this.fileSize,
      stats: { ...this.stats },
      hasAnimations: false,
    };
  }

  buildObjectPaths(root) {
    this.objects = [];
    const walk = (obj, path) => {
      if (obj !== root) {
        obj.userData.studioPath = path;
        this.objects.push({
          object: obj,
          path,
          label: obj.name ? `${obj.name}` : `Object ${path.join('.')}`,
        });
      }
      obj.children.forEach((child, index) => {
        walk(child, path.concat(index));
      });
    };
    walk(root, []);
  }

  createMaterialEntry(mat) {
    const index = this.materials.length;
    const name = mat.name && mat.name.trim() ? mat.name : `Material ${index + 1}`;
    if (!mat.name) mat.name = name;

    if (typeof mat.envMapIntensity === 'number') mat.envMapIntensity = 0.9;

    /*
     * Some exporters stamp invalid PBR extensions onto every material:
     *   KHR_materials_anisotropy  anisotropyStrength = 1.333 (spec max is 1)
     *   KHR_materials_sheen       black sheen colour
     *   KHR_materials_ior         non-default 1.6
     * An anisotropy strength above 1 makes a surface snap to black from
     * certain viewing angles. Neutralize it once, before the original
     * values are captured, so Reset also restores the neutral state.
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
    mat.needsUpdate = true;

    const original = {
      color: mat.color ? mat.color.clone() : null,
      roughness: typeof mat.roughness === 'number' ? mat.roughness : null,
      metalness: typeof mat.metalness === 'number' ? mat.metalness : null,
      emissive: mat.emissive ? mat.emissive.clone() : null,
      emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : null,
      opacity: typeof mat.opacity === 'number' ? mat.opacity : null,
      transparent: typeof mat.transparent === 'boolean' ? mat.transparent : null,
      envMapIntensity: typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : null,
      wireframe: typeof mat.wireframe === 'boolean' ? mat.wireframe : null,
      side: typeof mat.side === 'number' ? mat.side : null,
      transmission: typeof mat.transmission === 'number' ? mat.transmission : null,
      textures: {},
    };

    for (const [slot] of TEXTURE_SLOTS) {
      if (mat[slot]) {
        original.textures[slot] = mat[slot];
        this.originalTextures.add(mat[slot]);
        mat[slot].anisotropy = this.maxAniso;
        mat[slot].userData.mimeType = 'image/webp';
        mat[slot].needsUpdate = true;
      }
    }

    return {
      id: mat.uuid,
      index,
      material: mat,
      name,
      type: (mat.type || 'Material').replace('Material', '') || 'Basic',
      original,
      overrides: {},
      overrideTextures: {},
    };
  }

  getMaterial(id) {
    return this.materials.find((m) => m.id === id) || null;
  }

  getMaterialByName(name) {
    return this.materials.find((m) => m.name === name) || null;
  }

  setMaterialValue(id, prop, value) {
    const entry = this.getMaterial(id);
    if (!entry) return;
    const mat = entry.material;
    if (!(prop in mat)) return;
    if (prop === 'color' || prop === 'emissive') mat[prop].set(value);
    else if (prop === 'wireframe' || prop === 'transparent') mat[prop] = !!value;
    else mat[prop] = Number(value);
    if (prop === 'wireframe' || prop === 'transparent' || prop === 'opacity' || prop === 'side') {
      mat.needsUpdate = true;
    }
  }

  async replaceTexture(id, slot, file, onProgress) {
    if (!file) return null;
    const entry = this.getMaterial(id);
    if (!entry) return null;
    onProgress?.(0.1);
    const dataUrl = await fileToDataURL(file);
    onProgress?.(0.45);
    await this.assignTextureFromDataURL(entry, slot, dataUrl, file.name);
    onProgress?.(1);
    return { dataUrl, name: file.name };
  }

  async assignTextureFromDataURL(entry, slot, dataUrl, name = 'texture') {
    const texture = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        dataUrl,
        resolve,
        undefined,
        () => reject(new Error('Could not decode texture image'))
      );
    });
    texture.flipY = false;
    texture.colorSpace = COLOR_TEXTURE_SLOTS.has(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = this.maxAniso;
    texture.userData.mimeType = 'image/webp';
    texture.needsUpdate = true;

    const oldOverride = entry.overrideTextures[slot];
    if (oldOverride) oldOverride.dispose();

    entry.overrideTextures[slot] = texture;
    entry.overrides[slot] = { dataUrl, name };
    entry.material[slot] = texture;
    entry.material.needsUpdate = true;
    return texture;
  }

  removeTextureOverride(id, slot) {
    const entry = this.getMaterial(id);
    if (!entry) return;
    const override = entry.overrideTextures[slot];
    if (override) override.dispose();
    delete entry.overrideTextures[slot];
    delete entry.overrides[slot];
    const original = entry.original.textures[slot];
    entry.material[slot] = original || null;
    entry.material.needsUpdate = true;
  }

  revertMaterial(id) {
    const entry = this.getMaterial(id);
    if (!entry) return;
    const mat = entry.material;
    const orig = entry.original;
    if (orig.color) mat.color.copy(orig.color);
    if (orig.emissive) mat.emissive.copy(orig.emissive);
    if (orig.roughness !== null) mat.roughness = orig.roughness;
    if (orig.metalness !== null) mat.metalness = orig.metalness;
    if (orig.emissiveIntensity !== null) mat.emissiveIntensity = orig.emissiveIntensity;
    if (orig.opacity !== null) mat.opacity = orig.opacity;
    if (orig.transparent !== null) mat.transparent = orig.transparent;
    if (orig.envMapIntensity !== null && 'envMapIntensity' in mat) mat.envMapIntensity = orig.envMapIntensity;
    if (orig.wireframe !== null) mat.wireframe = orig.wireframe;
    if (orig.side !== null) mat.side = orig.side;
    if (orig.transmission !== null && 'transmission' in mat) {
      // Keep the mobile profile intact when the user resets a material.
      mat.transmission = this.quality === 'mobile' ? 0 : orig.transmission;
    }

    for (const slot of Object.keys(entry.overrideTextures)) {
      entry.overrideTextures[slot].dispose();
    }
    entry.overrideTextures = {};
    entry.overrides = {};

    for (const [slot] of TEXTURE_SLOTS) {
      if (orig.textures[slot]) mat[slot] = orig.textures[slot];
      else if (slot in mat && mat[slot] && !this.originalTextures.has(mat[slot])) mat[slot] = null;
    }
    mat.needsUpdate = true;
  }

  revertAll() {
    for (const entry of this.materials) this.revertMaterial(entry.id);
  }

  copyMaterialSettings(sourceId) {
    const source = this.getMaterial(sourceId);
    if (!source) return 0;
    const src = source.material;
    let count = 0;
    for (const entry of this.materials) {
      if (entry.id === source.id) continue;
      const mat = entry.material;
      if (src.color && mat.color) mat.color.copy(src.color);
      if (src.emissive && mat.emissive) mat.emissive.copy(src.emissive);
      for (const prop of ['roughness', 'metalness', 'emissiveIntensity', 'opacity', 'envMapIntensity']) {
        if (typeof src[prop] === 'number' && typeof mat[prop] === 'number') mat[prop] = src[prop];
      }
      if ('transparent' in mat) mat.transparent = !!src.transparent;
      if ('wireframe' in mat) mat.wireframe = !!src.wireframe;
      if ('side' in mat) mat.side = src.side;
      mat.needsUpdate = true;
      count++;
    }
    return count;
  }

  getMaterialState() {
    return this.materials.map((entry) => {
      const mat = entry.material;
      const overrides = {};
      for (const [slot, info] of Object.entries(entry.overrides)) {
        overrides[slot] = { dataUrl: info.dataUrl, name: info.name };
      }
      return {
        id: entry.id,
        index: entry.index,
        name: entry.name,
        type: entry.type,
        color: mat.color ? '#' + mat.color.getHexString() : null,
        emissive: mat.emissive ? '#' + mat.emissive.getHexString() : null,
        roughness: typeof mat.roughness === 'number' ? mat.roughness : null,
        metalness: typeof mat.metalness === 'number' ? mat.metalness : null,
        emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : null,
        opacity: typeof mat.opacity === 'number' ? mat.opacity : null,
        transparent: typeof mat.transparent === 'boolean' ? mat.transparent : null,
        envMapIntensity: typeof mat.envMapIntensity === 'number' ? mat.envMapIntensity : null,
        wireframe: typeof mat.wireframe === 'boolean' ? mat.wireframe : null,
        side: typeof mat.side === 'number' ? mat.side : null,
        overrides,
      };
    });
  }

  async applyMaterialState(states) {
    if (!Array.isArray(states)) return 0;
    let applied = 0;
    for (const state of states) {
      let entry = null;
      if (Number.isInteger(state.index) && this.materials[state.index]) {
        const byIndex = this.materials[state.index];
        if (!state.name || byIndex.name === state.name) entry = byIndex;
      }
      if (!entry && state.name) entry = this.getMaterialByName(state.name);
      if (!entry && state.id) entry = this.getMaterial(state.id);
      if (!entry) continue;

      const mat = entry.material;
      if (state.color && mat.color) mat.color.set(state.color);
      if (state.emissive && mat.emissive) mat.emissive.set(state.emissive);
      if (typeof state.roughness === 'number' && 'roughness' in mat) mat.roughness = state.roughness;
      if (typeof state.metalness === 'number' && 'metalness' in mat) mat.metalness = state.metalness;
      if (typeof state.emissiveIntensity === 'number' && 'emissiveIntensity' in mat) {
        mat.emissiveIntensity = state.emissiveIntensity;
      }
      if (typeof state.opacity === 'number' && 'opacity' in mat) mat.opacity = state.opacity;
      if (typeof state.transparent === 'boolean' && 'transparent' in mat) mat.transparent = state.transparent;
      if (typeof state.envMapIntensity === 'number' && 'envMapIntensity' in mat) {
        mat.envMapIntensity = state.envMapIntensity;
      }
      if (typeof state.wireframe === 'boolean' && 'wireframe' in mat) mat.wireframe = state.wireframe;
      if (typeof state.side === 'number' && 'side' in mat) mat.side = state.side;
      mat.needsUpdate = true;

      if (state.overrides && typeof state.overrides === 'object') {
        for (const [slot, info] of Object.entries(state.overrides)) {
          if (!info || !info.dataUrl) continue;
          try {
            await this.assignTextureFromDataURL(entry, slot, info.dataUrl, info.name || 'texture');
          } catch (err) {
            console.warn('[ModelStudio] texture override failed', slot, err);
          }
        }
      }
      applied++;
    }
    return applied;
  }

  resolvePath(path) {
    let obj = this.root;
    if (!obj || !Array.isArray(path)) return null;
    for (const index of path) {
      if (!obj.children || !obj.children[index]) return null;
      obj = obj.children[index];
    }
    return obj;
  }

  getObjectTargets() {
    return this.objects
      .filter((entry) => {
        const obj = entry.object;
        return obj.isMesh || obj.isGroup || (obj.children.length > 0 && !obj.isBone);
      })
      .map((entry) => ({
        path: entry.path,
        label: `${entry.label}  ·  ${entry.path.join('.')}`,
        object: entry.object,
      }));
  }

  getMeshTargets() {
    return this.meshes.map((mesh) => {
      const path = mesh.userData.studioPath || [];
      return {
        path,
        label: `${mesh.name || 'Mesh'}  ·  ${path.join('.')}`,
        object: mesh,
      };
    });
  }

  getMaterialChoices() {
    return this.materials.map((m) => ({ id: m.id, name: m.name, index: m.index, type: m.type }));
  }

  /* ------------------------------------------------------------------ */
  /* Structure editing: delete / merge / assign materials & objects      */
  /* ------------------------------------------------------------------ */
  getMaterialUsage(id) {
    const entry = this.getMaterial(id);
    if (!entry) return 0;
    let count = 0;
    for (const mesh of this.meshes) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (list.includes(entry.material)) count++;
    }
    return count;
  }

  getFallbackMaterial() {
    if (!this.fallbackMaterial) {
      this.fallbackMaterial = new THREE.MeshStandardMaterial({
        name: 'Default material',
        color: 0x9aa3b5,
        roughness: 0.85,
        metalness: 0.0,
      });
      this.materials.push(this.createMaterialEntry(this.fallbackMaterial));
    }
    return this.fallbackMaterial;
  }

  renameMaterial(id, name) {
    const entry = this.getMaterial(id);
    if (!entry) return false;
    const next = String(name || '').trim();
    if (!next) return false;
    entry.name = next;
    entry.material.name = next;
    return true;
  }

  assignMaterialToObject(object, materialId) {
    const entry = this.getMaterial(materialId);
    if (!entry || !object) return 0;
    let count = 0;
    object.traverse((node) => {
      if (!node.isMesh) return;
      if (Array.isArray(node.material)) node.material = node.material.map(() => entry.material);
      else node.material = entry.material;
      count++;
    });
    return count;
  }

  mergeMaterials(sourceId, targetId) {
    const source = this.getMaterial(sourceId);
    const target = this.getMaterial(targetId);
    if (!source || !target || source.id === target.id) return 0;

    let count = 0;
    for (const mesh of this.meshes) {
      if (Array.isArray(mesh.material)) {
        if (mesh.material.includes(source.material)) {
          mesh.material = mesh.material.map((mat) => (mat === source.material ? target.material : mat));
          count++;
        }
      } else if (mesh.material === source.material) {
        mesh.material = target.material;
        count++;
      }
    }

    for (const texture of Object.values(source.overrideTextures)) texture.dispose();
    source.overrideTextures = {};
    if (source.material === this.fallbackMaterial) this.fallbackMaterial = null;
    source.material.dispose();
    this.materials = this.materials.filter((entry) => entry.id !== source.id);
    this.refreshScene();
    return count;
  }

  deleteMaterial(id, { deleteObjects = false } = {}) {
    const entry = this.getMaterial(id);
    if (!entry) return { ok: false, affected: 0, deletedObjects: 0 };

    const affected = this.meshes.filter((mesh) => {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return list.includes(entry.material);
    });

    let deletedObjects = 0;
    if (deleteObjects) {
      for (const mesh of affected) {
        if (!mesh.parent) continue;
        mesh.parent.remove(mesh);
        this.disposeSubtree(mesh);
        deletedObjects++;
      }
    } else {
      const fallback = this.getFallbackMaterial();
      for (const mesh of affected) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => (mat === entry.material ? fallback : mat));
        } else {
          mesh.material = fallback;
        }
      }
    }

    for (const texture of Object.values(entry.overrideTextures)) texture.dispose();
    entry.overrideTextures = {};
    if (entry.material === this.fallbackMaterial) this.fallbackMaterial = null;
    entry.material.dispose();
    this.materials = this.materials.filter((item) => item.id !== entry.id);
    this.refreshScene();

    return { ok: true, affected: affected.length, deletedObjects };
  }

  deleteObject(object) {
    if (!object || object === this.root || !object.parent) return 0;
    let meshes = 0;
    object.traverse((node) => {
      if (node.isMesh) meshes++;
    });
    object.parent.remove(object);
    this.disposeSubtree(object);
    this.refreshScene();
    return meshes;
  }

  disposeSubtree(object) {
    if (!object) return;
    const geometries = new Set();
    const materials = new Set();
    object.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) {
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of list) if (mat) materials.add(mat);
      }
    });

    const liveGeometry = new Set();
    const liveMaterial = new Set();
    if (this.root) {
      this.root.traverse((node) => {
        if (node.geometry) liveGeometry.add(node.geometry);
        if (node.material) {
          const list = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of list) if (mat) liveMaterial.add(mat);
        }
      });
    }

    for (const geometry of geometries) if (!liveGeometry.has(geometry)) geometry.dispose();
    for (const material of materials) {
      if (liveMaterial.has(material)) continue;
      // Textures are intentionally left alive: GLTF materials often share the
      // same texture objects, so disposing them here could break other meshes.
      material.dispose();
    }
  }

  refreshScene() {
    if (!this.root) return;
    const meshList = [];
    this.root.traverse((object) => {
      if (object.isMesh) meshList.push(object);
    });

    let triangles = 0;
    let vertices = 0;
    for (const mesh of meshList) {
      const geometry = mesh.geometry;
      if (!geometry) continue;
      const count = geometry.index
        ? geometry.index.count
        : geometry.attributes.position
          ? geometry.attributes.position.count
          : 0;
      triangles += Math.floor(count / 3);
      vertices += geometry.attributes.position ? geometry.attributes.position.count : 0;
    }

    this.meshes = meshList;
    this.buildObjectPaths(this.root);
    this.materials.forEach((entry, index) => {
      entry.index = index;
    });
    this.stats = {
      meshes: meshList.length,
      materials: this.materials.length,
      triangles,
      vertices,
      objects: this.objects.length,
    };
    if (this.modelInfo) this.modelInfo.stats = { ...this.stats };
  }

  getMaterialEntriesForObject(object) {
    if (!object || !object.material) return [];
    const list = Array.isArray(object.material) ? object.material : [object.material];
    const entries = [];
    for (const mat of list) {
      if (!mat) continue;
      const sourceId = mat.userData && mat.userData.sourceMaterialId;
      const entry =
        this.materials.find((m) => m.material === mat) ||
        (sourceId ? this.materials.find((m) => m.id === sourceId) : null);
      if (entry && !entries.includes(entry)) entries.push(entry);
    }
    return entries;
  }

  findMaterialByRef(ref) {
    if (!ref) return null;
    if (Number.isInteger(ref.index) && this.materials[ref.index]) {
      const byIndex = this.materials[ref.index];
      if (!ref.name || byIndex.name === ref.name) return byIndex;
    }
    if (ref.name) {
      const byName = this.getMaterialByName(ref.name);
      if (byName) return byName;
    }
    if (ref.id) return this.getMaterial(ref.id);
    return null;
  }
}
