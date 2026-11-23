/*
 * Inside a villa — a plain-JS copy of the real-estate VillaTour (src/components/ComplexApp.tsx):
 *   tabs "المخطط 3D" (turning 360° pictures of the villa type, one set per floor) and "جولة 360°"
 *   (the walk-through, Visite360Viewer), fullscreen button, side panel with the villa facts, plan,
 *   favourite heart and the contact form (DetailLead → /api/leads). Same classes, so villa.css
 *   (copied from real-estate) gives the same look. On phones the side panel is a sheet you drag.
 */
import {
    COMPLEX, STATUS_AR, modelOf, tourVillaUrl, tourPlanDetailUrl,
} from './villa-data.js?v=1';

const PHONE_LAYOUT_MQ = '(max-width: 1366px), (max-width: 1400px) and (pointer: coarse)';
const phoneMq = window.matchMedia(PHONE_LAYOUT_MQ);
const syncPhoneClass = () => document.documentElement.classList.toggle('phone-layout', phoneMq.matches);
syncPhoneClass();
phoneMq.addEventListener('change', syncPhoneClass);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (paths, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
    back: svg('<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>'),
    full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', 20),
    fullExit: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M8 21v-3a2 2 0 0 0-2-2H3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>', 20),
    chevron: (cls) => `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
    heart: (filled, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
    ruler: svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>', 20).replace('stroke-width="2"', 'stroke-width="1.8"'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 20).replace('stroke-width="2"', 'stroke-width="1.8"'),
};
const FIELD_MARK = '<svg class="field-mark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.35" fill="#fff" stroke="#D83848" stroke-width="1.6"/><text x="8" y="8.7" text-anchor="middle" dominant-baseline="middle" fill="#D83848" font-size="11" font-weight="700" font-family="Arial, sans-serif">!</text></svg>';

export const favs = () => { try { return JSON.parse(localStorage.getItem('axis-favs') || '[]'); } catch { return []; } };
function toggleFav(id) {
    const cur = favs();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    localStorage.setItem('axis-favs', JSON.stringify(next));
    return next.includes(id);
}

let current = null; /* { root, cleanup[], onClose, pushed } */

export function isTourOpen() {
    return !!current;
}

export function closeVillaTour(goBack = true) {
    if (!current) return;
    const { cleanup, onClose, pushed, host } = current;
    current = null;
    cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    host.innerHTML = '';
    host.classList.remove('open');
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
    if (goBack && pushed) {
        history.back();
    } else if (new URLSearchParams(location.search).has('villa')) {
        const u = new URL(location.href);
        u.searchParams.delete('villa');
        history.replaceState(null, '', u);
    }
    onClose?.();
}

export function openVillaTour({ unit, tour, onClose, pushUrl = true }) {
    if (current) closeVillaTour(false);
    const host = document.getElementById('villa-tour');
    const cleanup = [];
    let pushed = false;
    if (pushUrl) {
        const u = new URL(location.href);
        u.searchParams.set('villa', unit.displayId);
        history.pushState({ axisVilla: unit.id }, '', u);
        pushed = true;
    }
    current = { host, cleanup, onClose, pushed };

    const floors = COMPLEX.villa360.floors;
    /* always open on the top floor (Final) */
    let floor = floors.find((f) => f.id === 'etage_2')?.id ?? floors[floors.length - 1]?.id ?? '';
    let tab = 'plan';
    const liked = () => favs().includes(unit.id);

    host.innerHTML = `
    <div class="detail">
      <div class="detail-body">
        <div class="detail-stage">
          <div class="detail-top">
            <button type="button" class="tool-back" aria-label="رجوع">${ICON.back}</button>
            <div class="detail-tabs" dir="ltr">
              <button type="button" class="on" data-tab="plan"><bdi dir="rtl">المخطط 3D</bdi></button>
              <button type="button" data-tab="visit"><bdi dir="rtl">جولة 360°</bdi></button>
            </div>
          </div>
          <div class="stage-content"></div>
          <button type="button" class="detail-full" title="ملء الشاشة" aria-label="ملء الشاشة">${ICON.full}</button>
        </div>
        <aside class="detail-side form-mode">
          <div class="sheet-handle"></div>
          <div class="side-head" dir="rtl">
            <div>
              <div class="side-project">${esc(tour.name)}</div>
              <h2>فيلا استثمارية <bdi dir="ltr">${esc(unit.displayId)}</bdi></h2>
            </div>
            <span class="side-badge st-${unit.status}">${STATUS_AR[unit.status] ?? unit.status}</span>
          </div>
          <div class="side-stats" dir="rtl">
            <div><span>النموذج</span><b>${esc(modelOf(unit))}</b></div>
            <div><span>الطوابق</span><b>${unit.floor}</b></div>
            <div><span>غرف النوم</span><b>${unit.rooms}</b></div>
            <div><span>المساحة</span><b>${unit.surface}</b></div>
          </div>
          <div class="plan-wrap">
            ${tourPlanDetailUrl(tour, unit) ? `<img src="${esc(tourPlanDetailUrl(tour, unit))}" alt="">` : ''}
            <button type="button" class="heart${liked() ? ' on' : ''}" aria-label="Favorite" aria-pressed="${liked()}">${ICON.heart(liked())}</button>
          </div>
          ${leadFormHtml(tour, liked())}
        </aside>
      </div>
    </div>`;
    host.classList.add('open');

    const detail = host.querySelector('.detail');
    const stageContent = host.querySelector('.stage-content');
    const side = host.querySelector('.detail-side');
    const heartBtn = host.querySelector('.plan-wrap .heart');
    const favBox = host.querySelector('input[name="favorites"]');

    host.querySelector('.tool-back').addEventListener('click', () => closeVillaTour(true));

    const setLiked = (on) => {
        heartBtn.classList.toggle('on', on);
        heartBtn.setAttribute('aria-pressed', String(on));
        heartBtn.innerHTML = ICON.heart(on);
        if (favBox) favBox.checked = on;
    };
    heartBtn.addEventListener('click', () => setLiked(toggleFav(unit.id)));
    favBox?.addEventListener('change', () => setLiked(toggleFav(unit.id)));

    /* ---- fullscreen ---- */
    const fullBtn = host.querySelector('.detail-full');
    /* iPad / older Safari only know the webkit-prefixed fullscreen */
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const syncFull = () => {
        const on = Boolean(fsEl());
        fullBtn.classList.toggle('on', on);
        fullBtn.innerHTML = on ? ICON.fullExit : ICON.full;
        fullBtn.title = on ? 'خروج من ملء الشاشة' : 'ملء الشاشة';
        fullBtn.setAttribute('aria-label', fullBtn.title);
    };
    const el = document.documentElement;
    const canFull = !!(el.requestFullscreen || el.webkitRequestFullscreen);
    if (!canFull) fullBtn.style.display = 'none'; /* iPhone: no fullscreen API */
    fullBtn.addEventListener('click', () => {
        if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
        else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    });
    document.addEventListener('fullscreenchange', syncFull);
    document.addEventListener('webkitfullscreenchange', syncFull);
    cleanup.push(() => {
        document.removeEventListener('fullscreenchange', syncFull);
        document.removeEventListener('webkitfullscreenchange', syncFull);
    });

    /* ---- tabs: plan (Spin360 + floors) / visit (Visite360) ---- */
    let stageCleanup = null;
    function renderStage() {
        stageCleanup?.();
        stageCleanup = null;
        stageContent.innerHTML = '';
        detail.classList.toggle('visit-full', tab === 'visit');
        side.hidden = tab === 'visit';
        host.querySelectorAll('.detail-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
        if (tab === 'plan') {
            const folder = () => floors.find((f) => f.id === floor)?.subfolder ?? floors[0]?.subfolder ?? 'RDC';
            const spin = createSpin360(stageContent, tour, unit.type, folder());
            const bar = document.createElement('div');
            bar.className = 'floor-float';
            bar.setAttribute('role', 'tablist');
            bar.setAttribute('aria-label', 'Floors');
            bar.innerHTML = floors.map((f) => `<button type="button" role="tab" data-floor="${f.id}" aria-selected="${floor === f.id}" class="${floor === f.id ? 'on' : ''}">${f.label}</button>`).join('');
            bar.addEventListener('click', (e) => {
                const b = e.target.closest('button[data-floor]');
                if (!b) return;
                floor = b.dataset.floor;
                bar.querySelectorAll('button').forEach((x) => {
                    x.classList.toggle('on', x === b);
                    x.setAttribute('aria-selected', String(x === b));
                });
                spin.setFolder(folder());
            });
            stageContent.appendChild(bar);
            stageCleanup = () => spin.dispose();
        } else {
            const visit = createVisite360(stageContent, '10000');
            stageCleanup = () => visit.dispose();
        }
    }
    host.querySelector('.detail-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (!b || b.dataset.tab === tab) return;
        tab = b.dataset.tab;
        renderStage();
    });
    renderStage();
    cleanup.push(() => stageCleanup?.());

    /* ---- phone: the side panel is a sheet (opens at 52%, pulled to 60% → full screen) ---- */
    setupPhoneSheet(detail, side, cleanup);

    /* ---- contact form ---- */
    setupLeadForm(host.querySelector('form.lead'), unit, tour, cleanup);
}

/* ------------------------------------------------------------------ *
 *  Spin360 — the villa type turning, one picture per angle (60 per floor)
 * ------------------------------------------------------------------ */
function createSpin360(parent, tour, type, startFolder) {
    const n = tour.villaFrames;
    const frontFrame = n ? Math.min(n - 1, COMPLEX.villa360.frontFrame ?? 0) : 0;
    let folder = startFolder;
    let pos = frontFrame;            /* total frames turned (never wraps) */
    let images = [];
    let pending = new Map();
    let generation = 0;
    let stopped = false;
    const idxOf = (p) => (n > 0 ? ((p % n) + n) % n : 0);

    const wrap = document.createElement('div');
    wrap.className = 'spin-wrap';
    wrap.innerHTML = `<canvas></canvas><div class="tour-load" dir="rtl">جارٍ التحميل…</div>
        <div class="spin compass">
            <button type="button" aria-label="تدوير لليسار" data-dir="-1">‹</button>
            <span class="compass-face" aria-hidden="true"><i class="compass-ptr"></i><b>N</b></span>
            <button type="button" aria-label="تدوير لليمين" data-dir="1">›</button>
        </div>`;
    parent.appendChild(wrap);
    const canvas = wrap.querySelector('canvas');
    const loadEl = wrap.querySelector('.tour-load');
    const ptr = wrap.querySelector('.compass-ptr');
    const dirEl = wrap.querySelector('.compass-face b');
    const setLoading = (on) => { loadEl.style.display = on ? '' : 'none'; };

    const floorCfg = () => COMPLEX.villa360.floors.find((f) => f.subfolder.toLowerCase() === folder.toLowerCase());

    function draw(i) {
        const img = images[i];
        if (!img?.complete || !img.naturalWidth) return;
        const ctx = canvas.getContext('2d');
        if (!ctx || wrap.clientWidth < 2 || wrap.clientHeight < 2) return;
        const w = Math.max(1, wrap.clientWidth);
        const h = Math.max(1, wrap.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = Math.round(w * dpr);
        const ch = Math.round(h * dpr);
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#E8EDF2';
        ctx.fillRect(0, 0, w, h);
        const f = floorCfg() ?? {};
        const zoom = f.zoom ?? 1, shiftX = f.shiftX ?? 0, shiftY = f.shiftY ?? 0, rotate = f.rotate ?? 0, pivotY = f.pivotY ?? 0.5;
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dy = Math.min(dh * shiftY, Math.max(0, (dh - h) / 2));
        const x = (w - dw) / 2;
        const y = (h - dh) / 2 + dy;
        ctx.drawImage(img, x, y, dw, dh);
        if (rotate) {
            const px = x + dw / 2;
            const py = y + dh * pivotY;
            ctx.save();
            ctx.translate(px + dw * shiftX, py);
            ctx.rotate((rotate * Math.PI) / 180);
            ctx.translate(-px, -py);
            ctx.drawImage(img, x, y, dw, dh);
            ctx.restore();
        }
    }

    function ensureFrame(i) {
        if (!n) return Promise.resolve();
        const index = idxOf(i);
        const existing = images[index];
        if (existing?.complete && existing.naturalWidth) {
            if (idxOf(pos) === index) { setLoading(false); draw(index); }
            return Promise.resolve();
        }
        if (pending.has(index)) return pending.get(index);
        const offset = floorCfg()?.frameOffset ?? 0;
        const src = tourVillaUrl(tour, type, folder, (index + offset) % n);
        if (!src) { setLoading(false); return Promise.resolve(); }
        const gen = generation;
        const img = existing ?? new Image();
        images[index] = img;
        img.decoding = 'async';
        const promise = new Promise((resolve) => {
            const finish = (ok) => {
                resolve();
                if (gen !== generation) return;
                pending.delete(index);
                if (idxOf(pos) !== index) return;
                setLoading(false);
                if (ok) draw(index);
            };
            img.onload = () => {
                const p = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
                p.then(() => finish(true), () => finish(Boolean(img.naturalWidth)));
            };
            img.onerror = () => finish(false);
        });
        pending.set(index, promise);
        if (img.src !== src) img.src = src;
        return promise;
    }

    function warmAround(center) {
        ensureFrame(center);
        for (let d = 1; d <= 4; d++) { ensureFrame(center + d); ensureFrame(center - d); }
    }

    const ready = (i) => { const img = images[i]; return Boolean(img?.complete && img.naturalWidth); };

    function show() {
        const idx = idxOf(pos);
        const headingDeg = n > 0 ? (pos / n) * 360 : 0;
        const normDeg = ((headingDeg % 360) + 360) % 360;
        ptr.style.transform = `rotate(${headingDeg}deg)`;
        dirEl.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(normDeg / 45) % 8];
        warmAround(idx);
        if (ready(idx)) { setLoading(false); draw(idx); return; }
        /* frame not downloaded yet: keep turning on the nearest one we have instead of freezing;
           the real frame replaces it as soon as it arrives (ensureFrame draws it) */
        for (let d = 1; d <= n / 2; d++) {
            const near = ready(idxOf(idx + d)) ? idxOf(idx + d) : ready(idxOf(idx - d)) ? idxOf(idx - d) : -1;
            if (near >= 0) { setLoading(false); draw(near); return; }
        }
        setLoading(true); /* nothing of this floor yet (first opening) */
    }

    /* draw at most once per screen refresh, however many moves arrive in between */
    let showQueued = 0;
    const requestShow = () => {
        if (!showQueued) showQueued = requestAnimationFrame(() => { showQueued = 0; if (!stopped) show(); });
    };

    function loadFloor() {
        generation += 1;
        images = [];
        pending = new Map();
        setLoading(true);
        show();
        /* background: every frame of this floor, nearest to the current view first, 4 at a time */
        const myGen = generation;
        const queue = [];
        const start = idxOf(pos);
        for (let d = 5; d <= Math.ceil(n / 2); d++) queue.push(start + d, start - d);
        const worker = async () => {
            while (!stopped && myGen === generation && queue.length) {
                const at = idxOf(pos);
                const dist = (i) => { const k = (((i - at) % n) + n) % n; return Math.min(k, n - k); };
                queue.sort((a, b) => dist(a) - dist(b));
                await ensureFrame(queue.shift());
            }
        };
        for (let w = 0; w < 4; w++) void worker();
    }

    const spin = (dir) => { if (n > 0) { pos += dir; requestShow(); } };

    /* turning by pixels: the house follows the finger exactly (fast swipe = several frames),
       the leftover pixels are kept so slow drags stay precise */
    const STEP_PX = 8;                 /* pixels per frame, as before */
    let acc = 0;
    function turnBy(px) {
        if (!n) return;
        acc += px;
        const frames = Math.trunc(acc / STEP_PX);
        if (frames) { acc -= frames * STEP_PX; pos += frames; requestShow(); }
    }

    /* momentum after letting go */
    let velocity = 0;                  /* px per ms, in "turn" direction */
    let glide = 0;
    const stopGlide = () => { if (glide) { cancelAnimationFrame(glide); glide = 0; } };
    function startGlide() {
        stopGlide();
        if (Math.abs(velocity) < 0.15) return;
        let last = performance.now();
        const step = (now) => {
            const dt = Math.min(48, now - last);
            last = now;
            turnBy(velocity * dt);
            velocity *= Math.pow(0.93, dt / 16.7);
            glide = !stopped && Math.abs(velocity) > 0.03 ? requestAnimationFrame(step) : 0;
        };
        glide = requestAnimationFrame(step);
    }

    /* drag: the house follows the finger */
    let dragging = false, lastX = 0, lastT = 0;
    wrap.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.compass')) return;
        stopGlide();
        dragging = true;
        lastX = e.clientX;
        lastT = performance.now();
        velocity = 0;
        acc = 0;
        e.target.setPointerCapture?.(e.pointerId);
    });
    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        if (performance.now() - lastT > 80) velocity = 0; /* finger stopped before lifting: no glide */
        startGlide();
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const now = performance.now();
        const px = -(e.clientX - lastX); /* finger right → house turns the same way as before */
        const dt = Math.max(1, now - lastT);
        velocity = velocity * 0.6 + (px / dt) * 0.4; /* smoothed speed for the glide */
        lastX = e.clientX;
        lastT = now;
        turnBy(px);
    });

    /* mouse wheel / trackpad turns the house too */
    const onWheel = (e) => {
        if (e.target.closest('.compass')) return;
        e.preventDefault();
        stopGlide();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        turnBy((e.deltaMode === 1 ? d * 16 : d) * 0.5);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });

    /* arrows: hold to keep turning */
    let hold = null;
    const stopHold = () => { if (hold != null) { clearInterval(hold); hold = null; } };
    wrap.querySelectorAll('.compass button').forEach((b) => {
        const dir = Number(b.dataset.dir);
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            stopHold();
            stopGlide();
            b.setPointerCapture?.(e.pointerId);
            spin(dir);
            hold = setInterval(() => spin(dir), 70);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, stopHold));
    });

    const onResize = () => draw(idxOf(pos));
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => requestAnimationFrame(() => requestAnimationFrame(onResize)))
        : null;
    ro?.observe(wrap);

    loadFloor();

    return {
        /* new floor: stay on the same side */
        setFolder(f) {
            folder = f;
            loadFloor();
        },
        dispose() {
            stopped = true;
            stopHold();
            stopGlide();
            if (showQueued) cancelAnimationFrame(showQueued);
            wrap.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', onResize);
            ro?.disconnect();
            wrap.remove();
        },
    };
}

/* ------------------------------------------------------------------ *
 *  Visite 360 — the walk-through (same engine as real-estate)
 * ------------------------------------------------------------------ */
const ROOM_AR = {
    Entrance: 'المدخل', 'Living Room': 'غرفة المعيشة', Kitchen: 'المطبخ', 'Dining Room': 'غرفة الطعام',
    Majlis: 'المجلس', Staircase: 'الدرج', 'Upper Hall': 'الصالة العلوية', 'Shared Bathroom': 'دورة المياه المشتركة',
    'Roof Hall': 'صالة السطح', 'Guest WC': 'دورة مياه الضيوف',
};
const FLOOR_AR = { ground: 'الدور الأرضي', first: 'الدور الأول', roof: 'السطح' };
function roomAr(lb) {
    if (!lb) return lb;
    if (ROOM_AR[lb]) return ROOM_AR[lb];
    const bath = /^Bedroom (\d+) Bathroom$/.exec(lb);
    if (bath) return `دورة مياه غرفة النوم ${bath[1]}`;
    const bed = /^Bedroom (\d+)$/.exec(lb);
    if (bed) return `غرفة النوم ${bed[1]}`;
    return lb;
}

let visiteImageBase = '';
export function setVisiteImageBase(supabaseUrl, slug) {
    /* panorama cubemaps live in Supabase Storage: media/<slug>/visite360/<res>/<id>_<face>.jpg */
    visiteImageBase = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/media/${slug}/visite360` : '';
}

