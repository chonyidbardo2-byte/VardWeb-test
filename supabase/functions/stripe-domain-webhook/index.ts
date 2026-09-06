import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

/*
 * Supabase Edge Function: stripe-domain-webhook
 *
 * Server-to-server — no CORS, no Supabase-issued JWT. Auth is Stripe's own
 * signature (STRIPE_WEBHOOK_SECRET), so this MUST be deployed with
 * --no-verify-jwt or the platform gateway rejects every call before this
 * code ever runs (same requirement as resend-webhook).
 *
 * On checkout.session.completed:
 *   1. Look up domain_orders by metadata.order_id, mark 'paid'.
 *   2. Register each cart domain via Openprovider: create/reuse a customer
 *      handle from the order's stored `registrant`, then create the domain
 *      with default (parking) nameservers — Cloudflare DNS management is a
 *      client-exclusive benefit per the standing architecture decision, not
 *      bundled into a bare walk-up domain purchase.
 *   3. Record per-domain outcome in openprovider_results; the order becomes
 *      'completed' only if every domain registered, else 'failed' (with
 *      the per-item error preserved) — that failure state is the surface
 *      crm/domain-orders.html exists to catch, since payment already
 *      succeeded by this point and can't just be silently dropped.
 *   4. Best-effort confirmation email via send-transactional-email — never
 *      fails the webhook response.
 *
 * ⚠️ UNVERIFIED AGAINST A LIVE CALL: the customer/domain request shapes
 * below are built from Openprovider's public docs, not a working test.
 * The account-wide auth 401 that blocked this for the whole build is
 * fixed as of 2026-08-24 (root cause was OPENPROVIDER_API_BASE pointing
 * at a stale/unreachable sandbox URL, compounded by the password field
 * needing the plaintext RCP password rather than the hash this build
 * assumed — see check-domain-availability/index.ts for the corrected
 * details) and check-domain-availability now gets real 200s from
 * sandbox. This file's customer-create/domain-register calls are still
 * untested against a live account, though — run one real purchase
 * through here the moment that's safe to do, and correct field
 * names/response paths against the actual response before trusting this
 * with real customer money. In particular: splitAddress()/splitPhone()
 * below are best-effort parses of single free-text form fields into
 * Openprovider's separate street/number and
 * country_code/area_code/subscriber_number fields — genuinely approximate.
 *
 * Deploy:
 *   supabase functions deploy stripe-domain-webhook --no-verify-jwt
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   (Stripe Dashboard
 *     -> Developers -> Webhooks -> Add Endpoint, pointed at this function's
 *     URL, listening for checkout.session.completed)
 */

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
  if (!res.ok || !token) throw new Error(`Openprovider auth failed: ${json?.desc || res.statusText}`);
  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return token;
}

function splitAddress(address: string): { street: string; number: string } {
  const match = String(address || '').trim().match(/^(\d+[a-zA-Z]?)\s+(.*)$/);
  if (match) return { number: match[1], street: match[2] };
  return { number: '', street: String(address || '').trim() };
}

function splitPhone(phone: string, country: string): { country_code: string; area_code: string; subscriber_number: string } {
  const digits = String(phone || '').replace(/\D/g, '');
  const isNanp = ['CA', 'US'].includes(String(country || '').toUpperCase());
  if (isNanp && digits.length >= 10) {
    const d = digits.slice(-10);
    return { country_code: '1', area_code: d.slice(0, 3), subscriber_number: d.slice(3) };
  }
  return { country_code: '', area_code: '', subscriber_number: digits };
}

type Registrant = { name: string; email?: string; phone: string; address: string; city: string; state: string; postal_code: string; country: string };

