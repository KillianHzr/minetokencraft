// Quick check, also run by continuous integration: syntax of every JavaScript file, loading of the server modules,
// matching translations, and a few rules that must never break.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDERS = ['bin', 'lib', 'lib/locales', 'scripts', 'public/js', 'public/js/locales'];
const load = (file) => import(pathToFileURL(path.join(root, file)).href);

const files = [
  'server.mjs',
  'config.mjs',
  ...FOLDERS.flatMap((folder) => fs.readdirSync(path.join(root, folder))
    .filter((name) => /\.(m?js)$/.test(name))
    .map((name) => path.join(folder, name))),
];
for (const file of files) execFileSync(process.execPath, ['--check', path.join(root, file)]);
console.log(`syntax: ${files.length} files`);

for (const file of fs.readdirSync(path.join(root, 'lib')).filter((name) => name.endsWith('.mjs'))) await load(`lib/${file}`);
console.log('server modules: loaded');

const { accountIdFor } = await load('lib/accounts.mjs');
assert.equal(accountIdFor('/home/someone/.claude'), 'claude');
assert.equal(accountIdFor('/home/someone/.claude-work'), 'claude-work');
assert.equal(accountIdFor('/srv/Claude Config'), 'claude-config');
const { noise } = await load('public/js/noise.js');
assert.equal(noise(3, 4, 5), noise(3, 4, 5));
assert.ok(noise(3, 4, 5) >= 0 && noise(3, 4, 5) < 1);
// An import map value must be a URL or start with ./ or /, otherwise the browser rejects it.
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
for (const target of Object.values(importMap.imports)) assert.match(target, /^(\.\/|\/|https:)/, `import map: ${target}`);
console.log('rules: ok');

/**
 * Every language of a locale folder has the keys of English, no more, the same placeholders and the same kind of
 * value (text or plural forms). Values hold no HTML, so the page can insert them as they are.
 */
async function checkLocales(folder, extension) {
  const reference = (await load(`${folder}/en${extension}`)).default;
  const placeholders = (value) => [...new Set(Object.values(typeof value === 'object' ? value : { value }).join(' ').match(/\{\w+\}/g) ?? [])].sort();
  const languages = fs.readdirSync(path.join(root, folder)).filter((name) => name.endsWith(extension) && name !== `en${extension}`);
  for (const file of [`en${extension}`, ...languages]) {
    const strings = (await load(`${folder}/${file}`)).default;
    assert.deepEqual(Object.keys(strings).sort(), Object.keys(reference).sort(), `${folder}/${file}: keys differ from English`);
    for (const [key, value] of Object.entries(strings)) {
      assert.equal(typeof value, typeof reference[key], `${folder}/${file}: ${key} is not the same kind of value`);
      if (typeof value === 'object') assert.ok('one' in value && 'other' in value, `${folder}/${file}: ${key} needs one and other`);
      assert.deepEqual(placeholders(value), placeholders(reference[key]), `${folder}/${file}: ${key} has other placeholders`);
      for (const text of Object.values(typeof value === 'object' ? value : { value })) assert.doesNotMatch(text, /[<>&"]/, `${folder}/${file}: ${key} holds HTML`);
    }
  }
  return { reference, count: languages.length + 1 };
}

const page = await checkLocales('public/js/locales', '.js');
const server = await checkLocales('lib/locales', '.mjs');
// Keys written as plain strings in the code must exist in English.
const usedKeys = (folder, strings) => {
  for (const file of fs.readdirSync(path.join(root, folder)).filter((name) => /\.m?js$/.test(name))) {
    const source = fs.readFileSync(path.join(root, folder, file), 'utf8');
    for (const [, key] of source.matchAll(/\bt\('([\w.-]+)'/g)) assert.ok(key in strings, `${folder}/${file}: unknown key ${key}`);
  }
};
usedKeys('public/js', page.reference);
for (const folder of ['lib', 'bin', 'scripts']) usedKeys(folder, server.reference);
assert.match(html, /data-i18n="toolbar\.simple"/);
for (const [, key] of html.matchAll(/data-i18n(?:-title)?="([\w.-]+)"/g)) assert.ok(key in page.reference, `index.html: unknown key ${key}`);
console.log(`translations: ${page.count} page languages, ${server.count} server languages, same keys`);

// The npm package holds only what runs: no local notes, no documentation images, no maintainer scripts.
// npm is a .cmd script on Windows, which only runs through a shell.
const npm = process.platform === 'win32' ? ['npm.cmd', { shell: true }] : ['npm', {}];
const packed = JSON.parse(execFileSync(npm[0], ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', ...npm[1] }))[0].files
  .map((file) => file.path.replaceAll('\\', '/'));
for (const file of packed) assert.doesNotMatch(file, /(^|\/)(CLAUDE\.md|\.claude\/|docs\/|_site\/)|^scripts\/(check|capture|build-pages|chrome|smoke)/, `npm package: ${file} should not be published`);
for (const file of ['bin/minetokencraft.mjs', 'server.mjs', 'public/index.html', 'scripts/fetch-assets.mjs']) assert.ok(packed.includes(file), `npm package: ${file} is missing`);
console.log(`npm package: ${packed.length} files`);
