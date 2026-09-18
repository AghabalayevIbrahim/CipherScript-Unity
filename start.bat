:: SPDX-License-Identifier: GPL-3.0-or-later
@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CipherScript Unity Bridge
cd /d "%~dp0"

if not exist "%~dp0logs" mkdir "%~dp0logs" >nul 2>nul
set "LOGFILE=%~dp0logs\start.log"
call :log "===== %DATE% %TIME%  start.bat launched (Unity edition) ====="
for /f "tokens=*" %%v in ('ver') do call :log "%%v"

echo.
echo   === CipherScript Unity Bridge ===
echo.

REM Refuse to run from inside a ZIP preview: Explorer extracts start.bat alone
REM to %TEMP%, so bridge.py is missing and the launch fails with a confusing
REM Python error. Detect the missing file up front with a plain explanation.
if not exist "%~dp0bridge.py" (
    echo   ERROR: bridge.py not found next to start.bat.
    echo.
    echo   If you opened start.bat from inside the downloaded ZIP, first EXTRACT
    echo   the whole ZIP ^(right-click, "Extract All..."^), then run start.bat
    echo   from the extracted folder.
    echo.
    call :log "FATAL: bridge.py missing next to start.bat (run from inside ZIP?)."
    pause
    exit /b 1
)

REM --- 1. Find Python ---------------------------------------------------------
echo   [1/3] Looking for Python...
set "PY="

REM Prefer the py launcher - it never resolves to the Microsoft Store stub.
where py >nul 2>nul && set "PY=py -3"
call :validate_py && goto :found

REM Fall back to python on PATH, but skip the Store stub (WindowsApps) which
REM cannot run pip and silently fails.
set "PY=python"
call :validate_py && goto :found

REM Last resort: scan the standard install folders directly.
for %%R in (
    "%LOCALAPPDATA%\Programs\Python"
    "%ProgramFiles%"
    "%ProgramFiles(x86)%"
) do (
    if exist "%%~R" (
        for /f "delims=" %%D in ('dir /b /ad /o-n "%%~R\Python3*" 2^>nul') do (
            if exist "%%~R\%%D\python.exe" (
                set PY="%%~R\%%D\python.exe"
                call :validate_py && goto :found
            )
        )
    )
)

set "PY="
call :log "Python not found on PATH or in standard install folders."
goto :need_install

:found
for /f "tokens=*" %%v in ('call %PY% --version 2^>^&1') do (
    echo         Found: %PY%  ^(%%v^)
    call :log "Python found: %PY% (%%v)"
)
goto :install_deps

:need_install
REM --- Python not found, try winget -------------------------------------------
where winget >nul 2>nul
if errorlevel 1 (
    echo   ERROR: Python is not installed and winget ^(Windows package manager^)
    echo   is not available on this PC, so it cannot be installed automatically.
    echo.
    echo   Install Python manually: https://www.python.org/downloads/
    echo   IMPORTANT: tick "Add python.exe to PATH", then run start.bat again.
    echo.
    call :log "FATAL: no Python and no winget on this machine."
    pause
    exit /b 1
)
echo         Not found. Installing via winget...
echo.
winget install --id Python.Python.3.12 --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 call :log "winget install returned an error (see console output above)."
echo.
echo   Checking again...
set "PY=py -3"
call :validate_py && goto :ready
set "PY=python"
call :validate_py && goto :ready
for %%R in (
    "%LOCALAPPDATA%\Programs\Python"
    "%ProgramFiles%"
    "%ProgramFiles(x86)%"
) do (
    if exist "%%~R" (
        for /f "delims=" %%D in ('dir /b /ad /o-n "%%~R\Python3*" 2^>nul') do (
            if exist "%%~R\%%D\python.exe" (
                set PY="%%~R\%%D\python.exe"
                call :validate_py && goto :ready
            )
        )
    )
)
echo.
echo   ERROR: Python not found after install.
echo   Install manually: https://www.python.org/downloads/
echo   Tick "Add python.exe to PATH" then run this again.
echo.
call :log "FATAL: no usable Python found even after winget install."
pause
exit /b 1
:ready
echo         Python ready!
call :log "Python ready after winget install: %PY%"

:install_deps
REM --- 2. Dependencies: websockets + uv (uvx runs the Unity MCP server) -------
echo.
echo   [2/3] Checking dependencies (websockets + uv)...

