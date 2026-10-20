// What the server says itself, in English: desktop notifications and the command line. Same keys in every language.
export default {
  'notify.waiting': 'A Claude is waiting for you',
  'notify.done': 'A Claude is done',
  'notify.stuck': 'A Claude looks stuck',
  'notify.stuckText': '{name}: nothing for several minutes',
  'notify.fiveHour': '5-hour quota spent',
  'notify.sevenDay': 'Weekly quota spent',
  'notify.quotaText': 'Sessions of this account are on hold until the quota resets.',

  'cli.firstRun': 'First run: downloading textures, font and skins…',
  'cli.starting': 'Starting the server…',
  'cli.noAnswer': 'The server does not answer. Log: {log}',
  'cli.stopped': 'Server stopped.',
  'cli.notRunning': 'No server started by minetokencraft is running.',
  'cli.usage': 'Usage: minetokencraft [demo | stop | serve | autostart on|off|status | assets | statusline]',
  'cli.autostartOn': 'Start at login installed: {file}\nLog: {log}',
  'cli.autostartOff': 'Start at login removed.',
  'cli.autostartActive': 'On ({file})',
  'cli.autostartInactive': 'Off',
  'cli.autostartUnsupported': 'Start at login is available on macOS (launchd) and Linux (systemd).',
  'cli.autostartUsage': 'Usage: minetokencraft autostart on | off | status',
};
