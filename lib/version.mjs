import fs from 'node:fs';

// Version of this install, from its package.json: the server tells it, the command compares it with its own.
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * True if `version` comes before `reference` (x.y.z, a pre-release suffix is ignored). No version at all is older: the
 * servers before 1.3.0 do not tell theirs.
 */
export function olderThan(version, reference) {
  if (!version) return true;
  const parts = (text) => text.split('-')[0].split('.').map((part) => Number(part) || 0);
  const [mine, theirs] = [parts(version), parts(reference)];
  for (let i = 0; i < 3; i++) {
    if ((mine[i] ?? 0) !== (theirs[i] ?? 0)) return (mine[i] ?? 0) < (theirs[i] ?? 0);
  }
  return false;
}
