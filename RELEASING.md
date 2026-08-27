# Como lançar uma versão nova

Todo o build e a publicação são automáticos. **Você empurra uma tag; o resto o
GitHub faz.** Nunca crie o release pela interface do GitHub — o workflow cria.

## O procedimento

Escolha o número da versão ([semver](https://semver.org/lang/pt-BR/)):

| Mudança | Número | Exemplo |
| --- | --- | --- |
| Só correção de bug | patch | `0.2.0` → `0.2.1` |
| Feature nova de usuário | minor | `0.2.0` → `0.3.0` |
| Quebra algo (perde o bichinho, muda o formato do `pet.json`) | major | `0.2.0` → `1.0.0` |

Com `main` limpa e atualizada:

```bash
# 1. confira que está tudo verde antes de começar
mise run test

# 2. suba a versão (atualiza package.json E package-lock.json)
mise exec -- npm version 0.3.0 --no-git-tag-version

# 3. commite o bump
git add package.json package-lock.json
git commit -m "v0.3.0"
git push origin main

# 4. marque e empurre a tag — é isto que dispara o build
git tag -a v0.3.0 -m "v0.3.0

Descreva aqui, em uma linha por item, o que mudou para quem usa."
git push origin v0.3.0
```

Pronto. Em torno de 5 minutos o release aparece publicado em
[Releases](../../releases), com os 9 arquivos dos três sistemas.

### Acompanhar

```bash
mise exec -- gh run watch                       # segue a execução ao vivo
mise exec -- gh run list --workflow=release.yml # histórico
```

Conferir o resultado como um visitante anônimo veria — sem token, que é o teste
que importa:

```bash
curl -s https://api.github.com/repos/vitorjpr/tokengotchi/releases/latest \
  | node -pe "const d=JSON.parse(require('fs').readFileSync(0)); \
      d.tag_name + ' draft=' + d.draft + ' arquivos=' + d.assets.length"
```

Tem que dizer `draft=false` e `arquivos=9`.

## O que o workflow faz

1. **Confere se a tag bate com o `package.json`.** Tag `v0.3.0` com
   `package.json` em `0.2.0` falha aqui, antes de compilar qualquer coisa.
2. **Compila nos três sistemas nativos** (`macos-latest`, `windows-latest`,
   `ubuntu-latest`), rodando o selftest antes de cada build. Cross-compilar
   funciona, mas só o build nativo prova que o artefato abre.
3. **Cria o release como rascunho**, anexa um arquivo por vez com até quatro
   tentativas, e **só então publica** como `latest`.

Se qualquer build falhar, não existe release nenhum — o passo de publicar
depende dos três. Se um upload falhar mesmo após as tentativas, o release fica
como rascunho incompleto e o job vermelho, em vez de virar um release público
pela metade.

## Os 9 arquivos

| Sistema | Arquivos |
| --- | --- |
| macOS | `-universal.dmg`, `-universal-mac.zip` (Intel e Apple Silicon juntos) |
| Windows | `-Setup-<versão>.exe`, `-win.zip`, `-arm64-win.zip` |
| Linux | `.AppImage` e `_amd64.deb` (mais as variantes arm64) |

**Ao adicionar um alvo novo de build**, inclua a extensão em duas listas ou o
arquivo é descartado em silêncio:

- `package.json` → `build.win.target` / `build.mac.target` / `build.linux.target`
- `.github/workflows/release.yml` → o `path:` do passo *Publicar artefatos*

## Quando algo dá errado

**Preciso refazer uma tag que já empurrei.** Apague o release e a tag, dos dois
lados, e empurre de novo:

```bash
mise exec -- gh release delete v0.3.0 --yes --cleanup-tag
git tag -d v0.3.0
git push origin :refs/tags/v0.3.0    # se ainda existir no remoto
# corrija o que precisa, commite, e refaça a tag
```

**O job de release falhou no meio dos uploads.** O release fica como rascunho
com parte dos arquivos. Não recomece do zero: empurre a tag de novo (removendo
e recriando) — os uploads usam `--clobber`, então reenviar por cima funciona.

**Esqueci de subir a versão antes de marcar a tag.** A trava do passo 1 pega
isso e o build nem começa. Rode `npm version`, commite e refaça a tag.

## Assinatura

Nenhum build é assinado — nem no macOS (exige Apple Developer Program, pago)
nem no Windows (exige certificado de code signing). Por isso os sistemas
avisam na primeira abertura, e o README explica o passo a passo para o usuário.

Se um dia houver certificado, ele entra como secret do repositório e o
`CSC_IDENTITY_AUTO_DISCOVERY: false` do workflow sai.
