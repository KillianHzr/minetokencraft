// Screenshots, README animation and social preview, taken from the test page in headless Chrome. For maintainers:
// run it after a visible change, with the server running (`minetokencraft serve`).
// Usage: npm run capture [-- --only screenshots|gif|preview] [--url http://localhost:4747]
// Needs Google Chrome or Chromium (CHROME_PATH to point at another one), and ffmpeg for the animation.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from '../config.mjs';
import { closeChrome, launchChrome, Page, sleep } from './chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(root, 'docs', 'screenshots');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = option('--url', `http://localhost:${PORT}`);
const ONLY = option('--only', null);
// Screenshot and animation sizes. The animation stays under 5 MB: 720 pixels wide, 8 frames a second, 128 colors.
const SHOT_SIZE = { width: 1456, height: 825 };
const GIF_SIZE = { width: 1280, height: 720 };
const GIF_WIDTH = 720;
const GIF_FPS = 8;
const PREVIEW_SIZE = { width: 1280, height: 640 };
// Time for textures, skins and the first layout before shooting.
const SETTLE_MS = 7000;

/**
 * The test page, with the controls the captures need.
 */
class DemoPage extends Page {
  /**
   * Opens the test page in English, with the toolbar hidden, and waits for the village to be drawn.
   */
  async openDemo(size, { toolbar = false } = {}) {
    await this.resize(size);
    await this.send('Page.navigate', { url: `${BASE}/demo` });
    await sleep(500);
    await this.evaluate(`localStorage.clear(); localStorage.setItem('minetokencraft:language', 'en'); location.reload(); true`);
    await sleep(SETTLE_MS);
    if (!toolbar) await this.evaluate(`document.getElementById('toolbar').style.display = 'none'; true`);
  }

  /**
   * Picks a scenario and forced time, weather and season on the test page; an empty value means the real one.
   */
  async setScene({ scenario = 'normal', hour = '13', condition = 'clear', season = '' } = {}) {
    await this.evaluate(`(() => {
      const set = (id, value) => { const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change')); };
      set('demo-scenario', ${JSON.stringify(scenario)});
      set('demo-hour', ${JSON.stringify(hour)});
      set('demo-condition', ${JSON.stringify(condition)});
      set('demo-season', ${JSON.stringify(season)});
      return true;
    })()`);
  }

  async clearChat() {
    await this.evaluate(`document.getElementById('chat').replaceChildren(); true`);
  }

  async setSimple(simple) {
    await this.evaluate(`(() => { const toggle = document.getElementById('simple-toggle'); if (toggle.checked !== ${simple}) toggle.click(); return true; })()`);
  }
}

/**
 * The four README screenshots: day, out of quota at night, winter, simple mode.
 */
async function screenshots(page) {
  await page.openDemo(SHOT_SIZE);
  const scenes = [
    ['village.jpg', { scenario: 'normal', hour: '13', condition: 'clear', season: 'summer' }],
    ['nether-end.jpg', { scenario: 'nether-end', hour: '23', condition: 'clear' }],
    ['winter.jpg', { scenario: 'normal', hour: '13', condition: 'snow', season: 'winter' }],
  ];
  for (const [file, scene] of scenes) {
    await page.setScene(scene);
    await sleep(4000);
    await page.clearChat();
    await page.shoot(path.join(SHOTS, file));
    console.log(`docs/screenshots/${file}`);
  }
  await page.setSimple(true);
  await sleep(1000);
  await page.shoot(path.join(SHOTS, 'simple.jpg'));
  console.log('docs/screenshots/simple.jpg');
  await page.setSimple(false);
  // The usage screen, over the last 7 days.
  await page.setScene({ scenario: 'normal', hour: '13', condition: 'clear', season: 'summer' });
  await page.evaluate(`document.getElementById('stats-toggle').click(); document.querySelector('[data-period=week]').click(); true`);
  await sleep(1000);
  await page.shoot(path.join(SHOTS, 'usage.jpg'));
  console.log('docs/screenshots/usage.jpg');
  await page.evaluate(`document.querySelector('#stats [data-close]').click(); true`);
}

/**
 * README animation: a day in the village, the tooltip of a waiting session, both accounts out of quota, the night, a
 * rainbow, then simple mode.
 */
