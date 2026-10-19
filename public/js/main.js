import * as THREE from 'three';
import { CAMERA_PITCH, CAMERA_YAW, computeLayout, DOOR_X, ROOM_DEPTH, STATIONS } from './layout.js';
import { World } from './world.js';
import { Player, STATUS_COLORS, Villager } from './entities.js';
import { Labels } from './labels.js';
import { Particles } from './particles.js';
import { Alerts, Chat, diffEvents, Panel } from './hud.js';
import { Dashboard } from './dashboard.js';
import { HistoryDrawer, SettingsDialog, Toasts } from './ui.js';
import { StatsOverlay } from './stats.js';
import { Environment } from './environment.js';
import { conditionsFor, SEASONS } from './season.js';
import { Herd } from './mobs.js';
import { emeraldCost, tasksLine, xpBar } from './widgets.js';
import { DONE_ITEM, itemForTool } from './items.js';
import { accountTheme, themeNotice } from './themes.js';
import { DEMO_SCENARIOS, demoHistory, demoState } from './demo.js';
import { biomeFor, hash, professionFor } from './identity.js';
import { loadImage, TEXTURE_ROOT } from './textures.js';
import {
  clockTime,
  escapeHtml,
  gitText,
  isUrgent,
  playerActivity,
  slotClass,
  STATUS_ICONS,
  truncate,
  workingVillagers,
} from './format.js';

// Caméra orthographique fixe, de trois quarts (angles dans layout.js) : toute la maison tient dans l'écran.
const CAMERA_DISTANCE = 150;
// Direction du soleil (ou de la lune) : elle suit l'heure, fournie par l'environnement à chaque image.
const SHADOW_MAP_SIZE = 2048;
// Budget de rendu : une page de suivi n'a pas besoin de plus de 30 images par seconde, ni d'un canvas en pleine
// résolution Retina (le pixel art n'y gagne rien) ; les ombres se recalculent dix fois par seconde.
const FRAME_MS = 1000 / 30;
// Fenêtre sans le focus (la page reste ouverte sur un écran pendant qu'on travaille ailleurs) : 20 images par seconde.
const BACKGROUND_FRAME_MS = 1000 / 20;
const MAX_PIXEL_RATIO = 1.25;
const SHADOW_EVERY_MS = 100;
const VIEW_MARGIN_PX = 14;
const FRAMING_EASE = 4;
const SKINS_STORAGE_KEY = 'minetokencraft:skins';
const SIMPLE_STORAGE_KEY = 'minetokencraft:simple';
const REFRESH_TEXTS_MS = 30000;
// Un joueur ne change de meuble qu'après ce délai, sinon il courrait de l'un à l'autre à chaque appel d'outil.
const STATION_DWELL_MS = 1500;
const LABEL_PRIORITY = { wing: 0, room: 1, villager: 2 };
// Nametag : le nom de la session, raccourci ; l'infobulle donne le reste.
const NAMETAG_CHARS = 26;
const TOOLTIP_VILLAGERS = 6;
const TOOLTIP_OFFSET_PX = 16;
// Couleurs des barres de boss du jeu, une par compte dans leur ordre.
const BOSS_BAR_COLORS = ['blue', 'yellow', 'purple', 'white'];

// Meuble de la pièce selon l'outil : fourneau pour les commandes, bibliothèque pour lire et chercher,
// table de cartographie pour le web, établi pour écrire et le reste.
const TOOL_STATIONS = {
  Bash: 'furnace',
  BashOutput: 'furnace',
  KillShell: 'furnace',
  Monitor: 'furnace',
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LS: 'library',
  Skill: 'library',
  WebSearch: 'carto',
  WebFetch: 'carto',
};
const STATION_POSES = { carto: 'work', craft: 'work', furnace: 'work', library: 'read', chair: 'sit', front: 'wave', supervise: 'idle' };
const TOOL_STATIONS_WITH_ITEM = new Set(['carto', 'craft', 'furnace']);
const PARTICLE_TIMERS = { craft: 0.42, carto: 0.42, furnace: 0.3, library: 0.5, chair: 2 };
// Ambiance d'une zone Nether (braises qui montent) ou End (particules de portail qui flottent), par seconde.
const ZONE_PARTICLES = {
  nether: { type: 'ember', rate: 10, velocity: [0, 0.9, 0], spread: 0.3, life: 2.6, size: 0.12 },
  end: { type: 'portal', rate: 10, velocity: [0, 0.25, 0], spread: 0.8, life: 2.2, size: 0.14 },
};
const DEMO = window.location.pathname === '/demo';
const DEMO_TICK_MS = 4000;

const stage = document.getElementById('stage');
const canvas = document.getElementById('world');
const offline = document.getElementById('offline');
const empty = document.getElementById('empty');
const bossBars = document.getElementById('bossbars');
const tooltip = document.getElementById('tooltip');
const simpleToggle = document.getElementById('simple-toggle');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
// Lumière du ciel (bleutée d'en haut, terreuse d'en bas) et soleil chaud qui porte les ombres.
const hemisphere = new THREE.HemisphereLight(0xdcecff, 0x8a7454, 0.5);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff1d6, 0.9);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
const cameraDirection = new THREE.Vector3(
  Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
  Math.sin(CAMERA_PITCH),
  Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
);
const framing = { current: null, target: null };

