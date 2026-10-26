// UPI "pay" links (the NPCI deep-link format every UPI app understands): on a phone they open
// GPay, PhonePe, Paytm or BHIM with the payee and amount filled in. Desktops can't open them,
// so the page shows the UPI ID and amount to copy instead.

// Values are percent-encoded, except the "@" in the UPI ID, which some apps expect as is.
const enc = (v) => encodeURIComponent(v).replace(/%40/g, '@');

export function upiLink({ upiId, name, amountPaise, note }) {
  const parts = [['pa', upiId], ['pn', name], ['am', (amountPaise / 100).toFixed(2)], ['cu', 'INR']];
  if (note) parts.push(['tn', note.slice(0, 50)]);
  return `upi://pay?${parts.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

export const canOpenUpi = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
