#!/usr/bin/env bash
# Alimenta o Tokengotchi a partir de qualquer ferramenta.
#
#   ./feed.sh <fonte> <tokens_entrada> <tokens_saida>
#   ./feed.sh cursor 800 1200
#
# Útil como hook de Stop/PostToolUse no Claude Code, no Cursor,
# ou no fim de qualquer script que fale com um modelo.
#
# A fonte e os números passam por uma lista fechada de caracteres.
# O que falha nessa lista não é enviado. O JSON e o segredo compartilhado
# são montados no Python (argv e ambiente, nunca numa string de comando):
# um campo com aspas, $(...) ou quebra de linha não vira shell nem muda
# o corpo do pedido.
#
# Autenticação: Authorization: Bearer <ingest.token>. O segredo vem de
# TOKENGOTCHI_TOKEN ou do sources.json do app (ingest.token, gerado na
# primeira execução). A porta vem de TOKENGOTCHI_PORT ou de ingest.port.

SOURCE="${1:-externo}"
INPUT="${2:-0}"
OUTPUT="${3:-0}"

if ! [[ "$SOURCE" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  exit 0
fi
if ! [[ "$INPUT" =~ ^[0-9]{1,15}$ ]]; then
  exit 0
fi
if ! [[ "$OUTPUT" =~ ^[0-9]{1,15}$ ]]; then
  exit 0
fi
if [[ -n "${TOKENGOTCHI_PORT:-}" ]] && ! [[ "$TOKENGOTCHI_PORT" =~ ^[0-9]{1,5}$ ]]; then
  exit 0
fi

# Argumentos já filtrados. O Python lê o segredo do ambiente herdado;
# este script não expande TOKENGOTCHI_TOKEN.
python3 - "$SOURCE" "$INPUT" "$OUTPUT" >/dev/null 2>&1 <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

source, raw_input, raw_output = sys.argv[1:4]

def candidate_files():
    override = os.environ.get("TOKENGOTCHI_SOURCES", "").strip()
    if override:
        return [Path(override)]
    home = Path.home()
    paths = [
        home / "Library" / "Application Support" / "Tokengotchi" / "sources.json",
        home / "Library" / "Application Support" / "tokengotchi" / "sources.json",
        home / ".config" / "Tokengotchi" / "sources.json",
        home / ".config" / "tokengotchi" / "sources.json",
    ]
    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        root = Path(appdata)
        paths.append(root / "Tokengotchi" / "sources.json")
        paths.append(root / "tokengotchi" / "sources.json")
    return paths

def load_ingest():
    for path in candidate_files():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        ingest = data.get("ingest") if isinstance(data, dict) else None
        if isinstance(ingest, dict):
            return ingest
    return {}

ingest = load_ingest()
token = os.environ.get("TOKENGOTCHI_TOKEN", "").strip()
if not token:
    configured = ingest.get("token")
    if isinstance(configured, str):
        token = configured.strip()
if not token or any(ord(ch) < 32 or ord(ch) == 127 for ch in token):
    sys.exit(0)

port_env = os.environ.get("TOKENGOTCHI_PORT", "").strip()
if port_env:
    try:
        port = int(port_env)
    except ValueError:
        sys.exit(0)
else:
    try:
        port = int(ingest.get("port") or 4736)
    except (TypeError, ValueError):
        port = 4736
if not 1 <= port <= 65535:
    sys.exit(0)

body = json.dumps(
    {
        "source": source,
        "label": source,
        "input_tokens": int(raw_input),
        "output_tokens": int(raw_output),
    },
    ensure_ascii=True,
).encode("utf-8")

request = urllib.request.Request(
    "http://127.0.0.1:%d/feed" % port,
    data=body,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
    },
)
try:
    with urllib.request.urlopen(request, timeout=2) as response:
        response.read()
except (OSError, urllib.error.URLError, ValueError):
    pass
PY

exit 0
