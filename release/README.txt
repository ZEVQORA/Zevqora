The distributable Windows file is named:

  ZEVQORA-Setup.exe

It is produced by either:

  desktop-app\scripts\package_windows.ps1

or the included GitHub Actions workflow:

  .github/workflows/windows-release.yml

This source bundle does not contain a precompiled EXE because the current build environment cannot reach npm/PyPI to download Electron/PyInstaller dependencies. The included workflow builds it on windows-latest and uploads it as an artifact; pushing a v* tag also attaches ZEVQORA-Setup.exe to a GitHub Release.
