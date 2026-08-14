@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\desktop-app\scripts\package_windows.ps1"
if errorlevel 1 exit /b %errorlevel%
echo.
echo Installer: desktop-app\desktop\release\ZEVQORA-Setup.exe
pause
