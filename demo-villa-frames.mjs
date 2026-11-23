// Builds every media file web-design-demo.html expects from the raw generations.
//
// Put the raw files here (names must match the "Demo Villa Media Prompts" artifact):
//   brand_assets/demo-villa/src/arrival.mp4                      (Seedance, K1 -> K2)
//   brand_assets/demo-villa/src/walk-a.mp4, walk-b.mp4, walk-c.mp4 (Seedance, K2 -> K3 -> K4 -> K5)
//   brand_assets/demo-villa/src/sunset.mp4                       (Seedance, K6 -> end)
//   brand_assets/demo-villa/src/photos/<name>.png|jpg|webp       (9 stills)
//
// Run:  node demo-villa-frames.mjs            (everything)
//       node demo-villa-frames.mjs photos     (one part: keys | photos | arrival | walk | sunset)
//
// Output (what the page reads):
//   arrival/d1920/0001..0064.webp  arrival/m/0001..0064.webp   (1920x1080, and the 606x1080 centre crop scaled to 540x960)
//   walk/d1920/0001..0192.webp     walk/m/0001..0192.webp
//   sunset/desktop.mp4 mobile.mp4 poster-desktop.webp poster-mobile.webp end-desktop.webp end-mobile.webp
//   sunset/desktop.webm mobile.webm (VP9, main) + the mp4s (fallback)
//   photos/<name>-1600.webp (1600x900) and photos/<name>-800.webp (800x450), plus photos/<name>-portrait.webp (4:5, full source height) for the tall slots
//   src/keys/k1..k7.webp (archive copies, not used by the page)
// Scroll frames are WebP quality 75 (tested: no visible loss, ~11 MB lighter); photos, posters and keys are quality 85.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const WINGET = 'C:/Users/VARD/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin';
const bin = n => process.env.FFMPEG_DIR ? path.join(process.env.FFMPEG_DIR, n) : fs.existsSync(`${WINGET}/${n}.exe`) ? `${WINGET}/${n}.exe` : n;
const FFMPEG = bin('ffmpeg'), FFPROBE = bin('ffprobe');

const ROOT = 'brand_assets/demo-villa', SRC = `${ROOT}/src`;
// Test builds: OUT sends the sequences elsewhere, FRAME_Q sets their WebP quality.
const SEQ_OUT = process.env.OUT || ROOT, FRAME_Q = process.env.FRAME_Q || '75';
// Phone frames: the 606x1080 centre crop scaled to 540x960 at quality 70 (tested: no visible loss, 2 MB lighter). M_Q / M_SIZE override.
const M_Q = process.env.M_Q || '70', M_SIZE = process.env.M_SIZE || '540x960';
const PHOTOS = ['ingresso', 'soggiorno', 'soggiorno-2', 'cucina', 'cucina-2', 'camera', 'camera-2', 'terrazza', 'tramonto'];
const SEQ = { arrival: { frames: 64, clips: ['arrival.mp4'] }, walk: { frames: 192, clips: ['walk-a.mp4', 'walk-b.mp4', 'walk-c.mp4'] } };
const COVER = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1';
const MOBILE = 'crop=606:1080:(iw-606)/2:0'; // centre crop of the 1920x1080 frame: the subject must sit in the middle 32%

// Every output is written without metadata (no source tags, no encoder version), so the shipped files stay clean.
const ff = args => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args.slice(0, -1), '-map_metadata', '-1', '-fflags', '+bitexact', args[args.length - 1]], { stdio: 'inherit' });
const duration = f => +execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const fresh = d => { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); };
const need = f => { if (!fs.existsSync(f)) throw new Error(`Missing ${f}`); return f; };

