// D'où la page tire ses ressources. Servie par minetokencraft : le serveur local (chemins relatifs, API). En démo en
// ligne (GitHub Pages), la page de build déclare `window.MINETOKENCRAFT_SITE` : pas de serveur derrière, des sessions
// factices, des textures et des skins tirés de sources publiques.
const declared = window.MINETOKENCRAFT_SITE ?? {};

export const SITE = {
  standalone: Boolean(declared.standalone),
  textures: declared.textures ?? 'assets/textures/',
  skinsIndex: declared.skinsIndex ?? 'assets/skins/index.json',
  skins: declared.skins ?? 'assets/skins/',
};
