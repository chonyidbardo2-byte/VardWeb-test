// Floating nav: adds .is-scrolled to .nav once the page scrolls past 10px,
// which turns the transparent top bar into the blurred floating bar.
// Also keeps the desktop dropdowns hover-only for the mouse, so a clicked
// trigger can't hold its menu open (via :focus-within) while another opens.
(function () {
  var THRESHOLD = 10;
  var nav = null, ticking = false;
  var keyboardMode = false;

  function update() {
    ticking = false;
    if (nav) nav.classList.toggle('is-scrolled', (window.scrollY || window.pageYOffset) > THRESHOLD);
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  function initDropdowns() {
    document.addEventListener('keydown', function () { keyboardMode = true; }, true);
    document.addEventListener('pointerdown', function () { keyboardMode = false; }, true);

    nav.querySelectorAll('.nav-links .nav-dropdown').forEach(function (dd) {
      var trigger = dd.querySelector('.nav-dropdown-trigger');
      if (!trigger) return;

      // Mouse clicks on a <button> trigger shouldn't focus it; hover already opens the menu
      if (trigger.tagName === 'BUTTON') {
        trigger.addEventListener('mousedown', function (e) { e.preventDefault(); });
      }

      // Leaving with the mouse drops any focus left inside, so the menu closes
      dd.addEventListener('mouseleave', function () {
        if (!keyboardMode && dd.contains(document.activeElement)) document.activeElement.blur();
        if (!dd.matches(':focus-within')) trigger.setAttribute('aria-expanded', 'false');
      });

      // aria-expanded sync (WCAG 4.1.2)
      dd.addEventListener('mouseenter', function () { trigger.setAttribute('aria-expanded', 'true'); });
      dd.addEventListener('focusin', function () { trigger.setAttribute('aria-expanded', 'true'); });
      dd.addEventListener('focusout', function (e) {
        if (!dd.contains(e.relatedTarget)) trigger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function init() {
    nav = document.querySelector('.nav');
    if (!nav) return;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', update);
    initDropdowns();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
