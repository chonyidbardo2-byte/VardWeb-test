/*
 * Pure pricing logic for sync-sms-rates. No Deno/Supabase APIs here, so the
 * same file can be tested locally with node against a saved feed.
 *
 * Feed: https://telnyx.com/api/pricing/messaging?country=CA|US (public JSON
 * behind telnyx.com/pricing/messaging). Shape: tablesData.USD[0].tabs[] each
 * with tables[]: "Services" (base rates) + "Carrier fees for outbound/inbound
 * messages". Cells read like "$0.0025 per message part + [carrier fee](...)",
 * "No carrier fee" or "N/A".
 */

// Pricing rule (artifact §11.3, 27 Sep 2026)
export const RULE = {
  fxFloor: 1.45,        // never convert below this, even if the live rate is lower
  fxBuffer: 1.03,       // live Bank of Canada rate × 3%
  markup: 1.45,
  replyShare: 0.10,     // replies included up to 10% of outbound
  step: 0.005,          // round up to the next C$0.005
  outlierFee: 0.01,     // carrier fees above this (USD) are flagged, not averaged in
};

// Prices VardWeb has decided to show no matter what the rule computes lower.
export const FLOORS = { ca_text: 0.035, us_text: 0.025, mms: 0.07 };

export function parseMoney(cell) {
  if (cell == null) return 0;
  const m = String(cell).match(/\$\s*([0-9]*\.?[0-9]+)/);
  return m ? parseFloat(m[1]) : 0; // "No carrier fee" / "N/A" -> 0
}

export function roundUp(value, step = RULE.step) {
  // small epsilon so 0.0350000001 from float math doesn't jump a step
  return Math.ceil(value / step - 1e-9) * step;
}

function findTab(feed, pattern) {
  const tabs = feed?.tablesData?.USD?.[0]?.tabs;
  if (!Array.isArray(tabs)) throw new Error('feed shape changed: no USD tabs');
  const tab = tabs.find((t) => pattern.test(t.label || ''));
  if (!tab) throw new Error(`feed shape changed: no tab matching ${pattern}`);
  return tab;
}

function findTable(tab, pattern) {
  const table = (tab.tables || []).find((t) => pattern.test(t.caption || ''));
  if (!table) throw new Error(`feed shape changed: no "${pattern}" table in tab "${tab.label}"`);
  return table;
}

// Returns { base:{out:{sms,mms}, in:{sms,mms}}, carrierOut:{sms,mms}, carrierIn:{sms,mms}, flagged:[] }
export function extractLine(feed, tabPattern) {
  const tab = findTab(feed, tabPattern);
  const services = findTable(tab, /^services$/i);
  const row = (re) => {
    const r = services.body.find((b) => re.test(b.label?.value || ''));
    if (!r) throw new Error(`feed shape changed: no "${re}" row in tab "${tab.label}"`);
    return r.data.value; // [sms, mms]
  };
  const out = row(/send outbound/i);
  const inb = row(/receive inbound/i);
  const base = {
    out: { sms: parseMoney(out[0]), mms: parseMoney(out[1]) },
    in: { sms: parseMoney(inb[0]), mms: parseMoney(inb[1]) },
  };
  if (!(base.out.sms > 0 && base.out.sms < 0.05)) {
    throw new Error(`implausible outbound SMS base ${base.out.sms} in tab "${tab.label}"`);
  }

  // Outlier carriers are flagged and left out of the worst case; recipients on
  // them get billed at cost × rule instead of the flat rate. MMS carrier fees
  // run higher by nature (CA Rogers 0.0177), so MMS gets its own threshold.
  const limits = { sms: RULE.outlierFee, mms: 0.05 };
  const flagged = [];
  const maxFee = (table, dir) => {
    const res = { sms: 0, mms: 0 };
    for (const b of table.body) {
      const name = b.label?.value || '?';
      ['sms', 'mms'].forEach((kind, i) => {
        const fee = parseMoney(b.data.value[i]);
        if (fee > limits[kind]) flagged.push({ carrier: name, dir, kind, fee });
        else if (fee > res[kind]) res[kind] = fee;
      });
    }
    return res;
  };
  return {
    tab: tab.label.trim(),
    base,
    carrierOut: maxFee(findTable(tab, /carrier fees for outbound/i), 'out'),
    carrierIn: maxFee(findTable(tab, /carrier fees for inbound/i), 'in'),
    flagged,
  };
}

// Worst-case USD cost per outbound segment, replies included.
export function worstCosts(line) {
  const text = line.base.out.sms + line.carrierOut.sms
    + RULE.replyShare * (line.base.in.sms + line.carrierIn.sms);
  const mms = line.base.out.mms + line.carrierOut.mms;
  const reply = line.base.in.sms + line.carrierIn.sms;
  return { text, mms, reply };
}

export function fxUsed(liveRate) {
  const live = Number(liveRate);
  if (!(live > 1 && live < 3)) return RULE.fxFloor;
  return Math.max(RULE.fxFloor, live * RULE.fxBuffer);
}

/*
 * ca = extractLine(caFeed, /local/i)   (Canadian local number)
 * us = extractLine(usFeed, /toll-free/i) (US toll-free number)
 * current = the stored row (or null). Prices only ever go up automatically.
 */
export function computePrices(ca, us, liveFx, current) {
  const fx = fxUsed(liveFx);
  const toCad = (usd) => roundUp(usd * fx * RULE.markup);
  const caCost = worstCosts(ca);
  const usCost = worstCosts(us);
  const computed = {
    ca_text: toCad(caCost.text),
    us_text: toCad(usCost.text),
    mms: toCad(Math.max(caCost.mms, usCost.mms)),
  };
  const prev = current || {};
  const next = {};
  const raised = [];
  for (const k of Object.keys(computed)) {
    const was = Number(prev[k]) || 0;
    next[k] = Math.max(computed[k], FLOORS[k], was);
    if (was && next[k] > was + 1e-9) raised.push({ key: k, from: was, to: next[k] });
  }
  // Custom volume floor (internal, never shown): at least 20% over the worst
  // cost at the buffered FX, in C$0.001 steps so it isn't pushed up to list price
  next.custom_floor = Math.max(
    roundUp(Math.max(caCost.text, usCost.text) * fx * 1.2, 0.001),
    Number(prev.custom_floor) || 0,
  );
  next.minimum_monthly = Math.max(25, Number(prev.minimum_monthly) || 0);
  return {
    fx,
    computed,
    prices: next,
    raised,
    costs: { ca: caCost, us: usCost },
    flagged: [...ca.flagged.map((f) => ({ ...f, line: 'CA local' })), ...us.flagged.map((f) => ({ ...f, line: 'US toll-free' }))],
  };
}