%PY% -c "import websockets" >nul 2>nul
if errorlevel 1 (
    echo         Installing websockets - first time only...
    %PY% -m pip install --user websockets
    if errorlevel 1 (
        echo.
        echo   ERROR: Could not install websockets ^(see pip output above^).
        echo   Common causes: no internet, a firewall/antivirus blocking pip,
        echo   or Python has no working pip. If you used the Microsoft Store
        echo   python, install from https://www.python.org/downloads/ instead
        echo   ^(tick "Add to PATH"^).
        echo.
        call :log "FATAL: pip install websockets failed."
        pause
        exit /b 1
    )
)
echo         websockets OK

REM uvx launches the Unity MCP server (mcp-for-unity) that the Editor talks to.
where uvx >nul 2>nul
if errorlevel 1 (
    echo         Installing uv ^(needed for the Unity MCP server^)...
    %PY% -m pip install --user uv
)
where uvx >nul 2>nul
if errorlevel 1 (
    REM A --user pip install may put uvx.exe in the Python Scripts folder which
    REM is NOT on PATH. Locate that folder and prepend it for this session so
    REM both the bridge and its spawned uvx child can resolve it.
    REM (A temp file beats for /f here: the python -c argument carries double
    REM quotes that for /f parses unreliably inside the command string.)
    call %PY% -c "import sysconfig;print(sysconfig.get_path('scripts'))" >"%TEMP%\cs_scripts.txt" 2>nul
    set "CS_SCRIPTS="
    if exist "%TEMP%\cs_scripts.txt" set /p CS_SCRIPTS=<"%TEMP%\cs_scripts.txt"
    if defined CS_SCRIPTS if exist "%CS_SCRIPTS%\uvx.exe" (
        echo         Found uvx at %CS_SCRIPTS%\uvx.exe - adding it to PATH for this session.
        set "PATH=%CS_SCRIPTS%;%PATH%"
    )
)
where uvx >nul 2>nul
if errorlevel 1 (
    echo.
    echo   ERROR: uv/uvx is not available. It is required to run the Unity MCP server.
    echo   Install it manually:  %PY% -m pip install uv
    echo   then run start.bat again.
    echo.
    call :log "FATAL: uvx not found after install attempt."
    pause
    exit /b 1
)
echo         uv OK
call :log "websockets + uv OK"

REM --- 3. Run the bridge ------------------------------------------------------
echo.
echo   [3/3] Starting bridge...

REM If a previous bridge is already listening on 17613, say so instead of
REM silently killing it - a double-launch is easy to do by mistake.
set "OLDPID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :17613 ^| findstr LISTENING 2^>nul') do (
    set "OLDPID=%%a"
)
if defined OLDPID (
    echo         A previous bridge ^(pid !OLDPID!^) is already running on this port.
    echo         Replacing it with this new instance...
    call :log "Killing previous bridge instance (pid !OLDPID!) on port 17613."
    taskkill /F /T /PID !OLDPID! >nul 2>nul
    timeout /t 1 /nobreak >nul
    set "STILLTHERE="
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr :17613 ^| findstr LISTENING 2^>nul') do (
        set "STILLTHERE=%%a"
    )
    if defined STILLTHERE (
        echo.
        echo   WARNING: port 17613 is still held by pid !STILLTHERE! after trying
        echo   to close the previous bridge. If the bridge below fails to start,
        echo   close that process manually in Task Manager ^(or restart Windows^)
        echo   and run start.bat again.
        echo.
        call :log "WARNING: port 17613 still held by pid !STILLTHERE! after taskkill."
    )
)

echo.
echo  ############################################################
echo  ##                                                        ##
echo  ##   KEEP THIS TERMINAL OPEN - DO NOT CLOSE THIS WINDOW   ##
echo  ##                                                        ##
echo  ##   CipherScript stops working if you close it. Just       ##
echo  ##   minimize this window and leave it running.           ##
echo  ##                                                        ##
echo  ############################################################
echo.
call :log "Launching bridge.py with %PY%"
%PY% "%~dp0bridge.py"
set "BRIDGE_EXIT=%errorlevel%"
call :log "bridge.py exited with code %BRIDGE_EXIT%"

echo.
if not "%BRIDGE_EXIT%"=="0" (
    echo   Bridge stopped with ERROR code %BRIDGE_EXIT% - scroll up for the Python
    echo   error message and include THIS WHOLE WINDOW in any bug report.
    echo   Log file: logs\start.log
) else (
    echo   Bridge stopped normally.
)
echo   Press any key to close.
pause >nul
exit /b 0

REM --- Subroutine: verify %PY% is a real, usable Python ------------------------
:validate_py
%PY% -m pip --version >nul 2>nul || exit /b 1
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
exit /b %errorlevel%

REM --- Subroutine: append a line to start.log (best-effort, never blocks) -----
:log
>>"%LOGFILE%" 2>nul echo(%~1
exit /b 0