function sequence(key) {
  const { frames, clips } = SEQ[key];
  const files = clips.map(c => need(`${SRC}/${c}`));
  // Chained first+last-frame clips repeat the seam frame: drop frame 1 of every clip after the first.
  const parts = files.map((_, i) => `[${i}:v]${COVER},${i ? 'trim=start_frame=1,' : ''}setpts=PTS-STARTPTS[v${i}]`);
  const total = files.reduce((s, f) => s + duration(f), 0);
  const fps = (frames / total).toFixed(6); // resample so the clip lands on exactly `frames` frames
  const tmp = `${SEQ_OUT}/${key}/_master.mp4`;
  fs.mkdirSync(`${SEQ_OUT}/${key}`, { recursive: true });
  ff([...files.flatMap(f => ['-i', f]), '-filter_complex',
    `${parts.join(';')};${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0,fps=${fps},tpad=stop_mode=clone:stop=3[out]`,
    '-map', '[out]', '-frames:v', String(frames), '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', tmp]);
  for (const [dir, vf, q] of [['d1920', 'null', FRAME_Q], ['m', M_SIZE ? `${MOBILE},scale=${M_SIZE.replace('x', ':')}:flags=lanczos` : MOBILE, M_Q]]) {
    fresh(`${SEQ_OUT}/${key}/${dir}`);
    ff(['-i', tmp, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libwebp', '-quality', q, '-compression_level', '6', `${SEQ_OUT}/${key}/${dir}/%04d.webp`]);
  }
  fs.rmSync(tmp);
  const n = fs.readdirSync(`${SEQ_OUT}/${key}/d1920`).length;
  console.log(`${key}: ${n} frames (${n === frames ? 'ok' : 'WRONG COUNT, expected ' + frames})`);
}

function sunset() {
  const src = need(`${SRC}/sunset.mp4`), out = `${ROOT}/sunset`;
  fresh(out);
  const enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '24'];
  ff(['-i', src, '-vf', COVER, ...enc, `${out}/desktop.mp4`]);
  ff(['-i', src, '-vf', `${COVER},${MOBILE}`, ...enc, `${out}/mobile.mp4`]);
  // WebM (VP9) is the main source; the MP4s above are the fallback for browsers without VP9.
  const webm = ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-r', '24'];
  ff(['-i', src, '-vf', COVER, ...webm, `${out}/desktop.webm`]);
  ff(['-i', src, '-vf', `${COVER},${MOBILE}`, ...webm, `${out}/mobile.webm`]);
  for (const tag of ['desktop', 'mobile']) {
    ff(['-i', `${out}/desktop.mp4`, '-vf', tag === 'desktop' ? 'null' : MOBILE, '-frames:v', '1', '-quality', '85', `${out}/poster-${tag}.webp`]);
    ff(['-sseof', '-0.1', '-i', `${out}/desktop.mp4`, '-vf', tag === 'desktop' ? 'null' : MOBILE, '-frames:v', '1', '-update', '1', '-quality', '85', `${out}/end-${tag}.webp`]);
  }
  console.log('sunset: desktop.webm, mobile.webm, desktop.mp4, mobile.mp4, posters and end frames ok');
}

const PORTRAIT = ['terrazza', 'ingresso', 'soggiorno', 'cucina', 'camera', 'tramonto'];
function photos() {
  fs.mkdirSync(`${ROOT}/photos`, { recursive: true });
  for (const name of PHOTOS) {
    const src = ['png', 'jpg', 'jpeg', 'webp'].map(e => `${SRC}/photos/${name}.${e}`).find(f => fs.existsSync(f));
    if (!src) { console.warn(`photos: skipped ${name} (no source yet)`); continue; }
    for (const w of [1600, 800]) {
      const h = Math.round(w * 9 / 16);
      ff(['-i', src, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-quality', '85', `${ROOT}/photos/${name}-${w}.webp`]);
    }
    // Tall 4:5 slots (the house photo, the menu stills) get their own crop at the source's full height, so they are never a blown-up slice of the wide file.
    if (PORTRAIT.includes(name)) ff(['-i', src, '-vf', 'crop=trunc(ih*4/5/2)*2:ih', '-quality', '85', `${ROOT}/photos/${name}-portrait.webp`]);
    console.log(`photos: ${name} ok`);
  }
}

function keys() {
  // Quality 85 WebP copies of the keyframes, beside the originals (the page does not load these).
  for (let n = 1; n <= 7; n++) {
    const src = ['png', 'jpg', 'jpeg'].map(e => `${SRC}/keys/k${n}.${e}`).find(f => fs.existsSync(f));
    if (!src) { console.warn(`keys: skipped k${n} (no source)`); continue; }
    ff(['-i', src, '-quality', '85', `${SRC}/keys/k${n}.webp`]);
  }
  console.log('keys: webp copies ok');
}

const only = process.argv[2];
const jobs = { keys, photos, arrival: () => sequence('arrival'), walk: () => sequence('walk'), sunset };
for (const [k, run] of Object.entries(jobs)) {
  if (only && only !== k) continue;
  try { run(); } catch (e) { console.warn(`${k}: ${e.message}`); }
}
