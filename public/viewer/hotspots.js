/*
 * Hotspots on the 3D model (like the Novoross / Verge3D tour):
 *  - a round icon floats above each place; the mouse over it widens it to show the name;
 *  - clicking it flies the camera close to that place and opens an info panel on the left;
 *  - closing the panel brings the camera back to the overall view;
 *  - far places (the airport) only show their info: the camera does not fly there;
 *  - the "places" list (☰ button) does the same as clicking a pin.
 *
 * Positions are in FINAL.glb coordinates (centimetres, Y up), read off the model's top view.
 * To move a pin: open the viewer with ?edit=1, click on the model, the coordinates are copied
 * (and shown at the bottom); paste them into `at` below.
 */

const ICONS = {
    mosque: '<path d="M4 21V11a8 6 0 0 1 16 0v10M2 21h20M12 2v3M9.5 21v-4a2.5 2.5 0 0 1 5 0v4"/>',
    school: '<path d="m3 9 9-5 9 5-9 5Z"/><path d="M7 11v5c3 2 7 2 10 0v-5M21 9v6"/>',
    park: '<path d="M12 22v-6"/><path d="M8 16h8l-2.5-3.5H16L12 6l-4 6.5h2.5Z"/>',
    play: '<circle cx="12" cy="5" r="2"/><path d="M4 21 9 9h6l5 12M7 15h10"/>',
    building: '<path d="M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2"/>',
    water: '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M12 3s-4 4.5-4 7a4 4 0 0 0 8 0c0-2.5-4-7-4-7Z"/>',
    road: '<path d="M4 21 8 3M20 21 16 3M12 5v2M12 11v2M12 17v2"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
};

/*
 * at:   [x, y, z] in the model (cm). y = height of the pin's foot (top of the building).
 * view: how far the camera stops from the place (cm) when you click it.
 * far:  true = only the info opens, the camera stays where it is (places outside the project).
 * snap: true = the height is taken from the ground under the point when the model loads.
 */
export const HOTSPOTS = [
    { id: 'mosque', icon: 'mosque', title: 'المسجد', at: [11950, 1700, -7000], view: 7000,
      text: 'مسجد الحي في قلب المشروع، بمئذنته وقبّته، على بُعد خطوات من الفلل. يصل إليه السكان مشياً لأداء الصلوات في الأوقات الخمسة.' },
    { id: 'center', icon: 'building', title: 'المركز المجتمعي', at: [18000, 1660, -7900], view: 6500,
      text: 'مبنى الخدمات والأنشطة لسكان المشروع بجانب المسجد، بواجهات زجاجية تطل على الحديقة.' },
    { id: 'park', icon: 'park', title: 'الحديقة', at: [17200, 350, -3000], view: 6000,
      text: 'المساحة الخضراء في وسط المشروع: ممرات للمشي، أشجار نخيل وجلسات للعائلات، بعيداً عن حركة السيارات.' },
    { id: 'school', icon: 'school', title: 'المدرسة', at: [11900, 1400, -800], view: 6000,
      text: 'مدرسة داخل المشروع بساحة واسعة، يصلها الأطفال مشياً من الفلل دون عبور الطريق الرئيسي.' },
    { id: 'play', icon: 'play', title: 'ملعب الأطفال', at: [11000, 360, 4200], view: 3200,
      text: 'منطقة ألعاب آمنة للأطفال بأرضية رملية وألعاب وزحاليق، بجانب المدرسة وتحت نظر الأهل.' },
    { id: 'road', icon: 'road', title: 'الطريق الرئيسي', at: [29300, 60, -9000], view: 14000,
      text: 'الشارع الرئيسي المشجّر على طرف المشروع، يربط الحي بالمدينة ويسهّل الدخول والخروج بالسيارة.' },
    { id: 'lake', icon: 'water', title: 'البحيرة', at: [43000, 0, 0], view: 18000,
      text: 'البحيرة والواجهة المائية على الجانب الشرقي من المشروع، مع ممشى على طول الضفة.' },
    { id: 'villas-north', icon: 'home', title: 'فلل قرب المسجد', at: [9000, 1000, -16500], view: 9000, villa: true,
      text: 'مجموعات من الفلل قريبة من المسجد والمركز المجتمعي، في شوارع داخلية هادئة.' },
    { id: 'villas-west', icon: 'home', title: 'فلل الشوارع الهادئة', at: [-5000, 1000, -6000], view: 10000, villa: true,
      text: 'فلل في شوارع داخلية هادئة بعيداً عن الطريق الرئيسي، مناسبة للعائلات الباحثة عن الهدوء.' },
    { id: 'villas-south', icon: 'home', title: 'فلل قرب المدرسة', at: [5000, 1000, 11000], view: 10000, villa: true,
      text: 'صفوف الفلل المنحنية قرب المدرسة وملعب الأطفال، يصل إليها الأطفال مشياً.' },
    { id: 'villas-east', icon: 'home', title: 'فلل قرب الحديقة', at: [25000, 1000, -8000], view: 9000, villa: true,
      text: 'فلل بين الحديقة والطريق الرئيسي، قريبة من المساحات الخضراء ومن مخرج المشروع.' },
    { id: 'airport', icon: 'plane', title: 'مطار أبها الدولي', at: [-38000, 0, -38000], far: true, snap: true,
      text: 'مطار أبها الدولي على بُعد نحو 25 دقيقة بالسيارة من المشروع، مع رحلات داخلية ودولية.' },
];

