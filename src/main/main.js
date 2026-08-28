'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const sources = require('./sources');
const petLib = require('./pet');
const { startIngest } = require('./ingest');
const updates = require('./updates');

const POLL_MS = 8000;
const WINDOW = { width: 250, height: 330 };

let win = null;
let tray = null;
let store = null;
let pet = null;
let cursors = {};
let config = null;
let ingestServer = null;
let lastScan = { at: 0, bySource: {} };
let updateInfo = null;
let pendingVersion = null;

// Uma instância só. Com "abrir no login" ligado, abrir o app de novo pela mão
// criaria um segundo processo brigando pela porta 4736 e pelo mesmo cursors.json
// — dois escritores no mesmo offset corrompem a contagem em silêncio.
// A segunda instância informa a própria versão ao morrer. Sem isso, instalar
// uma versão nova e abrir o app dava a impressão de que nada aconteceu: a
// instância antiga continua na bandeja, segura a trava, e a nova sai calada —
// o usuário vê a janela velha, com o aviso velho de atualização.
if (!app.requestSingleInstanceLock({ version: app.getVersion() })) {
  app.quit();
  return;
}

app.on('second-instance', (_event, _argv, _cwd, extra) => {
  const incoming = extra?.version;
  if (incoming && updates.isNewer(incoming, app.getVersion())) {
    // Não dá para assumir o lugar da instância viva sem arriscar duas escritas
    // no mesmo cursors.json, então a saída é avisar e deixar a decisão com quem
    // está usando.
    pendingVersion = incoming;
    push();
  }
  revealWindow();
});

function userDataDir() {
  return app.getPath('userData');
}

/** Carrega a config do usuário, criando-a a partir do padrão na primeira vez. */
function loadConfig() {
  const target = path.join(userDataDir(), 'sources.json');
  const fallback = path.join(__dirname, '..', '..', 'config', 'default-sources.json');
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    const defaults = JSON.parse(fs.readFileSync(fallback, 'utf8'));
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    x: display.x + display.width - WINDOW.width - 28,
    y: display.y + 28,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
}

/** Ícone 16x16 desenhado na mão para a barra de menus (template = segue o tema do macOS). */
function trayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const rows = [
    '................',
    '................',
    '....########....',
    '...##########...',
    '..############..',
    '..##..####..##..',
    '..##..####..##..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....##....##....',
    '....##....##....',
    '....##....##....',
    '................',
    '................'
  ];
  // Só o macOS entende "template image" (silhueta que o sistema inverte conforme
  // o tema da barra). No Windows e no Linux ela seria desenhada preta como está,
  // sumindo em qualquer bandeja escura — por isso lá vai a cor do bichinho, que
  // se enxerga tanto em fundo claro quanto escuro.
  const isMac = process.platform === 'darwin';
  const [r, g, b] = isMac ? [0, 0, 0] : [0xc4, 0x9a, 0x78];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = rows[y][x] === '#';
      const i = (y * size + x) * 4;
      buffer[i] = b; // B
      buffer[i + 1] = g; // G
      buffer[i + 2] = r; // R
      buffer[i + 3] = on ? 255 : 0; // A
    }
  }
  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size });
  if (isMac) image.setTemplateImage(true);
  return image;
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function buildTrayMenu() {
  const snap = petLib.snapshot(pet);
  const sourceItems = Object.entries(lastScan.bySource).map(([id, data]) => ({
    label: `${data.label}${data.estimated ? ' (estimado)' : ''} — ${data.files} arquivo(s)`,
    enabled: false
  }));

  return Menu.buildFromTemplate([
    { label: `${snap.name} · ${snap.stageLabel} · ${snap.mood}`, enabled: false },
    // Versão à vista: sem isso não dá para perceber que a janela na tela é de
    // uma instância antiga que ficou para trás.
    { label: `versão ${app.getVersion()}`, enabled: false },
    {
      label: snap.dead
        ? 'Morreu de fome'
        : `Saciedade ${snap.satiety}% · Saúde ${snap.health}%`,
      enabled: false
    },
    { label: `Hoje: ${formatTokens(snap.tokensToday)} tokens`, enabled: false },
    { type: 'separator' },
    ...(sourceItems.length ? sourceItems : [{ label: 'Nenhuma fonte encontrada', enabled: false }]),
    { type: 'separator' },
    {
      label: win && win.isVisible() ? 'Esconder bichinho' : 'Mostrar bichinho',
      click: () => toggleWindow()
    },
    ...(pendingVersion
      ? [
          {
            label: `Versão ${pendingVersion} instalada — sair para usá-la`,
            click: () => app.quit()
          },
          { type: 'separator' }
        ]
      : []),
    ...(!pendingVersion && updateInfo?.available
      ? [
          {
            label: `Baixar a versão ${updateInfo.latest}`,
            click: () => shell.openExternal(updateInfo.url)
          },
          { type: 'separator' }
        ]
      : []),
    {
      label: 'Renomear o bichinho…',
      click: () => {
        revealWindow();
        if (win && !win.isDestroyed()) win.webContents.send('pet:rename-request');
      }
    },
    {
      label: 'Chocar um novo ovo',
      click: () => hatch()
    },
    ...(SUPPORTS_LOGIN_ITEM
      ? [
          {
            label: 'Abrir no login',
            type: 'checkbox',
            checked: isOpenAtLogin(),
            click: (item) => setOpenAtLogin(item.checked)
          }
        ]
      : []),
    {
      label: 'Abrir pasta de dados',
      click: () => shell.openPath(userDataDir())
    },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]);
}

