# Como lançar uma versão nova

O release é um **build local** na máquina de quem publica, com [mise](https://mise.jdx.dev)
e [`gh`](https://cli.github.com). O arquivo `.github/workflows/release.yml` continua
no repositório, mas o workflow está **desligado** (`disabled_manually`) em
`davartec/tokengotchi` e em `vitorjpr/tokengotchi`. Ele não é o caminho de
publicação.

Empurrar uma tag `v*` **não** compila e **não** publica. A tag não dispara o
`ci.yml`, e também não depende do `release.yml`.

O código do app mora em `davartec/tokengotchi`. Os binários que o app anuncia
saem em `vitorjpr/tokengotchi` Releases — é o endpoint em `src/main/updates.js`.

A tag é anotada (`git tag -a`). O nome é `v` + a versão do `package.json` no
commit que ela aponta.

## O procedimento

Escolha o número da versão ([semver](https://semver.org/lang/pt-BR/)):

| Mudança | Número | Exemplo |
| --- | --- | --- |
| Só correção de bug | patch | `0.5.2` → `0.5.3` |
| Feature nova de usuário | minor | `0.5.2` → `0.6.0` |
| Quebra algo (perde o bichinho, muda o formato do `pet.json`) | major | `0.5.2` → `1.0.0` |

Não compile, não marque tag e não publique a partir do branch do bump. O SHA
do release é o commit que ficou em `main` depois do merge.

### 1. Pull request de bump na davartec, Audit, merge em `main`

No branch do bump, com a árvore limpa:

```bash
# atualiza package.json E package-lock.json; não cria tag
mise exec -- npm version 0.6.0 --no-git-tag-version

git add package.json package-lock.json
git commit -m "v0.6.0"
```

Abra o pull request em `davartec/tokengotchi`. Espere o Audit. Faça o merge em
`main`. O Ubuntu do pull request (`test (ubuntu-latest)`) não autoriza o build.

Depois do merge, o SHA do release é a ponta de `main`:

```bash
git fetch origin main
git rev-parse origin/main
git show origin/main:package.json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).version"
```

A versão tem que ser `0.6.0`. Se o merge for squash ou um merge commit, o SHA
de `main` é outro: é esse que segue para o `test-native`, não a ponta do
branch do pull request.

### 2. `test-native` verde nesse SHA

Antes de compilar, esse SHA de `main` precisa de um job `test-native` verde.
Ele roda o selftest e o doctor no macOS e no Windows. Só dispara assim:

- `workflow_dispatch` do `ci.yml` com `main` ainda nesse SHA
- ou push **desse mesmo SHA** para um branch `release/**`

```bash
SHA=$(git rev-parse origin/main)

# Caminho A — main ainda é $SHA
mise exec -- gh workflow run ci.yml --ref main

# Caminho B — o mesmo commit, sem abrir pull request
git push origin "$SHA":refs/heads/release/v0.6.0
```

Um pull request, mesmo saindo de `release/**`, não conta: o evento
`pull_request` usa `refs/pull/N/merge` e o `test-native` fica pulado. O job
`test (ubuntu-latest)` de `main` também não basta.

Confira que o run é desse SHA e que os dois checks passaram:

- `test-native (macos-latest)`
- `test-native (windows-latest)`

```bash
mise exec -- gh run list --workflow=ci.yml --limit 10
mise exec -- gh run watch
```

### 3. Compilar esse SHA na máquina local

Checkout limpo do SHA do passo 2 (`npm ci`, não um `node_modules` velho). Os
scripts já passam `--publish never`. `CSC_IDENTITY_AUTO_DISCOVERY=false`
impede o electron-builder de pegar um certificado do chaveiro.

```bash
git checkout "$SHA"
mise exec -- npm ci
CSC_IDENTITY_AUTO_DISCOVERY=false mise exec -- npm run dist:mac
CSC_IDENTITY_AUTO_DISCOVERY=false mise exec -- npm run dist:win
CSC_IDENTITY_AUTO_DISCOVERY=false mise exec -- npm run dist:linux
```

No macOS, os dois `.app` (arm64 e x64) têm que passar no `codesign` e mostrar
`Signature=adhoc`. Veja [Assinatura](#assinatura). No pacote, leia os fuses
com `npx @electron/fuses read` — veja [Fuses](#fuses-proteção-contra-injeção).

Gere o `SHA256SUMS` dos arquivos que vão para o release:

```bash
cd dist
shasum -a 256 \
  Tokengotchi-0.6.0-arm64.dmg \
  Tokengotchi-0.6.0-x64.dmg \
  Tokengotchi-0.6.0-arm64-mac.zip \
  Tokengotchi-0.6.0-x64-mac.zip \
  Tokengotchi-0.6.0-win.zip \
  Tokengotchi-0.6.0-arm64-win.zip \
  tokengotchi_0.6.0_amd64.deb \
  tokengotchi_0.6.0_arm64.deb \
  > SHA256SUMS
cd ..
```

### 4. Pull request de espelho no vitorjpr, Audit, merge

Abra o espelho em `vitorjpr/tokengotchi`. A árvore do app (`src/`, `config/`,
`build/`, `package.json`, `package-lock.json`) é a do SHA da davartec que você
compilou, e a versão do `package.json` é a mesma. A v0.5.2 é o modelo: a tag
`v0.5.2` aponta para `ceac708` no repositório público, e a árvore do app desse
commit espelha `b23e6d0` na davartec.

Espere o Audit. Faça o merge. Não marque a tag antes desse merge. O SHA da
davartec não precisa existir no repositório público.

### 5. Tag anotada no commit desse merge

No checkout do `vitorjpr/tokengotchi`, no commit que o merge deixou:

```bash
git tag -a v0.6.0 -m "v0.6.0"
git push origin v0.6.0
```

Isso **não** liga o `release.yml` — ele está desligado nos dois repositórios.
A tag não dispara o `ci.yml`.

### 6. Publicar com `gh`, ainda como rascunho

Crie o release como rascunho e anexe os arquivos do build local. `--verify-tag`
recusa criar a tag sozinho a partir da ponta de `main` se ela ainda não existir.
`--draft` deixa `draft=true` até você publicar no passo explícito.

```bash
mise exec -- gh release create v0.6.0 \
  --repo vitorjpr/tokengotchi \
  --verify-tag \
  --draft \
  --title v0.6.0 \
  --notes-file notas.md \
  dist/Tokengotchi-0.6.0-arm64.dmg \
  dist/Tokengotchi-0.6.0-x64.dmg \
  dist/Tokengotchi-0.6.0-arm64-mac.zip \
  dist/Tokengotchi-0.6.0-x64-mac.zip \
  dist/Tokengotchi-0.6.0-win.zip \
  dist/Tokengotchi-0.6.0-arm64-win.zip \
  dist/tokengotchi_0.6.0_amd64.deb \
  dist/tokengotchi_0.6.0_arm64.deb \
  dist/SHA256SUMS
```

Enquanto `gh release view v0.6.0 --repo vitorjpr/tokengotchi` disser
`draft=true`, um arquivo faltando ou errado pode ser reenviado:

```bash
mise exec -- gh release upload v0.6.0 dist/arquivo-que-faltou --clobber \
  --repo vitorjpr/tokengotchi
```

`--clobber` só nesse rascunho. Quando os 9 arquivos estiverem certos, publique:

```bash
mise exec -- gh release edit v0.6.0 --repo vitorjpr/tokengotchi --draft=false --latest
```

Depois de `draft=false`, pare. Asset publicado não se troca. Veja
[Ativos imutáveis](#ativos-imutáveis).

### Conferir como visitante

Sem token, que é o teste que importa:

```bash
curl -s https://api.github.com/repos/vitorjpr/tokengotchi/releases/latest \
  | node -pe "const d=JSON.parse(require('fs').readFileSync(0)); \
      d.tag_name + ' draft=' + d.draft + ' arquivos=' + d.assets.length"
```

Tem que dizer `draft=false` e `arquivos=9` (os oito pacotes acima mais
`SHA256SUMS`). Os cortes locais desde a v0.5.0 estão assim.

### Depois de publicar

1. Audit dos assets (nomes, `SHA256SUMS`, `codesign`, `npx @electron/fuses read`).
2. Gate B: `site/downloads.json` só com URL HTTPS pública dessa release. Sem
   token e sem URL de release privado.
3. Redeploy do Worker de `tokengotchi.app`.
4. Conferência ao vivo: `releases/latest` com `draft=false` e a página servindo
   os links novos.

## Os nomes dos arquivos

O pacote é um arquivo por arquitetura. O macOS não sai como um único
universal (na v0.4.1 o `.dmg` e o `.zip` tinham 206 MB cada, com Intel e
Apple Silicon juntos). O instalador único do Windows também era um arquivo
só, de 190 MB, com x64 e arm64 embutidos.

Os nomes vêm do `package.json` (`build.mac`, `build.dmg`, `build.nsis`):

| Sistema | Arquivos |
| --- | --- |
| macOS | `Tokengotchi-<versão>-arm64.dmg`, `Tokengotchi-<versão>-x64.dmg`, `Tokengotchi-<versão>-arm64-mac.zip`, `Tokengotchi-<versão>-x64-mac.zip` |
| Windows | `Tokengotchi-Setup-<versão>-x64.exe`, `Tokengotchi-Setup-<versão>-arm64.exe`, `Tokengotchi-<versão>-win.zip`, `Tokengotchi-<versão>-arm64-win.zip` |
| Linux | `.AppImage` (x64 e arm64) e `tokengotchi_<versão>_amd64.deb`, `tokengotchi_<versão>_arm64.deb` |

O que os cortes locais publicam desde a v0.5.0 é o subconjunto da tabela que
entra no `gh release create` acima: os dois `.dmg`, os dois `-mac.zip`, os
dois zip do Windows, os dois `.deb` e o `SHA256SUMS`. Não entra o
`Setup.exe` do NSIS nem o `.AppImage`, mesmo que `npm run dist:win` /
`dist:linux` os gerem em `dist/`.

O pacote guarda só os idiomas `en-US`, `pt-BR` e `pt-PT` do Electron. O app
já é português, e o restante dos locales do Chromium não entra. No zip do
macOS arm64 isso deixa o arquivo em cerca de 108 MB, contra 206 MB do
universal da v0.4.1. O pacote de um processador só que o instalador do
Windows embute fica em cerca de 95 MB, contra 190 MB do Setup único.

**Ao adicionar um alvo novo de build**, inclua a extensão em duas listas ou o
arquivo é descartado em silêncio:

- `package.json` → `build.win.target` / `build.mac.target` / `build.linux.target`
- a lista de arquivos do `gh release create` (e o `SHA256SUMS`)

O `path:` de artefatos do `release.yml` não publica mais nada.

## Ativos imutáveis

Arquivo de uma tag **já publicada** (`draft=false`) não se troca no lugar. Não
substitua um `.dmg`, `.zip`, `.exe`, `.AppImage` ou `.deb` por outro de mesmo
nome, não reenvie com `--clobber`, e não apague a tag para recriá-la com outros
bytes.

Binário publicado com defeito — assinatura, fuse, bug — sai numa **versão
patch nova** (`0.5.2` → `0.5.3`): bump, Audit, merge em `main`, `test-native`,
espelho, tag nova. A tag antiga continua servindo exatamente os arquivos que
foram publicados.

`--clobber` e apagar a tag valem só para release que **ainda é rascunho**
(`draft=true`), quando o upload falhou antes de publicar. Depois de
`gh release edit --draft=false`, a tag fica congelada.

## Quando algo dá errado

**A tag não bate com o `package.json`.** Não publique. Se o release ainda é
rascunho, apague o rascunho e refaça a tag no commit certo. Se já publicou,
a correção é um patch (veja [Ativos imutáveis](#ativos-imutáveis)).

**Preciso refazer uma tag que já empurrei.** Só se o release ainda não foi
publicado. Release público não se refaz. Enquanto for rascunho:

```bash
mise exec -- gh release delete v0.6.0 --yes --cleanup-tag --repo vitorjpr/tokengotchi
git tag -d v0.6.0
git push origin :refs/tags/v0.6.0
```

**O upload parou no meio.** O release fica rascunho (`draft=true`). Não abra
outra tag. Reenvie o arquivo que faltou com `gh release upload --clobber`
só enquanto continuar rascunho, e rode `gh release edit --draft=false` quando
os 9 estiverem lá.

**Esqueci de subir a versão.** O `release.yml` não trava mais isso. Confira
`package.json` no SHA de `main` antes do `test-native`. Tag `v0.6.0` com
`package.json` em `0.5.2` não se publica.

## Assinatura

Nenhum build tem certificado — nem no macOS (exige Apple Developer Program,
pago) nem no Windows (exige certificado de code signing). Por isso os sistemas
avisam na primeira abertura, e o README explica o passo a passo para o usuário.

No macOS o app sai com **assinatura ad-hoc** (`build.mac.identity: "-"`,
`hardenedRuntime: false`). Sem ela, o `.app` ficava só com a assinatura de
linker do binário do Electron, sem selar os recursos do bundle; baixado pelo
navegador (com quarentena), o macOS dizia que o app estava **danificado** e
mandava para o Lixo. Com a ad-hoc, `codesign --verify --deep --strict` passa e
o aviso volta a ser o de app não notarizado. O hardened runtime fica desligado
porque, com assinatura ad-hoc, a validação de biblioteca impediria o app de
abrir.

Na primeira abertura:

- **Até o macOS 14 (Sonoma):** na pasta Aplicativos, clique direito no
  Tokengotchi → **Abrir**, e **Abrir** de novo no aviso.
- **macOS 15 (Sequoia) e posteriores:** dê dois cliques, escolha **Concluído**,
  depois Ajustes do Sistema → Privacidade e Segurança → **Abrir Mesmo Assim**.
  O clique direito → Abrir é o caminho até o macOS 14.

Conferir antes de publicar:

```bash
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Tokengotchi.app
codesign --verify --deep --strict --verbose=2 dist/mac/Tokengotchi.app
codesign -dv --verbose=4 dist/mac-arm64/Tokengotchi.app 2>&1 | grep Signature=
codesign -dv --verbose=4 dist/mac/Tokengotchi.app 2>&1 | grep Signature=
```

As duas linhas `Signature=` têm que ser `adhoc`. O mesmo vale para o `.app`
dentro de cada `.dmg` e de cada `-mac.zip`.

O build local usa `CSC_IDENTITY_AUTO_DISCOVERY=false`. Não há Developer ID da
Apple nem certificado do Windows para ligar.

## Fuses (proteção contra injeção)

O hardened runtime ficou desligado na assinatura ad-hoc. Sem ele, o macOS não
barra `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` nem código carregado fora do
`app.asar`. Essa parte volta pelos fuses do Electron, gravados no binário na
hora do pacote (`build.electronFuses` no `package.json`). O electron-builder
vira os bits depois de empacotar e antes de assinar, então a assinatura ad-hoc
cobre o binário já com os fuses.

Os bits estão em `build.electronFuses` no `package.json` (o #9, já em `main`).
O selftest trava essa tabela; ele não sobe o Electron.

| Fuse | Valor | O que fecha |
| --- | --- | --- |
| `runAsNode` | `false` | `ELECTRON_RUN_AS_NODE` não transforma o app num Node |
| `enableNodeOptionsEnvironmentVariable` | `false` | `NODE_OPTIONS` e `NODE_EXTRA_CA_CERTS` são ignorados |
| `enableNodeCliInspectArguments` | `false` | `--inspect`, `--inspect-brk` e o `SIGUSR1` não abrem o depurador |
| `onlyLoadAppFromAsar` | `true` | só carrega `app.asar` (não cai em `app/` nem em `default_app.asar`) |
| `enableEmbeddedAsarIntegrityValidation` | `true` | no macOS e no Windows, confere o hash do `app.asar` antes de carregar |

Com Mac ad-hoc e Windows sem assinatura, essa integridade só pega adulteração ingênua: quem tem escrita no binário recalcula o hash e assina de novo.

O app não usa `process.fork`, que depende de `ELECTRON_RUN_AS_NODE`. A janela
abre com `loadFile` (`file://`), então `grantFileProtocolExtraPrivileges` fica
no padrão, ligado: desligar quebra página servida por arquivo local.
`enableCookieEncryption` também fica no padrão, desligado — com assinatura
ad-hoc o Keychain não é caminho confiável, e o bichinho não guarda cookie.
`NODE_EXTRA_CA_CERTS` deixa de valer junto com `NODE_OPTIONS`. O aviso de
atualização (`src/main/updates.js`) usa a lista de CAs embutida no Node, não
o chaveiro do sistema — um proxy que inspeciona TLS e depende de
`NODE_EXTRA_CA_CERTS` deixa de abrir esse pedido.

No Linux o Electron não aplica a checagem de integridade do `app.asar` (só
macOS e Windows). O bit fica gravado do mesmo jeito.

Conferir num app já empacotado:

```bash
npx @electron/fuses read --app dist/mac-arm64/Tokengotchi.app
```

`npm start` e `mise run test` usam o Electron de desenvolvimento, sem esses
bits. Os fuses só existem no binário que o `electron-builder` gera.

## CI do repositório público (`vitorjpr`)

A política de CI do app mora neste repositório, `davartec/tokengotchi`. Aqui o
`ci.yml` roda Ubuntu em todo pull request e em todo push para `main`, e só
gasta macOS e Windows no `test-native` (push em `release/**` ou
`workflow_dispatch`).

Essa mudança **não** foi espelhada em `vitorjpr/tokengotchi`. O `ci.yml` de lá
continua a matriz antiga: macOS, Ubuntu e Windows em todo pull request e em
todo push para `main`. Minutos de Actions no repositório público são
gratuitos. Um pull request de alinhamento em `vitorjpr/tokengotchi` pode vir
depois, como arrumação opcional — não faz parte deste procedimento.
