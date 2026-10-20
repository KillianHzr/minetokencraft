import { JOB_BLOCKS, professionFor } from './identity.js';
import { accountTheme } from './themes.js';

// A big house without a roof, seen from three-quarters: one wing per account, one room per session.
// Each row of rooms has a tall back wall (to the north) and low walls on the camera side, then an aisle.
// x to the right, z toward the camera; unit: the block. The floor of the rooms is at y = 0.

export const CAMERA_YAW = 0.5;
export const CAMERA_PITCH = 0.62;
export const ROOM_DEPTH = 5;
// Two blocks: enough for the interior, and the aisle is wide enough that the next row's wall hides nothing.
export const BACK_WALL = 2;
export const MAX_VILLAGERS_SHOWN = 6;
// Back wall, room, front low wall, aisle: the aisle is wide enough that the back wall of the next row
// does not hide the interior of this one, and that the sign on this wall does not bite into it.
const CORRIDOR = 4;
export const ROW_PITCH = 1 + ROOM_DEPTH + 1 + CORRIDOR;
// The player's part, then one block of trade every two blocks for its villagers.
const PLAYER_AREA = 8;
const VILLAGER_SPACING = 2;
const HALL = 3;
// Garden around the house: behind for the trees, on the sides for the quota portals,
// narrow in front, on the camera side, where it would only shrink the house on screen.
const MARGIN = { back: 4, left: 8, right: 8, front: 2 };
// Corner of a wing's portals, on the side of the house: the Nether portal (5 h quota), then in front of it
// the End portal frame (weekly quota).
const PORTAL_AREA = 6;
// Heights to keep in frame: the ground, and heads + signs above the back walls.
const VIEW_BOTTOM = -1;
const VIEW_TOP = BACK_WALL + 3;

const FACING_CAMERA = 0;

// Player stations, offset from the north-west corner of the inside of its room. The furniture forms
// a counter: the player stands behind it, facing the camera. `block`: the furniture's cell; `spot`: where it stands.
export const STATIONS = {
  library: { spot: [0.95, 1.0], yaw: 0.45 },
  carto: { block: [2, 2], spot: [2.5, 1.05], yaw: FACING_CAMERA },
  craft: { block: [4, 2], spot: [4.5, 1.05], yaw: FACING_CAMERA },
  furnace: { block: [6, 2], spot: [6.5, 1.05], yaw: FACING_CAMERA },
  chair: { block: [1, 3], spot: [1.5, 3.62], yaw: FACING_CAMERA },
  front: { spot: [3.5, ROOM_DEPTH - 0.55], yaw: 0.35 },
  supervise: { spot: [5.4, 3.4], yaw: 0.5 },
};
// Front right corner of the player's part: the emerald pile (cost), then the cobwebs (context).
export const EMERALD_SPOTS = [[6, 4], [7, 4], [6, 3], [7, 3]];
export const COBWEB_SPOTS = [[-1, 0], [-2, 0], [0, 3], [5, 4]];
export const BOOKSHELF_X = [0, 1];
export const DOOR_X = [3, 4];

export function villagerSlot(index) {
  const x = PLAYER_AREA + index * VILLAGER_SPACING;
  return { block: [x, 2], spot: [x + 0.5, 1.05], yaw: FACING_CAMERA };
}

/**
 * Villagers shown in the room: the working ones first, within the available space.
 */
export function shownVillagers(player) {
  const ordered = [...player.villagers].sort((a, b) => (a.status === b.status ? 0 : a.status === 'working' ? -1 : 1));
  return ordered.slice(0, MAX_VILLAGERS_SHOWN).sort((a, b) => a.startedAt - b.startedAt);
}

const roomWidth = (player) => (player ? PLAYER_AREA + VILLAGER_SPACING * shownVillagers(player).length : PLAYER_AREA);

/**
 * Distributes the rooms of a wing over `rowCount` rows of similar lengths, in order.
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
 * On-screen size (in blocks) of the bounding box, as seen by the camera.
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
  // Area of each wing, garden included: the theme (Nether, End) covers it up to the middle of the neighboring aisle.
  wings.forEach((wing, index) => {
    wing.zone = {
      x0: index === 0 ? bounds.x0 : wing.x0 - Math.ceil(HALL / 2),
      x1: index === wings.length - 1 ? bounds.x1 : wing.x1 + Math.floor(HALL / 2),
    };
    // Portals of the first wing to the left of the house, those of the last one to the right.
    if (index === 0) wing.portals = { x0: wing.x0 - 1 - PORTAL_AREA };
    else if (index === wings.length - 1) wing.portals = { x0: wing.x1 + 2 };
  });
  return { wings, rooms, bounds, depth, hall: HALL };
}

/**
 * Plan of the house: among the possible numbers of rows, the one that displays the characters biggest.
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
