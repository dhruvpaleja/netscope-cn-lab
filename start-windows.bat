@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22 or newer from nodejs.org, then run this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:3000 in your browser after the server starts.
node server.js
pause
