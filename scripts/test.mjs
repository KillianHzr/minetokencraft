// Runs every test/*.test.mjs with the Node test runner. Listing them here works the same on every Node version and
// on Windows, where the shell does not expand globs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('test', name));
const { status } = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exitCode = status ?? 1;