const world = new World(scene);
const particles = new Particles(scene, new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().lookAt(cameraDirection, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)),
));
const labels = new Labels(document.getElementById('labels'));
const chat = new Chat(document.getElementById('chat'));
const alerts = new Alerts(document.getElementById('sound-toggle'), document.getElementById('notify-toggle'), { demo: DEMO });
const toasts = new Toasts(document.getElementById('toasts'));
const statsOverlay = new StatsOverlay(document.getElementById('stats'));
document.getElementById('stats-toggle').addEventListener('click', () => statsOverlay.toggle(state));
const history = new HistoryDrawer(document.getElementById('history'), { onFocus: focusPlayer });
const settingsDialog = new SettingsDialog(document.getElementById('settings'), { onChange: () => refreshState() });
document.getElementById('settings-toggle').addEventListener('click', () => settingsDialog.open());
const dashboard = new Dashboard(document.getElementById('dashboard'), { onFocus: focusPlayer, onHistory: openHistory });
let highlighted = null;
const panel = new Panel(document.getElementById('panel'), {
  onHover: (id) => {
    highlighted = id;
    if (state && !simple) refreshLabels();
  },
  onFocus: focusPlayer,
  onHistory: openHistory,
});
// Un Claude qui t'attend depuis longtemps : la cloche resonne à intervalles réguliers.
const REMIND_MS = 60 * 1000;
// Le serveur relit les sessions toutes les secondes : un peu plus d'attente suffit pour voir un réglage appliqué.
const STATE_REFRESH_DELAY_MS = 1200;
// Session qui se termine (ou s'endort) : le joueur sort par sa porte et quitte l'île, puis sa pièce part en fumée.
const DEPARTURE_MS = 7000;
const departing = new Map();
const SOOT_EVERY_S = 0.25;

/**
 * Joueurs qui ont une pièce : les sessions éveillées, plus celles qui sont en train de partir.
 */
function housedPlayers() {
  const active = state.players.filter((player) => player.status !== 'sleeping');
  const ids = new Set(active.map((player) => player.id));
  return [...active, ...[...departing.values()].filter(({ player }) => !ids.has(player.id)).map(({ player }) => player)];
}

const entities = new Map();
let skins = [];
let skinAssignments = {};
let state = null;
let layout = null;
let viewport = { width: 1, height: 1 };
let paused = false;
let simple = false;

/**
 * Skin attribué à chaque joueur : stable pendant toute sa vie (et après rechargement), sans doublon si possible.
 */
function skinFor(playerId) {
  if (!skinAssignments[playerId] || !skins.some((skin) => skin.name === skinAssignments[playerId])) {
    const used = new Set(Object.values(skinAssignments));
    const start = hash(playerId) % skins.length;
    let pick = skins[start];
    for (let i = 0; i < skins.length; i++) {
      const candidate = skins[(start + i) % skins.length];
      if (!used.has(candidate.name)) {
        pick = candidate;
        break;
      }
    }
    skinAssignments[playerId] = pick.name;
    try {
      localStorage.setItem(SKINS_STORAGE_KEY, JSON.stringify(skinAssignments));
    } catch {
      // Sans stockage, les skins seront retirés au prochain chargement.
    }
  }
  const skin = skins.find((candidate) => candidate.name === skinAssignments[playerId]);
  return { ...skin, url: `/assets/skins/${skin.file}` };
}

function desiredStation(player) {
  if (player.status === 'waiting') return 'front';
  if (player.status === 'done') return 'chair';
  if (player.tool) return TOOL_STATIONS[player.tool.name] ?? (player.tool.name.startsWith('mcp__') ? 'carto' : 'craft');
  if (player.thinking) return 'library';
  return workingVillagers(player) ? 'supervise' : 'library';
}

function spawnPoof(position) {
  particles.emit('poof', { x: position.x, y: position.y + 1, z: position.z }, { count: 12, spread: 0.6, velocity: [0, 0.6, 0], life: 0.7, size: 0.22 });
}

function stationSpot(record) {
  const [dx, dz] = STATIONS[record.station].spot;
  return { x: record.room.x0 + dx, y: 0, z: record.room.z0 + dz };
}

/**
 * Poste du joueur : on ne le change qu'une fois le nouvel outil installé, sauf pour t'appeler ou se reposer.
 */
function applyStation(record, now) {
  const player = record.data;
  if (player.status === 'leaving') return walkAway(record);
  const desired = desiredStation(player);
  if (desired !== record.pendingStation) {
    record.pendingStation = desired;
    record.pendingSince = now;
  }
  const urgent = desired === 'front' || desired === 'chair' || !record.station;
  if (record.station !== desired && (urgent || now - record.pendingSince >= STATION_DWELL_MS)) record.station = desired;
  const spot = stationSpot(record);
  record.entity.moveTo(spot.x, spot.y, spot.z);
  record.entity.restYaw = STATIONS[record.station].yaw;
  const item = record.station === 'library' ? 'book'
    : TOOL_STATIONS_WITH_ITEM.has(record.station) && player.tool ? itemForTool(player.tool.name) : null;
  record.entity.setPose(STATION_POSES[record.station], item);
  record.entity.urgent = isUrgent(player);
  world.setFurnace(player.id, record.station === 'furnace' && !record.entity.moving);
}

/**
 * Départ d'une session : jusqu'à la porte, puis tout droit hors de l'île.
 */
