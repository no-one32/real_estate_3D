/*
 * Villas on the 3D model — the same behaviour as the real-estate project (OrbitEngine + ComplexApp):
 *  - Interactive.glb carries one invisible shape per villa (named 10, 10.001 … in the file);
 *    villa-map.json links each real-estate unit id (units.mesh_id) to its shape.
 *  - mouse over a villa: it is tinted with its status colour (green available, orange reserved,
 *    red sold) and the villa card follows the mouse;
 *  - eye button: every villa shows its colour, villas not for sale (Rectangle001) in grey;
 *  - 1st click: the camera flies to the villa, it stays tinted, "click again to enter" card;
 *  - 2nd click (or a click on that card): inside the villa (villa-tour.js);
 *  - click on empty ground: back to the overall view.
 */
import {
    COMPLEX, STATUS_COLOR, STATUS_AR, loadTour, cardPhoto, unitPrice, sarParts,
} from './villa-data.js?v=1';
import { openVillaTour, closeVillaTour, isTourOpen, setVisiteImageBase, favs } from './villa-tour.js?v=2';

const SHAPE_RE = /^\d+$/;               /* "10.001" in the file → "10001" once loaded by three.js */
const NOT_FOR_SALE_SHAPE = 'Rectangle001';
const OTHER_VILLA_COLOR = 0x6b7682;
const OTHER_VILLA_OPACITY = 0.45;

/** true for the villa shapes (not part of the real model: no shadows, no material tweaks). */
export function isVillaShape(obj) {
    return SHAPE_RE.test(obj.name) || obj.name === NOT_FOR_SALE_SHAPE;
}

