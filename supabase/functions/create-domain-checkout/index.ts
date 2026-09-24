import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Supabase Edge Function: create-domain-checkout
 *
 * Public: no auth required (walk-up buyers have no account, matches
 * create-checkout being publicly callable). Accepts POST
 * { items: [{domain, tld, price}, ...], registrant: {...}, buyer_email }.
 *
 * Writes a `domain_orders` row (status: pending) via the service-role
 * client BEFORE creating the Stripe session, so the order exists even if
 * the buyer abandons checkout. metadata.order_id on the session is what
 * stripe-domain-webhook uses to find this row again on payment success.
 *
 * One Stripe line item per cart domain: price is exactly what
 * check-domain-availability returned (Openprovider wholesale, 0% markup
 * at signup per the standing pricing decision). No client-side price is
 * trusted beyond validating it's a positive number.
 *
 * Deploy:
 *   supabase functions deploy create-domain-checkout
 *   (reuses STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
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

// Canadian sales tax (GST/HST only; PST/QST intentionally excluded).
// VardWeb is a voluntary GST/HST registrant (under the $30k small-supplier
// threshold but already holds a GST/HST number, so charging GST/HST is
// required going forward). PST/QST is NOT charged: BC exempts pure web
// design without software, and SK/MB/QC's service-line rules are unclear
// without an accountant's sign-off. HST provinces (NB/NL/NS/ON/PE) already
// are one single combined rate; everywhere else is plain 5% GST.
// Keep in sync with checkout.html's CA_TAX_RATES. Non-Canadian orders are 0%.
const CA_TAX_RATES: Record<string, number> = {
  AB: 0.05, BC: 0.05, MB: 0.05, NB: 0.15, NL: 0.15, NS: 0.14, NT: 0.05,
  NU: 0.05, ON: 0.13, PE: 0.15, QC: 0.05, SK: 0.05, YT: 0.05,
};
function getTaxRate(country: string, province: string): number {
  if (country !== 'CA') return 0;
  return CA_TAX_RATES[String(province || '').toUpperCase()] || 0;
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
    // Per-registry term limits: mirrors tld-catalog.js's maxYears/minYears fields
    // (researched against Openprovider's own published per-TLD registration-period
    // docs). Keep both copies in sync; this one is what actually blocks an
    // over/under-term purchase before Stripe is ever charged.
    const TLD_MAX_YEARS: Record<string, number> = {
      '.cn': 5, '.de': 1, '.ru': 1, '.nl': 1, '.it': 1, '.jp': 2,
      '.co': 5, '.ch': 1, '.pl': 3, '.es': 5, '.mx': 3,
    };
    const TLD_MIN_YEARS: Record<string, number> = { '.ai': 2 };
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
      const tldMax = TLD_MAX_YEARS[item.tld];
      if (item.years !== undefined && tldMax !== undefined && item.years > tldMax) {
        return new Response(JSON.stringify({ error: `${item.tld} domains can be registered for at most ${tldMax} year${tldMax > 1 ? 's' : ''}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const tldMin = TLD_MIN_YEARS[item.tld];
      if (item.years !== undefined && tldMin !== undefined && item.years < tldMin) {
        return new Response(JSON.stringify({ error: `${item.tld} domains require at least ${tldMin} years` }), {
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

    const lineItemCentsList = items.map((item: { domain: string; tld: string; price: number; years?: number; type?: string }) => {
      // 'broker' is a flat Domain Broker Service fee, not a domain; priced and
      // (in the webhook) registered like an addon, but kept as its own type so
      // its Stripe line-item label and domain_orders.items stay self-documenting
      // rather than showing up as "Domain Protection".
      const isAddon = item.type === 'addon' || item.type === 'broker';
      const isBroker = item.type === 'broker';
      const isPremium = item.type === 'premium';
      const years = item.years || 1;
      return {
        domain: item.domain,
        isAddon,
        isBroker,
        isPremium,
        years,
        // `price` is the annual rate check-domain-availability returned (Year 1, at cost).
        // Year 2+ is a flat +20% renewal markup; see multiYearCents() above. Still a
        // client-trusted approximation, not a real multi-year registrar quote (Openprovider's
        // /domains/check only ever returns a single-year price).
        amountCents: isAddon ? Math.round(item.price * 100) : multiYearCents(item.price, years),
      };
    });
    const subtotalCents = lineItemCentsList.reduce((sum: number, li: { amountCents: number }) => sum + li.amountCents, 0);
    const taxRate = getTaxRate(registrant.country, registrant.state);
    const taxCents = Math.round(subtotalCents * taxRate);
    const total = (subtotalCents + taxCents) / 100;

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

    const stripeLineItems = lineItemCentsList.map((li: { domain: string; isAddon: boolean; isBroker: boolean; isPremium: boolean; years: number; amountCents: number }) => ({
      price_data: {
        currency: 'cad',
        product_data: {
          name: li.isBroker
            ? `Domain Broker Service: ${li.domain}`
            : li.isAddon
              ? `Domain Protection: ${li.domain}`
              : li.isPremium
                ? `Premium domain purchase: ${li.domain}`
                : `Domain registration: ${li.domain} (${li.years} yr)`,
        },
        unit_amount: li.amountCents,
      },
      quantity: 1,
    }));
    if (taxCents > 0) {
      const taxName = taxRate >= 0.13 ? 'HST' : 'GST';
      stripeLineItems.push({
        price_data: {
          currency: 'cad',
          product_data: { name: `${taxName} (${registrant.state}, ${Math.round(taxRate * 10000) / 100}%)` },
          unit_amount: taxCents,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      // 'if_required' keeps the buyer inside the mounted Embedded Checkout with
      // Stripe's built-in in-page success state; the whole reason this uses
      // embedded mode over a hosted redirect. Stripe only navigates to
      // return_url when it truly can't stay in-page (e.g. a redirect-based
      // payment method or off-session 3DS); return_url stays required either way.
      redirect_on_completion: 'if_required',
      payment_method_types: ['card'],
      line_items: stripeLineItems,
      mode: 'payment',
      customer_email: buyer_email,
      return_url: `${req.headers.get('origin') || 'https://vardweb.com'}/checkout.html?order={CHECKOUT_SESSION_ID}`,
      metadata: { order_id: order.id },
      // @ts-ignore branding_settings isn't in the stripe@14 type defs yet; added to the
      // Checkout Sessions API in the 2025-09-30.clover version, requested below per-call
      // so the account-wide pinned apiVersion (2023-10-16) stays untouched everywhere else.
      branding_settings: {
        background_color: '#0f1219',
        button_color: '#34D399',
        border_style: 'rounded',
      },
    }, { apiVersion: '2025-09-30.clover' });

    await sb.from('domain_orders').update({ stripe_session_id: session.id }).eq('id', order.id);

    return new Response(JSON.stringify({ client_secret: session.client_secret, order_id: order.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
