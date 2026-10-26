// Display preferences kept on this device: privacy mode and how big numbers are written.
const read = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
};

// 'indian' -> ₹1,23,456 and ₹1.2L / ₹3Cr; 'international' -> ₹123,456 and ₹1.2M.
export const numberStyle = () => read('spendwise.numbers', 'indian');
export function setNumberStyle(style) {
  write('spendwise.numbers', style);
  // Every amount on screen uses the new style once the page reloads.
  window.location.reload();
}

export const privacyOn = () => read('spendwise.privacy', 'off') === 'on';
export function applyPrivacy(on) {
  document.documentElement.classList.toggle('privacy', on);
}
export function setPrivacy(on) {
  write('spendwise.privacy', on ? 'on' : 'off');
  applyPrivacy(on);
  window.dispatchEvent(new CustomEvent('spendwise:privacy', { detail: on }));
}

// Batch 12S: reading comfort on this device. Text size scales the whole app (everything is sized in rem);
// high contrast darkens grey text and borders (lightens them in dark mode). public/theme-init.js applies both
// before React loads, so the page never jumps.
export const TEXT_SIZES = ['normal', 'large', 'larger'];
export const textSize = () => { const v = read('spendwise.textSize', 'normal'); return TEXT_SIZES.includes(v) ? v : 'normal'; };
export const highContrast = () => read('spendwise.contrast', 'normal') === 'high';
export function applyDisplay(size = textSize(), contrast = highContrast()) {
  const root = document.documentElement.classList;
  root.toggle('text-large', size === 'large');
  root.toggle('text-larger', size === 'larger');
  root.toggle('contrast-high', contrast);
}
export function setTextSize(size) { write('spendwise.textSize', size); applyDisplay(size, highContrast()); }
export function setHighContrast(on) { write('spendwise.contrast', on ? 'high' : 'normal'); applyDisplay(textSize(), on); }
