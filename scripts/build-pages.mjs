// Démo en ligne (GitHub Pages) : la page seule, sans serveur, avec des sessions factices. Ses ressources viennent de
// sources publiques qui autorisent leur chargement depuis un autre site : textures et police sur GitHub, skins via
// minotar.net, three.js via jsDelivr. Aucun fichier de Mojang n'est copié ici.
// Usage : node scripts/build-pages.mjs [dossier de sortie, _site par défaut]
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
// GitHub Pages ne doit pas passer la page dans Jekyll.
await fs.writeFile(path.join(out, '.nojekyll'), '');
console.log(`Démo en ligne prête dans ${path.relative(root, out)}/ (three.js ${three})`);
