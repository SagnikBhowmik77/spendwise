// Runs before React: picks light or dark from the saved choice (or the system setting).
(function () {
  try {
    var saved = localStorage.getItem('spendwise.theme') || 'system';
    var dark = saved === 'dark' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    // Text size and high contrast (Settings → Display).
    var size = localStorage.getItem('spendwise.textSize');
    if (size === 'large' || size === 'larger') document.documentElement.classList.add('text-' + size);
    if (localStorage.getItem('spendwise.contrast') === 'high') document.documentElement.classList.add('contrast-high');
  } catch (e) {
    /* storage blocked: stay light */
  }
})();
