@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Installez Node.js 22.12 ou plus recent, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist node_modules\astro\package.json (
  echo Executez npm.cmd ci dans ce dossier avant le premier demarrage.
  pause
  exit /b 1
)
call npm.cmd run dev:app
if errorlevel 1 pause
