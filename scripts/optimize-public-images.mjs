import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

// Derivatives of existing local photographs only; originals and CMS URLs stay intact.
const files = ['banner', 'kampfoto', 'ribbels', 'speelclub', 'rakwi', 'tito-cover', 'keti-cover', 'aspi'];
await mkdir('public/assets/optimized', { recursive: true });
const manifest = {};
for (const name of files) {
  const source = `public/assets/${name}.jpg`;
  const { width, height } = await sharp(source).metadata();
  const variants = [];
  for (const requested of [480, 960, 1600]) {
    if (requested > width) continue;
    const path = `/assets/optimized/${name}-${requested}.webp`;
    await sharp(source).resize({ width: requested, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`public${path}`);
    variants.push(`${path} ${requested}w`);
  }
  manifest[`/assets/${name}.jpg`] = { width, height, srcset: variants.join(', ') };
}
await writeFile('src/data/public-image-variants.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Optimized ${files.length} existing photographs; regenerate after replacing originals.`);