const svg = (k, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.home}</svg>`;

export function initHotspots({ THREE, camera, controls, renderer, root, normScale, homeView, editMode }) {
    const layer = document.getElementById('hotspots');
    const card = document.getElementById('hcard');
    const list = document.getElementById('places');
    const listBtn = document.getElementById('placesBtn');
    if (!layer || !card) return null;

    root.updateMatrixWorld(true);
    const toWorld = (p) => root.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));

    const items = HOTSPOTS.map((h) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'hs' + (h.villa ? ' hs-villa' : '') + (h.far ? ' hs-far' : '');
        el.setAttribute('aria-label', h.title);
        el.innerHTML = `<span class="hs-pin">${svg(h.icon)}<b>${h.title}</b></span><i class="hs-stem"></i>`;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            open(h);
        });
        layer.appendChild(el);
        return { h, el, world: toWorld(h.at) };
    });

    /* far places: put the pin on the ground under them (the terrain is not flat) */
    const down = new THREE.Raycaster();
    for (const it of items) {
        if (!it.h.snap) continue;
        const top = toWorld([it.h.at[0], 1e6, it.h.at[2]]);
        down.set(top, new THREE.Vector3(0, -1, 0));
        const hit = down.intersectObject(root, true)[0];
        if (hit) it.world.copy(hit.point);
    }

    /* ---------- places list (like the Novoross side list) ---------- */
    if (list) {
        list.innerHTML = '<h3>الأماكن</h3>' + HOTSPOTS.map((h) =>
            `<button type="button" data-id="${h.id}">${svg(h.icon, 17)}<span>${h.title}</span></button>`).join('');
        list.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-id]');
            if (!b) return;
            const h = HOTSPOTS.find((x) => x.id === b.dataset.id);
            if (h) open(h);
            list.classList.remove('open');
        });
    }
    listBtn?.addEventListener('click', () => list?.classList.toggle('open'));

    /* ---------- camera flight ---------- */
    let flight = null;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    function flyTo(pos, target, ms = 1600) {
        flight = {
            p0: camera.position.clone(), t0: controls.target.clone(),
            p1: pos, t1: target, start: performance.now(), ms,
        };
        controls.enabled = false;
    }

    function viewFor(h) {
        const target = toWorld([h.at[0], h.at[1] * 0.45, h.at[2]]);
        const dist = Math.max(h.view * normScale, controls.minDistance * 1.2);
        /* keep the side the user is looking from, seen from ~35° above */
        const dir = camera.position.clone().sub(controls.target).setY(0);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
        dir.normalize();
        const elev = THREE.MathUtils.degToRad(35);
        const pos = target.clone()
            .addScaledVector(dir, Math.cos(elev) * dist)
            .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
        return { pos, target };
    }

    let current = null;
    function open(h) {
        const wasOpen = !!current;
        current = h;
        /* far places (airport): only the info, the camera stays */
        if (!h.far) {
            const v = viewFor(h);
            flyTo(v.pos, v.target);
        } else if (wasOpen) {
            goHome();
        }
        items.forEach((it) => it.el.classList.toggle('on', it.h === h));
        list?.classList.remove('open'); /* same place on the left as the panel */
        card.innerHTML = `
            <button type="button" class="hc-x" aria-label="إغلاق">×</button>
            <div class="hc-head"><span class="hc-ico">${svg(h.icon, 24)}</span><h2>${h.title}</h2></div>
            <p>${h.text}</p>`;
        card.classList.add('open');
        card.querySelector('.hc-x').onclick = () => close(true);
    }
    /* closing the panel brings back the overall view */
    function close(backHome = false) {
        const had = current;
        current = null;
        card.classList.remove('open');
        items.forEach((it) => it.el.classList.remove('on'));
        if (backHome && had && !had.far) goHome();
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current) close(true);
    });
    function goHome() {
        const { position, target } = homeView();
        flyTo(position.clone(), target.clone(), 1400);
    }

    /* ---------- ?edit=1 : click the model to read coordinates for a new pin ---------- */
    if (editMode) {
        const ray = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let down = null;
        renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
        renderer.domElement.addEventListener('pointerup', (e) => {
            if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
            const r = renderer.domElement.getBoundingClientRect();
            ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(ndc, camera);
            const hit = ray.intersectObject(root, true)[0];
            if (!hit) return;
            const p = root.worldToLocal(hit.point.clone());
            const txt = `at: [${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}]`;
            console.log('HOTSPOT', txt, hit.object.name, hit.object.material?.name);
            navigator.clipboard?.writeText(txt).catch(() => {});
            const t = document.getElementById('editToast');
            if (t) { t.textContent = txt + '  (copied)'; t.classList.add('show'); }
        });
    }

    /* ---------- every frame: flight + pin positions ---------- */
    const v = new THREE.Vector3();
    function update() {
        if (flight) {
            const k = Math.min(1, (performance.now() - flight.start) / flight.ms);
            const e = ease(k);
            camera.position.lerpVectors(flight.p0, flight.p1, e);
            controls.target.lerpVectors(flight.t0, flight.t1, e);
            camera.lookAt(controls.target);
            if (k >= 1) {
                flight = null;
                controls.enabled = true;
                controls.update();
            }
        }
        const w = renderer.domElement.clientWidth;
        const hgt = renderer.domElement.clientHeight;
        const camDist = camera.position.distanceTo(controls.target);
        for (const it of items) {
            v.copy(it.world).project(camera);
            const behind = v.z > 1 || v.z < -1;
            const off = v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
            /* villa-group pins only from far away; once close, the place pins take over */
            const villaHide = it.h.villa && camDist < it.h.view * normScale * 0.6 && current !== it.h;
            if (behind || off || villaHide) {
                it.el.style.display = 'none';
                continue;
            }
            it.el.style.display = '';
            it.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
            it.el.style.zIndex = String(1000 - Math.round(v.z * 500));
        }
    }

    return { update, open, close, goHome, isFlying: () => !!flight };
}
