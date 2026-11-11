/**
 * GET /api/crcast?code=ABC12
 *
 * A thin pass-through to CrCast's public deck API, so browsers can import
 * decks even if CrCast doesn't send CORS headers. Runs as a Vercel function in
 * production and as Vite middleware in development (see vite.config.js).
 * Responses are cached at the edge for a few minutes.
 */
const UPSTREAM = 'https://api.crcast.cc/v1/cc/decks';

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    return send(res, 400, { error: 400, message: 'Deck codes are 5 letters or numbers.' });
  }
  try {
    const up = await fetch(`${UPSTREAM}/${code}/all`, {
      headers: { accept: 'application/json', 'user-agent': 'GamesUnlimited (Cards with Insanity)' },
      signal: AbortSignal.timeout(12000),
    });
    const text = await up.text();
    try {
      JSON.parse(text);
    } catch {
      return send(res, up.status === 404 ? 404 : 502, up.status === 404 ? { error: 404, message: `No deck with code ${code}.` } : { proxyError: true, message: `CrCast answered with HTTP ${up.status}.` });
    }
    return send(res, up.status, text, up.ok ? 'public, s-maxage=300, stale-while-revalidate=3600' : 'no-store');
  } catch (err) {
    return send(res, 502, { proxyError: true, message: 'Couldn’t reach CrCast.' });
  }
}
