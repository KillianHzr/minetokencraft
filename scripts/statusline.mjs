// Status line pour Claude Code : garde une copie du JSON que Claude Code lui passe (contexte, coût et quotas de la
// session), que MineTokenCraft lit, puis affiche une ligne courte. Avec --quiet, n'affiche rien : pour l'appeler depuis
// une status line existante.
//
// Dans ~/.claude/settings.json :  "statusLine": { "type": "command", "command": "minetokencraft statusline" }
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSLINE_DIR } from '../config.mjs';
import { accountIdFor } from '../lib/accounts.mjs';

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

/**
 * Copie le JSON de la session dans `<compte>/<session>.json` ; écrite d'un bloc pour ne jamais être lue à moitié.
 */
export async function saveStatusline(input) {
  const data = JSON.parse(input);
  if (!data.session_id || !/^[\w-]+$/.test(data.session_id)) return data;
  const configDir = (process.env.CLAUDE_CONFIG_DIR ?? '').split(',')[0].trim() || path.join(os.homedir(), '.claude');
  const dir = path.join(STATUSLINE_DIR, accountIdFor(configDir));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${data.session_id}.json`);
  await fs.writeFile(`${file}.tmp`, input);
  await fs.rename(`${file}.tmp`, file);
  return data;
}

function line(data) {
  const parts = [data.model?.display_name, path.basename(data.workspace?.current_dir ?? data.cwd ?? '')];
  const context = data.context_window?.used_percentage;
  if (typeof context === 'number') parts.push(`contexte ${Math.round(context)} %`);
  const fiveHour = data.rate_limits?.five_hour?.used_percentage;
  if (typeof fiveHour === 'number') parts.push(`5 h ${Math.round(fiveHour)} %`);
  return parts.filter(Boolean).join(' · ');
}

export async function statusline(args = []) {
  try {
    const data = await saveStatusline(await readStdin());
    if (!args.includes('--quiet')) process.stdout.write(`${line(data)}\n`);
  } catch {
    // Une status line ne doit jamais casser l'affichage de Claude Code.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await statusline(process.argv.slice(2));
}