/**
 * Traz a janela de volta seja qual for o estado em que ela sumiu:
 * escondida pelo tray, minimizada pelo Cmd+M ou atrás de outra janela.
 * `show()` sozinho não desfaz um minimize — daí o restore() antes.
 */
function revealWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function toggleWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else revealWindow();
}

// Electron só implementa item de login no macOS e no Windows. No Linux a chamada
// é silenciosamente inócua, então lá o item nem aparece no menu — melhor não ter
// a opção do que ter um checkbox que mente.
const SUPPORTS_LOGIN_ITEM = process.platform === 'darwin' || process.platform === 'win32';

function isOpenAtLogin() {
  if (!SUPPORTS_LOGIN_ITEM) return false;
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return false;
  }
}

function setOpenAtLogin(value) {
  if (!SUPPORTS_LOGIN_ITEM) return;
  try {
    app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true });
  } catch (err) {
    console.error('[tokengotchi] não consegui alterar o item de login:', err.message);
  }
}

function hatch() {
  const generation = (pet?.generation || 0) + 1;
  pet = petLib.freshPet(Date.now(), generation);
  store.savePet(pet);
  push();
}

/**
 * O estado que o renderer recebe, num lugar só. Antes cada caminho montava o
 * seu: o push trazia scan e update, o snapshot só o scan, e o hatch nenhum dos
 * dois — então recarregar a janela fazia o aviso de versão sumir até o próximo
 * ciclo de varredura.
 */
function rendererState() {
  const snap = petLib.snapshot(pet);
  snap.scan = lastScan;
  snap.update = updateInfo;
  snap.version = app.getVersion();
  snap.pendingVersion = pendingVersion;
  return snap;
}

function push() {
  const snap = rendererState();
  if (win && !win.isDestroyed()) win.webContents.send('pet:state', snap);
  if (tray) {
    tray.setToolTip(`${snap.name} — saciedade ${snap.satiety}%, saúde ${snap.health}%`);
    tray.setContextMenu(buildTrayMenu());
  }
}

/**
 * Única saída de rede do app. Desligável em `updates.enabled` no sources.json;
 * quem não quiser nenhum tráfego põe false e nada é requisitado.
 */
async function checkUpdates() {
  if (config.updates?.enabled === false) return;
  try {
    const found = await updates.checkForUpdate({
      currentVersion: app.getVersion(),
      userAgent: `Tokengotchi/${app.getVersion()}`
    });
    // Resultado nulo é falha de rede: mantém o que já se sabia em vez de
    // piscar. Resultado válido manda, inclusive para APAGAR um aviso que não
    // vale mais — sem isso a faixa ficava presa até reiniciar o app.
    if (found) {
      updateInfo = found.available ? found : null;
      push();
    }
  } catch (err) {
    console.error('[tokengotchi] checagem de versão falhou:', err.message);
  }
}

/**
 * Detecta o bundle sendo trocado embaixo do processo em execução — o que
 * acontece ao arrastar a versão nova para Aplicativos com o app aberto. Aqui
 * não há segunda instância para avisar: ninguém abriu nada, os arquivos é que
 * mudaram. Sem isto, o app seguiria rodando código antigo indefinidamente,
 * anunciando uma atualização que já está instalada.
 */
