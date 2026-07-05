// Write the gallery to dist/gallery.html.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGallery } from './gallery';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'gallery.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderGallery());
console.log(`[gallery] wrote ${out}`);
