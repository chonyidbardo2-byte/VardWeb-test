// Regenerates sitemap.xml from the git-tracked public pages in the project root.
// Run after adding, removing or renaming a page: npm run sitemap
import { execSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';

const BASE = 'https://vardweb.com';
// Transactional or placeholder pages that shouldn't be indexed
const EXCLUDE = new Set(['checkout.html', 'ecommerce-demo.html']);

const tracked = execSync('git ls-files -- "*.html"', { encoding: 'utf8' })
  .split('\n')
  .filter(f => f && !f.includes('/') && !EXCLUDE.has(f))
  .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

function lastmod(file) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "${file}"`, { encoding: 'utf8' }).trim();
    if (d) return d;
  } catch {}
  return statSync(file).mtime.toISOString().slice(0, 10);
}

const urls = tracked.map(f => {
  const loc = f === 'index.html' ? `${BASE}/` : `${BASE}/${f}`;
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod(f)}</lastmod>\n  </url>`;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
writeFileSync('sitemap.xml', xml);
console.log(`sitemap.xml: ${urls.length} URLs`);