const heartSvg = (filled, size = 12) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
const eyeSvg = (on) =>
    `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>${on ? '' : '<path d="M4 20 20 4"/>'}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initVillas({ THREE, scene, camera, controls, renderer, root, normScale, hotspots, homeView }) {
    const hud = document.getElementById('villa-hud');
    const eyeBtn = document.getElementById('eyeBtn');
    const canvas = renderer.domElement;

    /* ---------- shapes: hidden, not hit by the other rays (pins), own material ---------- */
    const shapesByName = {};
    const otherMeshes = [];
    const noRay = () => {};
    root.traverse((obj) => {
        if (!obj.isMesh || !isVillaShape(obj)) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.raycast = noRay;           /* the pins' "stick to the surface" rays must not land on them */
        obj.visible = false;
        obj.renderOrder = 1;
        const isOther = obj.name === NOT_FOR_SALE_SHAPE;
        obj.material = new THREE.MeshBasicMaterial({
            color: isOther ? OTHER_VILLA_COLOR : STATUS_COLOR.available,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            fog: false,
        });
        obj.userData.targetOpacity = 0;
        if (isOther) otherMeshes.push(obj);
        else shapesByName[obj.name] = obj;
    });

    const unitMeshes = {};   /* unit id → shape */
    const units = {};        /* unit id → unit */
    let tour = null;
    let overlayVisible = false;
    let hoveredId = null;
    let focusedId = null;    /* the villa that was clicked (stays tinted) */
    let approaching = false;
    let enterWhenLanded = false;

    const meshRaycast = THREE.Mesh.prototype.raycast;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();

    /* ---------- data (Supabase like real-estate, units.json otherwise) ---------- */
    Promise.all([loadTour(), fetch('./villa-map.json').then((r) => r.json())]).then(([t, map]) => {
        tour = t;
        setVisiteImageBase(t.config?.supabaseUrl, t.slug);
        for (const u of t.units) {
            const mesh = shapesByName[map[u.id]];
            if (!mesh) continue;
            units[u.id] = u;
            unitMeshes[u.id] = mesh;
            mesh.userData.unitId = u.id;
        }
        syncMeshVisibility();
        console.log(`villas: ${Object.keys(units).length} villas (${t.source})`);
        /* opened with ?villa=T1-001: straight inside that villa, like /digital-twins/<slug>/<villa> */
        const want = new URLSearchParams(location.search).get('villa');
        const u = want && Object.values(units).find((x) => x.displayId === want);
        if (u) enter(u, false);
    }).catch((e) => console.warn('villas: data failed', e));

    function paint(mesh, unit) {
        mesh.material.color.setHex(STATUS_COLOR[unit.status] ?? 0x94a3b0);
    }

    /* same rules as OrbitEngine.syncMeshVisibility */
    function syncMeshVisibility() {
        for (const mesh of otherMeshes) {
            if (overlayVisible) mesh.visible = true;
            mesh.userData.targetOpacity = overlayVisible ? OTHER_VILLA_OPACITY : 0;
        }
        for (const [id, mesh] of Object.entries(unitMeshes)) {
            const unit = units[id];
            paint(mesh, unit);
            const highlighted = focusedId === id || hoveredId === id;
            if (highlighted || overlayVisible) mesh.visible = true;
            if (highlighted) mesh.userData.targetOpacity = COMPLEX.hoverOverlayOpacity;
            else if (overlayVisible) mesh.userData.targetOpacity = COMPLEX.showAllOpacity;
            else mesh.userData.targetOpacity = 0;
        }
    }

    /* ---------- eye ---------- */
    if (eyeBtn) {
        eyeBtn.innerHTML = eyeSvg(false);
        eyeBtn.addEventListener('click', () => {
            overlayVisible = !overlayVisible;
            eyeBtn.classList.toggle('on', overlayVisible);
            eyeBtn.setAttribute('aria-pressed', String(overlayVisible));
            eyeBtn.innerHTML = eyeSvg(overlayVisible);
            syncMeshVisibility();
        });
    }

    /* ---------- picking ---------- */
    function hit(e) {
        const r = canvas.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hits = [];
        for (const mesh of Object.values(unitMeshes)) meshRaycast.call(mesh, raycaster, hits);
        hits.sort((a, b) => a.distance - b.distance);
        const id = hits[0]?.object.userData.unitId;
        return id ? units[id] : null;
    }

    /** screen point above the top-centre of the villa (where the hover card sits) */
    function topOf(mesh) {
        box.setFromObject(mesh);
        v.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    }

    /* ---------- hover card (MiniUnitCard) ---------- */
    const tipCard = document.createElement('div');
    tipCard.className = 'tip follow tip-card';
    tipCard.style.display = 'none';
    hud.appendChild(tipCard);
    let tipFor = null;

    function miniCard(unit) {
        const photo = cardPhoto(tour, unit);
        const liked = favs().includes(unit.id);
        const price = sarParts(unitPrice(unit));
        return `<div class="units cards"><div class="unit">
            <div class="card-side">
                ${photo ? `<img src="${esc(photo)}" alt="">` : '<span class="card-img-fallback"></span>'}
                <span class="${liked ? 'heart on' : 'heart'}">${heartSvg(liked)}</span>
            </div>
            <div class="card-copy">
                <div class="card-availability">
                    <div class="card-identity">
                        <strong>${esc(unit.displayId)}</strong>
                        <span class="card-price" dir="ltr" lang="en"><span class="sar-cur">${price.currency}</span><span class="sar-num">${price.amount}</span></span>
                    </div>
                    <em class="badge ${unit.status}">${STATUS_AR[unit.status]}</em>
                </div>
                <div class="card-divider" aria-hidden="true"></div>
                <div class="card-specs">
                    <span class="spec-rooms"><b>${unit.rooms}</b><small>غرف النوم</small></span>
                    <span class="spec-area"><b>${unit.surface}</b><small>المساحة</small></span>
                    <span class="spec-floor"><b>${unit.floor}</b><small>الطوابق</small></span>
                </div>
            </div>
        </div></div>`;
    }

    function showHover(unit) {
        /* the clicked villa shows the "enter" card instead */
        if (!unit || (focusedId === unit.id && !approaching) || isTourOpen()) {
            tipCard.style.display = 'none';
            tipFor = null;
            return;
        }
        if (tipFor !== unit.id) {
            tipCard.innerHTML = miniCard(unit);
            tipFor = unit.id;
        }
        const p = topOf(unitMeshes[unit.id]);
        tipCard.style.left = `${p.x}px`;
        tipCard.style.top = `${p.y}px`;
        tipCard.style.display = '';
    }

    /* ---------- "click again to enter" card ---------- */
    const tipEnter = document.createElement('div');
    tipEnter.className = 'tip tip-enter';
    tipEnter.style.display = 'none';
    tipEnter.addEventListener('click', () => {
        const u = focusedId && units[focusedId];
        if (u) pick(u);
    });
    hud.appendChild(tipEnter);

    function showEnterCard(unit) {
        if (!unit || isTourOpen()) {
            tipEnter.style.display = 'none';
            return;
        }
        const photo = cardPhoto(tour, unit);
        tipEnter.innerHTML = `${photo ? `<img src="${esc(photo)}" alt="" decoding="async">` : ''}
            <div>
                <div class="tip-head"><b>${esc(unit.displayId)}</b><small class="${unit.status}" dir="rtl">${STATUS_AR[unit.status]}</small></div>
                <em class="hint" dir="rtl">انقر مرة أخرى للدخول</em>
            </div>`;
        tipEnter.style.display = '';
    }

    /* ---------- approach (1st click) / enter (2nd click) ---------- */
    function viewForVilla(mesh) {
        box.setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.45, center.z);
        /* far enough to see the whole villa and its neighbours, seen 22° from above like the pins */
        const dist = Math.max(Math.max(size.x, size.z) * 3.2, controls.minDistance * 1.2);
        const dir = camera.position.clone().sub(controls.target).setY(0);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
        dir.normalize();
        const elev = THREE.MathUtils.degToRad(22);
        const pos = target.clone()
            .addScaledVector(dir, Math.cos(elev) * dist)
            .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
        return { pos, target, dist };
    }

    function approach(unit) {
        const mesh = unitMeshes[unit.id];
        if (!mesh) return;
        hotspots?.close?.(false);
        approaching = true;
        enterWhenLanded = false;
        hoveredId = null;
        focusedId = unit.id;
        syncMeshVisibility();
        showHover(null);
        showEnterCard(unit);
        const view = viewForVilla(mesh);
        hotspots.unlock();
        hotspots.flyTo(view.pos, view.target, 3000, () => {
            approaching = false;
            hotspots.lockOn(view.dist, 20);
            if (enterWhenLanded && focusedId === unit.id) {
                enterWhenLanded = false;
                enter(unit);
            }
        }, 0.65);
    }

    /* same as ComplexApp.pickUnit */
    function pick(unit) {
        if (approaching) {
            if (focusedId === unit.id) enterWhenLanded = true;
            return;
        }
        if (focusedId === unit.id) {
            enter(unit);
            return;
        }
        approach(unit);
    }

    function enter(unit, pushUrl = true) {
        focusedId = unit.id;
        syncMeshVisibility();
        showHover(null);
        tipEnter.style.display = 'none';
        openVillaTour({ unit, tour, onClose: leave, pushUrl });
    }

    /* leaving the villa: back to the overall view (ComplexApp.closeVilla) */
    function leave() {
        focusedId = null;
        hoveredId = null;
        syncMeshVisibility();
        tipEnter.style.display = 'none';
        hotspots.goHome();
    }

    function resetSelection() {
        if (!focusedId) return;
        focusedId = null;
        syncMeshVisibility();
        tipEnter.style.display = 'none';
        hotspots.goHome();
    }

    /* ---------- pointer events (a drag is not a click) ---------- */
    let down = null;
    let lastMove = null;
    /*
     * Tablets / phones: a pinch (2 fingers) or a 2-finger turn must never count as a tap on a villa
     * when the fingers are lifted. Any gesture that had more than one finger down is not a click.
     */
    const fingers = new Set();
    let multiTouch = false;
    canvas.addEventListener('pointerdown', (e) => {
        fingers.add(e.pointerId);
        if (fingers.size > 1) multiTouch = true;
        down = { x: e.clientX, y: e.clientY };
    });
    const fingerUp = (e) => {
        fingers.delete(e.pointerId);
        if (!fingers.size) setTimeout(() => { if (!fingers.size) multiTouch = false; }, 0);
    };
    canvas.addEventListener('pointercancel', (e) => { fingerUp(e); down = null; });
    canvas.addEventListener('pointermove', (e) => {
        lastMove = e;
    });
    canvas.addEventListener('pointerleave', () => {
        lastMove = null;
        if (hoveredId) {
            hoveredId = null;
            syncMeshVisibility();
        }
        showHover(null);
    });
    canvas.addEventListener('pointerup', (e) => {
        /* fingers move a little on a tap: a larger tolerance on touch than with the mouse */
        const tol = e.pointerType === 'touch' ? 12 : 6;
        const moved = !down || multiTouch || Math.hypot(e.clientX - down.x, e.clientY - down.y) > tol;
        fingerUp(e);
        down = null;
        if (moved || isTourOpen() || !tour) return;
        const unit = hit(e);
        if (unit) pick(unit);
        else if (!approaching) resetSelection();   /* don't reset mid-flight */
    });

    function hoverAt(e) {
        if (isTourOpen() || approaching || down) return;
        /* touch screens have no hover: the first tap approaches directly */
        if (e.pointerType === 'touch') return;
        const unit = hit(e);
        const id = unit?.id ?? null;
        if (id !== hoveredId) {
            hoveredId = id;
            syncMeshVisibility();
        }
        canvas.style.cursor = unit ? 'pointer' : '';
        showHover(unit);
    }

    /* ---------- every frame: hover (once per frame), opacity fades ---------- */
    function update() {
        if (lastMove && tour) {
            hoverAt(lastMove);
            lastMove = null;
        } else if (hoveredId && unitMeshes[hoveredId] && tipCard.style.display !== 'none') {
            /* the camera may still be gliding: keep the card on the villa */
            const p = topOf(unitMeshes[hoveredId]);
            tipCard.style.left = `${p.x}px`;
            tipCard.style.top = `${p.y}px`;
        }
        for (const m of [...Object.values(unitMeshes), ...otherMeshes]) {
            const target = m.userData.targetOpacity;
            const mat = m.material;
            if (Math.abs(mat.opacity - target) > 0.002) mat.opacity += (target - mat.opacity) * 0.18;
            else mat.opacity = target;
            if (target === 0 && mat.opacity === 0) m.visible = false;
        }
    }

    window.addEventListener('popstate', () => {
        if (isTourOpen() && !new URLSearchParams(location.search).get('villa')) closeVillaTour(false);
    });

    return { update, isBusy: () => approaching || isTourOpen() };
}