async function animation(page) {
  const frames = await fs.mkdtemp(path.join(os.tmpdir(), 'minetokencraft-frames-'));
  await page.openDemo(GIF_SIZE);
  // The village alone, larger: the side panel is too small to read at this width.
  await page.evaluate(`document.getElementById('panel').style.display = 'none'; window.dispatchEvent(new Event('resize')); true`);
  await page.setScene({ scenario: 'normal', hour: '13', condition: 'clear', season: 'summer' });
  await sleep(3000);
  await page.clearChat();
  let index = 0;
  const record = async (seconds) => {
    for (const until = Date.now() + seconds * 1000; Date.now() < until;) {
      const started = Date.now();
      await page.shoot(path.join(frames, `frame${String(index++).padStart(4, '0')}.jpg`), { quality: 92 });
      await sleep(Math.max(0, 1000 / GIF_FPS - (Date.now() - started)));
    }
  };
  await record(2.5);
  const rooms = await page.evaluate('minetokencraft.rooms()');
  const waiting = rooms.find((room) => room.status === 'waiting') ?? rooms[0];
  await page.hover(waiting.x, waiting.y);
  await record(2.5);
  await page.hover(4, 4);
  await page.setScene({ scenario: 'nether-end', hour: '13', condition: 'clear', season: 'summer' });
  await record(3);
  await page.setScene({ scenario: 'nether-end', hour: '23', condition: 'clear', season: 'summer' });
  await record(2.5);
  await page.setScene({ scenario: 'normal', hour: '13', condition: 'rainbow', season: 'summer' });
  await sleep(3000);
  await record(2);
  await page.setSimple(true);
  await record(2);
  await page.setSimple(false);
  const output = path.join(root, 'docs', 'demo.gif');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(GIF_FPS), '-i', path.join(frames, 'frame%04d.jpg'),
    '-vf', `scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    output,
  ]);
  if (!process.env.KEEP_FRAMES) await fs.rm(frames, { recursive: true, force: true });
  else console.log(frames);
  console.log(`docs/demo.gif (${index} frames, ${((await fs.stat(output)).size / 1e6).toFixed(1)} MB)`);
}

/**
 * Social preview of the repository (GitHub asks for 1280 x 640): the village with the name and the tagline.
 */
async function preview(page) {
  await page.openDemo(PREVIEW_SIZE);
  await page.setScene({ scenario: 'normal', hour: '18.6', condition: 'clear', season: 'summer' });
  await sleep(3000);
  await page.evaluate(`(() => {
    document.getElementById('panel').style.display = 'none';
    document.getElementById('chat').style.display = 'none';
    document.getElementById('bossbars').style.display = 'none';
    window.dispatchEvent(new Event('resize'));
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;right:40px;top:36px;padding:18px 30px;text-align:center;white-space:nowrap;'
      + 'background:rgba(16,0,16,.82);border:3px solid #2a0a5e;outline:3px solid #100010;font-family:Minecraft,monospace;color:#fff;z-index:9';
    card.innerHTML = '<div style="font-size:54px;text-shadow:4px 4px 0 #3f3f3f">MineTokenCraft</div>'
      + '<div style="font-size:20px;color:#bbb;margin-top:12px;text-shadow:2px 2px 0 #2a2a2a">Your Claude Code sessions, live,<br>in a Minecraft village</div>';
    document.body.append(card);
    return true;
  })()`);
  await sleep(2500);
  await page.shoot(path.join(root, 'docs', 'social-preview.jpg'), { quality: 90 });
  console.log('docs/social-preview.jpg');
}

if (!(await fetch(`${BASE}/api/state`).then((response) => response.ok, () => false))) {
  console.error(`No server at ${BASE}: start one with \`minetokencraft serve\`, or pass --url.`);
  process.exit(1);
}
const chrome = await launchChrome();
try {
  const page = await DemoPage.open(chrome);
  if (!ONLY || ONLY === 'screenshots') await screenshots(page);
  if (!ONLY || ONLY === 'gif') await animation(page);
  if (!ONLY || ONLY === 'preview') await preview(page);
} finally {
  await closeChrome(chrome);
}
