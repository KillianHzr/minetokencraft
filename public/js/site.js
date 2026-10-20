// Where the page gets its resources from. Served by minetokencraft: the local server (relative paths, API). In the online
// demo (GitHub Pages), the build page declares `window.MINETOKENCRAFT_SITE`: no server behind it, fake sessions,
// and textures and skins taken from public sources.
const declared = window.MINETOKENCRAFT_SITE ?? {};

export const SITE = {
  standalone: Boolean(declared.standalone),
  textures: declared.textures ?? 'assets/textures/',
  skinsIndex: declared.skinsIndex ?? 'assets/skins/index.json',
  skins: declared.skins ?? 'assets/skins/',
};
