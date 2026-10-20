// Online demo (GitHub Pages): the page alone, without a server, with fake sessions. Its resources come from
// public sources that allow loading from another site: textures and font on GitHub, skins via
// minotar.net, three.js via jsDelivr. No Mojang file is copied here.
// Usage: node scripts/build-pages.mjs [output folder, _site by default]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_URL, TEXTURES_BASE } from './fetch-assets.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] ?? '_site');
const SKIN_URL = (name) => `https://minotar.net/skin/${encodeURIComponent(name)}`;

const three = JSON.parse(await fs.readFile(path.join(root, 'node_modules', 'three', 'package.json'), 'utf8')).version;
const cdn = `https://cdn.jsdelivr.net/npm/three@${three}`;

await fs.rm(out, { recursive: true, force: true });
await fs.cp(path.join(root, 'public'), out, { recursive: true });

const site = { standalone: true, textures: TEXTURES_BASE, skinsIndex: 'skins.json' };
const importMap = { imports: { three: `${cdn}/build/three.module.js`, 'three/addons/': `${cdn}/examples/jsm/` } };
const indexFile = path.join(out, 'index.html');
const html = (await fs.readFile(indexFile, 'utf8'))
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">${JSON.stringify(importMap)}</script>`)
  .replace('<script type="module"', `<script>window.MINETOKENCRAFT_SITE = ${JSON.stringify(site)};</script>\n  <script type="module"`);
await fs.writeFile(indexFile, html);

const styleFile = path.join(out, 'style.css');
await fs.writeFile(styleFile, (await fs.readFile(styleFile, 'utf8')).replace("url('assets/fonts/Minecraft.otf')", `url('${FONT_URL}')`));

const skins = JSON.parse(await fs.readFile(path.join(root, 'scripts', 'demo-skins.json'), 'utf8'));
await fs.writeFile(path.join(out, 'skins.json'), JSON.stringify(skins.map((skin) => ({ ...skin, url: SKIN_URL(skin.name) }))));
// GitHub Pages must not run the page through Jekyll.
await fs.writeFile(path.join(out, '.nojekyll'), '');
console.log(`Online demo ready in ${path.relative(root, out)}/ (three.js ${three})`);
