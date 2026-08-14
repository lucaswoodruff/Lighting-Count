@echo off
rem Double-click to start Lighting Takeoff. Keep this window open while using
rem the app; close it (or press Ctrl+C) to stop.
cd /d "%~dp0"
where node >nul 2>nul || set "PATH=%PATH%;C:\Users\lwoodruff\tools\node-v24.19.0-win-x64"
if not exist node_modules call npm install
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173"
npm run dev
