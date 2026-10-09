'use strict';

/**
 * The site's one public address (S9 Part B: tarasalon.org becomes the main
 * address; docs/DOMAIN_MOVE.md, docs/runbooks/TARASALON_PRIMARY.md).
 *
 * `CANONICAL_HOST` (e.g. `www.tarasalon.org`) is OFF unless set in Vercel, and
 * like every variable it takes effect only after a Redeploy. Unset, or not a
 * plain host name, and the site behaves exactly as before: every link follows
 * the host the visitor is on.
 *
 * Set, on any production host other than that one (www.matrixecosalon.org,
 * matrixecosalon.org, the tarasalon.org apex):
 *   - a PAGE (GET or HEAD, never /api/*) answers 301 to the same path and
 *     query on the canonical host, so old links, posts and printed QR codes
 *     open the same page there;
 *   - /api/* is never redirected: QPay's callbacks for invoices made before
 *     the switch, Google and Дали keep reaching the old host and are answered
 *     there (a redirected POST callback is a paid customer never booked);
 *   - every link the site writes (canonical, og:url, og:image, the sitemap and
 *     QPay's callback_url on new invoices) names the canonical host, whatever
 *     host the request came in on.
 *
 * Preview and local hosts (*.vercel.app, localhost) are never redirected and
 * keep their own links, so a preview's invoice never calls back Production.
 */

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

let warned = false;

/** The configured canonical host, lower case, or null when off or malformed. */
function canonicalHost() {
  const raw = String(process.env.CANONICAL_HOST || '').trim().toLowerCase();
  if (raw === '') return null;
  if (!HOST_RE.test(raw)) {
    if (!warned) {
      warned = true;
      console.error('canonical-host: CANONICAL_HOST is not a plain host name; ignored (links follow the request host)');
    }
    return null;
  }
  return raw;
}

/** The host the request came in on, lower case, without a port; '' when unreadable. */
function requestHost(req) {
  const headers = (req && req.headers) || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) return '';
  return host.replace(/:\d+$/, '');
}

/** A host that is never redirected and keeps its own links. */
function isPreviewOrLocal(host) {
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app');
}

/**
 * Where a page request should be sent instead, or null to serve it here.
 * Only GET/HEAD, never /api/*, never on the canonical, a preview or a local host.
 */
function redirectTarget(req) {
  const canonical = canonicalHost();
  if (canonical === null) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const path = String(req.path || '');
  if (path === '/api' || path.startsWith('/api/')) return null;
  const host = requestHost(req);
  if (host === canonical || isPreviewOrLocal(host)) return null;
  const url = String(req.originalUrl || '/');
  return `https://${canonical}${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * The origin every self-made link uses: the canonical host when it is set and
 * the request is on a production host; otherwise null, and the caller keeps
 * its own rule (the request host, then BASE_URL).
 */
function canonicalOriginFor(req) {
  const canonical = canonicalHost();
  if (canonical === null) return null;
  if (isPreviewOrLocal(requestHost(req))) return null;
  return `https://${canonical}`;
}

module.exports = { canonicalHost, requestHost, isPreviewOrLocal, redirectTarget, canonicalOriginFor };
