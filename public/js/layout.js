import { JOB_BLOCKS, professionFor } from './identity.js';
import { accountTheme } from './themes.js';

// Une grande maison sans toit, vue de trois quarts : une aile par compte, une pièce par session.
// Chaque rangée de pièces a un mur du fond haut (au nord) et des murets bas côté caméra, puis une allée.
// x vers la droite, z vers la caméra ; unité : le bloc. Le sol des pièces est en y = 0.

export const CAMERA_YAW = 0.5;
export const CAMERA_PITCH = 0.62;
export const ROOM_DEPTH = 5;
// Deux blocs : assez pour l'intérieur, et l'allée suffit à ce que le mur de la rangée suivante ne cache rien.
export const BACK_WALL = 2;
export const MAX_VILLAGERS_SHOWN = 6;
// Mur du fond, pièce, muret avant, allée : l'allée est assez large pour que le mur du fond de la rangée
// suivante ne cache pas l'intérieur de celle-ci, et que le panneau posé sur ce mur ne morde pas dessus.
const CORRIDOR = 4;
export const ROW_PITCH = 1 + ROOM_DEPTH + 1 + CORRIDOR;
// Partie du joueur, puis un bloc de métier tous les deux blocs pour ses villageois.
const PLAYER_AREA = 8;
const VILLAGER_SPACING = 2;
const HALL = 3;
// Jardin autour de la maison : derrière pour les arbres, sur les côtés pour les portails des quotas,
// étroit devant, côté caméra, où il ne ferait que réduire la maison à l'écran.
const MARGIN = { back: 4, left: 8, right: 8, front: 2 };
// Coin des portails d'une aile, sur le côté de la maison : le portail du Nether (quota 5 h), puis devant lui
// le cadre du portail de l'End (quota de la semaine).
const PORTAL_AREA = 6;
// Hauteurs à garder dans le cadre : le sol, et têtes + panneaux au-dessus des murs du fond.
const VIEW_BOTTOM = -1;
const VIEW_TOP = BACK_WALL + 3;

const FACING_CAMERA = 0;

// Postes du joueur, en décalage depuis le coin nord-ouest de l'intérieur de sa pièce. Les meubles forment
// un comptoir : le joueur se tient derrière, face à la caméra. `block` : case du meuble ; `spot` : où il se tient.
export const STATIONS = {
  library: { spot: [0.95, 1.0], yaw: 0.45 },
  carto: { block: [2, 2], spot: [2.5, 1.05], yaw: FACING_CAMERA },
  craft: { block: [4, 2], spot: [4.5, 1.05], yaw: FACING_CAMERA },
  furnace: { block: [6, 2], spot: [6.5, 1.05], yaw: FACING_CAMERA },
  chair: { block: [1, 3], spot: [1.5, 3.62], yaw: FACING_CAMERA },
  front: { spot: [3.5, ROOM_DEPTH - 0.55], yaw: 0.35 },
  supervise: { spot: [5.4, 3.4], yaw: 0.5 },
};
// Coin avant droit de la partie du joueur : le tas d'émeraudes (coût), puis les toiles d'araignée (contexte).
export const EMERALD_SPOTS = [[6, 4], [7, 4], [6, 3], [7, 3]];
export const COBWEB_SPOTS = [[-1, 0], [-2, 0], [0, 3], [5, 4]];
export const BOOKSHELF_X = [0, 1];
export const DOOR_X = [3, 4];

export function villagerSlot(index) {
  const x = PLAYER_AREA + index * VILLAGER_SPACING;
  return { block: [x, 2], spot: [x + 0.5, 1.05], yaw: FACING_CAMERA };
}

/**
 * Villageois affichés dans la pièce : ceux qui travaillent d'abord, dans la limite de la place.
 */
export function shownVillagers(player) {
  const ordered = [...player.villagers].sort((a, b) => (a.status === b.status ? 0 : a.status === 'working' ? -1 : 1));
  return ordered.slice(0, MAX_VILLAGERS_SHOWN).sort((a, b) => a.startedAt - b.startedAt);
}

const roomWidth = (player) => (player ? PLAYER_AREA + VILLAGER_SPACING * shownVillagers(player).length : PLAYER_AREA);

/**
 * Répartit les pièces d'une aile sur `rowCount` rangées de longueurs voisines, dans l'ordre.
 */
function splitIntoRows(rooms, rowCount) {
  const total = rooms.reduce((sum, room) => sum + room.width + 1, 0);
  const target = total / rowCount;
  const rows = [[]];
  let width = 0;
  for (const room of rooms) {
    if (rows.at(-1).length && width + room.width / 2 > target && rows.length < rowCount) {
      rows.push([]);
      width = 0;
    }
    rows.at(-1).push(room);
    width += room.width + 1;
  }
  return rows;
}

