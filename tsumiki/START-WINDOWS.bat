@echo off
title Tsumiki
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren (LTS) und neu starten. & pause & exit /b)
if not exist node_modules (echo Erster Start: Pakete werden installiert ... & call npm install)
start "" http://localhost:3000
node server.js
pause
