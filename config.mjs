import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const PORT = Number(process.env.MINETOKENCRAFT_PORT || process.env.PORT) || 4747;
// La page montre des extraits de conversation : le serveur n'écoute que la machine locale.
export const HOST = '127.0.0.1';

// Réglages (comptes, clés de session, notifications) et données de travail (historique des quotas).
export const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'minetokencraft');
export const CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'minetokencraft');
// Textures, police et skins téléchargés au premier lancement : chez l'utilisateur, le dossier d'installation pouvant
// être en lecture seule.
export const ASSETS_DIR = path.join(CACHE_DIR, 'assets');

// Copies du JSON que Claude Code passe à la status line (contexte, quotas), une par session, rangées par compte :
// `<compte>/<session>.json`. Elles sont déposées par scripts/statusline.mjs.
export const STATUSLINE_DIR = path.join(CACHE_DIR, 'statusline');
// Copie d'une session fermée depuis une semaine : on la supprime.
export const STATUSLINE_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const POLL_MS = 1000;
// Une session qui a fini depuis plus longtemps que ça passe en inactive : plus de pièce, une ligne dans le panneau.
export const DORMANT_AFTER_MS = 60 * 60 * 1000;
// Un statut busy que rien n'a rafraîchi depuis ce délai est périmé.
export const BUSY_STALE_MS = 30 * 60 * 1000;
// Un villageois qui a fini reste ce temps-là auprès de son joueur avant de repartir.
export const VILLAGER_LINGER_MS = 15 * 60 * 1000;
// Un sous-agent qui n'a rien écrit depuis ce délai est considéré comme arrêté.
export const VILLAGER_STALE_MS = 20 * 60 * 1000;

// Octets lus à la fin d'un transcript : assez pour retrouver le titre, le dernier message et l'outil en cours.
export const SESSION_TAIL_BYTES = 768 * 1024;
export const VILLAGER_TAIL_BYTES = 128 * 1024;

// Un Claude qui t'attend depuis plus longtemps que ça passe en alerte renforcée.
export const WAITING_URGENT_MS = 5 * 60 * 1000;
// Une session au travail qui n'a rien écrit depuis ce délai est peut-être bloquée.
export const STUCK_AFTER_MS = 8 * 60 * 1000;
// Statut git d'un dossier : recalculé au plus toutes les 10 s (les gros dépôts sont lents).
export const GIT_REFRESH_MS = 10 * 1000;

// Prévision de quota : tendance calculée sur la dernière heure d'échantillons.
export const FORECAST_WINDOW_MS = 60 * 60 * 1000;
export const USAGE_SAMPLE_MS = 60 * 1000;

// Météo réelle (Open-Meteo, sans clé) : la ville réglée, sinon celle du fuseau horaire de la machine.
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;
// Comptes : les dossiers de config Claude Code sont recherchés à nouveau toutes les minutes.
export const ACCOUNTS_REFRESH_MS = 60 * 1000;
// Quotas lus auprès d'Anthropic : toutes les 2 minutes ; après un refus pour excès de requêtes, on espace.
export const LIMITS_REFRESH_MS = 2 * 60 * 1000;
export const LIMITS_BACKOFF_MS = 5 * 60 * 1000;
export const LIMITS_BACKOFF_MAX_MS = 60 * 60 * 1000;