function walkAway(record) {
  const { entity, room } = record;
  const door = { x: room.x0 + DOOR_X[0] + 1, z: room.z0 + ROOM_DEPTH + 1.6 };
  record.leaving ??= 'door';
  const position = entity.root.position;
  if (record.leaving === 'door' && Math.hypot(position.x - door.x, position.z - door.z) < 0.15) record.leaving = 'away';
  const target = record.leaving === 'door' ? door : { x: layout.bounds.x1 + 4, z: door.z };
  entity.moveTo(target.x, 0, target.z);
  entity.setPose('idle', null);
  entity.urgent = false;
}

/**
 * Nuage de fumée sur toute la surface d'une pièce qui disparaît.
 */
function roomPoof(room) {
  for (let dx = 0.5; dx < room.width; dx += 1.5) {
    for (let dz = 0.5; dz < ROOM_DEPTH; dz += 1.5) {
      particles.emit('poof', { x: room.x0 + dx, y: 0.8, z: room.z0 + dz }, { count: 3, spread: 1.2, velocity: [0, 0.8, 0], life: 1.2, size: 0.35 });
    }
  }
}

function expireDepartures(now) {
  let expired = false;
  for (const [id, departure] of departing) {
    if (now < departure.until) continue;
    const room = layout.rooms.get(id);
    if (room) roomPoof(room);
    departing.delete(id);
    expired = true;
  }
  if (expired) relayout();
}

function syncVillagers(record, player, room) {
  const keep = new Set();
  const biome = biomeFor(player.id);
  for (const placed of room.villagers) {
    const data = player.villagers.find((villager) => villager.id === placed.id);
    keep.add(placed.id);
    let villager = record.villagers.get(placed.id);
    if (!villager) {
      villager = new Villager(biome, professionFor(data.type, data.id));
      // Le villageois arrive depuis son joueur puis rejoint son bloc de métier.
      villager.placeAt(record.entity.root.position.x, 0, record.entity.root.position.z);
      scene.add(villager.root);
      record.villagers.set(placed.id, villager);
    }
    villager.moveTo(room.x0 + placed.slot.spot[0], 0, room.z0 + placed.slot.spot[1]);
    villager.restYaw = placed.slot.yaw;
    villager.setStatus(data.status, data.status === 'working' ? itemForTool(data.tool?.name) ?? 'paper' : DONE_ITEM);
    villager.data = data;
  }
  for (const [id, villager] of record.villagers) {
    if (keep.has(id)) continue;
    spawnPoof(villager.root.position);
    scene.remove(villager.root);
    record.villagers.delete(id);
  }
}

function removeRecord(id, record) {
  spawnPoof(record.entity.root.position);
  scene.remove(record.entity.root);
  for (const villager of record.villagers.values()) scene.remove(villager.root);
  entities.delete(id);
}

function syncEntities() {
  const now = performance.now();
  const seen = new Set();
  for (const player of housedPlayers()) {
    const room = layout.rooms.get(player.id);
    if (!room) continue;
    seen.add(player.id);
    let record = entities.get(player.id);
    if (!record) {
      record = { entity: new Player(skinFor(player.id)), villagers: new Map(), timer: Math.random() };
      entities.set(player.id, record);
      scene.add(record.entity.root);
    }
    const isNew = !record.room;
    // Changement de pièce (réorganisation) : il y réapparaît plutôt que de traverser les murs.
    const moved = record.room && (record.room.x0 !== room.x0 || record.room.z0 !== room.z0);
    record.data = player;
    record.room = room;
    applyStation(record, now);
    if (isNew || moved) {
      const spot = stationSpot(record);
      record.entity.placeAt(spot.x, spot.y, spot.z);
      spawnPoof(record.entity.root.position);
    }
    syncVillagers(record, player, room);
  }
  for (const [id, record] of entities) {
    if (!seen.has(id)) removeRecord(id, record);
  }
}

/**
 * Détails d'une session, dans l'infobulle qui suit la souris au-dessus de sa pièce : nom et projet, ce qu'il fait,
 * ses tâches, le contexte en barre d'expérience, le coût en émeraudes, la branche git et ses villageois.
 */
function sessionTooltip(player) {
  const icon = player.stuck ? '⚠' : STATUS_ICONS[player.status];
  const git = gitText(player.git);
  const villagers = player.villagers.slice(0, TOOLTIP_VILLAGERS).map((villager) => `<li><span class="status-icon status-icon--${villager.status}">${STATUS_ICONS[villager.status]}</span> ${escapeHtml(truncate(villager.description, 40))}</li>`).join('');
  return `<div class="mc-tooltip__title">${escapeHtml(player.name)}</div>
    <div class="mc-tooltip__muted">${escapeHtml(player.accountLabel)} · ${escapeHtml(player.project)}${git ? ` · ${escapeHtml(git)}` : ''}</div>
    <div class="mc-tooltip__status mc-tooltip__status--${player.stuck ? 'stuck' : player.status}">${icon} ${escapeHtml(truncate(playerActivity(player), 80))}</div>
    ${tasksLine(player.tasks, 52)}
    <div class="mc-tooltip__line">${xpBar(player.context)}${emeraldCost(player.costUSD)}</div>
    ${villagers ? `<ul class="mc-tooltip__villagers">${villagers}</ul>` : ''}`;
}

function anchorAt(x, y, z) {
  const anchor = new THREE.Object3D();
  anchor.position.set(x, y, z);
  anchor.updateMatrixWorld();
  return anchor;
}

