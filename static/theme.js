// Sets the theme before first paint, so the legal pages match the dashboard.
// Mirrors the inline script in apps/web/index.html; keep the storage key and
// theme ids in sync with it.
(function () {
  var themes = ['light', 'dark'];
  var theme;
  try {
    theme = localStorage.getItem('app.theme');
  } catch {
    // Storage is blocked (private mode, site data off): follow the OS setting.
  }
  if (themes.indexOf(theme) < 0) {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
