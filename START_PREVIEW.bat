@echo off
setlocal
cd /d "%~dp0"
echo Starting ZEVQORA local preview on http://localhost:5600 ...
start "" http://localhost:5600
python scripts\preview_server.py
if errorlevel 1 (
  echo.
  echo Python could not start the preview server.
  echo Install Python or run: npx vercel dev
  pause
)