/**
 * Étiquettes de la carte, réduites au minimum pour laisser voir les personnages : un nametag au-dessus de chaque
 * joueur (comme dans le jeu), un petit écriteau devant chaque aile, et les villageois du joueur survolé dans le
 * panneau. Le reste est dans les barres de boss (quotas) et l'infobulle (détails d'une pièce).
 */
function refreshLabels() {
  const ids = new Set();
  for (const wing of layout.wings) {
    const key = `wing:${wing.account.id}`;
    ids.add(key);
    wing.anchor ??= anchorAt((wing.x0 + wing.x1 + 1) / 2, 0.2, wing.rows.at(-1).z0 + ROOM_DEPTH + 1.2);
    const theme = wing.theme === 'normal' ? slotClass(wing.account.slot) : wing.theme;
    labels.upsert(key, wing.anchor, escapeHtml(wing.account.label), `wing-tag wing-tag--${theme}`, LABEL_PRIORITY.wing, { fixed: true });
    for (const room of wing.rows.flatMap((row) => row.rooms)) {
      const record = room.player && entities.get(room.player.id);
      if (!record) continue;
      const nameKey = `name:${room.player.id}`;
      ids.add(nameKey);
      const player = record.data ?? room.player;
      const icon = player.stuck ? '⚠' : STATUS_ICONS[player.status];
      const flags = [highlighted === player.id && 'nametag--hl', isUrgent(player) && 'nametag--urgent', player.stuck && 'nametag--stuck'];
      labels.upsert(nameKey, record.entity.labelAnchor, `<span class="status-icon">${icon}</span> ${escapeHtml(truncate(player.name, NAMETAG_CHARS))}`,
        `nametag nametag--${player.status} ${flags.filter(Boolean).join(' ')}`, LABEL_PRIORITY.room);
    }
  }
  const record = highlighted && entities.get(highlighted);
  if (record) {
    for (const [villagerId, villager] of record.villagers) {
      const key = `villager:${villagerId}`;
      ids.add(key);
      const { status, description } = villager.data;
      labels.upsert(key, villager.labelAnchor, `<span class="status-icon">${STATUS_ICONS[status]}</span> ${escapeHtml(truncate(description, 24))}`,
        `tag tag--villager tag--${status}`, LABEL_PRIORITY.villager);
    }
  }
  labels.keepOnly(ids);
}

/**
 * Quotas de chaque compte en barres de boss, en haut de l'écran : la barre du haut pour les 5 heures, celle du
 * dessous pour la semaine. Elles se remplissent avec la consommation.
 */
function renderBossBars() {
  const now = Date.now();
  bossBars.innerHTML = (state.accounts ?? []).map((account) => {
    const usage = account.usage;
    const notice = themeNotice(accountTheme(usage), usage);
    const color = BOSS_BAR_COLORS[(account.slot ?? 0) % BOSS_BAR_COLORS.length];
    const value = (quota) => (quota ? (quota.usedPct >= 100 ? 'épuisé' : `${Math.round(quota.usedPct)} %`) : '?');
    const eta = account.forecast?.fiveHour?.eta;
    const detail = notice ? `<span class="bossbar__alert">${escapeHtml(notice)}</span>`
      : `5 h ${value(usage?.fiveHour)}${eta ? ` <span class="bossbar__alert">→ ${clockTime(eta, now)}</span>` : ''} · semaine ${value(usage?.sevenDay)}`;
    const bar = (quota) => `<div class="bossbar__bar" style="--bar:url('${TEXTURE_ROOT}gui/sprites/boss_bar/${color}_background.png');--fill:url('${TEXTURE_ROOT}gui/sprites/boss_bar/${color}_progress.png')">
        <i style="width:${Math.min(100, quota?.usedPct ?? 0)}%"></i></div>`;
    return `<div class="bossbar"><div class="bossbar__title"><b>${escapeHtml(account.label)}</b> · ${detail}</div>${bar(usage?.fiveHour)}${bar(usage?.sevenDay)}</div>`;
  }).join('');
}

