// Resize the existing Chiro identity; no redraw, crop or distortion. Sharp ships with Astro.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
const source = new URL('../public/assets/Chirologo_700px.png', import.meta.url);
const target = new URL('../public/assets/app/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const size of [180,192,512]) await sharp(source.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  .resize(size,size,{fit:'contain'}).flatten({background:'#ffffff'}).png()
  .toFile(new URL(size===180?'apple-touch-icon.png':`icon-${size}.png`,target).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const logo = await sharp(source.pathname.replace(/^\/([A-Za-z]:)/, '$1')).resize(280,280).png().toBuffer();
await sharp({create:{width:512,height:512,channels:4,background:'#ffffff'}})
  .composite([{input:logo,left:116,top:116}]).png().toFile(new URL('icon-maskable-512.png',target).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
