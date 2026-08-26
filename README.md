# Tokengotchi

Um bichinho de desktop que vive dos tokens que você gasta com agentes de IA.
Ele fica numa janelinha flutuante no canto da tela e na bandeja do sistema.
Se você programa, ele come. Se você some por um dia e meio, ele morre.

Roda em **macOS, Windows e Linux**.

Fontes suportadas de fábrica: **Claude Code**, **Codex CLI**, **Grok CLI** e **Cursor**
(este último por estimativa), mais um endpoint HTTP local para plugar qualquer outra coisa.

## Instalando

Baixe o pacote do seu sistema em [Releases](../../releases):

| Sistema | Arquivo | Como usar |
| --- | --- | --- |
| macOS (Apple Silicon) | `Tokengotchi-<versão>-arm64.dmg` | arraste para `/Applications` |
| macOS (Intel) | `Tokengotchi-<versão>.dmg` | arraste para `/Applications` |
| Windows x64 | `Tokengotchi-<versão>-win.zip` | extraia e rode `Tokengotchi.exe` |
| Windows ARM | `Tokengotchi-<versão>-arm64-win.zip` | extraia e rode `Tokengotchi.exe` |
| Linux x64 | `Tokengotchi-<versão>.AppImage` | `chmod +x` e execute |
| Linux ARM | `Tokengotchi-<versão>-arm64.AppImage` | `chmod +x` e execute |

Também há `.tar.gz` para Linux e `.zip` para macOS, se preferir sem instalador.

### Nenhum build é assinado

Assinar custa dinheiro: conta paga no Apple Developer Program (macOS) e certificado
de code signing (Windows). Enquanto não houver, cada sistema reclama na primeira
abertura. Isso é normal em projeto open source sem assinatura e não diz nada sobre
o conteúdo. Se preferir não confiar num binário pronto, compile do código (abaixo).

- **Windows:** o SmartScreen mostra "O Windows protegeu o computador" →
  **Mais informações** → **Executar assim mesmo**.
- **Linux:** o AppImage não é bloqueado; só precisa de `chmod +x`. Em algumas
  distros a bandeja do sistema exige `libappindicator3` instalado.
- **macOS:** ver abaixo.

### macOS: "não foi possível verificar se contém malware"

O app **não é notarizado** — notarização exige uma conta paga no Apple Developer
Program. Então, na primeira abertura, o Gatekeeper reclama. Isso é esperado para
qualquer app de código aberto sem notarização, e não diz nada sobre o conteúdo.

Para abrir: clique com o botão direito no app → **Abrir** → **Abrir** de novo no
diálogo. O macOS guarda a exceção e nas próximas vezes abre direto.

Se preferir não confiar num binário pronto — o que é perfeitamente razoável —
compile você mesmo a partir do código:

```bash
git clone https://github.com/SEU-USUARIO/tokengotchi.git
cd tokengotchi
mise trust && mise install
mise exec -- npm install

mise exec -- npm run dist:mac     # .dmg + .zip (arm64 e x64)
mise exec -- npm run dist:win     # .zip (x64 e arm64)
mise exec -- npm run dist:linux   # .AppImage + .tar.gz (x64 e arm64)
```

Dá para cross-compilar os três a partir de qualquer um dos sistemas. A exceção é o
instalador NSIS do Windows, que exige Wine fora do Windows — por isso o alvo aqui é
`zip`, que não precisa. O caminho mais confiável é deixar o workflow `release.yml`
compilar cada sistema no runner nativo.

## Setup com mise

