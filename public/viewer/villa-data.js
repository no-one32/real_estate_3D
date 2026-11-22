/*
 * Villa data — same sources and same rules as the real-estate project
 * (src/lib/complex.ts, src/lib/tour.ts, src/lib/load-complex.ts):
 *   Supabase tables `complexes`, `units`, `assets` (public read for published projects),
 *   read with the public anon key given by /api/config.
 * Without Supabase settings it falls back to units.json (statuses only, no 360 frames).
 */

export const STATUS_COLOR = {
    available: 0x3dba67,
    reserved: 0xf4b326,
    sold: 0xe25656,
};

export const STATUS_AR = {
    available: 'متاح',
    reserved: 'محجوز',
    sold: 'مباع',
};

export const COMPLEX = {
    slug: 'villas-ajyad',
    name: 'Villas Ajyad',
    logoPath: '/complexes/villas-ajyad/logo.webp',
    villaFrames: 60,
    overlayOpacity: 0.2,
    showAllOpacity: 0.25,
    hoverOverlayOpacity: 0.5,
    contactEmail: 'info@ajyadre.com',
    contactTel: '+966575555782',
    villa360: {
        frontFrame: 14,
        floors: [
            { id: 'rdc', subfolder: 'RDC', label: 'الدور الأرضي', frameOffset: 0, zoom: 1, shiftX: 0, shiftY: 0, rotate: 0, pivotY: 0.5 },
            { id: 'etage_1', subfolder: 'etage_1', label: 'الدور الأول', frameOffset: 0, zoom: 1, shiftX: 0, shiftY: 0, rotate: 0, pivotY: 0.5 },
            { id: 'etage_2', subfolder: 'etage_2', label: 'السطح', frameOffset: 2, zoom: 1.01, shiftX: -0.006, shiftY: 0, rotate: 2, pivotY: 0.72 },
        ],
    },
    villaTypes: { 1: 'type-1', 2: 'type-2', 3: 'type-3' },
    defaultPriceByType: { 1: 280_000, 2: 340_000, 3: 380_000 },
    defaultPriceByModel: { '1A': 280_000, '1B': 295_000, '2A': 340_000, '2B': 355_000, '3A': 380_000, '3B': 395_000 },
};

export function modelOf(u) {
    if (u.model && /^[123][AB]$/i.test(u.model)) return u.model.toUpperCase();
    const t = u.type === 2 || u.type === 3 ? u.type : 1;
    return `${t}A`;
}

export function unitPrice(u) {
    const model = modelOf(u);
    return u.price || COMPLEX.defaultPriceByModel[model] || COMPLEX.defaultPriceByType[u.type] || 0;
}

/** ر.س LEFT of amount — LRM marks stop RTL from flipping the pair. */
export function sarParts(n) {
    return {
        currency: '‎ر.س‎',
        amount: `‎${Math.round(n).toLocaleString('en-US')}‎`,
    };
}

export function arabicProjectName(name) {
    return name
        .replace(/\bvillas?\b/gi, 'فيلات')
        .replace(/\bajyad\b/gi, 'أجياد')
        .replace(/\bsa?e?dim+\b/gi, 'سديم')
        .replace(/\s+/g, ' ')
        .trim();
}

function mapUnit(row) {
    const type = row.type === 2 || row.type === 3 ? row.type : 1;
    const model = (row.model || `${type}A`).toUpperCase();
    return {
        id: row.mesh_id,
        displayId: row.display_id,
        type,
        model,
        status: row.status,
        surface: row.surface,
        rooms: row.rooms,
        floor: row.floor,
        price: row.price || COMPLEX.defaultPriceByModel[model] || COMPLEX.defaultPriceByType[type] || 0,
        planImage: row.plan_path || `assets/plans/types/type-${row.type}.webp`,
    };
}

function frameNum(path) {
    const m = path.match(/(\d+)(?=\.[^.]+$)/);
    return m ? parseInt(m[1], 10) : 0;
}

function sortAssets(rows, kind) {
    return (rows ?? [])
        .filter((a) => a.kind === kind && a.path)
        .sort((a, b) => a.sort_index - b.sort_index || frameNum(a.path) - frameNum(b.path) || a.path.localeCompare(b.path));
}

function relAfterKind(kind, path) {
    const marker = `/${kind}/`;
    const lower = path.replace(/\\/g, '/');
    const i = lower.toLowerCase().lastIndexOf(marker);
    const slice = i >= 0 ? path.replace(/\\/g, '/').slice(i + marker.length) : path.split('/').pop() || path;
    return decodeURIComponent(slice).replace(/\\/g, '/').toLowerCase();
}

