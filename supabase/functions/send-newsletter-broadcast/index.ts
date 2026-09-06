import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Supabase Edge Function: send-newsletter-broadcast
 *
 * Admin-only. Accepts POST { subject, html } with an Authorization header
 * carrying the CALLER'S SESSION JWT (not the anon key — crm/newsletter.html
 * must send session.access_token here, unlike subscribe-newsletter/
 * create-checkout which are intentionally public with no auth check).
 *
 * Sending a broadcast is irreversible and goes to the whole subscriber
 * list, so the caller's admin role is verified server-side before anything
 * else happens — never trust a client-supplied "I'm an admin" claim.
 *
 * Deploy:
 *   supabase functions deploy send-newsletter-broadcast
 *   supabase secrets set RESEND_API_KEY=re_...
 *   supabase secrets set RESEND_SEGMENT_ID=...
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Missing Authorization token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role client: verifies the caller's JWT and reads user_profiles
    // without RLS interference. Never uses the anon key + RLS path.
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // getClaims() (not getUser()) — this project signs sessions with
    // asymmetric ES256 keys, and getUser() has known verification bugs
    // with asymmetric-signed JWTs inside Edge Functions (supabase/supabase
    // #42244, #42810). getClaims() verifies locally against the project's
    // cached JWKS instead, which is Supabase's recommended approach here.
    const { data: claimsData, error: claimsErr } = await sb.auth.getClaims(jwt);
    const claims = claimsData?.claims ?? claimsData;
    const userId = claims?.sub;
    if (claimsErr || !userId) {
      console.error('send-newsletter-broadcast JWT verification failed:', claimsErr?.message);
      return new Response(JSON.stringify({ error: 'Invalid or expired session', reason: claimsErr?.message || 'no sub claim' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile, error: profileErr } = await sb
      .from('user_profiles').select('role').eq('id', userId).single();
    if (profileErr || profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, html } = await req.json();
    if (!subject || !html) {
      return new Response(JSON.stringify({ error: 'subject and html are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!html.includes('RESEND_UNSUBSCRIBE_URL')) {
      return new Response(JSON.stringify({ error: 'html must include the {{{RESEND_UNSUBSCRIBE_URL}}} placeholder' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const broadcastRes = await fetch('https://api.resend.com/broadcasts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        segment_id: Deno.env.get('RESEND_SEGMENT_ID') ?? '',
        from: 'VardWeb Blog <newsletter@vardweb.com>',
        subject,
        html,
        reply_to: 'newsletter@vardweb.com',
        name: `Blog broadcast — ${new Date().toISOString().slice(0, 10)}`,
        send: true,
      }),
    });
    const broadcastJson = await broadcastRes.json();
    if (!broadcastRes.ok) {
      return new Response(JSON.stringify({ error: broadcastJson.message || 'Resend broadcast failed', detail: broadcastJson }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, broadcast_id: broadcastJson.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