function checkBundleReplaced() {
  const onDisk = updates.installedVersion({
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: app.getPath('exe'),
    readFile: fs.readFileSync
  });
  if (!onDisk) return;

  // O aviso segue o disco nos dois sentidos. Antes só era ligado, nunca
  // desligado: uma vez aceso ficava até reiniciar o app, mesmo que a situação
  // já tivesse se resolvido — por exemplo se a versão anterior fosse
  // restaurada por cima.
  const alvo = onDisk === app.getVersion() ? null : onDisk;
  if (alvo !== pendingVersion) {
    pendingVersion = alvo;
    push();
  }
}

function scanAndTick(firstRun = false) {
  const now = Date.now();
  let harvest = { calories: 0, tokens: 0, bySource: {} };
  try {
    harvest = sources.collect(config, cursors, { now, firstRun });
  } catch (err) {
    console.error('[tokengotchi] falha ao varrer fontes:', err.message);
  }

  lastScan = { at: now, bySource: harvest.bySource };
  petLib.tick(pet, {
    calories: harvest.calories,
    tokens: harvest.tokens,
    bySource: harvest.bySource,
    now
  });

  store.savePet(pet);
  store.saveCursors(cursors);
  push();
}

function feedFromIngest(payload) {
  const usage = sources.normalizeUsage(payload) || sources.normalizeUsage(payload.usage);
  if (!usage) return { ok: false, error: 'informe input/output ou tokens' };

  const calories = sources.toCalories(usage);
  const tokens = sources.totalTokens(usage);
  const id = String(payload.source || 'externo');
  const label = String(payload.label || id);

  petLib.tick(pet, {
    calories,
    tokens,
    bySource: { [id]: { label, tokens, calories } },
    now: Date.now()
  });
  store.savePet(pet);
  push();

  return { ok: true, tokens, calories, satiety: Math.round(pet.satiety) };
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  store = new petLib.Store(userDataDir());
  config = loadConfig();
  cursors = store.loadCursors();

  const loaded = store.loadPet();
  pet = loaded.pet;
  const firstRun = loaded.isNew && Object.keys(cursors).length === 0;

  createWindow();
  tray = new Tray(trayIcon());
  tray.setContextMenu(buildTrayMenu());

  scanAndTick(firstRun);
  setInterval(() => scanAndTick(false), POLL_MS);

  // Barato (uma leitura de arquivo local), então roda junto da varredura:
  // quem arrasta o app novo para Aplicativos vê o aviso em segundos.
  checkBundleReplaced();
  setInterval(checkBundleReplaced, 15_000);

  // Atrasada para não competir com a abertura da janela, e repetida para quem
  // deixa o app semanas aberto.
  setTimeout(checkUpdates, 4000);
  const updateHours = config.updates?.checkIntervalHours ?? 24;
  setInterval(checkUpdates, Math.max(1, updateHours) * 3_600_000);

  if (config.ingest?.enabled !== false) {
    ingestServer = startIngest({
      port: config.ingest?.port || 4736,
      onFeed: feedFromIngest,
      // O mesmo estado que a janela recebe, e não só o do bichinho: sem
      // version/update/pendingVersion aqui, não havia como diagnosticar de
      // fora por que a faixa de atualização estava aparecendo.
      getStatus: () => rendererState(),
      onReveal: () => revealWindow(),
      onHide: () => {
        if (win && !win.isDestroyed()) win.hide();
      }
    });
  }

  app.on('activate', () => revealWindow());
});

app.on('window-all-closed', (event) => {
  // Fechar a janela não mata o bichinho: ele continua na barra de menus.
  event?.preventDefault?.();
});

app.on('before-quit', () => {
  if (ingestServer) ingestServer.close();
  if (pet && store) store.savePet(pet);
});

ipcMain.handle('pet:rename', (_event, name) => {
  const applied = petLib.renamePet(pet, name);
  store.savePet(pet);
  push();
  return applied;
});

ipcMain.handle('pet:hatch', () => {
  hatch();
  return rendererState();
});

ipcMain.handle('pet:snapshot', () => rendererState());

ipcMain.on('window:hide', () => {
  if (win) win.hide();
});

ipcMain.on('window:quit', () => app.quit());

ipcMain.on('app:quit-for-update', () => app.quit());

ipcMain.on('update:open', () => {
  // Só abre a URL que veio da API do GitHub, nunca uma vinda do renderer.
  if (updateInfo?.url) shell.openExternal(updateInfo.url);
  else shell.openExternal(updates.RELEASES_PAGE);
});
