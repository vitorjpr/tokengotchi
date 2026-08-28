'use strict';

const https = require('https');

/**
 * Aviso de versão nova.
 *
 * Este é o ÚNICO ponto do app que fala com a rede: um GET no endpoint público
 * de releases do GitHub. Nada do bichinho é enviado — nem tokens, nem contagens,
 * nem identificador. O GitHub vê o que veria em qualquer visita: o IP e o
 * User-Agent. Dá para desligar em `updates.enabled` no sources.json.
 *
 * A lógica de comparação fica separada da rede de propósito, para o selftest
 * exercitá-la sem precisar de conexão.
 */

const RELEASES_API = 'https://api.github.com/repos/vitorjpr/tokengotchi/releases/latest';
const RELEASES_PAGE = 'https://github.com/vitorjpr/tokengotchi/releases/latest';

/** Aceita "v1.2.3" e "1.2.3"; ignora sufixos de pré-lançamento. */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 se a < b, 0 se iguais, 1 se a > b. Null em qualquer entrada inválida. */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
  }
  return 0;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) === 1;
}

/**
 * Traduz a resposta do GitHub no que a interface precisa saber.
 * Rascunho e pré-lançamento nunca viram aviso: quem baixa é usuário final.
 */
function parseRelease(release, currentVersion) {
  if (!release || typeof release !== 'object') return null;
  if (release.draft === true || release.prerelease === true) return null;

  const latest = parseVersion(release.tag_name);
  if (!latest) return null;

  const latestLabel = latest.join('.');
  return {
    available: isNewer(latestLabel, currentVersion),
    latest: latestLabel,
    current: currentVersion,
    url: typeof release.html_url === 'string' ? release.html_url : RELEASES_PAGE
  };
}

function fetchLatestRelease({ timeoutMs = 8000, userAgent = 'Tokengotchi' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const request = https.get(
      RELEASES_API,
      {
        headers: {
          // O GitHub recusa requisição sem User-Agent.
          'User-Agent': userAgent,
          Accept: 'application/vnd.github+json'
        }
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          done(null);
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          // Resposta absurda é resposta suspeita: corta.
          if (body.length > 512 * 1024) {
            request.destroy();
            done(null);
          }
        });
        response.on('end', () => {
          try {
            done(JSON.parse(body));
          } catch {
            done(null);
          }
        });
      }
    );

    // Sem rede, atrás de proxy, offline: o app não pode nem travar nem reclamar.
    request.on('error', () => done(null));
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      done(null);
    });
  });
}

async function checkForUpdate({ currentVersion, timeoutMs, userAgent } = {}) {
  const release = await fetchLatestRelease({ timeoutMs, userAgent });
  if (!release) return null;
  return parseRelease(release, currentVersion);
}

/**
 * Versão declarada num Info.plist do macOS. O arquivo gerado pelo
 * electron-builder é XML de texto, então não precisa de parser de plist.
 */
function parseInfoPlistVersion(text) {
  if (typeof text !== 'string') return null;
  const match =
    /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
  if (!match) return null;
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

/**
 * Versão do app INSTALADO EM DISCO, que pode não ser a que está em execução.
 *
 * No macOS, arrastar a versão nova para Aplicativos troca os arquivos embaixo
 * do processo vivo: ele segue com o código antigo em memória, sem saber de
 * nada. Comparar esta leitura com app.getVersion() revela isso.
 *
 * Só macOS: no Windows o executável fica travado enquanto roda (e o instalador
 * NSIS fecha o app antes de trocar), e no Linux o AppImage em execução está
 * montado a partir de uma cópia, então substituir o arquivo não altera o que
 * está rodando. Nesses casos devolve null e o app não tenta adivinhar.
 */
function installedVersion({ platform, isPackaged, execPath, readFile } = {}) {
  if (!isPackaged || platform !== 'darwin') return null;
  if (typeof execPath !== 'string') return null;

  const marker = '/Contents/MacOS/';
  const at = execPath.indexOf(marker);
  if (at === -1) return null;

  try {
    return parseInfoPlistVersion(readFile(`${execPath.slice(0, at)}/Contents/Info.plist`, 'utf8'));
  } catch {
    // App movido, removido ou sendo substituído neste instante: sem palpite.
    return null;
  }
}

module.exports = {
  RELEASES_PAGE,
  RELEASES_API,
  parseVersion,
  parseInfoPlistVersion,
  installedVersion,
  compareVersions,
  isNewer,
  parseRelease,
  fetchLatestRelease,
  checkForUpdate
};