function createVisite360(parent, startId) {
    const base = `/complexes/${COMPLEX.slug}/visite360`;
    const host = document.createElement('div');
    host.className = 'visite360 detail-visit';
    host.innerHTML = `<canvas class="visite360-canvas"></canvas>
        <div class="visite360-loading"><span class="visite360-spinner"></span><span dir="rtl">جارٍ تحميل الجولة 360°…</span></div>`;
    parent.appendChild(host);
    const canvas = host.querySelector('canvas');
    const loading = host.querySelector('.visite360-loading');
    let engine = null;
    let disposed = false;
    let measuring = false;
    let tour = null;
    let currentId = '';
    let measureCount = 0;

    const caption = document.createElement('div');
    caption.className = 'visite360-caption';
    caption.dir = 'rtl';
    caption.setAttribute('aria-live', 'polite');
    const sideEl = document.createElement('div');
    sideEl.className = 'visite360-side';
    const rail = document.createElement('div');
    rail.className = 'visite360-rooms';
    rail.dir = 'rtl';
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-label', 'الغرف');

    function render() {
        if (!tour) return;
        const camById = new Map(tour.cameras.map((c) => [c.n, c]));
        const cur = camById.get(currentId);
        const floors = tour.floors ?? [];
        const active = floors.find((f) => f.id === cur?.floor) ?? floors[0];
        caption.innerHTML = cur ? `${floors.length > 1 && active ? `<span>${esc(active.label)}</span>` : ''}${cur.lb ? `<strong>${esc(cur.lb)}</strong>` : ''}` : '';
        sideEl.innerHTML = `<div class="visite360-measure-tools">
                <button type="button" class="visite360-tool${measuring ? ' on' : ''}" data-act="measure" title="${measuring ? 'إيقاف القياس' : 'قياس المسافة'}" aria-pressed="${measuring}">${ICON.ruler}${measureCount > 0 ? `<span class="tool-count">${measureCount}</span>` : ''}</button>
                ${measureCount > 0 ? `<button type="button" class="visite360-tool" data-act="clear" title="مسح القياسات">${ICON.trash}</button>` : ''}
            </div>
            ${floors.length > 1 ? `<div class="visite360-floors" role="tablist" aria-label="الطوابق">${[...floors].reverse().map((f) => `<button type="button" role="tab" data-room="${esc(f.rooms[0] ?? '')}" aria-selected="${f.id === active?.id}" class="${f.id === active?.id ? 'on' : ''}">${esc(f.label)}</button>`).join('')}</div>` : ''}`;
        const rooms = (active?.rooms ?? []).map((id) => ({ id, label: camById.get(id)?.lb ?? id }));
        rail.innerHTML = rooms.map((r) => `<button type="button" role="tab" data-node="${esc(r.id)}" aria-selected="${r.id === currentId}" class="${r.id === currentId ? 'on' : ''}">${esc(r.label)}</button>`).join('');
        rail.style.display = rooms.length ? '' : 'none';
        rail.querySelector(`[data-node="${CSS.escape(currentId)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    sideEl.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || !engine) return;
        if (b.dataset.act === 'measure') { measuring = !measuring; engine.setMeasureMode(measuring); render(); }
        else if (b.dataset.act === 'clear') engine.clearMeasurements();
        else if (b.dataset.room) engine.teleportTo(b.dataset.room);
    });

    /* rooms rail: click a room, or click-hold and drag to scroll it */
    let railDown = false, dragged = false, sx = 0, ss = 0;
    rail.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        railDown = true; dragged = false; sx = e.clientX; ss = rail.scrollLeft;
    });
    const railMove = (e) => {
        if (!railDown) return;
        const dx = e.clientX - sx;
        if (Math.abs(dx) > 4) dragged = true;
        if (dragged) rail.scrollLeft = ss - dx;
    };
    const railUp = () => { railDown = false; };
    window.addEventListener('pointermove', railMove);
    window.addEventListener('pointerup', railUp);
    rail.addEventListener('click', (e) => {
        if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; return; }
        const b = e.target.closest('button[data-node]');
        if (b && engine) engine.teleportTo(b.dataset.node);
    }, true);

    (async () => {
        try {
            const [{ Visite360Engine }, res] = await Promise.all([
                import('./visite360-engine.js?v=1'),
                fetch(`${base}/tour.json`),
            ]);
            if (!res.ok) throw new Error(`tour.json ${res.status}`);
            const data = await res.json();
            data.floors = data.floors?.map((f) => ({ ...f, label: FLOOR_AR[f.id] ?? f.label }));
            data.cameras = data.cameras.map((c) => ({ ...c, lb: roomAr(c.lb) }));
            if (disposed) return;
            if (startId && data.cameras.some((c) => c.n === startId)) data.startCamera = startId;
            tour = data;
            currentId = data.startCamera ?? data.cameras[0]?.n ?? '';
            engine = new Visite360Engine({
                canvas,
                overlay: host,
                baseUrl: base,
                imageBaseUrl: visiteImageBase || undefined,
                dracoPath: '/draco/',
                tour: data,
                onCameraChange: (id) => { if (!disposed) { currentId = id; render(); } },
                onArrive: (id) => { if (!disposed) { currentId = id; render(); } },
                onFirstFrame: () => {
                    if (disposed) return;
                    loading.classList.add('is-done');
                    host.append(caption, sideEl, rail);
                    render();
                },
                onError: (m) => showError(m),
                onMeasurementsChange: (count) => { if (!disposed) { measureCount = count; render(); } },
            });
            await engine.start();
        } catch (e) {
            showError(e instanceof Error ? e.message : 'تعذّر تحميل الجولة الافتراضية');
        }
    })();

    function showError(m) {
        if (disposed) return;
        loading.classList.add('is-done');
        const el = document.createElement('div');
        el.className = 'visite360-error';
        el.textContent = m;
        host.appendChild(el);
    }

    return {
        dispose() {
            disposed = true;
            window.removeEventListener('pointermove', railMove);
            window.removeEventListener('pointerup', railUp);
            engine?.dispose();
            host.remove();
        },
    };
}

/* ------------------------------------------------------------------ *
 *  Phone sheet (side panel dragged up / down)
 * ------------------------------------------------------------------ */
function setupPhoneSheet(detail, side, cleanup) {
    const SHEET_OPEN = 0.52;
    const SHEET_SNAP_FULL = 0.6;
    let height = SHEET_OPEN;
    let drag = null;
    const handle = side.querySelector('.sheet-handle');
    const apply = () => {
        const phone = phoneMq.matches;
        detail.classList.toggle('phone-sheet', phone);
        detail.classList.toggle('sheet-settle', phone && !drag);
        detail.classList.toggle('sheet-full', phone && height >= 0.99);
        handle.style.display = phone ? '' : 'none';
        const css = `min(${(height * 100).toFixed(2)}vh, 100%)`;
        if (phone) {
            detail.style.setProperty('--sheet-h', css);
            side.style.height = css;
        } else {
            detail.style.removeProperty('--sheet-h');
            side.style.height = '';
        }
    };
    handle.addEventListener('pointerdown', (e) => {
        if (!phoneMq.matches) return;
        handle.setPointerCapture(e.pointerId);
        drag = { startY: e.clientY, startH: height, h: height };
        apply();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dy = drag.startY - e.clientY;
        drag.h = Math.min(1, Math.max(0.25, drag.startH + dy / window.innerHeight));
        height = drag.h;
        apply();
    });
    const up = (e) => {
        if (!drag) return;
        try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        const { startH, h } = drag;
        drag = null;
        if (startH >= 0.99) height = h < 0.92 ? Math.min(h, SHEET_OPEN) : 1;
        else if (h >= SHEET_SNAP_FULL) height = 1;
        else if (h > SHEET_OPEN) height = SHEET_OPEN;
        apply();
    };
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    phoneMq.addEventListener('change', apply);
    cleanup.push(() => phoneMq.removeEventListener('change', apply));
    apply();
}

/* ------------------------------------------------------------------ *
 *  Contact form (DetailLead + PhoneField)
 * ------------------------------------------------------------------ */
const DIAL_CODES = [
    { d: '+966', n: 'Arabie saoudite' }, { d: '+216', n: 'Tunisie' }, { d: '+213', n: 'Algérie' },
    { d: '+212', n: 'Maroc' }, { d: '+20', n: 'Égypte' }, { d: '+971', n: 'EAU' }, { d: '+965', n: 'Koweït' },
    { d: '+974', n: 'Qatar' }, { d: '+973', n: 'Bahreïn' }, { d: '+968', n: 'Oman' }, { d: '+962', n: 'Jordanie' },
    { d: '+961', n: 'Liban' }, { d: '+963', n: 'Syrie' }, { d: '+964', n: 'Irak' }, { d: '+967', n: 'Yémen' },
    { d: '+970', n: 'Palestine' }, { d: '+218', n: 'Libye' }, { d: '+222', n: 'Mauritanie' }, { d: '+249', n: 'Soudan' },
    { d: '+90', n: 'Turquie' }, { d: '+33', n: 'France' }, { d: '+32', n: 'Belgique' }, { d: '+41', n: 'Suisse' },
    { d: '+49', n: 'Allemagne' }, { d: '+39', n: 'Italie' }, { d: '+34', n: 'Espagne' }, { d: '+44', n: 'Royaume-Uni' },
    { d: '+1', n: 'États-Unis / Canada' }, { d: '+92', n: 'Pakistan' }, { d: '+91', n: 'Inde' },
];
const NAME_DIGIT = /[0-9٠-٩۰-۹]/;
const PHONE_LETTER = /[A-Za-zÀ-ɏ؀-ۿ]/;

function splitDialPrefix(value) {
    const m = value.match(/^\s*(?:\+|00)([\d\s().-]*)$/);
    if (!m) return null;
    const raw = m[1];
    const digits = raw.replace(/\D/g, '');
    const best = DIAL_CODES.map((c) => c.d.slice(1)).filter((code) => digits.startsWith(code)).sort((a, b) => b.length - a.length)[0];
    if (!best) return null;
    let seen = 0, i = 0;
    while (i < raw.length && seen < best.length) { if (/\d/.test(raw[i])) seen++; i++; }
    const after = raw.slice(i);
    if (!after) return null;
    return { dial: `+${best}`, rest: after.replace(/^[\s().-]+/, '') };
}

function telFromForm(fd) {
    const dial = String(fd.get('dial') || '+216').trim();
    const num = String(fd.get('tel') || '').trim().replace(/[\s.-]/g, '');
    if (!num) return '';
    if (num.startsWith('+')) return num;
    return `${dial}${num.replace(/^0+/, '')}`;
}

function emailHasAtAndDot(email) {
    const at = email.indexOf('@');
    if (at <= 0 || /\s/.test(email) || email.indexOf('@', at + 1) !== -1) return false;
    const rest = email.slice(at + 1);
    const dot = rest.indexOf('.');
    return dot > 0 && dot < rest.length - 1;
}

function contactIssues(input) {
    const out = {};
    if (!input.gender) out.gender = 'اختر اللقب: السيدة أو السيد أو لا';
    if (!input.nom) out.nom = 'أدخل اسم العائلة';
    else if (NAME_DIGIT.test(input.nom)) out.nom = 'لا يمكن أن يحتوي اسم العائلة على أرقام';
    if (!input.prenom) out.prenom = 'أدخل الاسم الأول';
    else if (NAME_DIGIT.test(input.prenom)) out.prenom = 'لا يمكن أن يحتوي الاسم الأول على أرقام';
    if (!input.email) out.email = 'أدخل بريدك الإلكتروني';
    else if (!emailHasAtAndDot(input.email)) out.email = 'يجب أن يحتوي البريد على @ ونقطة بعده';
    if (!input.tel) out.tel = 'أدخل رقم هاتفك';
    else if (PHONE_LETTER.test(input.tel)) out.tel = 'لا يمكن أن يحتوي رقم الهاتف على حروف';
    return out;
}

function leadFormHtml(tour, liked) {
    return `<form class="lead side" novalidate dir="rtl">
      <div class="contact-info">
        <img src="${esc(tour.logoUrl || COMPLEX.logoPath)}" alt="" class="contact-logo">
        <div class="contact-lines">
          <span class="contact-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
          <b>${esc(tour.name)}</b>
          <span class="contact-ico" aria-hidden="true"><svg width="16" height="12" viewBox="0 0 20 15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1.5" width="18" height="12" rx="2"/><path d="m1.5 2.5 8.5 6.5 8.5-6.5"/></svg></span>
          <a href="mailto:${COMPLEX.contactEmail}">${COMPLEX.contactEmail}</a>
          <span class="contact-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
          <a href="tel:${COMPLEX.contactTel}" class="contact-tel">+966 57 555 5782</a>
        </div>
      </div>
      <p class="contact-ask">تحديد نوع الاستفسار</p>
      <div class="contact-genders">${['السيدة', 'السيد', 'لا'].map((g) => `<button type="button" data-gender="${g}" aria-pressed="false">${g}</button>`).join('')}</div>
      <p class="field-msg" data-err="gender" hidden></p>
      <label data-field="nom">اسم العائلة<input name="nom" placeholder="أدخل اسم العائلة" autocomplete="family-name"><span class="field-msg" data-err="nom" hidden></span></label>
      <label data-field="prenom">الاسم الأول<input name="prenom" placeholder="أدخل الاسم الأول" autocomplete="given-name"><span class="field-msg" data-err="prenom" hidden></span></label>
      <label data-field="email">البريد الإلكتروني<input name="email" type="email" placeholder="أدخل بريدك الإلكتروني" autocomplete="email" inputmode="email"><span class="field-msg" data-err="email" hidden></span></label>
      <label data-field="tel">رقم الهاتف
        <span class="phone-row">
          <span class="select-wrap">
            <input type="hidden" name="dial" value="+966">
            <button type="button" class="dial-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="رمز الدولة">${ICON.chevron('chev')}<span class="dial-val">+966</span></button>
          </span>
          <input name="tel" type="tel" autocomplete="tel" inputmode="tel" placeholder="أدخل رقم هاتفك">
        </span>
        <span class="field-msg" data-err="tel" hidden></span>
      </label>
      <label>هل لديك رسالة لنا؟<textarea name="message" rows="3" placeholder="اكتب رسالتك هنا..."></textarea></label>
      <label class="lead-check"><input type="checkbox" name="favorites" value="1"${liked ? ' checked' : ''}>إرسال إلى المفضلة</label>
      <p class="lead-ok" role="status" hidden>تم إرسال طلبك بنجاح.</p>
      <button type="submit">إرسال طلبك</button>
    </form>`;
}

function setupLeadForm(form, unit, tour, cleanup) {
    let gender = '';
    let busy = false;
    const genders = form.querySelector('.contact-genders');
    const okEl = form.querySelector('.lead-ok');
    const submitBtn = form.querySelector('button[type="submit"]');

    const setErr = (key, msg) => {
        const el = form.querySelector(`[data-err="${key}"]`);
        if (!el) return;
        el.hidden = !msg;
        el.innerHTML = msg ? `${FIELD_MARK}${esc(msg)}` : '';
        if (key === 'gender') genders.classList.toggle('bad', !!msg);
        else {
            const label = form.querySelector(`[data-field="${key}"]`);
            label?.classList.toggle('bad', !!msg);
            label?.querySelector('input')?.setAttribute('aria-invalid', String(!!msg));
        }
    };

    genders.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-gender]');
        if (!b) return;
        gender = b.dataset.gender;
        genders.querySelectorAll('button').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-pressed', String(x === b));
        });
        setErr('gender', '');
    });
    ['nom', 'prenom', 'email', 'tel'].forEach((k) => form.querySelector(`[name="${k}"]`).addEventListener('input', () => setErr(k, '')));

    /* phone: country code list */
    const dialInput = form.querySelector('input[name="dial"]');
    const dialBtn = form.querySelector('.dial-btn');
    const dialVal = form.querySelector('.dial-val');
    const wrapEl = form.querySelector('.select-wrap');
    let list = null;
    const setDial = (d) => { dialInput.value = d; dialVal.textContent = d; };
    const closeList = () => {
        list?.remove();
        list = null;
        wrapEl.classList.remove('open');
        dialBtn.setAttribute('aria-expanded', 'false');
        dialBtn.querySelector('.chev')?.classList.remove('up');
    };
    const placeList = (e) => {
        if (!list || (e && e.target?.closest?.('.dial-list'))) return;
        const r = dialBtn.getBoundingClientRect();
        const width = Math.max(r.width, 72);
        list.style.top = `${r.bottom + 6}px`;
        list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
        list.style.width = `${width}px`;
    };
    dialBtn.addEventListener('click', () => {
        if (list) { closeList(); return; }
        list = document.createElement('ul');
        list.className = 'dial-list';
        list.setAttribute('role', 'listbox');
        list.innerHTML = DIAL_CODES.map((c) => `<li role="presentation"><button type="button" role="option" title="${c.n}" data-d="${c.d}" aria-selected="${c.d === dialInput.value}" class="${c.d === dialInput.value ? 'on' : ''}">${c.d}</button></li>`).join('');
        list.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-d]');
            if (!b) return;
            setDial(b.dataset.d);
            closeList();
        });
        document.body.appendChild(list);
        wrapEl.classList.add('open');
        dialBtn.setAttribute('aria-expanded', 'true');
        dialBtn.querySelector('.chev')?.classList.add('up');
        placeList();
        const on = list.querySelector('button.on');
        if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2;
    });
    const onDoc = (e) => {
        if (!list || wrapEl.contains(e.target) || e.target.closest?.('.dial-list')) return;
        closeList();
    };
    const onKey = (e) => { if (e.key === 'Escape') closeList(); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', placeList);
    window.addEventListener('scroll', placeList, true);
    cleanup.push(() => {
        closeList();
        document.removeEventListener('pointerdown', onDoc);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', placeList);
        window.removeEventListener('scroll', placeList, true);
    });
    const telInput = form.querySelector('input[name="tel"]');
    telInput.addEventListener('input', () => {
        const hit = splitDialPrefix(telInput.value);
        if (!hit) return;
        setDial(hit.dial);
        telInput.value = hit.rest;
        telInput.setSelectionRange?.(hit.rest.length, hit.rest.length);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const fd = new FormData(form);
        const payload = {
            gender,
            nom: String(fd.get('nom') ?? ''),
            prenom: String(fd.get('prenom') ?? ''),
            email: String(fd.get('email') ?? ''),
            tel: String(fd.get('tel') ?? ''),
            message: String(fd.get('message') ?? ''),
            toFavorites: Boolean(fd.get('favorites')),
            favoriteUnits: fd.get('favorites') ? [unit.displayId] : [],
            unitId: unit.id,
            unitDisplayId: unit.displayId,
            /* the project slug, so the request is linked to the project in the dashboards */
            complex: tour.slug || COMPLEX.slug,
            source: 'villa-tour',
        };
        const issues = contactIssues(payload);
        ['gender', 'nom', 'prenom', 'email', 'tel'].forEach((k) => setErr(k, issues[k] || ''));
        if (Object.keys(issues).length) return;
        busy = true;
        okEl.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الإرسال...';
        try {
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, tel: telFromForm(fd) }),
            });
            if (!res.ok) throw new Error('fail');
            form.reset();
            setDial('+966');
            gender = '';
            genders.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
            okEl.hidden = false;
        } catch {
            setErr('email', 'تعذر الإرسال، حاول مرة أخرى.');
        } finally {
            busy = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'إرسال طلبك';
        }
    });
}
