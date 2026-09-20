// Shared TLD reference data — loaded by domain-search.html and hosting-services.html.
// `restricted: true` marks sponsored/eligibility-gated TLDs (.gov/.mil/.arpa/.edu/.int/.bank)
// that Openprovider won't sell to the general public; these are excluded from any live
// availability-check list built from this catalog. Everything else is fair game to check.
//
// `maxYears`/`minYears`: per-registry registration-term limits, researched directly
// against Openprovider's own published per-TLD registration-period documentation
// (openprovider.com/domains/tlds/<tld>, plus registry-authoritative sources for the
// two TLDs Openprovider doesn't publish a page for) — NOT assumptions. Absence of
// either field means the site's own default range (1/2/3/5/10 years) applies as-is.
// Keep supabase/functions/create-domain-checkout/index.ts's TLD_MAX_YEARS/TLD_MIN_YEARS
// in sync with any change here — that server-side copy is what actually blocks an
// over-term purchase before Stripe is ever charged.
var TLD_CATALOG = [
  { tld: '.com', type: 'gTLD', desc: 'Commercial; the universal standard for business websites.' },
  { tld: '.net', type: 'gTLD', desc: 'Network infrastructure; highly favored by tech and telecom.' },
  { tld: '.org', type: 'gTLD', desc: 'Organizations; standard for non-profits and open-source.' },
  { tld: '.arpa', type: 'Infrastructure', desc: 'Used exclusively for internal internet routing and DNS engineering.', restricted: true },
  { tld: '.edu', type: 'sTLD', desc: 'Accredited post-secondary educational institutions (primarily US).', restricted: true },
  { tld: '.gov', type: 'sTLD', desc: 'Reserved strictly for government entities (primarily US).', restricted: true },
  { tld: '.info', type: 'gTLD', desc: 'Information; a highly accessible unrestricted legacy extension.' },
  { tld: '.biz', type: 'gTLD', desc: 'Business alternative, created to alleviate .com overcrowding.' },
  { tld: '.mil', type: 'sTLD', desc: 'Restricted entirely to the United States Military.', restricted: true },
  { tld: '.int', type: 'sTLD', desc: 'International organizations established by treaty (e.g., UN, NATO).', restricted: true },
  { tld: '.cn', type: 'ccTLD', desc: 'China — highest-volume ccTLD.', maxYears: 5 },
  { tld: '.de', type: 'ccTLD', desc: 'Germany.', maxYears: 1 },
  { tld: '.uk', type: 'ccTLD', desc: 'United Kingdom.' },
  { tld: '.ru', type: 'ccTLD', desc: 'Russia.', maxYears: 1 },
  { tld: '.nl', type: 'ccTLD', desc: 'Netherlands.', maxYears: 1 },
  { tld: '.fr', type: 'ccTLD', desc: 'France.' },
  { tld: '.it', type: 'ccTLD', desc: 'Italy.', maxYears: 1 },
  { tld: '.eu', type: 'ccTLD', desc: 'European Union.' },
  { tld: '.ca', type: 'ccTLD', desc: 'Canada.' },
  { tld: '.jp', type: 'ccTLD', desc: 'Japan.', maxYears: 2 },
  { tld: '.in', type: 'ccTLD', desc: 'India.' },
  { tld: '.co', type: 'ccTLD', desc: 'Colombia — massively used globally as a .com alternative.', maxYears: 5 },
  { tld: '.ai', type: 'ccTLD', desc: 'Anguilla — the definitive standard for artificial intelligence companies.', minYears: 2 },
  { tld: '.io', type: 'ccTLD', desc: 'British Indian Ocean Territory — broadly adopted by SaaS/tech companies.' },
  { tld: '.ch', type: 'ccTLD', desc: 'Switzerland.', maxYears: 1 },
  { tld: '.se', type: 'ccTLD', desc: 'Sweden.' },
  { tld: '.pl', type: 'ccTLD', desc: 'Poland.', maxYears: 3 },
  { tld: '.es', type: 'ccTLD', desc: 'Spain.', maxYears: 5 },
  { tld: '.kr', type: 'ccTLD', desc: 'South Korea.' },
  { tld: '.tw', type: 'ccTLD', desc: 'Taiwan.' },
  { tld: '.mx', type: 'ccTLD', desc: 'Mexico.', maxYears: 3 },
  { tld: '.tv', type: 'ccTLD', desc: 'Tuvalu — widely used for media and video-streaming platforms.' },
  { tld: '.me', type: 'ccTLD', desc: 'Montenegro — frequently used for personal branding/blogs.' },
  { tld: '.cc', type: 'ccTLD', desc: 'Cocos Islands.' },
  { tld: '.xyz', type: 'gTLD', desc: 'Heavily used for web3, tech experimentation, and general projects.' },
  { tld: '.online', type: 'gTLD', desc: 'A universal, multi-purpose alternative for web storefronts.' },
  { tld: '.site', type: 'gTLD', desc: 'Popular for landing pages and modern portfolio architectures.' },
  { tld: '.shop', type: 'gTLD', desc: 'Standard for independent e-commerce operations.' },
  { tld: '.store', type: 'gTLD', desc: 'Extensively used for retail brands and merchandise stores.' },
  { tld: '.tech', type: 'gTLD', desc: 'The go-to generic extension for engineering and software companies.' },
  { tld: '.app', type: 'gTLD', desc: 'Secure extension (requires HTTPS) widely used by application developers.' },
  { tld: '.dev', type: 'gTLD', desc: 'Secure extension optimized for developers and software engineering platforms.' },
  { tld: '.cloud', type: 'gTLD', desc: 'Extensively adopted by B2B SaaS and cloud computing infrastructure firms.' },
  { tld: '.pro', type: 'gTLD', desc: 'Tailored for certified professionals like accountants, lawyers, and consultants.' },
  { tld: '.agency', type: 'gTLD', desc: 'Standard for design, advertising, and talent agencies.' },
  { tld: '.bank', type: 'gTLD', desc: 'Highly restricted verification for financial institutions.', restricted: true },
  { tld: '.studio', type: 'gTLD', desc: 'Design and photography workshops.' },
  { tld: '.design', type: 'gTLD', desc: 'UX/UI and graphic design portfolios.' },
  { tld: '.blog', type: 'gTLD', desc: 'Individual publication platforms.' },
  { tld: '.asia', type: 'geoTLD', desc: 'Pan-Asian business operations.' }
];
