// Vérification rapide, aussi lancée par l'intégration continue : syntaxe de tous les fichiers JavaScript, chargement
// des modules du serveur, et quelques règles qui ne doivent jamais casser.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDERS = ['bin', 'lib', 'scripts', 'public/js'];

const files = [
  'server.mjs',
  'config.mjs',
  ...FOLDERS.flatMap((folder) => fs.readdirSync(path.join(root, folder))
    .filter((name) => /\.(m?js)$/.test(name))
    .map((name) => path.join(folder, name))),
];
for (const file of files) execFileSync(process.execPath, ['--check', path.join(root, file)]);
console.log(`syntaxe : ${files.length} fichiers`);

for (const file of fs.readdirSync(path.join(root, 'lib'))) await import(path.join(root, 'lib', file));
console.log('modules du serveur : chargés');

const { accountIdFor } = await import(path.join(root, 'lib/accounts.mjs'));
assert.equal(accountIdFor('/home/someone/.claude'), 'claude');
assert.equal(accountIdFor('/home/someone/.claude-work'), 'claude-work');
assert.equal(accountIdFor('/srv/Claude Config'), 'claude-config');
const { noise } = await import(path.join(root, 'public/js/noise.js'));
assert.equal(noise(3, 4, 5), noise(3, 4, 5));
assert.ok(noise(3, 4, 5) >= 0 && noise(3, 4, 5) < 1);
// Une valeur de carte d'imports doit être une URL ou commencer par ./ ou / : sinon le navigateur la refuse.
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
for (const target of Object.values(importMap.imports)) assert.match(target, /^(\.\/|\/|https:)/, `carte d'imports : ${target}`);
console.log('règles : ok');