function buildTour(complex, units, assets, slug) {
    const branding = sortAssets(assets, 'branding').map((a) => a.path);
    const plans = {};
    sortAssets(assets, 'plan').forEach((a) => {
        const name = relAfterKind('plan', a.path).split('/').pop() || a.path;
        plans[name.toLowerCase()] = a.path;
    });
    const villa360 = {};
    sortAssets(assets, 'villa_360').forEach((a) => {
        villa360[relAfterKind('villa_360', a.path)] = a.path;
    });
    const agencyLogo =
        branding.find((u) => /\/agency\./i.test(u) || /agency\./i.test(u.split('/').pop() || '')) ||
        branding.find((u) => /logo/i.test(u) && !/project/i.test(u)) ||
        branding[0] ||
        (complex?.logo_path && String(complex.logo_path).startsWith('http') ? complex.logo_path : '') ||
        COMPLEX.logoPath;
    return {
        slug: complex?.slug || slug,
        complexName: complex?.name || COMPLEX.name,
        name: arabicProjectName(complex?.name || COMPLEX.name),
        logoUrl: agencyLogo,
        units,
        villaFrames: complex?.villa_frames || COMPLEX.villaFrames,
        plans,
        villa360,
    };
}

export function tourVillaUrl(tour, type, folder, index) {
    const typeFolder = COMPLEX.villaTypes[type] ?? 'type-1';
    const num = String(index + 1).padStart(2, '0');
    const names = [`frame-${num}.webp`, `frame-${num}.jpg`, `frame-${num}.png`];
    const folders = [folder, folder.toLowerCase(), folder.toUpperCase()];
    for (const f of folders) {
        for (const n of names) {
            const key = `${typeFolder}/${f}/${n}`.toLowerCase();
            if (tour.villa360[key]) return tour.villa360[key];
        }
    }
    const needle = `${typeFolder}/${folder}/frame-${num}`.toLowerCase();
    const hit = Object.entries(tour.villa360).find(([k]) => k.includes(needle));
    return hit ? hit[1] : '';
}

export function tourPlanUrl(tour, unit) {
    if (unit.planImage.startsWith('http')) return unit.planImage;
    const base = (unit.planImage.split('/').pop() || '').toLowerCase();
    return tour.plans[base] || tour.plans[`type-${unit.type}.webp`] || tour.plans[`type-${unit.type}.jpg`] || '';
}

export function tourPlanDetailUrl(tour, unit) {
    const full = tourPlanUrl(tour, unit);
    const name = (full.split('/').pop() || '').toLowerCase();
    return tour.plans[name.replace(/\.(webp|jpe?g|png)$/, '-detail.webp')] || full;
}

export function cardPhoto(tour, unit) {
    const thumb =
        tour.plans[`type-${unit.type}-thumb.webp`] ||
        tour.plans[`type-${unit.type}-thumb.jpg`] ||
        Object.entries(tour.plans).find(([k]) => k.includes(`type-${unit.type}`) && /thumb/i.test(k))?.[1] ||
        '';
    if (thumb) return thumb;
    const plan = tourPlanUrl(tour, unit);
    if (plan) return plan;
    const byType = Object.entries(tour.plans).find(([k]) => k.includes(`type-${unit.type}`) && !/thumb/i.test(k));
    if (byType) return byType[1];
    return Object.values(tour.plans).filter(Boolean)[0] || '';
}

/** Supabase settings (public): /api/config on Vercel or the local server. */
export async function loadConfig() {
    try {
        const r = await fetch('/api/config', { cache: 'no-cache' });
        if (r.ok) return await r.json();
    } catch { /* static hosting without functions */ }
    return {};
}

async function rest(cfg, path) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
        headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` },
    });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    return r.json();
}

/** Same data as real-estate's loadComplexPayload + buildTour. */
export async function loadTour() {
    const cfg = await loadConfig();
    const slug = cfg.complexSlug || COMPLEX.slug;
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        try {
            const [complex] = await rest(cfg, `complexes?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
            if (complex) {
                const [units, assets] = await Promise.all([
                    rest(cfg, `units?select=*&complex_id=eq.${complex.id}`),
                    rest(cfg, `assets?select=kind,path,sort_index&complex_id=eq.${complex.id}&order=sort_index`),
                ]);
                return { ...buildTour(complex, units.map(mapUnit), assets, slug), source: 'db', config: cfg };
            }
        } catch (e) {
            console.warn('villas: Supabase not reachable, using units.json', e);
        }
    }
    const json = await (await fetch('./units.json')).json();
    const units = (json.units ?? []).map((u) => {
        const type = u.type === 2 || u.type === 3 ? u.type : 1;
        const model = modelOf({ ...u, type });
        return { ...u, type, model, price: u.price || COMPLEX.defaultPriceByModel[model] || COMPLEX.defaultPriceByType[type] || 0 };
    });
    return { ...buildTour(null, units, [], slug), source: 'file', config: cfg };
}
