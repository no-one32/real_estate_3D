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
 * at:   [x, y, z] in the model (cm). y = the surface right under the point (measured with a ray from above),
 *       so the pin sits on the roof / ground and does not slide against the buildings when the camera moves.
 * text: one or more paragraphs of description (Arabic).
 * view: how far the camera stops from the place (cm) when you click it.
 * far:  true = only the info opens, the camera stays where it is (places outside the project).
 * minElev: lowest camera angle above the ground (degrees) when turning around the place (default 20°);
 *       higher where a tall building stands right next to the place (the school next to the playground).
 * snap: true = the height is taken from the ground under the point when the model loads.
 * cam:  the prepared camera of the place (like Novoross): dir = [x, z] direction from the place toward
 *       the camera (model axes), elev = degrees above the ground, dist = cm. To make one: open the viewer
 *       with ?edit=1, click the pin, turn the camera to the wanted view and press C (the line is copied).
 */
export const HOTSPOTS = [
    { id: 'mosque', icon: 'mosque', title: 'المسجد', at: [11950, 1504, -7000], view: 7000,
      /* his photo: in front of the stairs, minaret front-left, school behind */
      cam: { dir: [-0.2, -1], elev: 22, dist: 4500 },
      text: [
        'مسجد الحي في قلب المشروع، بقبّة ذهبية ومئذنة تُرى من معظم الشوارع، يصل إليه السكان مشياً للصلوات الخمس والجمعة.',
        'تحيط به ساحة مفتوحة، ويجاوره المركز الرياضي والحديقة والمدرسة.',
      ],
      facts: ['في وسط المشروع', 'قبّة ومئذنة', 'ساحة حول المسجد', 'قريب من المدرسة والحديقة'] },
    { id: 'center', icon: 'building', title: 'المركز الرياضي', at: [18000, 1328, -7900], view: 6500,
      /* his photo: straight in front of the entrance, low, the mosque on the right */
      cam: { dir: [0, -1], elev: 10, dist: 4200 },
      text: [
        'مبنى متعدد الاستخدامات بجانب المسجد، فوق سطحه ملاعب خضراء لكرة القدم والرياضات الجماعية.',
        'في داخله مساحات للأنشطة واللقاءات، ويطل على الحديقة المركزية على مسافة مشي من الفلل.',
      ],
      facts: ['ملاعب على السطح', 'بجانب المسجد', 'يطل على الحديقة'] },
    { id: 'school', icon: 'school', title: 'المدرسة', at: [11900, 412, -800], view: 6000,
      /* his photo: from the east, over the fence and trees, facing the courtyard with the flag */
      cam: { dir: [1, 0], elev: 18, dist: 5000 },
      text: [
        'مدرسة داخل المشروع من مبنيين تتوسطهما ساحة واسعة يرتفع فيها علم المملكة.',
        'يذهب إليها الأطفال مشياً من الفلل دون عبور الطريق الرئيسي، وبجانبها ملعب الأطفال والحديقة.',
      ],
      facts: ['داخل المشروع', 'ساحة واسعة', 'بجانب ملعب الأطفال', 'بعيدة عن الطريق الرئيسي'] },
    { id: 'play', icon: 'play', title: 'ملعب الأطفال', at: [11350, 28, 4160], view: 3600, minElev: 50,
      text: [
        'منطقة ألعاب مسوّرة بأرضية رملية ناعمة، فيها زحاليق وألعاب تسلّق وحبال.',
        'تحيط بها الأشجار والعشب، بجانب المدرسة وعلى مسافة قصيرة من الفلل، تحت نظر الأهل.',
      ],
      facts: ['مسوّر وآمن', 'أرضية رملية', 'زحاليق وألعاب', 'بجانب المدرسة'] },
    { id: 'villas-north', icon: 'home', title: 'فلل قرب المسجد', at: [10600, 1060, -15800], view: 9000, villa: true,
      text: [
        'فلل في شوارع داخلية هادئة قريبة من المسجد والمركز الرياضي، والحديقة والمدرسة على بُعد دقائق.',
        'ثلاثة نماذج من طابقين مع سطح: 200 م² و4 غرف نوم، 250 م² و5 غرف، 300 م² و6 غرف، ولكل نموذج تصميمان للواجهة (A وB).',
      ],
      facts: ['قريبة من المسجد', 'شوارع داخلية', 'فلل بحدائق خاصة'] },
    { id: 'villas-west', icon: 'home', title: 'فلل الشوارع الهادئة', at: [-3400, 1060, -5800], view: 9000, villa: true,
      text: [
        'فلل في شوارع هادئة بعيدة عن الطريق الرئيسي، للعائلات التي تبحث عن الهدوء والخصوصية.',
        'ثلاثة نماذج من طابقين مع سطح: 200 م² و4 غرف نوم، 250 م² و5 غرف، 300 م² و6 غرف، ولكل نموذج تصميمان للواجهة (A وB).',
      ],
      facts: ['بعيدة عن الطريق الرئيسي', 'هدوء وخصوصية', 'شوارع مشجّرة'] },
    { id: 'villas-south', icon: 'home', title: 'فلل قرب المدرسة', at: [8400, 1060, 11800], view: 9000, villa: true,
      text: [
        'صفوف منحنية قرب المدرسة وملعب الأطفال: يذهب الأطفال إلى المدرسة مشياً دون عبور الطريق الرئيسي.',
        'ثلاثة نماذج من طابقين مع سطح: 200 م² و4 غرف نوم، 250 م² و5 غرف، 300 م² و6 غرف، ولكل نموذج تصميمان للواجهة (A وB).',
      ],
      facts: ['قريبة من المدرسة', 'قريبة من ملعب الأطفال', 'صفوف منحنية'] },
    { id: 'villas-east', icon: 'home', title: 'فلل قرب الحديقة', at: [25000, 1060, -8000], view: 9000, villa: true,
      text: [
        'فلل بين الحديقة والطريق الرئيسي: قريبة من المساحات الخضراء والبحيرة ومن مخرج المشروع.',
        'ثلاثة نماذج من طابقين مع سطح: 200 م² و4 غرف نوم، 250 م² و5 غرف، 300 م² و6 غرف، ولكل نموذج تصميمان للواجهة (A وB).',
      ],
      facts: ['قريبة من الحديقة', 'قريبة من مخرج المشروع', 'قرب البحيرة'] },
    { id: 'airport', icon: 'plane', title: 'مطار أبها الدولي', at: [-61215, 0, -6881], far: true, snap: true,
      text: [
        'المطار الرئيسي في منطقة عسير، على بُعد نحو 25 دقيقة بالسيارة من المشروع.',
        'رحلات داخلية منتظمة إلى الرياض وجدة والدمام، إضافة إلى رحلات دولية.',
      ],
      facts: ['نحو 25 دقيقة بالسيارة', 'رحلات داخلية ودولية'] },
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

    /*
     * Stick every pin onto the real surface under it (roof, dome, ground). A pin anchored even a little
     * in the air (e.g. above a street between two villas) shifts against the houses behind it whenever
     * the camera turns, so it looked like it moved by itself. The ray starts 3 m above the given point
     * (so a point slightly inside a roof still lands on top of it); far places search from the sky.
     */
    const down = new THREE.Raycaster();
    const DOWN = new THREE.Vector3(0, -1, 0);
    /* one pin per idle moment: a ray through the whole model is heavy, doing all at once froze phones */
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
    let snapIndex = 0;
    const snapNext = () => {
        const it = items[snapIndex++];
        if (!it) return;
        const startY = it.h.snap ? 1e6 : it.h.at[1] + 300;
        down.set(toWorld([it.h.at[0], startY, it.h.at[2]]), DOWN);
        const hit = down.intersectObject(root, true)[0];
        if (hit) it.world.copy(hit.point);
        idle(snapNext);
    };
    idle(snapNext);

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
    const _off = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    /*
     * Free movement (overall view) vs. "locked on a place" (after a click, like Novoross):
     * on a place you can turn around it and zoom in / out, but not slide away (no pan, distance kept
     * within a range around the place). Closing the panel gives the free movement back.
     */
    const free = {
        enablePan: controls.enablePan,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        maxPolarAngle: controls.maxPolarAngle,
        /* the calmer handling (app.js) is only for the overall view */
        rotateSpeed: controls.rotateSpeed,
        zoomSpeed: controls.zoomSpeed,
        dampingFactor: controls.dampingFactor,
    };
    function lockOn(dist, minElev = DEFAULT_MIN_ELEV, minDistFactor = 0.5) {
        controls.enablePan = false;
        /* close to a place: the earlier handling, which felt right there */
        controls.rotateSpeed = 0.75;
        controls.zoomSpeed = 0.9;
        controls.dampingFactor = 0.18;
        /* not closer than half the arrival distance: seen this low, closer would go between the villas */
        controls.minDistance = Math.max(0.5, dist * minDistFactor);
        controls.maxDistance = dist * 1.7;
        /*
         * Turning around the place keeps the camera at least `minElev` above the ground (20° by default,
         * from there up to straight down). Together with minDistance it stays above the roofs.
         */
        controls.maxPolarAngle = Math.min(free.maxPolarAngle, THREE.MathUtils.degToRad(90 - minElev));
    }
    function unlock() {
        Object.assign(controls, free);
    }

    /* spin: how far (radians) the camera turns around the place at the end of the flight (one way) */
    function flyTo(pos, target, ms = 1600, onDone = null, spin = 0) {
        /* drop the rotation still gliding from the last drag, so it does not carry on after the flight */
        const damp = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damp;
        flight = {
            p0: camera.position.clone(), t0: controls.target.clone(),
            p1: pos, t1: target, start: performance.now(), ms, onDone, spin,
        };
        if (spin) {
            /* the straight approach ends `spin` short of the final view; the last turn lands exactly on it */
            flight.pPre = target.clone().add(pos.clone().sub(target).applyAxisAngle(_up, -spin));
        }
        controls.enabled = false;
    }

    /*
     * Arrival angle when a pin is clicked: 22° above the ground, so you see the fronts of the houses
     * (35° before showed mostly the roofs). Places with a tall building next to them (minElev) stay higher.
     */
    /* lower than before (22°): the camera arrives nearly at eye level of the facades */
    const DEFAULT_MIN_ELEV = 13;
    const VIEW_ELEV = 15;

    /* ---------- best viewpoint (like the prepared cameras of Novoross) ---------- */
    /*
     * villa-fronts.json: for 132 of the 139 villas, the side of the street door (found from the model:
     * behind a villa the next house is ~25 m away, back-to-back gardens; in front there is the street).
     */
    let fronts = {};
    fetch('./villa-fronts.json').then((r) => r.json()).then((j) => { fronts = j; }).catch(() => {});
    const shapes = [];
    root.traverse((o) => {
        if (o.isMesh && /^\d+$/.test(o.name)) {
            shapes.push({ name: o.name, c: new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) });
        }
    });
    const UP = new THREE.Vector3(0, 1, 0);
    const THREE_QUARTER = 0; /* straight in front of the facade (asked: face the place directly) */

    function currentDir() {
        const d = camera.position.clone().sub(controls.target).setY(0);
        if (d.lengthSq() < 1e-6) d.set(1, 0, 1);
        return d.normalize();
    }

    /** ¾ view of a facade: the front direction turned 25° toward the side the user comes from */
    function threeQuarter(front, prefer) {
        const a = front.clone().applyAxisAngle(UP, THREE_QUARTER);
        const b = front.clone().applyAxisAngle(UP, -THREE_QUARTER);
        return a.dot(prefer) >= b.dot(prefer) ? a : b;
    }

    /**
     * Direction (horizontal, from the target toward the camera) of the best view:
     *  - a villa (shape name given, or the villa nearest to a villa pin): in front of its street door;
     *  - anything else: the side where no houses stand between the camera and the place.
     */
    function viewDir({ target, dist, elev, shape = null, villaArea = false }) {
        const prefer = currentDir();
        let name = shape;
        if (!name && villaArea) {
            let best = Infinity;
            for (const s of shapes) {
                if (!fronts[s.name]) continue;
                const d = Math.hypot(s.c.x - target.x, s.c.z - target.z);
                if (d < best) { best = d; name = s.name; }
            }
        }
        const f = name && fronts[name];
        if (f) return threeQuarter(new THREE.Vector3(f[0], 0, f[1]).normalize(), prefer);

        const L = Math.cos(elev) * dist;
        const W = 1400 * normScale; /* a house closer than ~14 m to the line of sight blocks it */
        let bestDir = prefer, bestScore = Infinity;
        const d = new THREE.Vector3(), rel = new THREE.Vector3();
        for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            d.set(Math.sin(a), 0, Math.cos(a));
            let score = 0;
            for (const s of shapes) {
                rel.subVectors(s.c, target).setY(0);
                const t = rel.dot(d);
                if (t < L * 0.08 || t > L * 1.1) continue;
                const lateral = rel.addScaledVector(d, -t).length();
                if (lateral < W) score += 1 - lateral / W;
            }
            score += 0.4 * (1 - d.dot(prefer)); /* equal views: stay close to where the user is */
            if (score < bestScore) { bestScore = score; bestDir = d.clone(); }
        }
        return bestDir;
    }

    /* villa pins: like his "villas near the school" photo, in front of the doors, 24° up */
    const VILLA_PIN_ELEV = 24;
    function viewFor(h) {
        const target = toWorld([h.at[0], h.at[1] * 0.45, h.at[2]]);
        if (h.cam) {
            /* prepared camera of this place */
            const dist = Math.max(h.cam.dist * normScale, controls.minDistance * 1.2);
            const elev = THREE.MathUtils.degToRad(h.cam.elev);
            const dir = new THREE.Vector3(h.cam.dir[0], 0, h.cam.dir[1]).normalize();
            const pos = target.clone()
                .addScaledVector(dir, Math.cos(elev) * dist)
                .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
            return { pos, target, dist, minElev: Math.max(5, h.cam.elev - 3) };
        }
        const dist = Math.max((h.villa ? h.view * 0.65 : h.view) * normScale, controls.minDistance * 1.2);
        const elev = THREE.MathUtils.degToRad(h.villa ? VILLA_PIN_ELEV : Math.max(VIEW_ELEV, (h.minElev ?? DEFAULT_MIN_ELEV) + 2));
        const dir = viewDir({ target, dist, elev, villaArea: !!h.villa });
        const pos = target.clone()
            .addScaledVector(dir, Math.cos(elev) * dist)
            .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
        return { pos, target, dist, minElev: h.villa ? VILLA_PIN_ELEV - 4 : h.minElev };
    }

    let current = null;
    function open(h) {
        const wasOpen = !!current;
        current = h;
        /* far places (airport): only the info, the camera stays */
        if (!h.far) {
            const v = viewFor(h);
            unlock();
            flyTo(v.pos, v.target, 3400, () => lockOn(v.dist, v.minElev), 0.3);
        } else if (wasOpen) {
            goHome();
        }
        items.forEach((it) => it.el.classList.toggle('on', it.h === h));
        list?.classList.remove('open'); /* same place on the left as the panel */
        /* picture of the place, rendered from the model (places/<id>.webp); none for far places */
        const img = h.far ? '' : `<img class="hc-img" src="./places/${h.id}.webp" alt="${h.title}" loading="lazy" onerror="this.remove()">`;
        card.innerHTML = `
            ${img}
            <button type="button" class="hc-x" aria-label="إغلاق">×</button>
            <div class="hc-body">
                <div class="hc-head"><span class="hc-ico">${svg(h.icon, 24)}</span><h2>${h.title}</h2></div>
                ${(Array.isArray(h.text) ? h.text : [h.text]).map((t) => `<p>${t}</p>`).join('')}
                ${h.facts?.length ? `<ul class="hc-facts">${h.facts.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
            </div>`;
        card.classList.toggle('has-img', !!img);
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
        unlock();
        const { position, target } = homeView();
        flyTo(position.clone(), target.clone(), 1400);
    }

    /* ---------- ?edit=1 : click the model to read coordinates for a new pin ---------- */
    if (editMode) {
        /* C: copy the prepared camera ("cam") of the open place from the current view */
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'c' || !current || current.far) return;
            const off = camera.position.clone().sub(controls.target);
            const len = off.length();
            const flat = Math.hypot(off.x, off.z) || 1;
            const elev = Math.round(THREE.MathUtils.radToDeg(Math.asin(off.y / len)));
            const txt = `cam: { dir: [${(off.x / flat).toFixed(3)}, ${(off.z / flat).toFixed(3)}], elev: ${elev}, dist: ${Math.round(len / normScale)} },  // ${current.id}`;
            console.log('CAM', txt);
            navigator.clipboard?.writeText(txt).catch(() => {});
            const t = document.getElementById('editToast');
            if (t) { t.textContent = txt + '  (copied)'; t.classList.add('show'); }
        });
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
    const _d = new THREE.Vector3();
    /* sin(14°): a pin must be seen at least 14° from above; sin(22°): the camera must look down 22° for far pins */
    const PIN_MIN = Math.sin(THREE.MathUtils.degToRad(14));
    const LOOK_MIN = Math.sin(THREE.MathUtils.degToRad(22));
    function update() {
        if (flight) {
            const k = Math.min(1, (performance.now() - flight.start) / flight.ms);
            const e = ease(k);
            if (flight.spin) {
                /*
                 * Click on a pin / a house: the camera flies in a straight line toward the front of the
                 * place (no more swinging around it, which looked strange when the front was on the other
                 * side), then a small turn at the end (~17°) settles it exactly in front, softly.
                 *   a:    the approach (done at 70% of the flight, slowing down)
                 *   turn: the last small turn (from 45% to the end, soft start and stop)
                 */
                const a = easeOutCubic(Math.min(1, k / 0.7));
                const turn = easeInOutSine(THREE.MathUtils.clamp((k - 0.45) / 0.55, 0, 1));
                controls.target.lerpVectors(flight.t0, flight.t1, a);
                _off.lerpVectors(flight.p0, flight.pPre, a).sub(controls.target)
                    .applyAxisAngle(_up, flight.spin * turn);
                camera.position.copy(controls.target).add(_off);
            } else {
                controls.target.lerpVectors(flight.t0, flight.t1, e);
                camera.position.lerpVectors(flight.p0, flight.p1, e);
            }
            camera.lookAt(controls.target);
            if (k >= 1) {
                const done = flight.onDone;
                flight = null;
                done?.();
                controls.enabled = true;
                /* no leftover glide from before the flight: the camera stays exactly on the chosen view */
                const damp = controls.enableDamping;
                controls.enableDamping = false;
                controls.update();
                controls.enableDamping = damp;
            }
        }
        /*
         * The camera matrix is only refreshed inside renderer.render(), which runs after this. Without
         * this line the pins were placed with the previous frame's camera, so they lagged behind the
         * model and seemed to float / slide over the buildings while the camera moved.
         */
        camera.updateMatrixWorld();
        const w = renderer.domElement.clientWidth;
        const hgt = renderer.domElement.clientHeight;
        const camDist = camera.position.distanceTo(controls.target);
        _d.subVectors(camera.position, controls.target);
        const camLook = _d.y / Math.max(_d.length(), 1e-6); /* sin of how steeply the camera looks down */
        /* pins only in the overall view, seen from high up (like Novoross): zooming in hides them */
        const home = homeView();
        const overview = !current && !flight && camDist >= home.position.distanceTo(home.target) * 0.45;
        for (const it of items) {
            v.copy(it.world).project(camera);
            const behind = v.z > 1 || v.z < -1;
            const off = v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
            /* a pin right next to the camera would swing across the screen at the smallest move */
            const tooClose = camera.position.distanceTo(it.world) < camDist * 0.3;
            if (behind || off || tooClose) {
                it.el.style.display = 'none';
                continue;
            }
            it.el.style.display = '';
            /*
             * Pins are drawn over the 3D view, so the walls cannot hide them. Show a pin only when it is
             * seen from above (like the places in the overall view): seen almost level, from the street,
             * it is behind the houses → it fades out. The place that was clicked keeps its pin.
             */
            let seen;
            if (current) {
                /* on a place: only its own pin */
                seen = current === it.h;
            } else if (!overview) {
                seen = false;
            } else {
                if (it.h.far) {
                    /* far places (airport): only while the camera looks down on the project */
                    seen = camLook >= LOOK_MIN;
                } else {
                    _d.subVectors(camera.position, it.world);
                    seen = _d.y / Math.max(_d.length(), 1e-6) >= PIN_MIN;
                }
            }
            it.el.classList.toggle('hs-hide', !seen);
            it.el.style.transform = `translate3d(${Math.round(((v.x + 1) / 2) * w)}px, ${Math.round(((1 - v.y) / 2) * hgt)}px, 0)`;
            it.el.style.zIndex = String(1000 - Math.round(v.z * 500));
        }
    }

    /* flyTo / lockOn / unlock are shared with the villas (villas.js): same flight and handling */
    return { update, open, close, goHome, flyTo, lockOn, unlock, viewDir, isOpen: () => !!current, isFlying: () => !!flight };
}
