@echo off
REM Post-install: rebuild node-pty for Electron, working around Spectre mitigation
REM requirement in VS 2022 Build Tools when Spectre libraries are not installed.
cd /d "%~dp0"

REM Only run on Windows
if not "%OS%"=="Windows_NT" exit /b 0

REM Check if node-pty exists
if not exist "node_modules\node-pty\binding.gyp" exit /b 0

REM Skip if .node files already exist (already built)
if exist "node_modules\node-pty\build\Release\pty.node" exit /b 0

echo [postinstall] Rebuilding node-pty for Electron (Spectre workaround)...

REM Step 1: configure
call npx --prefix . node-gyp configure --directory=node_modules/node-pty --target=35.7.5 --arch=x64 --dist-url=https://www.electronjs.org/headers --msvs_version=2022 2>&1
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

REM Step 2: patch vcxproj files to disable Spectre mitigation
for /r "node_modules\node-pty\build" %%f in (*.vcxproj) do (
  powershell -NoProfile -Command "(Get-Content '%%f' -Raw) -replace '<SpectreMitigation>Spectre</SpectreMitigation>', '<SpectreMitigation>false</SpectreMitigation>' | Set-Content '%%f' -NoNewline"
)

REM Step 3: build
call npx --prefix . node-gyp build --directory=node_modules/node-pty --target=35.7.5 --arch=x64 --dist-url=https://www.electronjs.org/headers --msvs_version=2022 2>&1
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo [postinstall] node-pty rebuild complete