function frameTarget() {
  const { bounds } = layout;
  const center = new THREE.Vector3((bounds.x0 + bounds.x1 + 1) / 2, (bounds.y0 + bounds.y1) / 2, (bounds.z0 + bounds.z1 + 1) / 2);
  const inverse = new THREE.Matrix4().lookAt(cameraDirection, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).invert();
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const x of [bounds.x0, bounds.x1 + 1]) {
    for (const y of [bounds.y0, bounds.y1]) {
      for (const z of [bounds.z0, bounds.z1 + 1]) {
        const point = new THREE.Vector3(x, y, z).sub(center).applyMatrix4(inverse);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  const unitsPerPx = Math.max((maxX - minX) / (viewport.width - 2 * VIEW_MARGIN_PX), (maxY - minY) / (viewport.height - 2 * VIEW_MARGIN_PX));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfWidth = (viewport.width / 2) * unitsPerPx;
  const halfHeight = (viewport.height / 2) * unitsPerPx;
  return { center, left: cx - halfWidth, right: cx + halfWidth, top: cy + halfHeight, bottom: cy - halfHeight };
}

function updateCamera(dt) {
  if (!framing.target) return;
  if (!framing.current) framing.current = { ...framing.target, center: framing.target.center.clone() };
  const ease = 1 - Math.exp(-FRAMING_EASE * dt);
  for (const key of ['left', 'right', 'top', 'bottom']) {
    framing.current[key] += (framing.target[key] - framing.current[key]) * ease;
  }
  framing.current.center.lerp(framing.target.center, ease);
  Object.assign(camera, { left: framing.current.left, right: framing.current.right, top: framing.current.top, bottom: framing.current.bottom });
  camera.position.copy(framing.current.center).addScaledVector(cameraDirection, CAMERA_DISTANCE);
  camera.lookAt(framing.current.center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Le soleil suit la maison : sa caméra d'ombres couvre juste l'île, pour des ombres nettes.
 */
function aimSun(direction) {
  const { bounds } = layout;
  const center = new THREE.Vector3((bounds.x0 + bounds.x1 + 1) / 2, 0, (bounds.z0 + bounds.z1 + 1) / 2);
  const radius = Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + 4;
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(direction, 60);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: 140 });
  sun.shadow.camera.updateProjectionMatrix();
}

// Paysage : il couvre tout ce que voit la caméra, coins compris, jusqu'au lit de la rivière ; les montagnes montent
// au-delà du haut de l'écran, de quelques blocs seulement.
const LOWEST_GROUND = -3;
const COVER_MARGIN = 3;
const CEILING_MARGIN = 3;
// La pluie et la neige tombent aussi autour de la maison.
const WEATHER_MARGIN = 14;

/**
 * Cases à couvrir de paysage pour le cadrage visé (et le précédent, le temps que la caméra glisse de l'un à l'autre),
 * et hauteur à partir de laquelle une colonne sort par le haut de l'écran.
 */
function sceneryFor(target, previous) {
  const basis = new THREE.Matrix4().lookAt(cameraDirection, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  const cover = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const view of [target, previous].filter(Boolean)) {
    for (const sx of [view.left, view.right]) {
      for (const sy of [view.bottom, view.top]) {
        const origin = view.center.clone().addScaledVector(right, sx).addScaledVector(up, sy);
        for (const level of [LOWEST_GROUND, 0]) {
          const t = (origin.y - level) / cameraDirection.y;
          const x = origin.x - cameraDirection.x * t;
          const z = origin.z - cameraDirection.z * t;
          cover.x0 = Math.min(cover.x0, Math.floor(x) - COVER_MARGIN);
          cover.x1 = Math.max(cover.x1, Math.ceil(x) + COVER_MARGIN);
          cover.z0 = Math.min(cover.z0, Math.floor(z) - COVER_MARGIN);
          cover.z1 = Math.max(cover.z1, Math.ceil(z) + COVER_MARGIN);
        }
      }
    }
  }
  const top = Math.max(...[target, previous].filter(Boolean).map((view) => view.center.clone().addScaledVector(up, view.top).sub(target.center).dot(up)));
  const point = new THREE.Vector3();
  // Un bloc de plus en hauteur remonte le sommet de la colonne de up.y à l'écran.
  const ceiling = (x, z) => Math.floor((top - point.set(x + 0.5, 0, z + 0.5).sub(target.center).dot(up)) / up.y) + CEILING_MARGIN;
  return { cover, ceiling, skyKey: Math.round(top * 10) };
}

const sameFraming = (a, b) => a && b && a.center.equals(b.center) && ['left', 'right', 'top', 'bottom'].every((key) => Math.abs(a[key] - b[key]) < 1e-6);

function relayout() {
  if (!state || !skins.length || simple || viewport.width < 2 || viewport.height < 2) return;
  layout = computeLayout(housedPlayers(), state.accounts ?? [], viewport);
  const { bounds } = layout;
  layout.weatherArea = { x0: bounds.x0 - WEATHER_MARGIN, x1: bounds.x1 + WEATHER_MARGIN, z0: bounds.z0 - WEATHER_MARGIN, z1: bounds.z1 + WEATHER_MARGIN };
  conditions = conditionsFor(Date.now(), state.weather, envOverride);
  const target = frameTarget();
  if (!sameFraming(target, framing.target)) framing.previous = framing.target;
  framing.target = target;
  if (world.build(layout, conditions.season, sceneryFor(framing.target, framing.previous)) && lastNight >= 0) world.setNight(lastNight);
  syncEntities();
  refreshLabels();
  empty.hidden = state.players.some((player) => player.status !== 'sleeping');
}

function renderTexts() {
  if (simple) dashboard.render(state);
  else {
    panel.render(state);
    renderBossBars();
  }
  statsOverlay.render(state);
}

function applyState(next) {
  if (skins.length) for (const player of next.players) player.skinUrl = skinFor(player.id).url;
  const events = diffEvents(state, next);
  const nextActive = new Set(next.players.filter((player) => player.status !== 'sleeping').map((player) => player.id));
  for (const player of state?.players ?? []) {
    if (player.status === 'sleeping' || nextActive.has(player.id) || !entities.has(player.id) || departing.has(player.id)) continue;
    departing.set(player.id, { player: { ...player, status: 'leaving', tool: null, villagers: [] }, until: performance.now() + DEPARTURE_MS });
  }
  for (const id of departing.keys()) if (nextActive.has(id)) departing.delete(id);
  state = next;
  relayout();
  renderTexts();
  for (const event of events) chat.say(event.html, event.kind);
  alerts.announce(events);
  const waiting = state.players.filter((player) => player.status === 'waiting').length;
  const title = DEMO ? 'MineTokenCraft · test' : 'MineTokenCraft';
  document.title = waiting ? `(${waiting}) ! ${title}` : title;
  document.getElementById('favicon').href = waiting ? '/favicon-alert.svg' : '/favicon.svg';
}

function emitAmbient(record, dt) {
  const objects = world.rooms.get(record.data.id);
  if (!objects) return;
  if (record.data.stuck) {
    record.sootTimer = (record.sootTimer ?? 0) - dt;
    if (record.sootTimer <= 0) {
      record.sootTimer = SOOT_EVERY_S;
      const { room } = record;
      particles.emit('soot', { x: room.x0 + room.width / 2, y: 2.2, z: room.z0 + ROOM_DEPTH / 2 }, { count: 2, spread: room.width / 3, velocity: [0, 1, 0], life: 2.5, size: 0.4 });
    }
  }
  const frameMaterial = objects.frame.userData.material;
  frameMaterial.color.set(STATUS_COLORS[record.data.status]);
  frameMaterial.opacity = record.data.status === 'waiting' ? 0.45 + 0.55 * Math.abs(Math.sin(record.entity.clock * 4)) : 0.9;
  record.timer -= dt;
  if (record.timer > 0) return;
  const { entity, station } = record;
  record.timer = PARTICLE_TIMERS[station] ?? 1;
  const at = ([x, y, z]) => ({ x, y, z });
  if (entity.moving) {
    record.timer = 0.4;
  } else if (station === 'craft' || station === 'carto') {
    particles.emit('chip', at(objects.stations[station]), { count: 3, spread: 0.4, velocity: [0, 1.6, 0], gravity: 6, life: 0.6, size: 0.1 });
  } else if (station === 'furnace') {
    particles.emit('flame', at(objects.stations.furnace), { count: 2, spread: 0.25, velocity: [0, 0.6, 0.1], life: 0.6, size: 0.14 });
    particles.emit('smoke', { ...at(objects.stations.furnace), y: 1.2 }, { spread: 0.2, velocity: [0, 0.8, 0], life: 1.4, size: 0.18 });
  } else if (station === 'library') {
    particles.emit('glyph', at(objects.stations.library), { count: 2, spread: 0.6, velocity: [0, -0.2, 0.4], life: 1.6, size: 0.13 });
  } else if (station === 'chair') {
    const position = entity.root.position;
    particles.emit('sparkle', { x: position.x, y: 1.9, z: position.z }, { count: 2, spread: 0.7, velocity: [0, 0.4, 0], life: 1.2, size: 0.16 });
  }
  for (const villager of record.villagers.values()) {
    if (villager.data.status === 'done' && Math.random() < 0.4) {
      const villagerAt = villager.root.position;
      particles.emit('sparkle', { x: villagerAt.x, y: 2.2, z: villagerAt.z }, { spread: 0.6, velocity: [0, 0.4, 0], life: 1.2, size: 0.14 });
    }
  }
}

/**
 * Braises ou particules de portail au-dessus des zones dont le compte a épuisé un quota.
 */
function emitZoneParticles(dt) {
  for (const wing of layout.wings) {
    const effect = ZONE_PARTICLES[wing.theme];
    if (!effect) continue;
    let count = effect.rate * dt;
    while (count > 0) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      const origin = {
        x: wing.zone.x0 + Math.random() * (wing.zone.x1 - wing.zone.x0 + 1),
        y: Math.random() * 1.5,
        z: layout.bounds.z0 + Math.random() * (layout.bounds.z1 - layout.bounds.z0 + 1),
      };
      particles.emit(effect.type, origin, effect);
    }
  }
}

const timer = new THREE.Timer();
const environment = new Environment(scene, {
  sky: document.getElementById('sky'),
  veil: document.getElementById('veil'),
  flash: document.getElementById('flash'),
  hemisphere,
  sun,
});
const herd = new Herd(scene, particles);
// Heure, météo et saison forcées par la page de test ; vides en temps normal.
let envOverride = {};
let conditions = conditionsFor(Date.now(), null);
let lastNight = -1;

function updateEnvironment(dt) {
  const now = Date.now();
  conditions = conditionsFor(now, state?.weather, envOverride);
  if (layout && world.season !== conditions.season) relayout();
  aimSun(environment.update(dt, conditions, layout, particles, now));
  const night = Math.round((1 - conditions.day) * 50) / 50;
  if (night !== lastNight) {
    lastNight = night;
    world.setNight(night);
  }
  herd.update(dt, conditions, layout);
}

const frameCost = { total: 0, samples: 0, fps: 0, frames: 0, since: 0, parts: {}, lastParts: {} };
let lastFrameAt = -Infinity;
let lastShadowAt = -Infinity;

function frame(time) {
  requestAnimationFrame(frame);
  // Tolérance de 2 ms : sur un écran à 60 Hz, une image sur deux ; à 120 Hz, une sur quatre.
  if (time - lastFrameAt < (document.hasFocus() ? FRAME_MS : BACKGROUND_FRAME_MS) - 2) return;
  lastFrameAt = time;
  if (time - lastShadowAt >= SHADOW_EVERY_MS) {
    lastShadowAt = time;
    renderer.shadowMap.needsUpdate = true;
  }
  const started = performance.now();
  frameCost.frames += 1;
  if (time - frameCost.since >= 1000) {
    frameCost.fps = frameCost.frames;
    frameCost.frames = 0;
    frameCost.since = time;
    frameCost.lastParts = Object.fromEntries(Object.entries(frameCost.parts).map(([name, total]) => [name, +(total / Math.max(1, frameCost.samples)).toFixed(2)]));
    frameCost.parts = {};
    frameCost.total = 0;
    frameCost.samples = 0;
  }
  renderFrame(time);
  frameCost.total += performance.now() - started;
  frameCost.samples += 1;
}

function renderFrame(time) {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  // En mode simple, la scène n'est pas affichée : on ne calcule rien.
  if (simple || !layout) return;
  const now = performance.now();
  timed('entities', () => {
    for (const record of entities.values()) {
      applyStation(record, now);
      record.entity.update(dt);
      for (const villager of record.villagers.values()) villager.update(dt);
      emitAmbient(record, dt);
      world.updateRoom(record.data, now);
    }
  });
  timed('world', () => {
    world.updatePortals(state.accounts ?? [], now);
    world.animate(now);
    expireDepartures(now);
    emitZoneParticles(dt);
  });
  timed('environment', () => updateEnvironment(dt));
  timed('particles', () => particles.update(dt));
  updateCamera(dt);
  timed('render', () => renderer.render(scene, camera));
  timed('labels', () => labels.update(camera, viewport.width, viewport.height));
}

// Temps passé par étape sur la seconde écoulée, pour minetokencraft.perf().
function timed(name, run) {
  const started = performance.now();
  run();
  frameCost.parts[name] = (frameCost.parts[name] ?? 0) + performance.now() - started;
}

function resize() {
  viewport = { width: stage.clientWidth, height: stage.clientHeight };
  if (viewport.width < 2 || viewport.height < 2) return;
  renderer.setSize(viewport.width, viewport.height, false);
  relayout();
}

function setSimple(value) {
  simple = value;
  simpleToggle.checked = value;
  document.body.classList.toggle('simple', value);
  try {
    localStorage.setItem(SIMPLE_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Le choix ne survivra pas au rechargement.
  }
  if (!state) return;
  if (!value) resize();
  renderTexts();
}

async function start() {
  try {
    skinAssignments = JSON.parse(localStorage.getItem(SKINS_STORAGE_KEY) ?? '{}');
    simple = localStorage.getItem(SIMPLE_STORAGE_KEY) === '1';
  } catch {
    skinAssignments = {};
  }
  setSimple(simple);
  simpleToggle.addEventListener('change', () => setSimple(simpleToggle.checked));
  skins = await (await fetch('/assets/skins/index.json')).json();
  new ResizeObserver(resize).observe(stage);
  resize();
  if (DEMO) {
    startDemo();
  } else {
    // Premier affichage sans attendre le flux direct, qui peut mettre un moment à livrer son premier message.
    const initial = await (await fetch('/api/state')).json().catch(() => null);
    if (initial?.players && !state) applyState(initial);
    const source = new EventSource('/events');
    source.onmessage = (event) => paused || applyState(JSON.parse(event.data));
    source.onopen = () => (offline.hidden = true);
    source.onerror = () => (offline.hidden = false);
  }
  setInterval(() => {
    if (!state) return;
    renderTexts();
    if (!simple) refreshLabels();
  }, REFRESH_TEXTS_MS);
  setInterval(() => state && alerts.remind(state.players), REMIND_MS);
  requestAnimationFrame(frame);
}

/**
 * Page de test : sessions factices, un sélecteur de scénario (thèmes des ailes) et des outils qui tournent.
 */
/**
 * Après un réglage (nom ou affichage d'un compte) : le serveur en tient compte au tour suivant, on va chercher l'état.
 */
function refreshState() {
  if (DEMO) return;
  setTimeout(async () => {
    const next = await (await fetch('/api/state')).json().catch(() => null);
    if (next?.players) applyState(next);
  }, STATE_REFRESH_DELAY_MS);
}

/**
 * Ramène le terminal d'une session (clic sur sa pièce ou sa carte) et dit ce qui a été fait.
 */
async function focusPlayer(id) {
  const player = state?.players.find((candidate) => candidate.id === id);
  if (!player) return;
  if (DEMO) {
    toasts.show(player.name, 'Page de test : pas de vrai terminal derrière cette session.', { ok: false });
    return;
  }
  try {
    const response = await fetch(`/api/focus/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    toasts.show(player.name, result.message, { ok: result.ok });
  } catch {
    toasts.show(player.name, 'Le serveur ne répond pas.', { ok: false });
  }
}

function openHistory(id) {
  const player = state?.players.find((candidate) => candidate.id === id);
  if (!player) return;
  history.open(player, async (playerId) => (DEMO ? demoHistory(player)
    : (await (await fetch(`/api/history/${encodeURIComponent(playerId)}`)).json()).events));
}

/**
 * Ce qu'il y a sous le pointeur : une créature d'abord, sinon la pièce où le rayon de la caméra touche le sol.
 */
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function aimAt(event) {
  if (!layout) return {};
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const mob = herd.mobAt(raycaster.ray);
  if (mob) return { mob };
  const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!hit) return {};
  const room = [...layout.rooms.values()].find((candidate) => hit.x >= candidate.x0 && hit.x <= candidate.x0 + candidate.width
    && hit.z >= candidate.z0 - 1 && hit.z <= candidate.z0 + ROOM_DEPTH + 1);
  return { room };
}

// Au-dessus d'une créature, le pointeur devient une épée en diamant.
let swordCursor = 'crosshair';
loadImage(`${TEXTURE_ROOT}item/diamond_sword.png`).then((image) => {
  const size = 32;
  const icon = document.createElement('canvas');
  icon.width = icon.height = size;
  const context = icon.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, size, size);
  swordCursor = `url(${icon.toDataURL()}) 29 3, crosshair`;
}).catch(() => {});

canvas.addEventListener('click', (event) => {
  const { mob, room } = aimAt(event);
  if (mob) herd.hit(mob, raycaster.ray);
  else if (room?.player) focusPlayer(room.player.id);
});
canvas.addEventListener('mousemove', (event) => {
  const { mob, room } = aimAt(event);
  canvas.style.cursor = mob ? swordCursor : room?.player ? 'pointer' : 'default';
  showTooltip(!mob && room?.player ? entities.get(room.player.id)?.data ?? room.player : null, event);
});
canvas.addEventListener('mouseleave', () => showTooltip(null));

/**
 * Infobulle de la pièce survolée, façon infobulle d'objet Minecraft, à côté du pointeur sans sortir de la scène.
 */
function showTooltip(player, event) {
  tooltip.hidden = !player;
  if (!player) return;
  tooltip.innerHTML = sessionTooltip(player);
  const stageBox = stage.getBoundingClientRect();
  const x = Math.min(event.clientX - stageBox.left + TOOLTIP_OFFSET_PX, stageBox.width - tooltip.offsetWidth - 4);
  const y = Math.min(event.clientY - stageBox.top + TOOLTIP_OFFSET_PX, stageBox.height - tooltip.offsetHeight - 4);
  tooltip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

function startDemo() {
  const select = document.createElement('select');
  select.id = 'demo-scenario';
  select.innerHTML = DEMO_SCENARIOS.map((scenario) => `<option value="${scenario.id}">${escapeHtml(scenario.label)}</option>`).join('');
  const tag = document.createElement('span');
  tag.className = 'demo-tag';
  tag.textContent = 'Page de test';
  document.getElementById('toolbar').append(tag, select);
  let tick = 0;
  // « Faire partir » retire une session au travail le temps de voir le joueur quitter l'île et sa pièce disparaître.
  const hidden = new Set();
  // Heure, météo et saison forcées, pour voir chaque ambiance sans attendre qu'elle arrive.
  const environmentSelects = [
    ['hour', [['', 'Heure réelle'], ['9', 'Matin'], ['13', 'Midi'], ['18.6', 'Coucher'], ['23', 'Nuit']]],
    ['condition', [['', 'Météo réelle'], ['clear', 'Soleil'], ['cloudy', 'Nuageux'], ['rain', 'Pluie'], ['storm', 'Orage'], ['snow', 'Neige'], ['fog', 'Brouillard']]],
    ['season', [['', 'Saison réelle'], ...SEASONS.map((season) => [season, { winter: 'Hiver', spring: 'Printemps', summer: 'Été', autumn: 'Automne' }[season]])]],
  ];
  for (const [key, options] of environmentSelects) {
    const control = document.createElement('select');
    control.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    control.addEventListener('change', () => {
      envOverride = { ...envOverride, [key]: control.value === '' ? undefined : key === 'hour' ? Number(control.value) : control.value };
    });
    document.getElementById('toolbar').append(control);
  }
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.textContent = 'Faire partir une session';
  leave.addEventListener('click', () => {
    hidden.add('demo:4');
    show();
    setTimeout(() => {
      hidden.delete('demo:4');
      show();
    }, 15000);
  });
  document.getElementById('toolbar').append(leave);
  const show = () => applyState(demoState(select.value, tick, { hidden }));
  select.addEventListener('change', show);
  setInterval(() => {
    tick += 1;
    show();
  }, DEMO_TICK_MS);
  show();
}

// Pour essayer les états depuis la console : minetokencraft.pause(), puis applyState() d'une copie modifiée de state().
window.minetokencraft = {
  scene,
  renderer,
  // Coût du rendu : appels de dessin, triangles, lumières, et temps moyen passé par image sur les dernières images.
  perf: () => ({
    ...renderer.info.render,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    pixelRatio: renderer.getPixelRatio(),
    size: [renderer.domElement.width, renderer.domElement.height],
    lights: scene.children.filter((child) => child.isLight).length + world.group.getObjectsByProperty('isPointLight', true).length,
    frameMs: frameCost.samples ? +(frameCost.total / frameCost.samples).toFixed(2) : null,
    drawn: (() => {
      const counts = {};
      scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isSprite && !object.isPoints && !object.isLine) return;
        let top = object;
        while (top.parent && top.parent !== scene) top = top.parent;
        const key = top === world.group ? (object.isInstancedMesh ? 'world:instanced' : 'world:meshes') : object.isSprite ? 'sprites' : top.type;
        counts[key] = (counts[key] ?? 0) + 1;
      });
      return counts;
    })(),
    fps: frameCost.fps,
    parts: frameCost.lastParts,
  }),
  applyState,
  state: () => structuredClone(state),
  pause: (value = true) => (paused = value),
  // Créatures par thème, avec leur position à l'écran (pour viser depuis la console) et leur vie.
  mobs: () => [...herd.groups.values()].map((group) => ({
    theme: group.theme,
    cells: group.cells.size,
    mobs: group.mobs.map((mob) => {
      const point = mob.root.position.clone().setY(mob.root.position.y + 0.5).project(camera);
      const rect = canvas.getBoundingClientRect();
      return { kind: mob.kind, health: mob.health, x: Math.round(rect.left + (point.x + 1) / 2 * rect.width), y: Math.round(rect.top + (1 - point.y) / 2 * rect.height) };
    }),
    queue: group.queue,
    respawns: group.respawns.map((respawn) => respawn.kind),
  })),
};

start();
