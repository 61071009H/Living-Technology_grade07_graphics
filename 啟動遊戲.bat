@echo off
cd /d "%~dp0"
set "NODE_EXE="
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE (
  echo 尚未安裝 Node.js，請先安裝後再執行本檔。
  echo 官方下載頁：https://nodejs.org/en/download
  pause
  exit /b 1
)
start "三視圖挑戰賽伺服器" cmd /k ""%NODE_EXE%" "%~dp0server.js""
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
