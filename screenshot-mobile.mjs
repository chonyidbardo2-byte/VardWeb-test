import puppeteer from './node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/VARD/.cache/puppeteer/chrome/win64-147.0.7727.57/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.goto('http://localhost:3000/about.html', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1000));

await page.screenshot({ path: 'temporary screenshots/screenshot-210-mobile-closed.png', fullPage: false });
console.log('Saved closed state');

await page.click('.nav-hamburger');
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: 'temporary screenshots/screenshot-211-mobile-open.png', fullPage: false });
console.log('Saved open state');

await browser.close();
