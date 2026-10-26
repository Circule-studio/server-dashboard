// Thème clair / sombre. Chargé dans <head> pour appliquer le choix avant
// l'affichage (pas de flash). Sans choix enregistré, le CSS suit le système.
function savedTheme() {
  try {
    const theme = localStorage.getItem('sd-theme');
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch { return null; /* stockage indisponible */ }
}

function currentTheme() {
  return savedTheme() || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function setTheme(theme) {
  try { localStorage.setItem('sd-theme', theme); } catch { /* stockage indisponible */ }
  document.documentElement.dataset.theme = theme;
}

if (savedTheme()) document.documentElement.dataset.theme = savedTheme();
