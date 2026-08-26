#!/usr/bin/env bash
# Alimenta o Tokengotchi a partir de qualquer ferramenta.
#
#   ./feed.sh <fonte> <tokens_entrada> <tokens_saida>
#   ./feed.sh cursor 800 1200
#
# Útil como hook de Stop/PostToolUse no Claude Code, no Cursor,
# ou no fim de qualquer script que fale com um modelo.

SOURCE="${1:-externo}"
INPUT="${2:-0}"
OUTPUT="${3:-0}"
PORT="${TOKENGOTCHI_PORT:-4736}"

curl -s --max-time 2 "http://127.0.0.1:${PORT}/feed" \
  -H 'Content-Type: application/json' \
  -d "{\"source\":\"${SOURCE}\",\"label\":\"${SOURCE}\",\"input_tokens\":${INPUT},\"output_tokens\":${OUTPUT}}" \
  >/dev/null 2>&1

exit 0
