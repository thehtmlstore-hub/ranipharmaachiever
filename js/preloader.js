/* Preloader — hide once everything has loaded (kept up briefly so
   it doesn't just flash), with a failsafe so a slow image or font
   never blocks the page. */
(function() {
  var loader = document.getElementById('preloader');
  if (!loader) return;
  var done = false;
  function hide() {
    if (done) return;
    done = true;
    loader.classList.add('is-hidden');
    window.__rpaReady = true;
    window.dispatchEvent(new Event('rpa:ready'));
    setTimeout(function() { loader.remove(); }, 600);
  }
  window.addEventListener('load', function() {
    setTimeout(hide, Math.max(0, 800 - performance.now()));
  });
  setTimeout(hide, 8000);
})();
