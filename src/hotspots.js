import * as THREE from 'three';

export const HOTSPOT_SHAPES = [
  ['pin', 'Pin'],
  ['circle', 'Circle'],
  ['diamond', 'Diamond'],
  ['square', 'Square'],
  ['ring', 'Ring'],
];

export const HOTSPOT_ACTIONS = [
  ['popup', 'Open popup'],
  ['camera', 'Move camera'],
  ['material', 'Change material'],
  ['visibility', 'Show / hide object'],
];

const COLORS = ['#ffb454', '#69a7ff', '#4fe0a6', '#ff7393', '#c08cff', '#ffd166'];
const ACTION_LABEL = {
  popup: 'Popup',
  camera: 'Camera',
  material: 'Material',
  visibility: 'Visibility',
};
const TMP_WORLD = new THREE.Vector3();
const TMP_SCALE = new THREE.Vector3();

function makeId() {
  return 'hs_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAction(action) {
  const type = action && ['popup', 'camera', 'material', 'visibility'].includes(action.type) ? action.type : 'popup';
  if (type === 'camera') {
    return {
      type,
      position: Array.isArray(action.position) ? action.position.slice(0, 3).map(Number) : null,
      target: Array.isArray(action.target) ? action.target.slice(0, 3).map(Number) : null,
    };
  }
  if (type === 'material') {
    return {
      type,
      targetPath: Array.isArray(action.targetPath) ? action.targetPath.slice() : [],
      targetLabel: action.targetLabel || '',
      materialName: action.materialName || '',
      materialIndex: Number.isInteger(action.materialIndex) ? action.materialIndex : undefined,
      materialId: action.materialId || '',
    };
  }
  if (type === 'visibility') {
    return {
      type,
      targetPath: Array.isArray(action.targetPath) ? action.targetPath.slice() : [],
      targetLabel: action.targetLabel || '',
      mode: ['show', 'hide', 'toggle'].includes(action.mode) ? action.mode : 'toggle',
    };
  }
  return {
    type: 'popup',
    title: action.title || 'Hotspot',
    text: action.text || '',
    image: action.image || null,
  };
}

function normalizeItem(raw, index) {
  if (!raw || !Array.isArray(raw.position) || raw.position.length < 3) return null;
  const label = raw.label || `Hotspot ${index + 1}`;
  return {
    id: raw.id || makeId(),
    label,
    position: raw.position.slice(0, 3).map(Number),
    color: typeof raw.color === 'string' ? raw.color : COLORS[index % COLORS.length],
    size: clamp(Number(raw.size) || 1, 0.35, 3),
    shape: HOTSPOT_SHAPES.some(([id]) => id === raw.shape) ? raw.shape : 'pin',
    icon: typeof raw.icon === 'string' && raw.icon.startsWith('data:') ? raw.icon : null,
    hoverAnim: ['none', 'fade', 'scale', 'pulse'].includes(raw.hoverAnim) ? raw.hoverAnim : 'scale',
    action: normalizeAction(raw.action || {}),
  };
}

export class HotspotManager {
  constructor(viewer, modelService, callbacks = {}) {
    this.viewer = viewer;
    this.model = modelService;
    this.callbacks = callbacks;

    this.items = [];
    this.selectedId = null;
    this.placing = false;
    this.root = null;
    this.rootScale = 1;

    this.group = new THREE.Group();
    this.group.name = '__hotspots';
    this.group.renderOrder = 10;

    this._drag = null;
    this._placingDown = null;
    this._hoverId = null;
    this._iconImages = new Map();

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'hotspot-tooltip';
    this.tooltip.hidden = true;
    this.tooltip.innerHTML = '<b></b><span></span>';
    document.body.appendChild(this.tooltip);

    this._bindPointerEvents();

    viewer.addFrameCallback(() => this.updateFrame());
  }

  /* ---------------------------------------------------------------- */
  /* Attach & lifecycle                                               */
  /* ---------------------------------------------------------------- */
  attach(root) {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.root = root;
    root.add(this.group);
    this.rootScale = this.getRootScale();
    for (const item of this.items) {
      if (!item.sprite) this.createSprite(item);
    }
  }