async function getOrCreateCustomerHandle(apiBase: string, token: string, registrant: Registrant, buyerEmail: string): Promise<string> {
  const { street, number } = splitAddress(registrant.address);
  const phone = splitPhone(registrant.phone, registrant.country);
  const nameParts = String(registrant.name).trim().split(/\s+/);
  const firstName = nameParts[0] || registrant.name;
  const lastName = nameParts.slice(1).join(' ') || firstName;

  const res = await fetch(`${apiBase}/v1beta/customers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: { firstName, lastName },
      address: { street, number, zipcode: registrant.postal_code, city: registrant.city, state: registrant.state, country: registrant.country },
      phone,
      email: registrant.email || buyerEmail,
    }),
  });
  const json = await res.json();
  const handle = json?.data?.handle;
  if (!res.ok || !handle) throw new Error(`Openprovider customer create failed: ${json?.desc || res.statusText}`);
  return handle;
}

async function registerDomain(apiBase: string, token: string, item: { domain: string; tld: string }, handle: string, period: number): Promise<{ id?: string }> {
  const name = item.domain.replace(new RegExp(item.tld.replace('.', '\\.') + '$'), '');
  const extension = item.tld.replace(/^\./, '');
  const res = await fetch(`${apiBase}/v1beta/domains`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: { name, extension },
      period: period,
      owner_handle: handle,
      admin_handle: handle,
      tech_handle: handle,
      billing_handle: handle,
      ns_group: 'dns-openprovider',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.desc || res.statusText);
  return json?.data || {};
}

serve(async (req) => {
  const rawBody = await req.text();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2023-10-16' });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      req.headers.get('stripe-signature') ?? '',
      Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
    );
  } catch (err) {
    console.error('stripe-domain-webhook signature verification failed:', err.message);
    return new Response('Invalid signature', { status: 401 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object as { metadata?: { order_id?: string }; payment_intent?: string };
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    console.error('stripe-domain-webhook: checkout.session.completed with no order_id metadata');
    return new Response('ok', { status: 200 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const { data: order, error: fetchErr } = await sb.from('domain_orders').select('*').eq('id', orderId).single();
  if (fetchErr || !order) {
    console.error('stripe-domain-webhook: order not found', orderId, fetchErr?.message);
    return new Response('ok', { status: 200 });
  }

  await sb.from('domain_orders').update({
    status: 'paid',
    stripe_payment_intent: session.payment_intent || null,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  const apiBase = Deno.env.get('OPENPROVIDER_API_BASE') || 'https://api.openprovider.eu';
  const results: Array<{ domain: string; tld: string; ok: boolean; openprovider_id?: string; error?: string; skipped?: string }> = [];
  let allOk = true;

  try {
    const token = await getOpenproviderToken(apiBase);
    const handle = await getOrCreateCustomerHandle(apiBase, token, order.registrant, order.buyer_email);

    for (const item of order.items as Array<{ domain: string; tld: string; years?: number; type?: string }>) {
      // Addon line items (e.g. Full Domain Protection) aren't real domains —
      // Openprovider has nothing to register for them, so skip straight to a
      // recorded no-op rather than sending a bogus domain-create call.
      if (item.type === 'addon') {
        results.push({ domain: item.domain, tld: item.tld, ok: true, skipped: 'addon' });
        continue;
      }
      try {
        const data = await registerDomain(apiBase, token, item, handle, item.years || 1);
        results.push({ domain: item.domain, tld: item.tld, ok: true, openprovider_id: data?.id });
      } catch (err) {
        allOk = false;
        results.push({ domain: item.domain, tld: item.tld, ok: false, error: err.message });
      }
    }
  } catch (err) {
    allOk = false;
    for (const item of order.items as Array<{ domain: string; tld: string }>) {
      results.push({ domain: item.domain, tld: item.tld, ok: false, error: err.message });
    }
  }

  await sb.from('domain_orders').update({
    status: allOk ? 'completed' : 'failed',
    openprovider_results: results,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId);

  // Best-effort confirmation email — must NOT fail the webhook response,
  // Stripe retries on non-2xx and we don't want a Resend hiccup to cause
  // duplicate Openprovider registration attempts on retry.
  try {
    const domainResults = results.filter(r => r.skipped !== 'addon');
    const html = allOk
      ? `<p>Your domain purchase is complete:</p><ul>${domainResults.map(r => `<li>${r.domain}</li>`).join('')}</ul>`
      : `<p>Your payment went through, but one or more domains needs attention on our end — we'll follow up shortly.</p><ul>${domainResults.map(r => `<li>${r.domain}: ${r.ok ? 'registered' : 'needs follow-up'}</li>`).join('')}</ul>`;
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-transactional-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: order.buyer_email,
        from: 'VardWeb <notifications@vardweb.com>',
        subject: allOk ? 'Your domain purchase is complete' : 'Your domain purchase needs attention',
        html,
      }),
    });
  } catch (emailErr) {
    console.error('stripe-domain-webhook confirmation email failed:', emailErr);
  }

  return new Response('ok', { status: 200 });
});
