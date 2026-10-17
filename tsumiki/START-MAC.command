#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js fehlt. Bitte von https://nodejs.org installieren (LTS)."; read; exit; fi
[ -d node_modules ] || { echo "Erster Start: Pakete werden installiert ..."; npm install; }
(sleep 2; open http://localhost:3000) &
node server.js
