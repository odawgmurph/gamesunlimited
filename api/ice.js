/**
 * GET /api/ice
 *
 * Hands browsers the ICE servers (STUN + TURN relays) to use for WebRTC.
 * Two devices on different networks often can't connect directly (mobile
 * carriers, many routers, school/corporate Wi-Fi); a TURN relay carries the
 * traffic for them. Same-computer play never needs one, which is why joining
 * works there but not across devices.
 *
 * Configure one of these in Vercel → Project → Settings → Environment Variables:
 *   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
 *       Cloudflare Realtime TURN (free tier). Short-lived credentials are minted per request.
 *   ICE_SERVERS
 *       A JSON array of RTCIceServer objects, e.g. from metered.ca or your own coturn.
 *
 * With neither set, responds { iceServers: [] } and the client uses its built-in defaults.
 */
const TTL = 6 * 60 * 60; // seconds

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

async function cloudflare(keyId, token) {
  const up = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: TTL }),
    signal: AbortSignal.timeout(5000),
  });
  if (!up.ok) throw new Error(`Cloudflare TURN answered HTTP ${up.status}`);
  const data = await up.json();
  const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers].filter(Boolean);
  // Port 53 is often blocked by browsers/networks and just slows ICE down.
  return list.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }));
}

export default async function handler(req, res) {
  const env = process.env;
  try {
    if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
      const iceServers = await cloudflare(env.CLOUDFLARE_TURN_KEY_ID, env.CLOUDFLARE_TURN_API_TOKEN);
      return send(res, 200, { iceServers, source: 'cloudflare' });
    }
    if (env.ICE_SERVERS) {
      const iceServers = JSON.parse(env.ICE_SERVERS);
      if (!Array.isArray(iceServers)) throw new Error('ICE_SERVERS must be a JSON array');
      return send(res, 200, { iceServers, source: 'env' }, 'public, s-maxage=300');
    }
    return send(res, 200, { iceServers: [], source: 'none' }, 'public, s-maxage=300');
  } catch (err) {
    console.error('[api/ice]', err);
    return send(res, 200, { iceServers: [], source: 'error' });
  }
}
