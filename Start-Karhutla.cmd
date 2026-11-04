@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\start-karhutla.mjs" %*
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Karhutla could not find Node.js.
    echo Use the Windows release ZIP, which includes its own runtime.
    echo For a Git checkout, install Node.js and run npm ci first.
    pause
    exit /b 1
  )
  node "%~dp0scripts\start-karhutla.mjs" %*
)
set "KARHUTLA_EXIT=%ERRORLEVEL%"
if not "%KARHUTLA_EXIT%"=="0" pause
exit /b %KARHUTLA_EXIT%