/**
 * Taille à l'écran (en blocs) de la boîte englobante, vue par la caméra.
 */
function screenSize(bounds) {
  const cy = Math.cos(CAMERA_YAW);
  const sy = Math.sin(CAMERA_YAW);
  const cp = Math.cos(CAMERA_PITCH);
  const sp = Math.sin(CAMERA_PITCH);
  const xs = [];
  const ys = [];
  for (const x of [bounds.x0, bounds.x1 + 1]) {
    for (const y of [bounds.y0, bounds.y1]) {
      for (const z of [bounds.z0, bounds.z1 + 1]) {
        xs.push(x * cy - z * sy);
        ys.push(-x * sp * sy + y * cp - z * sp * cy);
      }
    }
  }
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function place(groups, rowCount) {
  const rooms = new Map();
  const wings = [];
  let x = 0;
  for (const group of groups) {
    const candidates = group.players.length
      ? group.players.map((player) => ({ player, width: roomWidth(player) }))
      : [{ player: null, width: PLAYER_AREA }];
    const rows = splitIntoRows(candidates, Math.min(rowCount, candidates.length));
    const wing = { account: group.account, theme: accountTheme(group.account.usage), x0: x, rows: [] };
    rows.forEach((row, rowIndex) => {
      const back = rowIndex * ROW_PITCH;
      let rx = x + 1;
      const placedRow = { x0: x, back, z0: back + 1, rooms: [] };
      for (const { player, width } of row) {
        const room = {
          key: `${group.account.id}:${player?.id ?? 'vide'}`,
          account: group.account.id,
          player,
          x0: rx,
          z0: back + 1,
          width,
          villagers: player ? shownVillagers(player).map((villager, i) => ({
            id: villager.id,
            slot: villagerSlot(i),
            block: JOB_BLOCKS[professionFor(villager.type, villager.id)] ?? null,
          })) : [],
        };
        placedRow.rooms.push(room);
        if (player) rooms.set(player.id, room);
        rx += width + 1;
      }
      placedRow.x1 = rx - 1;
      wing.rows.push(placedRow);
    });
    wing.x1 = Math.max(...wing.rows.map((row) => row.x1));
    wing.depth = wing.rows.length * ROW_PITCH;
    wings.push(wing);
    x = wing.x1 + 1 + HALL;
  }
  const depth = Math.max(...wings.map((wing) => wing.depth));
  const bounds = {
    x0: -MARGIN.left,
    x1: x - HALL - 1 + MARGIN.right,
    y0: VIEW_BOTTOM,
    y1: VIEW_TOP,
    z0: -MARGIN.back,
    z1: depth - 1 + MARGIN.front,
  };
  // Zone de chaque aile, jardin compris : le thème (Nether, End) la couvre jusqu'au milieu de l'allée voisine.
  wings.forEach((wing, index) => {
    wing.zone = {
      x0: index === 0 ? bounds.x0 : wing.x0 - Math.ceil(HALL / 2),
      x1: index === wings.length - 1 ? bounds.x1 : wing.x1 + Math.floor(HALL / 2),
    };
    // Portails de la première aile à gauche de la maison, ceux de la dernière à droite.
    if (index === 0) wing.portals = { x0: wing.x0 - 1 - PORTAL_AREA };
    else if (index === wings.length - 1) wing.portals = { x0: wing.x1 + 2 };
  });
  return { wings, rooms, bounds, depth, hall: HALL };
}

/**
 * Plan de la maison : parmi les nombres de rangées possibles, celui qui affiche les personnages le plus grand.
 */
export function computeLayout(players, accounts, viewport) {
  const groups = accounts.map((account) => ({
    account,
    players: players
      .filter((player) => player.account === account.id && player.status !== 'sleeping')
      .sort((a, b) => a.project.localeCompare(b.project) || (a.startedAt ?? 0) - (b.startedAt ?? 0)),
  }));
  const maxRows = Math.max(1, ...groups.map((group) => group.players.length));
  let best = null;
  for (let rowCount = 1; rowCount <= maxRows; rowCount++) {
    const layout = place(groups, rowCount);
    const size = screenSize(layout.bounds);
    const scale = Math.min(viewport.width / size.width, viewport.height / size.height);
    if (!best || scale > best.scale + 0.01) best = { layout, scale };
  }
  const { layout } = best;
  layout.signature = JSON.stringify(layout.wings.map((wing) => [wing.theme, wing.rows.map((row) => row.rooms.map((room) => [
    room.x0, room.z0, room.width, Boolean(room.player), Boolean(room.player?.tasks?.total), room.villagers.map((v) => v.block),
  ]))]));
  return layout;
}
