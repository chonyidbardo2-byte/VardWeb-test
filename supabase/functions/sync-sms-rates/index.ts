import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractLine, computePrices } from './rates.js';

/*
 * Supabase Edge Function: sync-sms-rates
 *
 * Daily job (pg_cron, see schema.sql) that keeps the SMS prices shown on
 * email-marketing.html accurate without anyone checking Telnyx by hand:
 *   1. Reads Telnyx's public rate feed for CA (local numbers) and US
 *      (toll-free numbers), including every carrier's fee.
 *   2. Reads the Bank of Canada USD/CAD rate.
 *   3. Recomputes each price with the rule in rates.js and upserts the single
 *      sms_rates row. Prices only ever go UP automatically.
 *   4. Emails support@ if a price was raised (existing clients need 30 days'
 *      notice), if an outlier carrier appears, or if the feed breaks. On any
 *      failure the last good row is kept untouched; it never writes a guess.
 *
 * Auth: deployed with --no-verify-jwt and guarded by a shared secret header
 * (x-sync-secret == SMS_SYNC_SECRET), so only the cron job can trigger it.
 *
 * Deploy:
 *   npx.cmd supabase functions deploy sync-sms-rates --no-verify-jwt --project-ref lvxlshberdazzmjbrjdu
 *   npx.cmd supabase secrets set SMS_SYNC_SECRET=<random string> --project-ref lvxlshberdazzmjbrjdu
 *   (reuses the RESEND_API_KEY secret already set for the other functions)
 */

const FEED = 'https://telnyx.com/api/pricing/messaging?country=';
const FX_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
const ALERT_TO = 'support@vardweb.com';
const ALERT_FROM = 'VardWeb <notifications@vardweb.com>';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function getJson(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function alert(subject: string, lines: string[]) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [ALERT_TO],
        subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1b2420">${lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('')}</div>`,
      }),
    });
  } catch (_) { /* an alert failure must not mask the sync result */ }
}

const cad = (n: number) => `C$${Number(n).toFixed(3)}`;

serve(async (req) => {
  const secret = Deno.env.get('SMS_SYNC_SECRET') ?? '';
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const { data: current } = await sb.from('sms_rates').select('*').eq('id', 1).maybeSingle();

  try {
    const [caFeed, usFeed] = await Promise.all([getJson(FEED + 'CA'), getJson(FEED + 'US')]);
    const ca = extractLine(caFeed, /local/i);
    const us = extractLine(usFeed, /toll-free/i);

    // FX failure is not fatal: fxUsed() falls back to the 1.45 floor.
    let liveFx: number | null = null;
    try {
      const fx = await getJson(FX_URL);
      liveFx = parseFloat(fx?.observations?.[0]?.FXUSDCAD?.v);
    } catch (_) { liveFx = null; }

    const result = computePrices(ca, us, liveFx, current);
    const row = {
      id: 1,
      ...result.prices,
      fx_live: Number.isFinite(liveFx) ? liveFx : null,
      fx_used: result.fx,
      worst_costs_usd: { ...result.costs, computed_cad: result.computed },
      flagged_carriers: result.flagged,
      synced_at: new Date().toISOString(),
      feed_ok: true,
      last_error: null,
    };
    const { error } = await sb.from('sms_rates').upsert(row);
    if (error) throw new Error(`sms_rates upsert: ${error.message}`);

    if (result.raised.length) {
      await alert('SMS prices raised automatically: notify existing clients', [
        'The daily Telnyx rate sync pushed these SMS prices up. The website now shows the new figures to new clients.',
        ...result.raised.map((r) => `<strong>${r.key}</strong>: ${cad(r.from)} &rarr; ${cad(r.to)}`),
        'Existing clients keep their current rate until you give them 30 days\' notice.',
        `FX used: ${result.fx.toFixed(4)} (live ${liveFx ?? 'unavailable'}).`,
      ]);
    }
    if (result.flagged.length) {
      await alert('SMS rate sync: outlier carrier fees', [
        'These carriers charge above the outlier threshold and are billed at cost &times; rule instead of the flat rate:',
        ...result.flagged.map((f: any) => `${f.line} &middot; ${f.carrier} &middot; ${f.kind.toUpperCase()} ${f.dir}: US$${f.fee}`),
      ]);
    }
    return json({ ok: true, prices: result.prices, raised: result.raised, flagged: result.flagged.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Keep the last good prices; only record that the feed failed.
    if (current) {
      await sb.from('sms_rates').update({ feed_ok: false, last_error: message }).eq('id', 1);
    }
    await alert('SMS rate sync FAILED: prices unchanged', [
      'The daily Telnyx rate sync could not read or parse the feed. The website keeps showing the last good prices.',
      `Error: ${message}`,
      'Check https://telnyx.com/pricing/messaging for a layout change, then update rates.js.',
    ]);
    return json({ ok: false, error: message }, 502);
  }
});
