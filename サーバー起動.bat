@echo off
cd /d "%~dp0"
title ToDo リスト サーバー

where python >nul 2>nul || (
  echo.
  echo  Python が見つかりません。Python をインストールしてください。
  echo.
  pause
  exit /b
)

echo.
echo  ToDo リストのサーバーを起動しています...
start "" /b python -m http.server 8000
timeout /t 2 /nobreak >nul
start "" http://localhost:8000

echo.
echo  ブラウザで http://localhost:8000 を開きました。
echo.
echo  ** このウィンドウを閉じるとサーバーが止まり、アプリは開けなくなります **
echo.

:loop
timeout /t 3600 /nobreak >nul
goto loop
