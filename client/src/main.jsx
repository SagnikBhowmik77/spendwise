// Entry point. Hindi is most of the app's text by size, so it is downloaded only when it is the chosen language,
// and before the app's modules load: labels written at module level (navigation, status names) are translated
// as those modules run, so the dictionary has to be there first.
import { loadLanguage } from './lib/i18n.js';

loadLanguage()
  .catch(() => { /* offline on first visit in Hindi: the app opens in English rather than not at all */ })
  .then(() => import('./boot.jsx'));
