// ── Shared runtime-performance helpers ──
// Used sitewide to pause/resume expensive loops (WebGL/canvas RAF chains,
// setInterval-driven widgets) based on viewport visibility + tab visibility,
// and to let multiple scroll-reveal call sites share one IntersectionObserver
// instead of each constructing their own. Purely behavioral; never changes
// what anything renders, only when it's allowed to run.
window.PerfUtils = (function () {

  // gatedLoop(el, { start, stop, threshold }):
  // Calls start() when `el` is intersecting the viewport AND the tab is
  // visible; calls stop() the instant either condition becomes false.
  // Safe against double-start/double-stop; start/stop are only invoked on
  // actual state transitions.
  function gatedLoop(el, opts) {
    opts = opts || {};
    var start = opts.start || function () {};
    var stop = opts.stop || function () {};
    var threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.01;

    var running = false;
    var intersecting = false;

    function apply() {
      var shouldRun = intersecting && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        start();
      } else if (!shouldRun && running) {
        running = false;
        stop();
      }
    }

    var io = new IntersectionObserver(function (entries) {
      intersecting = entries[entries.length - 1].isIntersecting;
      apply();
    }, { threshold: threshold });
    io.observe(el);

    document.addEventListener('visibilitychange', apply);

    return {
      isRunning: function () { return running; },
      disconnect: function () {
        io.disconnect();
        document.removeEventListener('visibilitychange', apply);
        if (running) { running = false; stop(); }
      }
    };
  }

  // sharedObserver(threshold):
  // One IntersectionObserver reused across many .watch() calls instead of
  // each call site constructing its own. watch(el, callback, { once }):
  // callback receives the IntersectionObserverEntry; when once is true
  // (default) the element is auto-unobserved right before the callback runs,
  // matching the existing one-shot scroll-reveal pattern used across the site.
  // Desktop keeps the requested threshold. On phones and touch screens a
  // ratio threshold can never be met by a container taller than
  // viewport / threshold (a long pricing grid on a 568px screen), so reveal
  // thresholds of 0.1 and up switch to "10% into the screen" instead, which
  // always fires and still starts the motion inside the viewport.
  // Thresholds under 0.1 (hero entrances, loops) are left exactly as asked.
  var isMobile = false;
  try { isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches; } catch (e) {}

  function sharedObserver(threshold) {
    var t = typeof threshold === 'number' ? threshold : 0.15;
    var ioOpts = (isMobile && t >= 0.1)
      ? { threshold: 0, rootMargin: '0px 0px -10% 0px' }
      : { threshold: t };
    var callbacks = new WeakMap();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var entry_cb = callbacks.get(entry.target);
        if (!entry_cb) return;
        if (!entry.isIntersecting) return;
        if (entry_cb.once !== false) {
          io.unobserve(entry.target);
          callbacks.delete(entry.target);
        }
        entry_cb.fn(entry);
      });
    }, ioOpts);

    return {
      watch: function (el, fn, opts) {
        callbacks.set(el, { fn: fn, once: opts ? opts.once : true });
        io.observe(el);
      },
      unwatch: function (el) {
        io.unobserve(el);
        callbacks.delete(el);
      }
    };
  }

  return { gatedLoop: gatedLoop, sharedObserver: sharedObserver };
})();
