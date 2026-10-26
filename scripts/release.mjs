// Publishes a new version in one go: dates the Unreleased notes of CHANGELOG.md, bumps package.json, commits, tags and
// pushes. The tag starts release.yml, which runs every check, publishes to npm and creates the GitHub release.
// Usage: npm run release [-- patch | minor | major | x.y.z] [--yes] [--dry-run]
//   Without a level: minor when the notes add something (### Added), patch otherwise.
//   --yes publishes without asking, --dry-run shows the version and the notes and changes nothing.
// Not called `publish`: npm would run a script of that name during the workflow's own `npm publish`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(root, 'CHANGELOG.md');
const LEVELS = ['major', 'minor', 'patch'];
// npm is a .cmd script on Windows, which only runs through a shell.
const npm = process.platform === 'win32' ? ['npm.cmd', { shell: true }] : ['npm', {}];

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const runNpm = (...args) => execFileSync(npm[0], args, { cwd: root, stdio: 'inherit', ...npm[1] });

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function bump(version, level) {
  if (/^\d+\.\d+\.\d+$/.test(level)) return level;
  if (!LEVELS.includes(level)) fail(`unknown level ${level} (patch, minor, major or x.y.z)`);
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const today = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const level = args.find((arg) => !arg.startsWith('--'));

// The release is cut from main as pushed, with nothing left aside.
if (git('branch', '--show-current') !== 'main') fail('switch to main first');
if (git('status', '--porcelain')) fail('commit or set aside the changes in progress first');
git('fetch', '--quiet', 'origin', 'main');
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') fail('origin/main has commits that are not here: pull first');

const changelog = fs.readFileSync(CHANGELOG, 'utf8');
const notes = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## \[)/m)?.[1].trim();
if (!notes) fail('nothing under ## [Unreleased] in CHANGELOG.md');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const previous = pkg.version;
const version = bump(previous, level ?? (/^### Added/m.test(notes) ? 'minor' : 'patch'));
const tag = `v${version}`;
if (git('tag', '--list', tag) || git('ls-remote', '--tags', 'origin', tag)) fail(`${tag} already exists`);

console.log(`\n${pkg.name} ${previous} -> ${version}\n\n${notes}\n`);
if (dryRun) process.exit(0);
if (!args.includes('--yes')) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Publish ${version} on npm? [y/N] `);
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail('cancelled');
}

// The workflow runs them again on three systems: here, they stop a broken release before anything is pushed.
runNpm('run', 'check');
runNpm('test');

const repository = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
fs.writeFileSync(CHANGELOG, changelog
  .replace('## [Unreleased]\n', `## [Unreleased]\n\n## [${version}] - ${today()}\n`)
  .replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repository}/compare/${tag}...HEAD\n[${version}]: ${repository}/compare/v${previous}...${tag}`));
runNpm('version', version, '--no-git-tag-version');
git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json');
git('commit', '--quiet', '-m', `chore: release ${version}`);
git('tag', tag);
// Both or neither: a tag without its commit on main would fail the workflow.
git('push', '--atomic', 'origin', 'main', tag);

console.log(`\n${tag} pushed. Every check runs, then npm and the GitHub release follow:
  ${repository}/actions/workflows/release.yml
Then \`npm view ${pkg.name} version\` says ${version}.`);
