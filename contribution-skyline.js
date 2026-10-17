/* ── Contribution Skyline ──
   A year of GitHub activity as a heat map that folds up into an isometric
   skyline, and back down again. Vanilla port of the React
   contribution-skyline component: one canvas scene, one camera swinging from
   straight-down (2D) to the corner (3D) while each week's bars rise in a wave.

   Usage: ContributionSkyline.mount(el, { username, palette, defaultView })
   Data comes from the public GitHub contributions proxy; if that fails, a
   seeded sample year is drawn so the card is never empty. */
(function () {
  'use strict';

  // ── Pure helpers: dates, grid, stats, levels, camera and colour maths ──
  var DAY_MS = 86400000;
  var clamp01 = function (v) { return v > 0 ? (v < 1 ? v : 1) : 0; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeInOutCubic = function (x) {
    var t = clamp01(x);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  var easeOutCubic = function (x) { return 1 - Math.pow(1 - clamp01(x), 3); };
  var smoothstep = function (a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  var toKey = function (ms) { return new Date(ms).toISOString().slice(0, 10); };

  // "YYYY-MM-DD" read literally, Date by its local day, number as UTC timestamp.
  var dayMs = function (v) {
    if (typeof v === 'number') return Math.floor(v / DAY_MS) * DAY_MS;
    if (typeof v === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
      v = new Date(v);
    }
    return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  };

  // mulberry32
  var rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  var generateContributions = function (endMs, seed, days) {
    seed = seed == null ? 7 : seed;
    days = days || 371;
    var r = rng(seed);
    var bursts = [];
    for (var b = 0; b < 4; b++) bursts.push({ at: r(), width: 0.035 + r() * 0.07, gain: 0.6 + r() * 1.1 });
    var out = [];
    var mood = 0.5;
    for (var i = 0; i < days; i++) {
      var ms = endMs - (days - 1 - i) * DAY_MS;
      var x = i / Math.max(1, days - 1);
      var dow = new Date(ms).getUTCDay();
      var weekend = dow === 0 || dow === 6;
      var heat = 0.2;
      for (var k = 0; k < bursts.length; k++) {
        var bu = bursts[k];
        heat += bu.gain * Math.exp(-Math.pow(x - bu.at, 2) / (2 * bu.width * bu.width));
      }
      mood = mood * 0.85 + r() * 0.15;
      heat *= 0.55 + mood * 0.9;
      var pActive = Math.min(0.94, (weekend ? 0.22 : 0.5) + heat * 0.4);
      var count = 0;
      if (r() < pActive) count = 1 + Math.floor(-Math.log(1 - r()) * (1.2 + heat * 7) * (weekend ? 0.5 : 1));
      if (r() < 0.01) count += 18 + Math.floor(r() * 24);
      out.push({ date: toKey(ms), count: count });
    }
    return out;
  };

  // 0 for an empty day, else 1-4 by quarters of `busy`.
  var levelOf = function (count, busy) {
    return count <= 0 ? 0 : busy <= 0 ? 4 : 1 + Math.min(3, Math.floor((count / busy) * 4));
  };

  // Columns are weeks, rows weekdays. Levels split non-zero days by the 95th percentile.
  var buildGrid = function (data, endMs, weekStart) {
    var counts = new Map();
    data.forEach(function (d) {
      if (!d || typeof d.date !== 'string') return;
      var ms = dayMs(d.date);
      var c = Number(d.count);
      if (!Number.isFinite(ms) || !(c > 0) || !Number.isFinite(c)) return;
      var k = toKey(ms);
      counts.set(k, (counts.get(k) || 0) + c);
    });
    var start = endMs - 364 * DAY_MS;
    start -= ((new Date(start).getUTCDay() - weekStart + 7) % 7) * DAY_MS;
    var cells = [];
    for (var ms = start, i = 0; ms <= endMs; ms += DAY_MS, i++) {
      var date = toKey(ms);
      cells.push({ date: date, count: counts.get(date) || 0, level: 0, week: Math.floor(i / 7), day: i % 7 });
    }
    var nz = cells.map(function (c) { return c.count; }).filter(function (c) { return c > 0; }).sort(function (a, b) { return a - b; });
    var busy = nz.length ? nz[Math.floor(0.95 * (nz.length - 1))] : 0;
    cells.forEach(function (c) { c.level = levelOf(c.count, busy); });
    return { cells: cells, weeks: cells.length ? cells[cells.length - 1].week + 1 : 0, max: nz.length ? nz[nz.length - 1] : 0 };
  };

  // Total, busiest day, longest run, and the run reaching today (or yesterday).
  var computeStats = function (cells) {
    var total = 0, best = 0, bestDate = null, run = 0, runStart = null;
    var longest = { days: 0, start: null, end: null };
    cells.forEach(function (c) {
      total += c.count;
      if (c.count > best) { best = c.count; bestDate = c.date; }
      if (c.count > 0) {
        if (run === 0) runStart = c.date;
        run++;
        if (run > longest.days) longest = { days: run, start: runStart, end: c.date };
      } else run = 0;
    });
    var j = cells.length - 1;
    if (j >= 0 && cells[j].count === 0) j--;
    var endAt = j;
    while (j >= 0 && cells[j].count > 0) j--;
    var days = endAt - j;
    var current = days > 0 ? { days: days, start: cells[j + 1].date, end: cells[endAt].date } : { days: 0, start: null, end: null };
    return {
      total: total,
      first: cells.length ? cells[0].date : null,
      last: cells.length ? cells[cells.length - 1].date : null,
      busiest: { count: best, date: bestDate },
      longest: longest,
      current: current
    };
  };

  // A label on each week whose first day starts a new month; a cramped first label is dropped.
  var monthLabels = function (cells, weeks, locale) {
    var fmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    var out = [];
    var prev = -1;
    for (var w = 0; w < weeks; w++) {
      var c = cells[w * 7];
      if (!c) break;
      var m = +c.date.slice(5, 7);
      if (m !== prev) out.push({ week: w, label: fmt.format(dayMs(c.date)) });
      prev = m;
    }
    if (out.length > 1 && out[1].week - out[0].week < 3) out.shift();
    return out;
  };

  // Box height in grid units. Empty days are thin slabs; the busiest day is ~7.6 cells tall.
  var barHeight = function (count, max, scale) {
    return count > 0 && max > 0 ? 0.4 + Math.pow(count / max, 0.85) * 7.2 * scale : 0.2;
  };

  var WAVE = 0.42;
  var riseAt = function (t, week, weeks, day) {
    var d = (weeks > 1 ? week / (weeks - 1) : 0) * 0.36 + (day / 6) * 0.06;
    return easeOutCubic((t - d) / (1 - WAVE));
  };

  var YAW_3D = Math.PI / 4;
  var ELEV_3D = (34 * Math.PI) / 180;
  var YAW_RANGE = [(8 * Math.PI) / 180, (82 * Math.PI) / 180];
  var ELEV_RANGE = [(18 * Math.PI) / 180, (62 * Math.PI) / 180];

  // e=0 looks straight down; e=1 is the isometric corner. Orbit offsets scale with e.
  var camera = function (e, dYaw, dElev) {
    dYaw = dYaw || 0;
    dElev = dElev || 0;
    var yaw = Math.min(YAW_RANGE[1], Math.max(0, lerp(0, YAW_3D + dYaw, e)));
    var elev = lerp(Math.PI / 2, Math.min(ELEV_RANGE[1], Math.max(ELEV_RANGE[0], ELEV_3D + dElev)), e);
    return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
  };

  var project = function (c, x, y, z) {
    return [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce];
  };

  var mixRGB = function (a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  var luminance = function (c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };

  var PALETTES = {
    github: { light: ['#c6e48b', '#7bc96f', '#239a3b', '#196127'], dark: ['#0e4429', '#006d32', '#26a641', '#39d353'] }
  };
  var resolvePalette = function (p, dark) {
    var pick = Array.isArray(p) ? p : (p && typeof p === 'object') ? (dark ? p.dark : p.light) : (PALETTES[p] || PALETTES.github)[dark ? 'dark' : 'light'];
    var base = PALETTES.github[dark ? 'dark' : 'light'];
    return [0, 1, 2, 3].map(function (i) { return pick[i] || pick[pick.length - 1] || base[i]; });
  };

  var FG_FALLBACK = [23, 23, 23];
  var BG_FALLBACK = [255, 255, 255];

  // Any CSS colour → sRGB, by letting the browser paint it.
  var probe = null;
  var toRGB = function (color, fallback) {
    if (!probe) {
      var c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    if (!probe) return fallback;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = 'rgba(0,0,0,0)';
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    var d = probe.getImageData(0, 0, 1, 1).data;
    if (d[3] < 8) return fallback;
    return [d[0], d[1], d[2]];
  };

  var rgbString = function (r, g, b) {
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  };

  var pointInQuad = function (p, o, x, y) {
    var sign = 0;
    for (var k = 0; k < 4; k++) {
      var ax = p[o + k * 2], ay = p[o + k * 2 + 1];
      var bx = p[o + ((k + 1) % 4) * 2], by = p[o + ((k + 1) % 4) * 2 + 1];
      var cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (Math.abs(cross) < 1e-9) continue;
      var s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return sign !== 0;
  };

  var quadPath = function (ctx, p, o, r) {
    if (r < 0.3) {
      ctx.moveTo(p[o], p[o + 1]);
      ctx.lineTo(p[o + 2], p[o + 3]);
      ctx.lineTo(p[o + 4], p[o + 5]);
      ctx.lineTo(p[o + 6], p[o + 7]);
      ctx.closePath();
      return;
    }
    ctx.moveTo((p[o + 6] + p[o]) / 2, (p[o + 7] + p[o + 1]) / 2);
    for (var k = 0; k < 4; k++) {
      var b = (k + 1) % 4;
      ctx.arcTo(p[o + k * 2], p[o + k * 2 + 1], p[o + b * 2], p[o + b * 2 + 1], r);
    }
    ctx.closePath();
  };

  var GRID_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="9" y="9" width="5.5" height="5.5" rx="1" fill="currentColor"/></svg>';
  var CUBE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.2 14.2 4.6v6.8L8 14.8 1.8 11.4V4.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M1.8 4.6 8 8l6.2-3.4M8 8v6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ── Data ──
  var fetchContributions = function (username) {
    if (!username || !window.fetch) return Promise.reject(new Error('no source'));
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch('https://github-contributions-api.jogruber.de/v4/' + encodeURIComponent(username) + '?y=last', ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || !Array.isArray(j.contributions) || !j.contributions.length) throw new Error('empty');
        return j.contributions.map(function (d) { return { date: d.date, count: d.count }; });
      });
  };

  // ── Component ──
  function render(root, data, opts) {
    var locale = opts.locale || 'en-US';
    var unit = opts.unit || 'contribution';
    var plural = opts.unitPlural || unit + 's';
    var heightScale = opts.heightScale || 1;
    var duration = opts.duration || 1300;
    var orbit = opts.orbit !== false;
    var weekStart = opts.weekStart || 0;
    var palette = opts.palette || 'github';
    var view = opts.defaultView || '2d';

    // Never show days past today: the API's last row can be tomorrow in UTC.
    var end = dayMs(new Date());
    data = data.filter(function (d) { return dayMs(d.date) <= end; });
    var grid = buildGrid(data, end, weekStart);
    var model = {
      cells: grid.cells,
      weeks: grid.weeks,
      max: grid.max,
      stats: computeStats(grid.cells),
      months: monthLabels(grid.cells, grid.weeks, locale)
    };

    var nf = new Intl.NumberFormat(locale);
    var df = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    var dfy = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    var dfl = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    var noun = function (n) { return n === 1 ? unit : plural; };
    var range = function (a, b, withYear) {
      if (!a || !b) return '–';
      var f = withYear ? dfy : df;
      return f.format(dayMs(a)) + ' – ' + f.format(dayMs(b));
    };
    var describe = function (i) {
      var c = model.cells[i];
      if (!c) return '';
      return (c.count ? nf.format(c.count) + ' ' + noun(c.count) : 'No ' + plural) + ' on ' + dfl.format(dayMs(c.date));
    };

    var stats = model.stats;
    var statBlocks = [
      { label: '1 year total', value: nf.format(stats.total), unit: noun(stats.total), sub: range(stats.first, stats.last, true) },
      { label: 'Busiest day', value: nf.format(stats.busiest.count), unit: noun(stats.busiest.count), sub: stats.busiest.date ? df.format(dayMs(stats.busiest.date)) : '–' },
      { label: 'Longest streak', value: nf.format(stats.longest.days), unit: stats.longest.days === 1 ? 'day' : 'days', sub: range(stats.longest.start, stats.longest.end) },
      { label: 'Current streak', value: nf.format(stats.current.days), unit: stats.current.days === 1 ? 'day' : 'days', sub: range(stats.current.start, stats.current.end) }
    ];

    // ── DOM ──
    root.innerHTML = '';
    root.classList.add('sky');

    var head = el('header', 'sky-head');
    var title = el('h3', 'sky-title');
    title.innerHTML = '<span class="sky-title-num">' + nf.format(stats.total) + '</span> ' + noun(stats.total) +
      '<span class="sky-title-long"> in the last year</span><span class="sky-title-short"> this year</span>';
    head.appendChild(title);

    var toggle = el('div', 'sky-toggle');
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Chart view');
    var thumb = el('span', 'sky-toggle-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    toggle.appendChild(thumb);
    var buttons = {};
    ['2d', '3d'].forEach(function (v) {
      var b = el('button', 'sky-toggle-btn', v === '2d' ? GRID_ICON : CUBE_ICON);
      b.type = 'button';
      b.setAttribute('aria-label', v === '2d' ? 'Flat heat map' : '3D skyline');
      b.title = v === '2d' ? 'Flat heat map' : '3D skyline';
      b.addEventListener('click', function () { setView(v); });
      buttons[v] = b;
      toggle.appendChild(b);
    });
    head.appendChild(toggle);
    root.appendChild(head);

    var inner = el('div', 'sky-inner');
    var pad = el('div', 'sky-pad');
    var wrap = el('div', 'sky-wrap');
    var stage = el('div', 'sky-stage');
    var canvas = el('canvas', 'sky-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    stage.appendChild(canvas);

    var statEl = function (s, align) {
      var n = el('div', 'sky-stat sky-stat--' + align);
      var label = '<div class="sky-stat-label">' + s.label + '</div>';
      if (align === 'stack') {
        n.innerHTML = label +
          '<div class="sky-stat-main"><span class="sky-stat-val">' + s.value + '</span><span class="sky-stat-unit">' + s.unit + '</span></div>' +
          '<div class="sky-stat-sub">' + s.sub + '</div>';
      } else {
        n.innerHTML = (align === 'end' ? label + '<div></div>' : label) +
          '<div class="sky-stat-val">' + s.value + '</div>' +
          '<div class="sky-stat-side"><div class="sky-stat-unit">' + s.unit + '</div><div class="sky-stat-sub">' + s.sub + '</div></div>';
      }
      return n;
    };

    var cornerTR = el('div', 'sky-corner sky-corner--tr');
    var cornerBL = el('div', 'sky-corner sky-corner--bl');
    cornerTR.appendChild(statEl(statBlocks[0], 'end'));
    cornerTR.appendChild(statEl(statBlocks[1], 'end'));
    cornerBL.appendChild(statEl(statBlocks[2], 'start'));
    cornerBL.appendChild(statEl(statBlocks[3], 'start'));
    stage.appendChild(cornerTR);
    stage.appendChild(cornerBL);
    wrap.appendChild(stage);

    var tip = el('div', 'sky-tip');
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    wrap.appendChild(tip);
    pad.appendChild(wrap);
    inner.appendChild(pad);

    var row = el('div', 'sky-stats');
    statBlocks.forEach(function (s) { row.appendChild(statEl(s, 'stack')); });
    inner.appendChild(row);

    var foot = el('div', 'sky-foot');
    var hintEl = el('p', 'sky-hint');
    foot.appendChild(hintEl);
    var legend = el('div', 'sky-legend');
    legend.appendChild(el('span', 'sky-legend-word', 'Less'));
    var levelNames = ['No ' + plural, 'Light', 'Moderate', 'Heavy', 'Heaviest'];
    var swatches = [];
    for (var lvIdx = 0; lvIdx < 5; lvIdx++) {
      (function (k) {
        var sw = el('span', 'sky-swatch');
        sw.tabIndex = 0;
        sw.title = levelNames[k];
        sw.setAttribute('aria-label', levelNames[k] + ': highlight these days');
        var on = function () { legendLevel = k; kick(); };
        var off = function () { if (legendLevel === k) { legendLevel = -1; kick(); } };
        sw.addEventListener('pointerenter', on);
        sw.addEventListener('pointerleave', off);
        sw.addEventListener('focus', on);
        sw.addEventListener('blur', off);
        swatches.push(sw);
        legend.appendChild(sw);
      })(lvIdx);
    }
    legend.appendChild(el('span', 'sky-legend-word', 'More'));
    foot.appendChild(legend);
    inner.appendChild(foot);
    root.appendChild(inner);

    var live = el('div', 'sky-sr');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Engine state ──
    var reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced = reduceMq.matches;
    var t = view === '3d' ? 1 : 0;
    var target = t;
    var yaw = 0, elev = 0, yawGoal = 0, elevGoal = 0;
    var W = 0, H2 = 0, H3 = 0, Hmax = 0, lastH = -1, dpr = 1;
    var gutter = 30, labelW = 30, font = '10px sans-serif';
    var col = new Float32Array(15);
    var colGoal = new Float32Array(15);
    var fg = FG_FALLBACK, bg = BG_FALLBACK, isDark = true;
    var accent = '#39d353';
    var legendLevel = -1;
    var corners = false;

    var n = model.cells.length;
    var weeks = model.weeks;
    var wk = new Float32Array(n), dy = new Float32Array(n), lv = new Uint8Array(n);
    var hgt = new Float32Array(n), zs = new Float32Array(n);
    var hover = new Float32Array(n), dim = new Float32Array(n);
    var polys = new Float32Array(n * 24), faces = new Uint8Array(n);
    var order = [];
    for (var i0 = 0; i0 < n; i0++) {
      var c0 = model.cells[i0];
      order.push(i0);
      wk[i0] = c0.week;
      dy[i0] = c0.day;
      lv[i0] = c0.level;
      hgt[i0] = barHeight(c0.count, model.max, heightScale);
    }
    var months = model.months;
    var weekdayRows = [];
    var wf = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    for (var d0 = 0; d0 < 7 && d0 < n; d0++) {
      var dow = new Date(dayMs(model.cells[d0].date)).getUTCDay();
      if (dow === 1 || dow === 3 || dow === 5) weekdayRows.push({ day: d0, label: wf.format(dayMs(model.cells[d0].date)) });
    }

    var hovered = -1, pinned = -1, activeIdx = -1, tipW = 0, raf = 0, last = 0;

    var retheme = function () {
      var cs = getComputedStyle(root);
      fg = toRGB(cs.color, FG_FALLBACK) || FG_FALLBACK;
      var b = toRGB(cs.backgroundColor, null);
      bg = b || (luminance(fg) > 0.5 ? [10, 10, 10] : BG_FALLBACK);
      isDark = luminance(bg) < 0.45;
      font = '400 10px ' + (cs.fontFamily || 'sans-serif');
      var pal = resolvePalette(palette, isDark);
      var empty = mixRGB(bg, fg, isDark ? 0.11 : 0.075);
      var all = [empty].concat(pal.map(function (c) { return toRGB(c, FG_FALLBACK) || FG_FALLBACK; }));
      for (var k = 0; k < 5; k++) for (var ch = 0; ch < 3; ch++) colGoal[k * 3 + ch] = all[k][ch];
      col.set(colGoal);
      ctx.font = font;
      labelW = Math.ceil(Math.max.apply(null, [20].concat(weekdayRows.map(function (r) { return ctx.measureText(r.label).width; })))) + 8;
      var sw = all.map(function (c) { return rgbString(c[0], c[1], c[2]); });
      accent = sw[4];
      swatches.forEach(function (s, k) { s.style.background = sw[k]; });
      root.style.setProperty('--sky-accent', accent);
    };

    // Projected extent of the scene for camera e.
    var extent = function (cam, e, full) {
      var w = lerp(0.78, 0.9, e);
      var off = (1 - w) / 2;
      var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      var add = function (x, y, z) {
        var p = project(cam, x, y, z);
        if (p[0] < minx) minx = p[0];
        if (p[0] > maxx) maxx = p[0];
        if (p[1] < miny) miny = p[1];
        if (p[1] > maxy) maxy = p[1];
      };
      for (var i = 0; i < n; i++) {
        var x0 = wk[i] + off, y0 = dy[i] + off;
        var z = full ? hgt[i] * e : zs[i];
        add(x0, y0, z);
        add(x0 + w, y0, z);
        add(x0, y0 + w, z);
        add(x0 + w, y0 + w, 0);
        add(x0, y0 + w, 0);
        add(x0 + w, y0, 0);
      }
      // room for the month labels along the front edge in 3D
      add(0, 7 + 1.5 * e, 0);
      add(weeks, 7 + 1.5 * e, 0);
      return { minx: minx, maxx: maxx, miny: miny, maxy: maxy };
    };

    var relayout = function () {
      var w = Math.round(stage.clientWidth);
      if (!w || !n) return;
      W = w;
      // Narrow cards give the weekday column to the grid; rows get too tight to label.
      gutter = W < 520 ? 0 : labelW;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var b2 = extent(camera(0), 0, true);
      H2 = 20 + 4 + ((b2.maxy - b2.miny) / (b2.maxx - b2.minx)) * (W - gutter - 4);
      var b3 = extent(camera(1), 1, true);
      var natural = ((b3.maxy - b3.miny) / (b3.maxx - b3.minx)) * (W - 40) + 40;
      H3 = Math.max(Math.min(natural, W * 0.72, 620), Math.min(natural, 240));
      Hmax = Math.ceil(Math.max(H2, H3));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(Hmax * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = Hmax + 'px';
      lastH = -1;
      corners = W >= 560;
      var big = Math.round(Math.max(30, Math.min(56, W * 0.058))) + 'px';
      [cornerTR, cornerBL].forEach(function (c) { c.style.setProperty('--sky-big', big); });
      applyView();
      draw();
    };

    var draw = function () {
      if (!W || !n) return;
      var e = easeInOutCubic(t);
      var cam = camera(e, yaw, elev);
      var Hc = lerp(H2, H3, e);
      if (Math.abs(Hc - lastH) > 0.2) {
        stage.style.height = Hc.toFixed(1) + 'px';
        lastH = Hc;
      }
      for (var i = 0; i < n; i++) zs[i] = riseAt(t, wk[i], weeks, dy[i]) * hgt[i];
      var b = extent(cam, e, false);
      var padPx = lerp(2, 20, e);
      var left = padPx + gutter * (1 - e);
      var top = padPx + 20 * (1 - e);
      var aw = W - left - padPx;
      var ah = Hc - top - padPx;
      var bw = Math.max(1e-6, b.maxx - b.minx);
      var bh = Math.max(1e-6, b.maxy - b.miny);
      var s = Math.min(aw / bw, ah / bh);
      var ox = left + (aw - bw * s) / 2 - b.minx * s;
      var oy = top + (ah - bh * s) / 2 - b.miny * s;
      var cs = cam.cs, sn = cam.sn, se = cam.se, ce = cam.ce;
      var px = function (x, y) { return ox + (x * cs - y * sn) * s; };
      var py = function (x, y, z) { return oy + ((x * sn + y * cs) * se - z * ce) * s; };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hmax);

      order.sort(function (a, c) {
        return (wk[a] + 0.5) * sn + (dy[a] + 0.5) * cs - ((wk[c] + 0.5) * sn + (dy[c] + 0.5) * cs);
      });

      var w = lerp(0.78, 0.9, e);
      var off = (1 - w) / 2;
      var radius = lerp(0.17, 0.03, e) * s;
      var outline = (1 - e) * 0.07;
      var lift = 0.7 * e;
      var ex = col[0], ey = col[1], ez = col[2];

      for (var k = 0; k < n; k++) {
        var ix = order[k];
        var x0 = wk[ix] + off, y0 = dy[ix] + off, x1 = x0 + w, y1 = y0 + w;
        var z = zs[ix] + hover[ix] * lift;
        var o = ix * 24;
        // top
        polys[o] = px(x0, y0); polys[o + 1] = py(x0, y0, z);
        polys[o + 2] = px(x1, y0); polys[o + 3] = py(x1, y0, z);
        polys[o + 4] = px(x1, y1); polys[o + 5] = py(x1, y1, z);
        polys[o + 6] = px(x0, y1); polys[o + 7] = py(x0, y1, z);
        // +y face (left on screen)
        polys[o + 8] = px(x0, y1); polys[o + 9] = py(x0, y1, 0);
        polys[o + 10] = px(x1, y1); polys[o + 11] = py(x1, y1, 0);
        polys[o + 12] = polys[o + 4]; polys[o + 13] = polys[o + 5];
        polys[o + 14] = polys[o + 6]; polys[o + 15] = polys[o + 7];
        // +x face (right on screen)
        polys[o + 16] = px(x1, y0); polys[o + 17] = py(x1, y0, 0);
        polys[o + 18] = polys[o + 10]; polys[o + 19] = polys[o + 11];
        polys[o + 20] = polys[o + 4]; polys[o + 21] = polys[o + 5];
        polys[o + 22] = polys[o + 2]; polys[o + 23] = polys[o + 3];

        var tall = z * ce * s;
        var f = 0;
        if (tall > 0.35 && w * cs * s > 0.35) f |= 1;
        if (tall > 0.35 && w * sn * s > 0.35) f |= 2;
        faces[ix] = f;

        var L = lv[ix] * 3;
        var r = col[L], g = col[L + 1], bl = col[L + 2];
        var dd = dim[ix];
        if (dd > 0.002) {
          r += (ex - r) * 0.72 * dd;
          g += (ey - g) * 0.72 * dd;
          bl += (ez - bl) * 0.72 * dd;
        }
        var hv = hover[ix];
        if (hv > 0.002) {
          var m = 0.16 * hv;
          r += (fg[0] - r) * m;
          g += (fg[1] - g) * m;
          bl += (fg[2] - bl) * m;
        }
        if (f & 1) {
          ctx.beginPath();
          quadPath(ctx, polys, o + 8, 0);
          ctx.fillStyle = rgbString(r * 0.84, g * 0.84, bl * 0.84);
          ctx.fill();
        }
        if (f & 2) {
          ctx.beginPath();
          quadPath(ctx, polys, o + 16, 0);
          ctx.fillStyle = rgbString(r * 0.68, g * 0.68, bl * 0.68);
          ctx.fill();
        }
        ctx.beginPath();
        quadPath(ctx, polys, o, radius);
        ctx.fillStyle = rgbString(r, g, bl);
        ctx.fill();
        if (outline > 0.004) {
          ctx.strokeStyle = 'rgba(' + fg[0] + ',' + fg[1] + ',' + fg[2] + ',' + outline.toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (hv > 0.02) {
          ctx.strokeStyle = 'rgba(' + fg[0] + ',' + fg[1] + ',' + fg[2] + ',' + (0.85 * hv).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Labels: top and left in 2D, along the front edge in 3D. They fade, never pop.
      var muted = mixRGB(bg, fg, 0.55);
      var mutedRGB = Math.round(muted[0]) + ',' + Math.round(muted[1]) + ',' + Math.round(muted[2]);
      ctx.font = font;
      var a2 = 1 - smoothstep(0, 0.4, e);
      var a3 = smoothstep(0.62, 1, e);
      var edge, mi, mm, x, tw;
      if (a2 > 0.004) {
        ctx.fillStyle = 'rgba(' + mutedRGB + ',' + a2.toFixed(3) + ')';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        edge = -Infinity;
        for (mi = 0; mi < months.length; mi++) {
          mm = months[mi];
          x = px(mm.week + off, -0.3);
          tw = ctx.measureText(mm.label).width;
          if (x < edge || x + tw > W) continue;
          ctx.fillText(mm.label, x, py(mm.week + off, -0.3, 0) - 3);
          edge = x + tw + 6;
        }
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (gutter > 0) weekdayRows.forEach(function (r) { ctx.fillText(r.label, px(0, r.day + 0.5) - 6, py(0, r.day + 0.5, 0)); });
      }
      if (a3 > 0.004) {
        ctx.fillStyle = 'rgba(' + mutedRGB + ',' + a3.toFixed(3) + ')';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        edge = -Infinity;
        for (mi = 0; mi < months.length; mi++) {
          mm = months[mi];
          x = px(mm.week + 0.5, 7.3);
          tw = ctx.measureText(mm.label).width;
          if (x < edge || x + tw > W) continue;
          ctx.fillText(mm.label, x, py(mm.week + 0.5, 7.3, 0) + 2);
          edge = x + tw + 10;
        }
      }

      // Tooltip rides the active cell through morphs and orbits.
      if (activeIdx >= 0 && activeIdx < n) {
        var ai = activeIdx;
        var az = zs[ai] + hover[ai] * lift;
        var tx = px(wk[ai] + 0.5, dy[ai] + 0.5);
        var ty = Math.min(py(wk[ai] + off, dy[ai] + off, az), py(wk[ai] + off + w, dy[ai] + off, az), py(wk[ai] + off, dy[ai] + off + w, az));
        var half = tipW / 2;
        var cx = Math.min(W - half - 2, Math.max(half + 2, tx));
        tip.style.transform = 'translate(' + (cx - half).toFixed(1) + 'px,' + (ty - 8).toFixed(1) + 'px) translateY(-100%)';
        tip.style.setProperty('--arrow', (tx - cx + half).toFixed(1) + 'px');
      }
    };

    var tick = function (now) {
      raf = 0;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      var moving = false;

      if (t !== target) {
        var step = reduced ? 1 : (dt * 1000) / Math.max(1, duration);
        t = target > t ? Math.min(target, t + step) : Math.max(target, t - step);
        moving = true;
      }

      var ko = reduced ? 1 : 1 - Math.exp(-dt * 12);
      yaw += (yawGoal - yaw) * ko;
      elev += (elevGoal - elev) * ko;
      if (Math.abs(yawGoal - yaw) > 1e-4 || Math.abs(elevGoal - elev) > 1e-4) moving = true;
      else { yaw = yawGoal; elev = elevGoal; }

      var kh = reduced ? 1 : 1 - Math.exp(-dt * 16);
      var kd = reduced ? 1 : 1 - Math.exp(-dt * 10);
      for (var i = 0; i < n; i++) {
        var hg = i === activeIdx ? 1 : 0;
        var dg = legendLevel >= 0 && lv[i] !== legendLevel ? 1 : 0;
        var h = hover[i], d = dim[i];
        if (h !== hg) {
          hover[i] = Math.abs(hg - h) < 0.003 ? hg : h + (hg - h) * kh;
          moving = true;
        }
        if (d !== dg) {
          dim[i] = Math.abs(dg - d) < 0.003 ? dg : d + (dg - d) * kd;
          moving = true;
        }
      }

      draw();
      if (moving) raf = requestAnimationFrame(tick);
    };

    var kick = function () {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    // The active day is the hovered one, else the pinned one (tap, click or keyboard).
    var refreshActive = function () {
      var next = hovered >= 0 ? hovered : pinned;
      if (next === activeIdx) return;
      activeIdx = next;
      if (next >= 0) {
        var c = model.cells[next];
        tip.innerHTML = '<strong>' + (c.count ? nf.format(c.count) + ' ' + noun(c.count) : 'No ' + plural) + '</strong> on ' + df.format(dayMs(c.date));
        tip.classList.add('is-on');
        tip.setAttribute('aria-hidden', 'false');
        tipW = tip.offsetWidth;
      } else {
        tip.classList.remove('is-on');
        tip.setAttribute('aria-hidden', 'true');
      }
      kick();
    };

    var hit = function (x, y) {
      for (var k = n - 1; k >= 0; k--) {
        var i = order[k];
        var o = i * 24;
        if (pointInQuad(polys, o, x, y)) return i;
        if (faces[i] & 1 && pointInQuad(polys, o + 8, x, y)) return i;
        if (faces[i] & 2 && pointInQuad(polys, o + 16, x, y)) return i;
      }
      return -1;
    };

    var local = function (ev) {
      var r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };

    var drag = null;
    var grabCursor = function () { return orbit && target === 1 ? 'grab' : 'default'; };

    canvas.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var can = orbit && target === 1;
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: yawGoal, elev: elevGoal, moved: false, orbit: can, mouse: ev.pointerType === 'mouse' };
      if (can) { try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* nicety */ } }
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (drag && drag.orbit && ev.pointerId === drag.id) {
        var dx = ev.clientX - drag.x;
        var dyy = ev.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dyy) > 4) {
          drag.moved = true;
          yawGoal = Math.min(YAW_RANGE[1] - YAW_3D, Math.max(YAW_RANGE[0] - YAW_3D, drag.yaw + dx * 0.006));
          if (drag.mouse) elevGoal = Math.min(ELEV_RANGE[1] - ELEV_3D, Math.max(ELEV_RANGE[0] - ELEV_3D, drag.elev + dyy * 0.004));
          canvas.style.cursor = 'grabbing';
          hovered = -1;
          refreshActive();
          kick();
          return;
        }
      }
      if (ev.pointerType !== 'mouse') return;
      var p = local(ev);
      var i = hit(p[0], p[1]);
      if (i !== hovered) {
        hovered = i;
        refreshActive();
      }
      canvas.style.cursor = orbit && target === 1 ? 'grab' : i >= 0 ? 'pointer' : 'default';
    });

    canvas.addEventListener('pointerup', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var wasMoved = drag.moved;
      drag = null;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      canvas.style.cursor = grabCursor();
      if (wasMoved) return;
      var p = local(ev);
      var i = hit(p[0], p[1]);
      pinned = i === pinned ? -1 : i;
      if (ev.pointerType !== 'mouse') hovered = -1;
      refreshActive();
    });

    canvas.addEventListener('pointercancel', function () { drag = null; });
    canvas.addEventListener('pointerleave', function () {
      if (drag) return;
      hovered = -1;
      refreshActive();
    });
    canvas.addEventListener('dblclick', function () {
      yawGoal = 0;
      elevGoal = 0;
      kick();
    });

    canvas.addEventListener('keydown', function (ev) {
      var keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'];
      if (keys.indexOf(ev.key) < 0 || !n) return;
      ev.preventDefault();
      if (ev.key === 'Escape') {
        pinned = -1;
        hovered = -1;
        refreshActive();
        return;
      }
      var i = pinned >= 0 ? pinned : activeIdx >= 0 ? activeIdx : n - 1;
      if (pinned >= 0 || activeIdx >= 0) {
        if (ev.key === 'ArrowLeft') i -= 7;
        if (ev.key === 'ArrowRight') i += 7;
        if (ev.key === 'ArrowUp') i -= 1;
        if (ev.key === 'ArrowDown') i += 1;
        if (ev.key === 'Home') i = 0;
        if (ev.key === 'End') i = n - 1;
      }
      i = Math.max(0, Math.min(n - 1, i));
      pinned = i;
      hovered = -1;
      refreshActive();
      live.textContent = describe(i);
    });

    canvas.addEventListener('blur', function () {
      pinned = -1;
      refreshActive();
    });

    // ── View: toggle, corner stats, stat row, hint ──
    function applyView() {
      var is3d = view === '3d';
      buttons['2d'].setAttribute('aria-pressed', String(!is3d));
      buttons['3d'].setAttribute('aria-pressed', String(is3d));
      toggle.classList.toggle('is-3d', is3d);
      var showCorners = corners && is3d;
      [cornerTR, cornerBL].forEach(function (c, k) {
        c.hidden = !corners;
        // Corner stats settle in late in the rise, and leave at once.
        c.style.transitionDelay = showCorners ? Math.round(duration * (k ? 0.65 : 0.55)) + 'ms' : '0ms';
        c.classList.toggle('is-on', showCorners);
        c.setAttribute('aria-hidden', String(!showCorners));
      });
      row.hidden = showCorners;
      hintEl.textContent = is3d && orbit ? 'Drag to orbit · double-click to reset' : 'Hover a day for details · arrow keys to explore';
      canvas.style.touchAction = is3d && orbit ? 'pan-y' : 'auto';
      canvas.style.cursor = grabCursor();
      canvas.setAttribute('aria-label',
        nf.format(stats.total) + ' ' + noun(stats.total) + ' between ' + range(stats.first, stats.last, true) +
        ', shown as a ' + (is3d ? '3D skyline' : 'heat map') + '. Use the arrow keys to read individual days.');
    }

    function setView(v) {
      if (v === view) return;
      view = v;
      target = v === '3d' ? 1 : 0;
      if (target === 0) { yawGoal = 0; elevGoal = 0; }
      applyView();
      kick();
    }

    retheme();
    relayout();

    var ro = new ResizeObserver(function () {
      if (Math.round(stage.clientWidth) !== W) relayout();
    });
    ro.observe(stage);
    reduceMq.addEventListener('change', function () { reduced = reduceMq.matches; kick(); });

    return { setView: setView };
  }

  window.ContributionSkyline = {
    mount: function (root, opts) {
      opts = opts || {};
      root.classList.add('sky', 'is-loading');
      return fetchContributions(opts.username)
        .catch(function () { return generateContributions(dayMs(new Date()), opts.seed == null ? 7 : opts.seed); })
        .then(function (data) {
          root.classList.remove('is-loading');
          return render(root, data, opts);
        });
    }
  };
})();
