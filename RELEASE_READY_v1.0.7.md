# ZEVQORA v1.0.7 Release Ready

This build keeps the Huslen v8 website design unchanged and adds only release/build infrastructure required for a clean Windows + GitHub release.

## Local release preflight
```powershell
node .\scripts\verify-release.mjs
```

## Build Windows installer
```powershell
powershell -ExecutionPolicy Bypass -File .\desktop-app\scripts\package_windows.ps1
```

Expected outputs:
- `desktop-app\desktop\release\ZEVQORA-Setup-1.0.7.exe`
- `desktop-app\desktop\release\ZEVQORA-Setup.exe`

## Tag
```powershell
git tag -a v1.0.7 -m "ZEVQORA v1.0.7"
git push origin v1.0.7
```
