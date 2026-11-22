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
 * minElev: lowest camera angle above the ground (degrees) when turning around the place (default 28°);
 *       higher where a tall building stands right next to the place (the school next to the playground).
 * snap: true = the height is taken from the ground under the point when the model loads.
 */
export const HOTSPOTS = [
    { id: 'mosque', icon: 'mosque', title: 'المسجد', at: [11950, 1504, -7000], view: 7000,
      text: [
        'مسجد الحي في قلب المشروع، بقبّة ذهبية ومئذنة تُرى من معظم الشوارع، يصل إليه السكان مشياً للصلوات الخمس والجمعة.',
        'تحيط به ساحة مفتوحة، ويجاوره المركز الرياضي والحديقة والمدرسة.',
      ],
      facts: ['في وسط المشروع', 'قبّة ومئذنة', 'ساحة حول المسجد', 'قريب من المدرسة والحديقة'] },
    { id: 'center', icon: 'building', title: 'المركز الرياضي', at: [18000, 1328, -7900], view: 6500,
      text: [
        'مبنى متعدد الاستخدامات بجانب المسجد، فوق سطحه ملاعب خضراء لكرة القدم والرياضات الجماعية.',
        'في داخله مساحات للأنشطة واللقاءات، ويطل على الحديقة المركزية على مسافة مشي من الفلل.',
      ],
      facts: ['ملاعب على السطح', 'بجانب المسجد', 'يطل على الحديقة'] },
    { id: 'school', icon: 'school', title: 'المدرسة', at: [11900, 412, -800], view: 6000,
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
    { id: 'airport', icon: 'plane', title: 'مطار أبها الدولي', at: [-38000, 0, -38000], far: true, snap: true,
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
    const _sph = new THREE.Spherical();
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
    };
    function lockOn(dist, minElev = 28) {
        controls.enablePan = false;
        controls.minDistance = Math.max(0.5, dist * 0.3); /* close enough to see the details */
        controls.maxDistance = dist * 1.7;
        /*
         * Turning around the place keeps the camera at least 28° above the ground (from there up to
         * straight down): lower, it went down between the villas around the place while rotating.
         */
        controls.maxPolarAngle = Math.min(free.maxPolarAngle, THREE.MathUtils.degToRad(90 - minElev));
    }
    function unlock() {
        Object.assign(controls, free);
    }

    /* spin: extra turn (radians) around the place during the end of the flight */
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
            /* spherical description of the start / end camera offsets around their targets */
            const s0 = new THREE.Spherical().setFromVector3(flight.p0.clone().sub(flight.t0));
            const s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
            let dTheta = s1.theta - s0.theta;
            dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)); /* shortest way round */
            flight.s0 = s0;
            flight.s1 = s1;
            flight.dTheta = dTheta;
        }
        controls.enabled = false;
    }

    function viewFor(h) {
        const target = toWorld([h.at[0], h.at[1] * 0.45, h.at[2]]);
        const dist = Math.max(h.view * normScale, controls.minDistance * 1.2);
        /* keep the side the user is looking from, seen from ~35° above */
        const dir = camera.position.clone().sub(controls.target).setY(0);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
        dir.normalize();
        const elev = THREE.MathUtils.degToRad(Math.max(35, (h.minElev ?? 28) + 5));
        const pos = target.clone()
            .addScaledVector(dir, Math.cos(elev) * dist)
            .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
        return { pos, target, dist };
    }

    let current = null;
    function open(h) {
        const wasOpen = !!current;
        current = h;
        /* far places (airport): only the info, the camera stays */
        if (!h.far) {
            const v = viewFor(h);
            unlock();
            flyTo(v.pos, v.target, 2300, () => lockOn(v.dist, h.minElev), 0.6);
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
            controls.target.lerpVectors(flight.t0, flight.t1, e);
            if (flight.spin) {
                /*
                 * Approach first, then a short turn around the place while settling (instead of going
                 * straight to the point): the last ~45% of the flight sweeps `spin` radians.
                 */
                const late = THREE.MathUtils.smoothstep(k, 0.45, 1);
                const { s0, s1 } = flight;
                _sph.radius = s0.radius * Math.pow(s1.radius / s0.radius, e);
                _sph.phi = s0.phi + (s1.phi - s0.phi) * e;
                _sph.theta = s0.theta + (flight.dTheta - flight.spin) * e + flight.spin * late;
                camera.position.setFromSpherical(_sph).add(controls.target);
            } else {
                camera.position.lerpVectors(flight.p0, flight.p1, e);
            }
            camera.lookAt(controls.target);
            if (k >= 1) {
                const done = flight.onDone;
                flight = null;
                done?.();
                controls.enabled = true;
                controls.update();
            }
        }
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
            it.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
            it.el.style.zIndex = String(1000 - Math.round(v.z * 500));
        }
    }

    return { update, open, close, goHome, isFlying: () => !!flight };
}
