/* Optional, best-effort inspection of a candidate's OWN official website,
 * run server-side for the top few candidates only.
 *
 * PURPOSE: turn "this business has a website" into a structured statement
 * about how a customer can actually transact with them -- booking, ordering,
 * quote request, enquiry form, email or phone -- or the established absence
 * of any of those. That is the difference between a lead we can say
 * something concrete about and a name on a list.
 *
 * SAFETY. This is the only place VISION fetches an arbitrary third-party URL,
 * so the rules are strict and enforced before the socket is opened:
 *   * https only. No http, no other scheme, no credentials in the URL.
 *   * The hostname must be public: no localhost, no *.local/.internal, no
 *     literal IPs at all (which removes the entire private/loopback/link-local
 *     /metadata-endpoint SSRF class without needing to enumerate ranges).
 *   * Redirects are NOT followed. A redirect is reported as UNKNOWN rather
 *     than chased to somewhere the checks above never saw.
 *   * Hard timeout, hard byte cap, and only text/html is parsed.
 *   * GET only, no cookies, no credentials, identifiable User-Agent.
 * Any failure at any point yields UNKNOWN -- never a claim, and never a
 * fabricated weakness. A site we could not read is a site we say nothing
 * about.
 */

import { buildSignal } from './signals.js';

export const WEBSITE_INSPECTION_USER_AGENT = 'VISIONLeadIntelligence/1.0 (+https://visionproof.app)';
export const MAX_INSPECTION_BYTES = 400_000;

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa', '.onion'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'instance-data']);
// Any bare IP literal, v4 or v6. Public IPs are rejected too: a legitimate
// business website is reached by name, so refusing literals costs nothing and
// closes the whole SSRF-by-address surface.
const IP_LITERAL_RE = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]*:[0-9a-f:.]*\]?)$/i;

/** Pure, dependency-free. Exported so the safety rules are directly testable
 * without a network. */
export function isInspectableUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, reason: 'unparseable_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'non_https_url' };
  if (url.username || url.password) return { ok: false, reason: 'credentialed_url' };
  const host = url.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host)) return { ok: false, reason: 'non_public_host' };
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { ok: false, reason: 'non_public_host' };
  if (IP_LITERAL_RE.test(host)) return { ok: false, reason: 'ip_literal_host' };
  if (!host.includes('.')) return { ok: false, reason: 'non_public_host' };
  return { ok: true, url: url.toString() };
}

/* ── Structural route detection ────────────────────────────────────────
   Each detector reports the EXACT evidence it matched (an href, a scheme, a
   form action) so the resulting signal names a real element of a real page.
   We look at hrefs and anchor/button labels, which is where a conversion
   route actually lives -- not at page prose. */

const ROUTE_DETECTORS = Object.freeze([
  { route: 'booking', href: /(^|[/.?=-])(book|booking|bookings|reserve|reservation|appointments?|schedule)([/.?&=-]|$)/i, label: /\b(book|booking|reserve|reservation|appointment|schedule)\b/i },
  { route: 'ordering', href: /(^|[/.?=-])(order|orders|shop|store|cart|checkout|menu)([/.?&=-]|$)/i, label: /\b(order|shop|buy|cart|checkout)\b/i },
  { route: 'quote', href: /(^|[/.?=-])(quote|quotes|estimate|pricing|get-a-quote)([/.?&=-]|$)/i, label: /\b(quote|estimate|get a quote)\b/i },
  // Bare "request" is deliberately NOT an enquiry label: "Request a quote" is
  // a quote route, and matching it here would double-count one real link as
  // two distinct routes.
  { route: 'enquiry', href: /(^|[/.?=-])(enquire|enquiry|enquiries|inquiry|inquire)([/.?&=-]|$)/i, label: /\b(enquire|enquiry|enquiries|inquiry|inquire)\b/i },
  { route: 'contact_form', href: /(^|[/.?=-])(contact|contact-us|get-in-touch)([/.?&=-]|$)/i, label: /\b(contact|get in touch)\b/i },
]);

function anchors(html) {
  const found = [];
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let match = anchorRe.exec(html);
  while (match && found.length < 800) {
    found.push({ href: match[1].trim(), label: match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() });
    match = anchorRe.exec(html);
  }
  return found;
}

/** Maps real page structure onto CONVERSION_ROUTES. Returns the matched
 * evidence verbatim so nothing downstream has to trust a summary. */