  detach() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.root = null;
  }

  reset() {
    this.clearItems();
    this.setPlacing(false);
    this.select(null);
    this.detach();
  }

  clearItems() {
    for (const item of this.items) this.disposeSprite(item);
    this.items = [];
    this.selectedId = null;
  }

  getRootScale() {
    if (!this.root) return 1;
    this.root.getWorldScale(TMP_SCALE);
    const avg = (Math.abs(TMP_SCALE.x) + Math.abs(TMP_SCALE.y) + Math.abs(TMP_SCALE.z)) / 3;
    return avg || 1;
  }

  /* ---------------------------------------------------------------- */
  /* Data                                                            */
  /* ---------------------------------------------------------------- */
  getSelected() {
    return this.items.find((item) => item.id === this.selectedId) || null;
  }

  getItem(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  select(id, notify = true) {
    if (id && !this.getItem(id)) return;
    const previous = this.selectedId;
    this.selectedId = id || null;
    if (previous) {
      const prevItem = this.getItem(previous);
      if (prevItem) this.refreshMarker(prevItem);
    }
    if (this.selectedId) {
      const item = this.getSelected();
      if (item) this.refreshMarker(item);
    }
    if (notify) this.callbacks.onSelect?.(this.selectedId);
  }

  updateItem(id, patch, options = {}) {
    const item = this.getItem(id);
    if (!item) return null;
    Object.assign(item, patch);
    if (patch.color || patch.shape) this.refreshMarker(item);
    if (options.structural) this.callbacks.onChange?.(options.reason || 'update', item);
    return item;
  }

  setAction(id, action) {
    const item = this.getItem(id);
    if (!item) return;
    item.action = action;
    this.callbacks.onChange?.('action', item);
  }

  moveItem(id, position) {
    const item = this.getItem(id);
    if (!item) return;
    item.position = position;
    if (item.sprite) item.sprite.position.fromArray(position);
  }

  deleteItem(id, { silent = false } = {}) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return;
    const item = this.items[index];
    this.disposeSprite(item);
    this.items.splice(index, 1);
    if (this.selectedId === id) {
      this.selectedId = this.items.length ? this.items[Math.min(index, this.items.length - 1)].id : null;
    }
    this.rebuildNumbers();
    if (!silent) {
      this.callbacks.onChange?.('delete', item);
      this.callbacks.onSelect?.(this.selectedId);
      this.callbacks.onToast?.(`Hotspot “${item.label}” removed`, 'ok');
    }
  }

  deleteSelected() {
    if (this.selectedId) this.deleteItem(this.selectedId);
  }

  toJSON() {
    return this.items.map((item) => ({
      id: item.id,
      label: item.label,
      position: item.position.slice(),
      color: item.color,
      size: item.size,
      shape: item.shape,
      icon: item.icon || null,
      hoverAnim: item.hoverAnim || 'scale',
      action: JSON.parse(JSON.stringify(item.action)),
    }));
  }

  async loadIcon(dataUrl) {
    if (!dataUrl) return null;
    if (this._iconImages.has(dataUrl)) return this._iconImages.get(dataUrl);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode hotspot image'));
      img.src = dataUrl;
    });
    this._iconImages.set(dataUrl, image);
    return image;
  }

  async setIcon(id, dataUrl) {
    const item = this.getItem(id);
    if (!item) return null;
    item.icon = dataUrl || null;
    if (item.icon) {
      try {
        await this.loadIcon(item.icon);
      } catch (error) {
        item.icon = null;
      }
    }
    this.refreshMarker(item);
    this.callbacks.onChange?.('icon', item);
    return item.icon;
  }

  loadState(list) {
    if (!this.root) return false;
    this.clearItems();
    const normalized = [];
    (Array.isArray(list) ? list : []).forEach((raw, index) => {
      const item = normalizeItem(raw, index);
      if (item) normalized.push(item);
    });
    this.items = normalized;
    this.rebuildNumbers();
    this.callbacks.onChange?.('load');
    this.callbacks.onSelect?.(null);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Placement                                                       */
  /* ---------------------------------------------------------------- */
  setPlacing(active) {
    const next = !!active && !!this.root;
    if (this.placing === next) return;
    this.placing = next;
    document.body.classList.toggle('placing', next);
    this.hideTooltip();
    if (next) this.select(null);
    this.callbacks.onPlacing?.(next);
  }

  beginPlacing() {
    if (!this.root) {
      this.callbacks.onToast?.('Load a model first', 'err');
      return;
    }
    this.setPlacing(true);
  }

  addAtWorld(worldPoint) {
    if (!this.root) return null;
    const local = this.root.worldToLocal(worldPoint.clone());
    const index = this.items.length;
    const label = `Hotspot ${index + 1}`;
    const item = {
      id: makeId(),
      label,
      position: [local.x, local.y, local.z],
      color: COLORS[index % COLORS.length],
      size: 1,
      shape: 'pin',
      icon: null,
      hoverAnim: 'scale',
      action: {
        type: 'popup',
        title: label,
        text: 'Add a description, an image, or change this action in the Hotspots panel.',
        image: null,
      },
      sprite: null,
      texture: null,
    };
    this.items.push(item);
    this.createSprite(item);
    this.rebuildNumbers();
    this.select(item.id);
    this.callbacks.onChange?.('add', item);
    this.callbacks.onToast?.(`Hotspot “${label}” added — drag to reposition`, 'ok');
    return item;
  }

  /* ---------------------------------------------------------------- */
  /* Sprites                                                         */
  /* ---------------------------------------------------------------- */
  createSprite(item) {
    const texture = this.makeMarkerTexture(item);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.position.fromArray(item.position);
    sprite.renderOrder = 999;
    sprite.userData.hotspotId = item.id;
    this.group.add(sprite);
    item.sprite = sprite;
    item.texture = texture;
    this.updateSpriteScale(item);
    if (item.icon) {
      this.loadIcon(item.icon)
        .then(() => this.refreshMarker(item))
        .catch(() => {});
    }
  }

  disposeSprite(item) {
    if (!item.sprite) return;
    this.group.remove(item.sprite);
    if (item.sprite.material) {
      if (item.sprite.material.map) item.sprite.material.map.dispose();
      item.sprite.material.dispose();
    }
    item.sprite = null;
    item.texture = null;
  }

  rebuildNumbers() {
    for (const item of this.items) {
      if (!item.sprite) this.createSprite(item);
      else this.refreshMarker(item);
    }
  }

  rebuildSprites() {
    for (const item of this.items) this.disposeSprite(item);
    for (const item of this.items) this.createSprite(item);
  }

  refreshMarker(item) {
    if (!item.sprite) return;
    const old = item.sprite.material.map;
    const texture = this.makeMarkerTexture(item);
    item.sprite.material.map = texture;
    item.sprite.material.needsUpdate = true;
    if (old) old.dispose();
    item.texture = texture;
    this.updateSpriteScale(item);
  }

  makeMarkerTexture(item) {
    const index = this.items.indexOf(item);
    const selected = item.id === this.selectedId;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const color = item.color || '#ffb454';

    ctx.save();
    ctx.translate(128, 128);

    if (selected) {
      ctx.beginPath();
      ctx.arc(0, 0, 118, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.shadowColor = color;
    ctx.shadowBlur = selected ? 46 : 26;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';

    const r = 86;

    if (item.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (item.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.12);
      ctx.lineTo(r * 1.12, 0);
      ctx.lineTo(0, r * 1.12);
      ctx.lineTo(-r * 1.12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (item.shape === 'square') {
      ctx.beginPath();
      const s = r * 0.92;
      const rad = 24;
      ctx.roundRect(-s, -s, s * 2, s * 2, rad);
      ctx.fill();
      ctx.stroke();
    } else if (item.shape === 'ring') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // pin
      ctx.beginPath();
      ctx.moveTo(0, 118);
      ctx.bezierCurveTo(-16, 74, -r, 34, -r, -14);
      ctx.arc(0, -14, r, Math.PI, 0, false);
      ctx.bezierCurveTo(r, 34, 16, 74, 0, 118);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    const iconImage = item.icon ? this._iconImages.get(item.icon) : null;
    if (iconImage) {
      const cx = 0;
      const cy = item.shape === 'pin' ? -14 : 0;
      const ir = item.shape === 'pin' ? 52 : 64;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, ir, 0, Math.PI * 2);
      ctx.clip();
      const side = Math.min(iconImage.width, iconImage.height);
      const sx = (iconImage.width - side) / 2;
      const sy = (iconImage.height - side) / 2;
      ctx.drawImage(iconImage, sx, sy, side, side, cx - ir, cy - ir, ir * 2, ir * 2);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, ir, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 6;
      ctx.stroke();

      const bx = 58;
      const by = 66;
      const br = 28;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,10,14,0.9)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 34px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), bx, by + 1);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 92px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ty = item.shape === 'pin' ? -24 : 4;
      ctx.strokeStyle = 'rgba(20,16,8,0.55)';
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round';
      ctx.strokeText(String(index + 1), 0, ty);
      ctx.fillText(String(index + 1), 0, ty);
    }
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.userData.mimeType = 'image/webp';
    texture.needsUpdate = true;
    return texture;
  }

  updateSpriteScale(item) {
    if (!item.sprite || !this.root) return;
    const camera = this.viewer.camera;
    const height = this.viewer.renderer.domElement.clientHeight || window.innerHeight;
    item.sprite.getWorldPosition(TMP_WORLD);
    const distance = Math.max(0.001, camera.position.distanceTo(TMP_WORLD));
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const pixels = 46 * (item.size || 1);
    const worldSize = 2 * distance * Math.tan(vFov / 2) * (pixels / Math.max(height, 1));
    let boost = 1;
    if (item.id === this._hoverId && !this._drag) {
      const anim = item.hoverAnim || 'scale';
      if (anim === 'scale') boost = 1.25;
      else if (anim === 'pulse') boost = 1 + 0.08 * Math.sin(performance.now() / 170);
      else if (anim === 'fade') boost = 1.06;
    }
    const scale = (worldSize / Math.max(this.rootScale, 0.0001)) * boost;
    item.sprite.scale.set(scale, scale, 1);
  }

  updateFrame() {
    if (!this.items.length || !this.root) return;
    this.rootScale = this.getRootScale();
    for (const item of this.items) this.updateSpriteScale(item);
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                         */
  /* ---------------------------------------------------------------- */
  trigger(item) {
    if (!item) return;
    const action = item.action;
    if (!action) return;

    if (action.type === 'popup') {
      this.callbacks.onPopup?.(item);
      return;
    }

    if (action.type === 'camera') {
      if (!action.position || !action.target) {
        this.callbacks.onToast?.('No camera view saved for this hotspot yet', 'err');
        return;
      }
      const position = new THREE.Vector3().fromArray(action.position);
      const target = new THREE.Vector3().fromArray(action.target);
      this.viewer.flyTo(position, target, 1100);
      this.callbacks.onToast?.(`Moving camera to “${item.label}”`, 'ok');
      return;
    }

    if (action.type === 'material') {
      const object = this.model.resolvePath(action.targetPath);
      const entry = this.model.findMaterialByRef({
        name: action.materialName,
        index: action.materialIndex,
        id: action.materialId,
      });
      if (!object || !entry) {
        this.callbacks.onToast?.('Material action is not configured', 'err');
        return;
      }
      object.material = entry.material;
      this.callbacks.onToast?.(`Material “${entry.name}” applied`, 'ok');
      return;
    }

    if (action.type === 'visibility') {
      const object = this.model.resolvePath(action.targetPath);
      if (!object) {
        this.callbacks.onToast?.('Visibility target is missing', 'err');
        return;
      }
      if (action.mode === 'show') object.visible = true;
      else if (action.mode === 'hide') object.visible = false;
      else object.visible = !object.visible;
      this.callbacks.onToast?.(`${object.visible ? 'Shown' : 'Hidden'}: ${action.targetLabel || 'object'}`, 'ok');
    }
  }

  actionLabel(action) {
    if (!action) return 'None';
    if (action.type === 'material') return action.materialName ? `Material · ${action.materialName}` : 'Material';
    if (action.type === 'visibility') return `Visibility · ${action.mode}`;
    return ACTION_LABEL[action.type] || action.type;
  }

  /* ---------------------------------------------------------------- */
  /* Pointer interaction                                             */
  /* ---------------------------------------------------------------- */
  _bindPointerEvents() {
    const canvas = this.viewer.renderer.domElement;

    this._onPointerDown = (event) => {
      if (event.button !== 0) return;

      if (this.placing) {
        this._placingDown = { x: event.clientX, y: event.clientY };
        return;
      }

      const hits = this.viewer.raycast(event, this.sprites());
      if (!hits.length) return;

      const id = hits[0].object.userData.hotspotId;
      const item = this.getItem(id);
      if (!item) return;

      event.stopPropagation();
      event.preventDefault();
      this.viewer._tween = null;
      this._drag = {
        item,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        controlsEnabled: this.viewer.controls.enabled,
      };
      this.viewer.controls.enabled = false;
      this.hideTooltip();
      this.select(item.id);
    };

    this._onPointerMove = (event) => {
      if (this._drag) {
        const dx = event.clientX - this._drag.startX;
        const dy = event.clientY - this._drag.startY;
        if (!this._drag.moved && Math.hypot(dx, dy) > 4) {
          this._drag.moved = true;
          this.viewer.renderer.domElement.style.cursor = 'grabbing';
        }
        if (this._drag.moved) {
          const point = this.pickSurface(event);
          if (point) {
            const local = this.root.worldToLocal(point.clone());
            this.moveItem(this._drag.item.id, [local.x, local.y, local.z]);
          }
        }
        return;
      }

      if (this.placing) return;

      const hits = this.viewer.raycast(event, this.sprites());
      if (hits.length) {
        const item = this.getItem(hits[0].object.userData.hotspotId);
        if (item) {
          if (this._hoverId !== item.id) {
            this._hoverId = item.id;
            this.applyTooltipAnim(item);
          }
          this.viewer.renderer.domElement.style.cursor = 'pointer';
          this.showTooltip(item, event.clientX, event.clientY);
          return;
        }
      }
      this._hoverId = null;
      this.viewer.renderer.domElement.style.cursor = '';
      this.hideTooltip();
    };

    this._onPointerUp = (event) => {
      if (this._drag) {
        const drag = this._drag;
        this._drag = null;
        this.viewer.controls.enabled = drag.controlsEnabled;
        this.viewer.renderer.domElement.style.cursor = '';
        if (drag.moved) {
          this.callbacks.onChange?.('move', drag.item);
          this.callbacks.onPosition?.(drag.item);
        } else {
          this.trigger(drag.item);
        }
        return;
      }

      if (this.placing && this._placingDown) {
        const dist = Math.hypot(event.clientX - this._placingDown.x, event.clientY - this._placingDown.y);
        this._placingDown = null;
        if (dist > 6) return;
        const point = this.pickSurface(event, false);
        if (point) {
          this.addAtWorld(point);
          this.setPlacing(false);
        } else {
          this.callbacks.onToast?.('Click directly on the model to place a hotspot', 'err');
        }
      }
    };

    this._onPointerLeave = () => {
      this._hoverId = null;
      if (!this._drag) this.hideTooltip();
    };

    canvas.addEventListener('pointerdown', this._onPointerDown, true);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointerleave', this._onPointerLeave);
  }

  pickSurface(event, allowGround = true) {
    const meshes = this.model.meshes.filter((mesh) => mesh.visible);
    const hits = this.viewer.raycast(event, meshes);
    if (hits.length) return hits[0].point;
    if (!allowGround) return null;

    // fall back to the ground plane so markers can be dragged off the model
    const raycaster = this.viewer.setPointerFromEvent(event);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.viewer.bbox.min.y);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  sprites() {
    return this.items.map((item) => item.sprite).filter(Boolean);
  }

  applyTooltipAnim(item) {
    const anim = ['none', 'fade', 'scale', 'pulse'].includes(item.hoverAnim) ? item.hoverAnim : 'scale';
    this.tooltip.className = `hotspot-tooltip anim-${anim}`;
    void this.tooltip.offsetWidth;
  }

  showTooltip(item, x, y) {
    this.tooltip.hidden = false;
    this.tooltip.querySelector('b').textContent = item.label;
    this.tooltip.querySelector('span').textContent = this.actionLabel(item.action);
    const pad = 14;
    const rect = this.tooltip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }

  setMarkersVisible(visible) {
    this.group.visible = visible;
  }
}
