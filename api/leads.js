/*
 * POST /api/leads — the villa contact form (same checks and same `leads` rows as real-estate's
 * src/app/api/leads/route.ts), so the requests show up in the same admin / client dashboard.
 *
 * Vercel environment variables:
 *   SUPABASE_URL               same as NEXT_PUBLIC_SUPABASE_URL in real-estate
 *   SUPABASE_SERVICE_ROLE_KEY  same as in real-estate (secret: server only, never sent to the browser)
 */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameDigit = /[0-9٠-٩۰-۹]/;
const phoneLetter = /[A-Za-zÀ-ɏ؀-ۿ]/;
const hits = new Map();

function send(res, status, obj) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
}

function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
}

function rateLimit(ip) {
    const now = Date.now();
    const row = hits.get(ip);
    if (!row || now - row.t > 60_000) {
        hits.set(ip, { n: 1, t: now });
        return true;
    }
    if (row.n >= 8) return false;
    row.n += 1;
    return true;
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}

async function sb(url, key, path, init = {}) {
    return fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
            ...(init.headers || {}),
        },
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    try {
        if (!rateLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests' });

        const body = await readBody(req);
        const nom = String(body?.nom ?? '').trim().slice(0, 80);
        const prenom = String(body?.prenom ?? '').trim().slice(0, 80);
        const email = String(body?.email ?? '').trim().slice(0, 120);
        let tel = String(body?.tel ?? '').trim().slice(0, 40);
        if (tel && !tel.startsWith('+')) {
            const dial = String(body?.dial ?? '+').trim();
            tel = `${dial.startsWith('+') ? dial : '+'}${tel.replace(/^0+/, '')}`;
        }
        const gender = String(body?.gender ?? '').trim().slice(0, 20);
        const subject = String(body?.subject ?? '').trim().slice(0, 120);
        const message = String(body?.message ?? '').trim().slice(0, 800);
        const favoriteUnits = Array.isArray(body?.favoriteUnits)
            ? [...new Set(body.favoriteUnits.map((v) => String(v ?? '').trim().slice(0, 40)).filter(Boolean))].slice(0, 60)
            : [];
        const toFavorites = Boolean(body?.toFavorites) && favoriteUnits.length > 0;
        const unitId = body?.unitId ? String(body.unitId).slice(0, 80) : null;
        const unitDisplayId = body?.unitDisplayId ? String(body.unitDisplayId).slice(0, 40) : null;
        const complex = String(body?.complex ?? 'villas-ajyad').slice(0, 80);

        if (!nom || !prenom || nameDigit.test(nom) || nameDigit.test(prenom)) return send(res, 400, { error: 'Missing fields' });
        if (!emailRe.test(email)) return send(res, 400, { error: 'Invalid email' });
        if (!tel || phoneLetter.test(tel)) return send(res, 400, { error: 'Missing fields' });

        const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
            console.info('lead (no supabase)', { nom, prenom, email, tel, unitDisplayId, complex });
            return send(res, 200, { ok: true, stored: 'log' });
        }

        let complexId = null;
        const cxRes = await sb(url, key, `complexes?select=id&slug=eq.${encodeURIComponent(complex)}&limit=1`, { headers: { Prefer: '' } });
        if (cxRes.ok) complexId = (await cxRes.json())[0]?.id ?? null;

        const base = {
            nom: gender ? `${gender} ${nom}` : nom,
            prenom,
            email,
            tel: tel || '-',
            unit_id: unitId,
            unit_display_id: unitDisplayId,
            complex_slug: complex,
            complex_id: complexId,
        };
        const details = { ...base, gender, subject, message, to_favorites: toFavorites };
        const insert = (row) => sb(url, key, 'leads', { method: 'POST', body: JSON.stringify(row) });

        let r = await insert({ ...details, favorite_units: toFavorites ? favoriteUnits : null });
        if (!r.ok && toFavorites) {
            const note = `الفلل المفضلة: ${favoriteUnits.join('، ')}`;
            r = await insert({ ...details, message: message ? `${message}\n\n${note}` : note });
        }
        if (!r.ok) r = await insert(base);
        if (!r.ok) {
            console.error('lead insert failed', r.status);
            return send(res, 500, { error: 'Could not save' });
        }
        return send(res, 200, { ok: true, stored: 'db' });
    } catch {
        return send(res, 500, { error: 'Could not save' });
    }
}