export function detectConversionRoutes(html) {
  const text = String(html || '');
  const links = anchors(text);
  const routes = new Map();

  const record = (route, evidence) => {
    if (!routes.has(route)) routes.set(route, evidence);
  };

  for (const link of links) {
    for (const detector of ROUTE_DETECTORS) {
      if (detector.href.test(link.href) || (link.label && detector.label.test(link.label))) {
        record(detector.route, { via: 'link', href: link.href.slice(0, 300), label: link.label.slice(0, 120) });
      }
    }
    if (/^mailto:/i.test(link.href)) record('email', { via: 'mailto_link', href: link.href.slice(0, 300) });
    if (/^tel:/i.test(link.href)) record('phone', { via: 'tel_link', href: link.href.slice(0, 300) });
  }
  // A real <form> that posts somewhere is a contact/enquiry route even when
  // no anchor advertises it.
  if (/<form\b[^>]*>/i.test(text) && /<input\b[^>]*type\s*=\s*["']?(email|text)["']?/i.test(text)) {
    record('contact_form', { via: 'form_element' });
  }
  return [...routes.entries()].map(([route, evidence]) => ({ route, evidence }));
}

/** Fetches and inspects ONE candidate website. Always resolves -- never
 * throws -- because a lead's qualification must not depend on a third party's
 * uptime. `status` is 'inspected' | 'unreachable' | 'skipped'. */
export async function inspectCandidateWebsite(rawUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  checkedAt = new Date().toISOString(),
  maxBytes = MAX_INSPECTION_BYTES,
} = {}) {
  const gate = isInspectableUrl(rawUrl);
  if (!gate.ok) return { status: 'skipped', reason: gate.reason, url: null, routes: [], signals: [] };
  if (typeof fetchImpl !== 'function') return { status: 'skipped', reason: 'no_fetch_implementation', url: gate.url, routes: [], signals: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(gate.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      credentials: 'omit',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': WEBSITE_INSPECTION_USER_AGENT },
    });
    if (!response || typeof response.status !== 'number') return unreachable(gate.url, 'malformed_response', checkedAt);
    if (response.status >= 300 && response.status < 400) return unreachable(gate.url, 'redirected', checkedAt);
    if (!response.ok) return unreachable(gate.url, `http_${response.status}`, checkedAt);
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return unreachable(gate.url, 'non_html_content', checkedAt);
    const body = await response.text();
    const html = body.length > maxBytes ? body.slice(0, maxBytes) : body;
    const routes = detectConversionRoutes(html);
    return {
      status: 'inspected',
      url: gate.url,
      routes,
      signals: conversionSignals({ url: gate.url, routes, checkedAt }),
    };
  } catch (error) {
    return unreachable(gate.url, error?.name === 'AbortError' ? 'timeout' : 'network_error', checkedAt);
  } finally {
    clearTimeout(timer);
  }
}

function unreachable(url, reason, checkedAt) {
  return {
    status: 'unreachable',
    url,
    reason,
    routes: [],
    // Deliberately UNKNOWN, never an absence claim: we did not read the page,
    // so we know nothing about it and score nothing from it.
    signals: [buildSignal({
      signalId: 'conversion_path.unknown',
      kind: 'conversion_path',
      evidenceStatus: 'UNKNOWN',
      confidence: 0,
      sourceUrl: null,
      sourceType: 'official_website',
      researchMethod: 'website_inspection_failed',
      checkedAt,
      value: { inspected: false, reason },
      detail: 'The official website could not be read, so no claim is made about how this business takes enquiries.',
    })],
  };
}

function conversionSignals({ url, routes, checkedAt }) {
  if (routes.length === 0) {
    // An OBSERVED absence: we fetched and parsed the page and found no
    // enquiry route of any kind. This is a real, checkable finding.
    return [buildSignal({
      signalId: 'conversion_path.none_found',
      kind: 'conversion_path',
      evidenceStatus: 'OBSERVED',
      confidence: 0.7,
      sourceUrl: url,
      sourceType: 'official_website',
      researchMethod: 'website_structure_review',
      checkedAt,
      value: { inspected: true, routes: [] },
      detail: 'The official website was read and contains no booking, ordering, quote, enquiry or contact route.',
    })];
  }
  return routes.map((entry) => buildSignal({
    signalId: `conversion_path.${entry.route}`,
    kind: 'conversion_path',
    evidenceStatus: 'OBSERVED',
    confidence: 0.9,
    sourceUrl: url,
    sourceType: 'official_website',
    researchMethod: 'website_structure_review',
    checkedAt,
    value: { inspected: true, route: entry.route, evidence: entry.evidence },
    detail: `The official website exposes a ${entry.route.replace(/_/g, ' ')} route.`,
  }));
}
