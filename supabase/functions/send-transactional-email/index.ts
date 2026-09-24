import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/*
 * Supabase Edge Function: send-transactional-email
 *
 * Public: no admin check (same public model EmailJS's exposed public key
 * had; matches create-checkout/subscribe-newsletter's existing pattern).
 *
 * Generic single-recipient email relay used by both contact.html's inquiry
 * notification and blog.html's welcome-confirmation email. The caller
 * builds the full HTML client-side (buildInquiryEmailHtml / the fetched
 * blog-newsletter-welcome.html template); this function only relays it to
 * Resend, it never reassembles a template itself.
 *
 * Accepts POST { to, subject, html, from, replyTo? }.
 *
 * Deploy:
 *   supabase functions deploy send-transactional-email
 *   (reuses the RESEND_API_KEY secret already set for the other functions)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, html, from, replyTo } = await req.json();

    if (!to || !EMAIL_RE.test(to)) {
      return new Response(JSON.stringify({ error: 'A valid "to" email is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!subject || !html) {
      return new Response(JSON.stringify({ error: 'subject and html are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!from) {
      return new Response(JSON.stringify({ error: 'from is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from, to: [to], subject, html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const resendJson = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: resendJson.message || 'Resend send failed', detail: resendJson }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: resendJson.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
