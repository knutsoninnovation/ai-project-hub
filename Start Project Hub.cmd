@echo off
rem Starts Project Hub and opens the board in your browser. Needs Node.js 22.13 or newer (nodejs.org).
cd /d "%~dp0"
if not exist package.json (echo This launcher was opened from inside the zip. Right-click the zip, choose Extract All, then run Start Project Hub.cmd from the extracted folder. & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing, first run only... & call npm install || (pause & exit /b 1))
call npm run dev -- --open /board.html
pause
