import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Supabase Edge Function: create-domain-checkout
 *
 * Public — no auth required (walk-up buyers have no account, matches
 * create-checkout being publicly callable). Accepts POST
 * { items: [{domain, tld, price}, ...], registrant: {...}, buyer_email }.
 *
 * Writes a `domain_orders` row (status: pending) via the service-role
 * client BEFORE creating the Stripe session, so the order exists even if
 * the buyer abandons checkout. metadata.order_id on the session is what
 * stripe-domain-webhook uses to find this row again on payment success.
 *
 * One Stripe line item per cart domain — price is exactly what
 * check-domain-availability returned (Openprovider wholesale, 0% markup
 * at signup per the standing pricing decision). No client-side price is
 * trusted beyond validating it's a positive number.
 *
 * Deploy:
 *   supabase functions deploy create-domain-checkout
 *   (reuses STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY —
 *   all already set for create-checkout / other functions)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_REGISTRANT_FIELDS = ['name', 'phone', 'address', 'city', 'state', 'postal_code', 'country'];

// Year 1 is at cost (0% markup); Year 2+ renews at a flat +20% over wholesale.
// Rounds once at the end (not per-year) so this always matches the client's
// displayed total, which does the same dollar-precision math before rounding.
const RENEWAL_MARKUP = 0.20;
function multiYearCents(baseDollars: number, years: number): number {
  const renewalDollars = baseDollars * (1 + RENEWAL_MARKUP);
  const totalDollars = baseDollars + Math.max(years - 1, 0) * renewalDollars;
  return Math.round(totalDollars * 100);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { items, registrant, buyer_email } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'items array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const VALID_YEARS = [1, 2, 3, 5, 10];
    for (const item of items) {
      if (!item || typeof item.domain !== 'string' || !item.domain.trim() || typeof item.price !== 'number' || item.price <= 0) {
        return new Response(JSON.stringify({ error: 'Each item needs a domain and a positive price' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (item.years !== undefined && !VALID_YEARS.includes(item.years)) {
        return new Response(JSON.stringify({ error: 'item.years must be one of 1, 2, 3, 5, 10' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    if (!buyer_email || !EMAIL_RE.test(buyer_email)) {
      return new Response(JSON.stringify({ error: 'A valid buyer_email is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!registrant || typeof registrant !== 'object') {
      return new Response(JSON.stringify({ error: 'registrant details are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    for (const field of REQUIRED_REGISTRANT_FIELDS) {
      if (!registrant[field] || !String(registrant[field]).trim()) {
        return new Response(JSON.stringify({ error: `registrant.${field} is required` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const total = items.reduce((sum: number, i: { price: number; years?: number; type?: string }) => {
      if (i.type === 'addon') return sum + i.price;
      return sum + multiYearCents(i.price, i.years || 1) / 100;
    }, 0);

    const { data: order, error: dbError } = await sb
      .from('domain_orders')
      .insert({
        buyer_email: String(buyer_email).trim().toLowerCase(),
        registrant,
        items,
        total,
        status: 'pending',
      })
      .select()
      .single();

    if (dbError) {
      return new Response(JSON.stringify({ error: dbError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2023-10-16' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map((item: { domain: string; tld: string; price: number; years?: number; type?: string }) => {
        const isAddon = item.type === 'addon';
        const years = item.years || 1;
        return {
          price_data: {
            currency: 'usd',
            product_data: { name: isAddon ? `Domain Protection — ${item.domain}` : `Domain registration — ${item.domain} (${years} yr)` },
            // `price` is the annual rate check-domain-availability returned (Year 1, at cost).
            // Year 2+ is a flat +20% renewal markup — see multiYearCents() above. Still a
            // client-trusted approximation, not a real multi-year registrar quote (Openprovider's
            // /domains/check only ever returns a single-year price).
            unit_amount: isAddon ? Math.round(item.price * 100) : multiYearCents(item.price, years),
          },
          quantity: 1,
        };
      }),
      mode: 'payment',
      customer_email: buyer_email,
      success_url: `${req.headers.get('origin') || 'https://vardweb.com'}/hosting-services.html?order=success`,
      cancel_url: `${req.headers.get('origin') || 'https://vardweb.com'}/hosting-services.html?order=cancelled`,
      metadata: { order_id: order.id },
    });

    await sb.from('domain_orders').update({ stripe_session_id: session.id }).eq('id', order.id);

    return new Response(JSON.stringify({ checkout_url: session.url, order_id: order.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
