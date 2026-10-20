// Ce que dit le serveur lui-même, en français : notifications macOS et ligne de commande. Mêmes clés que l'anglais.
export default {
  'notify.waiting': 'Un Claude t\'attend',
  'notify.done': 'Un Claude a fini',
  'notify.stuck': 'Un Claude semble bloqué',
  'notify.stuckText': '{name} : rien depuis plusieurs minutes',
  'notify.fiveHour': 'Quota 5 h épuisé',
  'notify.sevenDay': 'Quota de la semaine épuisé',
  'notify.quotaText': 'Les sessions de ce compte sont à l\'arrêt jusqu\'à la remise à zéro.',

  'cli.firstRun': 'Premier lancement : téléchargement des textures, de la police et des skins…',
  'cli.starting': 'Démarrage du serveur…',
  'cli.noAnswer': 'Le serveur ne répond pas. Journal : {log}',
  'cli.stopped': 'Serveur arrêté.',
  'cli.notRunning': 'Aucun serveur lancé par minetokencraft ne tourne.',
  'cli.usage': 'Usage : minetokencraft [demo | stop | serve | autostart on|off|status | assets | statusline]',
  'cli.autostartOn': 'Démarrage automatique installé : {plist}\nJournal : {log}',
  'cli.autostartOff': 'Démarrage automatique retiré.',
  'cli.autostartActive': 'Actif ({plist})',
  'cli.autostartInactive': 'Inactif',
  'cli.autostartMacOnly': 'Le démarrage automatique passe par launchd : il n\'existe que sur macOS.',
  'cli.autostartUsage': 'Usage : minetokencraft autostart on | off | status',
};
