// Online demo (GitHub Pages): the page alone, without a server, with fake sessions. Its resources come from
// public sources that allow loading from another site: textures and font on GitHub, skins via
// minotar.net, three.js via jsDelivr. No Mojang file is copied here.
// Usage: node scripts/build-pages.mjs [output folder, _site by default]
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_URL, TEXTURES_BASE, UI_FONT_URL } from './fetch-assets.mjs';

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
let html = (await fs.readFile(indexFile, 'utf8'))
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">${JSON.stringify(importMap)}</script>`)
  .replace('<script type="module"', `<script>window.MINETOKENCRAFT_SITE = ${JSON.stringify(site)};</script>\n  <script type="module"`);
// GitHub Pages sends no headers of ours: the Content Security Policy goes in the page, with the hosts the demo uses.
const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(([, code]) => `'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`);
const policy = [
  "default-src 'none'",
  `script-src 'self' https://cdn.jsdelivr.net ${hashes.join(' ')}`,
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob: https://raw.githubusercontent.com https://minotar.net",
  "font-src https://raw.githubusercontent.com https://cdn.jsdelivr.net",
  "connect-src 'self' https://raw.githubusercontent.com https://minotar.net",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
await fs.writeFile(indexFile, html);

const styleFile = path.join(out, 'style.css');
await fs.writeFile(styleFile, (await fs.readFile(styleFile, 'utf8')).replace("url('assets/fonts/Minecraft.otf')", `url('${FONT_URL}')`));
const dashboardFile = path.join(out, 'dashboard.css');
await fs.writeFile(dashboardFile, (await fs.readFile(dashboardFile, 'utf8')).replace("url('assets/fonts/Montserrat.woff2')", `url('${UI_FONT_URL}')`));

const skins = JSON.parse(await fs.readFile(path.join(root, 'scripts', 'demo-skins.json'), 'utf8'));
await fs.writeFile(path.join(out, 'skins.json'), JSON.stringify(skins.map((skin) => ({ ...skin, url: SKIN_URL(skin.name) }))));
// GitHub Pages must not run the page through Jekyll.
await fs.writeFile(path.join(out, '.nojekyll'), '');
console.log(`Online demo ready in ${path.relative(root, out)}/ (three.js ${three})`);
