document.addEventListener('DOMContentLoaded', function () {
  var btn  = document.querySelector('.nav-hamburger');
  var menu = document.querySelector('.nav-mobile-menu');
  if (!btn || !menu) return;

  var triggers = menu.querySelectorAll('.mob-accordion-trigger');
  var panels   = menu.querySelectorAll('.mob-accordion-panel');

  function closeAllAccordions() {
    triggers.forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
    panels.forEach(function (p) { p.classList.remove('open'); });
  }

  function close() {
    menu.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    closeAllAccordions();
  }

  triggers.forEach(function (trigger) {
    var panelId = trigger.getAttribute('aria-controls');
    var panel   = panelId ? menu.querySelector('#' + panelId) : null;
    if (!panel) return;
    trigger.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open);
    });
  });

  btn.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
    menu.setAttribute('aria-hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav') && menu.classList.contains('open')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.classList.contains('open')) close();
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 1024 && menu.classList.contains('open')) close();
  });

  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (menu.classList.contains('open')) close();
    });
  });
});

// ── In-page anchor smooth scroll ──
// scroll-behavior:smooth on <html> used to drive this, but applying it globally
// also smooths native wheel/trackpad scrolling, which can glitch and jump when
// the user reverses direction quickly (e.g. scrolling up right after a refresh
// restores a mid-page position). Scoping smoothing to anchor clicks only avoids
// that, and accounts for the fixed nav covering the target's top edge.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    a.addEventListener('click', function (e) {
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      var navHeight = (document.querySelector('.nav') || {}).offsetHeight || 0;
      var top = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });
});
