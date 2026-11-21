import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

const TMP_SUN = new THREE.Vector3();
const TMP_TARGET = new THREE.Vector3();
const TMP_NORMAL = new THREE.Vector3();
const TMP_MATRIX = new THREE.Matrix3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class BakeService {
  constructor(viewer, model) {
    this.viewer = viewer;
    this.model = model;
    this.active = false;
    this.onChange = null;
    this._meshes = [];
    this._geometries = new Map();
    this._shadow = null;
  }

  apply() {
    if (this.active) return null;
    if (!this.model.root) return null;

    const started = performance.now();
    this._started = started;
    const sun = this.viewer.sun;
    const hemi = this.viewer.hemi;
    const renderer = this.viewer.renderer;

    sun.getWorldPosition(TMP_SUN);
    sun.target.getWorldPosition(TMP_TARGET);
    const sunDir = TMP_SUN.clone().sub(TMP_TARGET).normalize();
    const sunColor = sun.color;
    const sunScale = clamp(sun.intensity * 0.32, 0.1, 1.4);
    const hemiScale = clamp(hemi.intensity * 0.9, 0, 0.8);
    const envScale = clamp((this.viewer.envState.intensity || 0) * 0.5, 0, 0.8);
    const base = 0.18 + envScale * 0.55;
    const outputScale = 0.78;

    this._meshes = [];
    this._geometries.clear();
    this._geometrySwaps = [];
    let glassExcluded = 0;

    this.model.root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;

      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hasGlass = list.some((mat) => mat && (mat.transmission > 0 || mat.transparent));
      if (hasGlass) {
        glassExcluded++;
        return;
      }

      const geo = mesh.geometry;
      const originalGeometry = this._sharedGeometryCount(geo) === 1 ? geo : null;
      let geometry = geo;
      if (originalGeometry) {
        geometry = this.subdivideIfNeeded(mesh, originalGeometry);
      }

      let record = this._geometries.get(geometry.uuid);
      if (!record) {
        const colors = this.buildVertexColors(mesh, { sunDir, sunColor, sunScale, hemiScale, base, outputScale });
        record = {
          geometry,
          original: geometry.getAttribute('color') || null,
          added: colors,
        };
        this._geometries.set(geometry.uuid, record);
      }
      if (record.added) geometry.setAttribute('color', record.added);

      const originalMaterial = mesh.material;
      const baked = list.map((mat) => this.bakeMaterial(mat));

      this._meshes.push({
        mesh,
        material: originalMaterial,
        baked: Array.isArray(originalMaterial) ? baked : baked[0],
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
      });

      mesh.material = Array.isArray(originalMaterial) ? baked : baked[0];
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (mesh.material.needsUpdate !== undefined) mesh.material.needsUpdate = true;
    });

    this._shadow = {
      enabled: renderer.shadowMap.enabled,
      sunCast: sun.castShadow,
      planeVisible: this.viewer.shadowPlane ? this.viewer.shadowPlane.visible : true,
    };
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    if (this.viewer.shadowPlane) this.viewer.shadowPlane.visible = false;

    this.active = true;
    this.onChange?.(true);
    return {
      meshes: this._meshes.length,
      vertices: this._meshes.reduce((sum, item) => sum + (item.mesh.geometry.getAttribute('position')?.count || 0), 0),
      subdivided: this._geometrySwaps.length,
      glassExcluded,
      ms: Math.round(performance.now() - started),
    };
  }

  _sharedGeometryCount(geometry) {
    let count = 0;
    for (const mesh of this.model.meshes || []) {
      if (mesh.geometry === geometry) count++;
    }
    return count;
  }

  subdivideIfNeeded(mesh, geometry) {
    const positions = geometry.getAttribute('position');
    if (!positions) return geometry;

    const index = geometry.getIndex();
    const triangleCount = Math.floor((index ? index.count : positions.count) / 3);
    if (!triangleCount) return geometry;
    if (triangleCount > 6000) return geometry;
    if (performance.now() - this._started > 6000) return geometry;

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    if (!maxSize) return geometry;

    const flat = Math.min(size.x, size.y, size.z) <= maxSize * 0.12;
    if (!flat) return geometry;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const count = index ? index.count : positions.count;
    let maxEdge = 0;
    const step = Math.max(3, Math.floor(count / 1500) * 3);
    for (let i = 0; i + 2 < count; i += step) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(positions, ia);
      b.fromBufferAttribute(positions, ib);
      c.fromBufferAttribute(positions, ic);
      maxEdge = Math.max(maxEdge, ab.subVectors(a, b).length(), ac.subVectors(a, c).length());
    }
    if (maxEdge < maxSize * 0.2) return geometry;

    let subdivided;
    try {
      subdivided = new TessellateModifier(maxSize * 0.3, 1).modify(geometry);
    } catch (error) {
      console.warn('[ModelStudio] Tessellation failed', error);
      return geometry;
    }
    if (subdivided === geometry) return geometry;

    const newCount = subdivided.getAttribute('position')?.count || 0;
    if (newCount > 400000) {
      subdivided.dispose();
      return geometry;
    }

    mesh.geometry = subdivided;
    this._geometrySwaps.push({ mesh, original: geometry, subdivided });
    return subdivided;
  }

  buildVertexColors(mesh, { sunDir, sunColor, sunScale, hemiScale, base, outputScale }) {
    const geo = mesh.geometry;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const normals = geo.getAttribute('normal');
    const positions = geo.getAttribute('position');
    if (!normals || !positions) return null;

    const count = positions.count;
    const colors = new Float32Array(count * 3);
    TMP_MATRIX.getNormalMatrix(mesh.matrixWorld);

    const sky = this.viewer.hemi.color;
    const ground = this.viewer.hemi.groundColor;

    for (let i = 0; i < count; i++) {
      TMP_NORMAL.fromBufferAttribute(normals, i).applyMatrix3(TMP_MATRIX).normalize();
      const ndl = Math.max(0, TMP_NORMAL.dot(sunDir));
      const mix = 0.5 + 0.5 * TMP_NORMAL.y;
      const hemiR = (sky.r * mix + ground.r * (1 - mix)) * hemiScale * 0.5;
      const hemiG = (sky.g * mix + ground.g * (1 - mix)) * hemiScale * 0.5;
      const hemiB = (sky.b * mix + ground.b * (1 - mix)) * hemiScale * 0.5;

      colors[i * 3] = clamp((base + sunColor.r * sunScale * ndl + hemiR) * outputScale, 0, 1.6);
      colors[i * 3 + 1] = clamp((base + sunColor.g * sunScale * ndl + hemiG) * outputScale, 0, 1.6);
      colors[i * 3 + 2] = clamp((base + sunColor.b * sunScale * ndl + hemiB) * outputScale, 0, 1.6);
    }

    return new THREE.BufferAttribute(colors, 3);
  }

  bakeMaterial(source) {
    const mat = source || new THREE.MeshBasicMaterial();
    const basic = new THREE.MeshBasicMaterial({
      name: mat.name || '',
      color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
      map: mat.map || null,
      vertexColors: true,
      transparent: !!mat.transparent || (typeof mat.opacity === 'number' && mat.opacity < 1),
      opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
      alphaMap: mat.alphaMap || null,
      alphaTest: mat.alphaTest || 0,
      side: mat.side ?? THREE.FrontSide,
      wireframe: !!mat.wireframe,
      depthWrite: mat.depthWrite !== false,
      toneMapped: false,
    });
    basic.userData.sourceMaterialId = mat.uuid;
    return basic;
  }

  restore() {
    if (!this.active) return false;

    for (const item of this._meshes) {
      const bakedList = Array.isArray(item.baked) ? item.baked : [item.baked];
      for (const mat of bakedList) {
        if (mat && mat.isMeshBasicMaterial && mat.userData && mat.userData.sourceMaterialId) mat.dispose();
      }
      item.mesh.material = item.material;
      item.mesh.castShadow = item.castShadow;
      item.mesh.receiveShadow = item.receiveShadow;
      if (item.mesh.material && !Array.isArray(item.mesh.material)) item.mesh.material.needsUpdate = true;
    }

    for (const record of this._geometries.values()) {
      const geo = record.geometry;
      if (!geo) continue;
      if (geo.getAttribute('color') === record.added) {
        if (record.original) geo.setAttribute('color', record.original);
        else geo.deleteAttribute('color');
      }
    }

    for (const swap of this._geometrySwaps) {
      swap.mesh.geometry = swap.original;
      swap.subdivided.dispose();
    }

    if (this._shadow) {
      this.viewer.renderer.shadowMap.enabled = this._shadow.enabled;
      this.viewer.sun.castShadow = this._shadow.sunCast;
      if (this.viewer.shadowPlane) this.viewer.shadowPlane.visible = this._shadow.planeVisible;
      this.viewer.renderer.shadowMap.needsUpdate = true;
    }

    this._meshes = [];
    this._geometries.clear();
    this._geometrySwaps = [];
    this._shadow = null;
    this.active = false;
    this.onChange?.(false);
    return true;
  }
}
