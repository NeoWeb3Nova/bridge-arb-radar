@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 境外接口（DexScreener / Etherscan）需要走本地代理，按需修改或删除下面这行
set HTTPS_PROXY=http://127.0.0.1:10808
set HTTP_PROXY=http://127.0.0.1:10808

where node >nul 2>nul
if %errorlevel%==0 (
  node --disable-warning=ExperimentalWarning server.js
) else (
  echo 未检测到 node，请先安装 Node.js 22+（需内置 node:sqlite）
  pause
  exit /b 1
)
pause
