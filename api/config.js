/*
 * GET /api/config — public settings for the viewer (Vercel function).
 * Only the PUBLIC Supabase values are sent: the anon key is meant to be used in the browser
 * (Row Level Security limits it to published projects, exactly like real-estate).
 *
 * Vercel → Project → Settings → Environment Variables:
 *   SUPABASE_URL       same value as NEXT_PUBLIC_SUPABASE_URL in real-estate
 *   SUPABASE_ANON_KEY  same value as NEXT_PUBLIC_SUPABASE_ANON_KEY in real-estate
 *   COMPLEX_SLUG       optional, default "villas-ajyad"
 */
export default function handler(req, res) {
    const body = JSON.stringify({
        supabaseUrl: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''),
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        complexSlug: process.env.COMPLEX_SLUG || 'villas-ajyad',
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(body);
}