O ambiente é gerenciado por [mise](https://mise.jdx.dev). O `mise.toml` na raiz fixa
o Node LTS 22 (o Electron 43 exige Node 20+).

```bash
mise trust              # só na primeira vez, mise exige confiar no config
mise install            # instala o Node 22 declarado no mise.toml
mise exec -- node --version
```

Tasks disponíveis (`mise tasks` lista todas):

```bash
mise run test           # selftest — não precisa de npm install
mise run doctor         # diagnóstico das fontes, últimas 48h
mise run doctor 720     # últimos 30 dias
mise run start          # sobe o app (alias: mise run dev)
mise run show           # traz a janela de volta se ela sumiu
mise run status         # estado do bichinho em JSON
```

## Rodando

```bash
mise exec -- npm install
mise run start
```

Antes disso, vale rodar o diagnóstico para ver o que o app enxerga na sua máquina:

```bash
mise run doctor         # últimas 48h
mise run doctor 720     # últimos 30 dias
```

Ele lista cada fonte, se o diretório existe, quantos arquivos encontrou e quantos
tokens conseguiu ler. Se alguma linha vier com `✗`, é só ajustar o caminho na config
(veja abaixo) — nada quebra por causa disso.

Para gerar um `.app` de verdade: `mise exec -- npm run dist` (usa electron-builder, baixa ~200 MB na primeira vez).

## Deixando rodando todo dia

No **macOS** e no **Windows**, o menu da bandeja tem **Abrir no login** (checkbox).
Ligado, o sistema sobe o bichinho a cada login, já escondido.

No **Linux** o item não aparece: o Electron não implementa item de login nessa
plataforma, e um checkbox que não faz nada é pior que nenhum. Use o autostart do
seu ambiente — normalmente um `.desktop` em `~/.config/autostart/`.

Um detalhe importante: rodando via `mise run start`, o item de login aponta para o
binário do Electron dentro de `node_modules/` — se você apagar ou reinstalar as
dependências, ele quebra. Para uso diário de verdade, gere o pacote:

```bash
mise exec -- npm run dist:mac     # ou dist:win / dist:linux
```

…instale o resultado no lugar definitivo (`/Applications` no macOS, uma pasta fixa
no Windows) e ligue o **Abrir no login** a partir dele.

### Só uma instância por vez

O app segura um *single instance lock*. Abrir de novo enquanto já existe um rodando
não cria um segundo processo — apenas revela a janela do que já está no ar. Isso
evita dois processos disputando a porta 4736 e escrevendo no mesmo `cursors.json`,
o que corromperia a contagem em silêncio.

### Perdeu a janela?

Ela não aparece no Dock nem na barra de tarefas, então some de vez quando você
esconde ou minimiza. O ícone da bandeja é o caminho normal de volta (**Mostrar
bichinho**), mas numa tela larga ele é fácil de perder. Pelo terminal:

```bash
mise run show
```

## Como ele come

Cada token vale um número de calorias diferente, na mesma proporção do custo real:

| token | peso |
| --- | --- |
| saída | 4× |
| entrada | 1× |
| escrita de cache | 1,25× |
| leitura de cache | 0,1× |

- 4.000 calorias = 1 ponto de saciedade (de 0 a 100)
- Sem comer, perde 5 pontos de saciedade por hora → ~20h para esvaziar
- Barriga vazia, perde 8 pontos de saúde por hora → mais ~12h até morrer
- Acima de 50 de saciedade, recupera 6 pontos de saúde por hora
- 20 minutos sem token nenhum e ele dorme

Na prática: uma sessão decente de Claude Code enche a barriga. Um fim de semana
inteiro sem abrir o terminal mata o bicho. Quando morre, o botão laranja choca um
novo ovo e a geração sobe.

O tempo passa mesmo com o app fechado — ele calcula o decaimento pelo relógio ao abrir,
com teto de 7 dias.

### Evolução

`ovo → broto → filhote → jovem → adulto → ancião`, por calorias acumuladas na vida
(250k / 2M / 10M / 40M / 150M). A aparência muda em cada estágio, e o bichinho fica
mais pálido conforme a saúde cai.

Ajuste os números em `src/main/pet.js`, no objeto `TUNING`.

## Como ele lê cada ferramenta

| Fonte | O que é lido | Precisão |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl`, campo `message.usage` de cada resposta | exata |
| Codex CLI | `~/.codex/sessions/**/*.jsonl`, eventos `token_count` (usa o delta do total acumulado) | exata |
| Grok CLI | `~/.grok/**`, qualquer objeto de usage reconhecível | depende da versão |
| Cursor | mudanças nos arquivos de estado do Cursor (caminho por sistema, ver abaixo) | **estimativa** |

No Codex, `input_tokens` **já inclui** `cached_input_tokens` (convenção da OpenAI:
`total_tokens === input_tokens + output_tokens`), e `reasoning_output_tokens` é
subconjunto de `output_tokens`. O parser desconta o cache do input antes de pesar —
sem isso o cache seria contado duas vezes, e a 1× em vez de 0,1×. O Claude Code é o
oposto: lá os campos são disjuntos. Por isso o Codex tem normalização própria
(`normalizeCodexUsage` em `src/main/sources.js`).

O Cursor não escreve contagem de tokens em disco em formato aberto, então ele é
creditado por atividade: cada alteração detectada nos arquivos de estado vale
~1.800 tokens estimados, no máximo um evento a cada 45s. Se quiser precisão em vez
de estimativa, desligue a fonte na config e use o endpoint abaixo.

Os caminhos do Cursor em `config/default-sources.json` cobrem os três sistemas —
`~/Library/Application Support/Cursor` no macOS, `~/AppData/Roaming/Cursor` no
Windows e `~/.config/Cursor` no Linux. Raízes que não existem são ignoradas em
silêncio, então a mesma config serve para todo mundo. **Só os caminhos de macOS
foram verificados numa máquina real**; os de Windows e Linux seguem a convenção do
VS Code, do qual o Cursor é um fork. Rode `mise run doctor` no seu sistema para
confirmar — se vier `✗`, corrija na config e mande um PR.

A leitura é incremental: o app guarda o offset de cada arquivo, então reiniciar não
faz o bichinho comer duas vezes. E na primeira execução ele só marca a posição atual
dos logs — ninguém nasce com meses de histórico na barriga.

## Alimentando de fora (qualquer ferramenta)

O app sobe um servidor local em `127.0.0.1:4736`:

```bash
curl -s localhost:4736/feed -d '{"source":"grok","input_tokens":800,"output_tokens":1200}'
curl -s localhost:4736/status
curl -s localhost:4736/show      # revela a janela
curl -s localhost:4736/hide      # esconde de novo
```

Se a porta 4736 já estiver ocupada, o app avisa no console e segue comendo dos logs
normalmente — só o servidor fica fora. Dá para mudar em `ingest.port` no `sources.json`.

Tem um atalho em `hooks/feed.sh`:

```bash
chmod +x hooks/feed.sh
./hooks/feed.sh cursor 800 1200
```

Para plugar no Claude Code como hook, em `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "/caminho/para/tokengotchi/hooks/feed.sh claude-code 0 1500" }
        ]
      }
    ]
  }
}
```

(Não é necessário para o Claude Code — ele já é lido direto do disco. Serve de modelo
para qualquer outro agente que tenha hooks.)

## Configuração

Na primeira execução, o app copia `config/default-sources.json` para a pasta de
dados do usuário, que muda conforme o sistema:

| Sistema | Caminho |
| --- | --- |
| macOS | `~/Library/Application Support/Tokengotchi/` |
| Windows | `%APPDATA%\Tokengotchi\` |
| Linux | `~/.config/Tokengotchi/` |

O menu da bandeja tem **Abrir pasta de dados**, que leva direto ao lugar certo.

Edite esse arquivo para ligar/desligar fontes, corrigir caminhos ou mudar a porta.
Junto dele ficam `pet.json` (o bichinho) e `cursors.json` (a posição de leitura dos logs).
Apagar o `pet.json` é o botão de reset definitivo.

## Estrutura

```
src/main/main.js      janela, tray, loop de varredura a cada 8s
src/main/sources.js   leitura incremental dos logs + parsers por ferramenta
src/main/pet.js       fome, saúde, evolução, persistência
src/main/ingest.js    servidor HTTP local (/feed, /status, /show, /hide)
src/renderer/         a janelinha: pixel art em canvas + medidores
config/               fontes padrão, copiadas para o Application Support na 1ª vez
hooks/feed.sh         atalho para alimentar via hook de qualquer ferramenta
scripts/doctor.js     diagnóstico das fontes
scripts/selftest.js   testes das regras e dos parsers (mise run test)
scripts/make-icon.js  gera build/icon.png a partir de pixel art, sem dependências
build/icon.png        ícone do app (1024x1024), consumido pelo electron-builder
mise.toml             Node 22 + tasks do projeto
```

Nenhuma dependência além do Electron.

## Política de atualização do Electron

O `package.json` usa `^43.4.1`, ou seja, `npm install` pega patches e minors da linha
43 sozinho, mas **nunca troca de major**. Trocar de major é decisão manual.

Isso existe porque ficar parado sai caro. O projeto nasceu no Electron 31 (build de
2024) e, ao ser instalado em 2026, o macOS passou a classificar aquele binário como
malware e apagá-lo logo após a extração — o app simplesmente não abria. O `npm audit`
concordava por outro caminho: todo Electron ≤ 40.10.2 estava marcado como
vulnerabilidade de severidade alta, com dezenas de CVEs.

Recomendação: revisar a major uma vez por trimestre.

```bash
mise exec -- npm audit           # tem que dizer "found 0 vulnerabilities"
mise exec -- npm outdated        # mostra se saiu major nova
```

Ao subir de major, rode `mise run test` e depois `mise run start` e confira as três
coisas que mais quebram entre majors do Electron: a janela sem moldura/transparente,
o ícone da bandeja e o `preload.js` com `contextIsolation`.

## Desenvolvimento

```bash
mise run test           # selftest: parsers, leitura incremental, ciclo de vida
mise run doctor 720     # o que o app enxerga na sua máquina
mise run start          # sobe em modo dev
mise run icon           # regenera build/icon.png a partir da arte em scripts/make-icon.js
```

O CI (GitHub Actions) roda `mise run test` e `mise run doctor` a cada push e PR.
O selftest não precisa do Electron nem de `npm install` — só de Node.

Ao mexer nos parsers, adicione um caso em `scripts/selftest.js` com o formato **real**
do log (um trecho colado do arquivo de verdade), não com um formato imaginado. Foi
assim que apareceu o bug de contagem dupla do Codex.

## Detalhes chatos

- A janela é sem moldura e arrastável por qualquer parte que não seja botão.
- O app não aparece no Dock nem na barra de tarefas, só na bandeja do sistema. Fechar a janela não mata o processo — use `Sair` no menu da bandeja, ou `mise run show` para trazer a janela de volta.
- O ícone da bandeja é monocromático no macOS (*template image*, que o sistema inverte conforme o tema) e colorido no Windows e no Linux, que não suportam esse recurso e desenhariam um quadrado preto invisível em bandeja escura.
- Nada sai da sua máquina: leitura local de arquivos e um servidor que só escuta em `127.0.0.1`.
