@echo off
chcp 65001 >nul
title Habitat
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Habitat
echo   ==========================================
echo.
echo   Building and starting. Keep this window open --
echo   closing it quits the app.
echo.

if not exist "node_modules" (
  echo   First run: installing dependencies...
  call npm install
  if errorlevel 1 goto fail
)

call npm run desktop:prod
if errorlevel 1 goto fail

exit /b 0

:fail
echo.
echo   [!] Failed. See the log above.
pause
exit /b 1
