import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GIT_REFRESH_MS } from '../config.mjs';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;

// Dossier -> { at, value, refreshing } ; la valeur est servie tout de suite, rafraîchie en arrière-plan.
const cache = new Map();

function parse(output) {
  const status = { branch: null, ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0 };
  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14);
    else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ');
      status.ahead = Number(ahead);
      status.behind = Math.abs(Number(behind));
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) status.changed += 1;
    else if (line.startsWith('u ')) status.conflicts += 1;
    else if (line.startsWith('? ')) status.untracked += 1;
  }
  return status;
}

async function refresh(cwd, entry) {
  entry.refreshing = true;
  try {
    const { stdout } = await run('git', ['-C', cwd, '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeout: GIT_TIMEOUT_MS });
    entry.value = parse(stdout);
  } catch {
    // Pas un dépôt git, ou git trop lent : rien à afficher.
    entry.value = null;
  } finally {
    entry.at = Date.now();
    entry.refreshing = false;
  }
}

/**
 * Branche et fichiers modifiés d'un dossier, comme dans la status line.
 */
export function gitStatus(cwd) {
  let entry = cache.get(cwd);
  if (!entry) {
    entry = { at: 0, value: null, refreshing: false };
    cache.set(cwd, entry);
  }
  if (!entry.refreshing && Date.now() - entry.at > GIT_REFRESH_MS) refresh(cwd, entry);
  return entry.value;
}
