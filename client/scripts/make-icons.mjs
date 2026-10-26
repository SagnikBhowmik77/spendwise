// Builds the PNG app icons from public/icon.svg (run: npm run icons). Output: public/icons/.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const svg = await readFile(pub('icon.svg'));

// Maskable icons get cropped to a circle or squircle by the phone, so the artwork must sit inside the
// central 80%: a full-bleed background with the same glyph scaled down around the centre.
const maskable = Buffer.from(svg.toString()
  .replace('<rect width="512" height="512" rx="112" fill="#4f46e5"/>', '<rect width="512" height="512" fill="#4f46e5"/><g transform="translate(76.8 76.8) scale(0.7)">')
  .replace('</svg>', '</g></svg>'));

await mkdir(pub('icons'), { recursive: true });
await Promise.all([
  sharp(svg).resize(192, 192).png().toFile(pub('icons/icon-192.png')),
  sharp(svg).resize(512, 512).png().toFile(pub('icons/icon-512.png')),
  sharp(maskable).resize(512, 512).png().toFile(pub('icons/icon-maskable-512.png')),
]);
console.log('Icons written to public/icons/');
