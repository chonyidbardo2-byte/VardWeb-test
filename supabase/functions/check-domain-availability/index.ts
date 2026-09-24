import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/*
 * Supabase Edge Function: check-domain-availability
 *
 * Public: no auth required (matches create-checkout / subscribe-newsletter
 * being publicly callable). Accepts POST { domains: [{ name, tld }, ...] }
 * where `tld` includes the leading dot (e.g. ".com"), matching the
 * host-hero TLD pill convention on hosting-services.html.
 *
 * Returns { results: [{ domain, tld, available, price, premium }, ...] }.
 *
 * Talks to the Openprovider Reseller API (v1beta). Auth is a login-token
 * flow, not a static key: POST /v1beta/auth/login returns a bearer token
 * good for ~1hr, cached here in a module-level variable across warm
 * invocations to avoid re-authenticating every call. OPENPROVIDER_PASSWORD
 * accepts either the plaintext RCP login password or the password hash
 * generated on the RCP contact-details page, confirmed empirically
 * against the sandbox account on 2026-08-24; a prior version of this
 * comment claimed hash-only was required, which was never actually
 * verified and turned out to be wrong (that "password vs hash" distinction
 * is a legacy XML/SOAP API detail, not a v1beta one).
 *
 * OPENPROVIDER_API_BASE defaults to production; point it at
 * https://api.sandbox.openprovider.nl (no custom port; the previously
 * documented http://...:8480 form is unreachable/stale) to test against
 * Openprovider's sandbox before production credentials/KYC are ready. No
 * code change needed to switch, just the secret.
 *
 * Deploy:
 *   supabase functions deploy check-domain-availability
 *   supabase secrets set OPENPROVIDER_USERNAME=...
 *   supabase secrets set OPENPROVIDER_PASSWORD=...
 *   supabase secrets set OPENPROVIDER_API_BASE=https://api.openprovider.eu   (optional, this is the default)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_DOMAINS_PER_REQUEST = 20;

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getOpenproviderToken(apiBase: string): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const res = await fetch(`${apiBase}/v1beta/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: Deno.env.get('OPENPROVIDER_USERNAME') ?? '',
      password: Deno.env.get('OPENPROVIDER_PASSWORD') ?? '',
    }),
  });
  const json = await res.json();
  const token = json?.data?.token;
  if (!res.ok || !token) {
    throw new Error(`Openprovider auth failed: ${json?.desc || res.statusText}`);
  }

  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + 50 * 60 * 1000; // ~50min, token itself lasts ~1hr
  return token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { domains } = await req.json();
    if (!Array.isArray(domains) || domains.length === 0) {
      return new Response(JSON.stringify({ error: 'domains array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (domains.length > MAX_DOMAINS_PER_REQUEST) {
      return new Response(JSON.stringify({ error: `Max ${MAX_DOMAINS_PER_REQUEST} domains per request` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    for (const d of domains) {
      if (!d || typeof d.name !== 'string' || !d.name.trim() || typeof d.tld !== 'string' || !d.tld.startsWith('.')) {
        return new Response(JSON.stringify({ error: 'Each domain needs a non-empty name and a tld starting with "."' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const apiBase = Deno.env.get('OPENPROVIDER_API_BASE') || 'https://api.openprovider.eu';
    const token = await getOpenproviderToken(apiBase);

    const checkRes = await fetch(`${apiBase}/v1beta/domains/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domains: domains.map((d: { name: string; tld: string }) => ({
          name: d.name.trim().toLowerCase(),
          extension: d.tld.slice(1).toLowerCase(),
        })),
        with_price: true,
      }),
    });
    const checkJson = await checkRes.json();
    if (!checkRes.ok) {
      return new Response(JSON.stringify({ error: `Openprovider check failed: ${checkJson?.desc || checkRes.statusText}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Openprovider returns `domain` as a flat string (e.g. "test4.london") per
    // result, but NOT reliably in request order: confirmed empirically: mixing
    // TLDs in one request can come back with results shuffled, silently
    // misattributing availability/price to the wrong domain if matched by
    // index. Match each result back to its request by that flat `domain`
    // string instead (exact, case-insensitive); safe here since every TLD
    // this site checks is single-label (.com, .ca, .io, etc), so `name + tld`
    // reconstructs the flat string unambiguously.
    const keyToIndex: Record<string, number> = {};
    domains.forEach((d: { name: string; tld: string }, i: number) => {
      keyToIndex[(d.name.trim() + d.tld).toLowerCase()] = i;
    });
    const results: any[] = new Array(domains.length).fill(null);
    (checkJson?.data?.results || []).forEach((r: any) => {
      const key = typeof r.domain === 'string' ? r.domain.toLowerCase() : '';
      const idx = keyToIndex[key];
      if (idx === undefined) return;
      results[idx] = {
        domain: domains[idx].name.trim().toLowerCase(),
        tld: domains[idx].tld,
        available: r.status === 'free',
        // `||` (not `??`) on purpose: Openprovider sometimes returns a literal
        // 0 in the first field of a premium listing (price not populated there),
        // which `??` would lock onto instead of falling through to a field that
        // actually has the real price. A genuine $0 domain price isn't a case
        // worth preserving.
        price: r.premium?.price?.reseller?.price || r.price?.reseller?.price || r.price?.product?.price || null,
        premium: Boolean(r.premium),
      };
    });
    // A requested domain missing from the response (shouldn't happen, but the
    // safe default matters here) is reported unavailable rather than silently
    // treated as purchasable.
    domains.forEach((d: { name: string; tld: string }, i: number) => {
      if (!results[i]) results[i] = { domain: d.name.trim().toLowerCase(), tld: d.tld, available: false, price: null, premium: false };
    });

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
