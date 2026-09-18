#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# MacOS_Start.command  (Unity edition)
# ---------------------------------------------------------------------------
#  Self-contained macOS/Linux launcher for the CipherScript Unity bridge.
#  Double-clickable in Finder (that is why it is a .command, not a .sh: a .sh
#  opens in an editor instead of running). It finds Python, ensures the two
#  required tools are installed (websockets + uv), frees a previous bridge
#  still holding the port, then runs bridge.py itself.
#  The Windows equivalent is start.bat.
# ---------------------------------------------------------------------------
set -u

# Run from the folder this script lives in, so bridge.py is found regardless of
# where Finder launched it from.
cd "$(dirname "$0")" || exit 1

BRIDGE_PORT="${CS_BRIDGE_PORT:-17613}"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/start.log"
mkdir -p "$LOG_DIR" 2>/dev/null

log() {
    # Best-effort append; never abort the launch if logging fails.
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

pause_and_exit() {
    # A double-clicked .command opens a fresh Terminal window; without this the
    # window closes instantly and any error scrolls away unread.
    echo
    read -n 1 -s -r -p "Press any key to close this window..."
    echo
    exit "${1:-0}"
}

echo
echo "  === CipherScript Unity Bridge ==="
echo
log "===== MacOS_Start.command launched (Unity edition) ====="

# --- 0. bridge.py must be next to us ---------------------------------------
if [ ! -f "bridge.py" ]; then
    echo "  ERROR: bridge.py was not found next to this launcher."
    echo "  Extract the WHOLE download, then run MacOS_Start.command from that folder."
    log "FATAL: bridge.py missing next to launcher."
    pause_and_exit 1
fi

# --- 1. Find a usable Python (3.9+ with a working pip) ----------------------
echo "  [1/3] Looking for Python 3.9+..."
PY=""
py_ok() {
    command -v "$1" >/dev/null 2>&1 || return 1
    "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1
}
for cand in python3 python; do
    if py_ok "$cand"; then
        PY="$cand"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "  ERROR: Python 3.9 or newer was not found."
    echo "  Install it from https://www.python.org/downloads/ then run this again."
    echo "  (On macOS you can also run:  xcode-select --install)"
    log "FATAL: no Python 3.9+ found."
    pause_and_exit 1
fi
PY_VER="$("$PY" --version 2>&1)"
echo "        Found: $PY ($PY_VER)"
log "Python found: $PY ($PY_VER)"

# --- 2. Dependencies: websockets + uv (uvx runs the Unity MCP server) --------
echo "  [2/3] Checking dependencies (websockets + uv)..."
if ! "$PY" -c "import websockets" >/dev/null 2>&1; then
    echo "        Installing websockets - first time only..."
    log "websockets missing, installing via pip --user."
    if ! "$PY" -m pip install --user websockets >/dev/null 2>&1; then
        # Newer macOS Pythons (Homebrew / python.org) mark the environment as
        # externally managed (PEP 668) and refuse --user. Retry allowing it,
        # since this is the user's own machine and a single small pure-Python
        # dependency, not a system package.
        log "pip --user failed; retrying with --break-system-packages."
        "$PY" -m pip install --user --break-system-packages websockets >/dev/null 2>&1 || true
    fi
    if ! "$PY" -c "import websockets" >/dev/null 2>&1; then
        echo
        echo "  ERROR: could not install the 'websockets' library automatically."
        echo "  Install it yourself, then run this again:"
        echo "      $PY -m pip install --user websockets"
        log "FATAL: websockets install failed."
        pause_and_exit 1
    fi
fi
echo "        websockets OK"
log "websockets library OK."

if ! command -v uvx >/dev/null 2>&1 && ! "$PY" -m uvx --version >/dev/null 2>&1; then
    echo "        Installing uv (needed for the Unity MCP server)..."
    log "uv missing, installing via pip --user."
    "$PY" -m pip install --user uv >/dev/null 2>&1 || \
        "$PY" -m pip install --user --break-system-packages uv >/dev/null 2>&1 || true
fi
if command -v uvx >/dev/null 2>&1 || "$PY" -m uvx --version >/dev/null 2>&1; then
    echo "        uv OK"
    log "uv OK."
else
    # uvx may have landed in the Python Scripts dir without being on PATH;
    # prepend it so both the bridge and its spawned uvx child can find it.
    SCRIPTS_DIR="$("$PY" -c "import sysconfig;print(sysconfig.get_path('scripts'))" 2>/dev/null || true)"
    if [ -n "$SCRIPTS_DIR" ] && [ -x "$SCRIPTS_DIR/uvx" ]; then
        export PATH="$SCRIPTS_DIR:$PATH"
        echo "        Found uvx at $SCRIPTS_DIR/uvx - added it to PATH for this session."
        echo "        uv OK"
        log "uvx found via Scripts dir PATH prepend."
    else
        echo
        echo "  ERROR: uv/uvx is not available. It is required to run the Unity MCP server."
        echo "  Install it yourself, then run this again:"
        echo "      $PY -m pip install uv"
        log "FATAL: uvx not found after install attempt."
        pause_and_exit 1
    fi
fi

# --- 3. Replace any previous bridge holding the port ------------------------
echo "  [3/3] Starting bridge..."
if command -v lsof >/dev/null 2>&1; then
    OLD_PID="$(lsof -ti "tcp:$BRIDGE_PORT" -s TCP:LISTEN 2>/dev/null | head -n1)"
    if [ -n "${OLD_PID:-}" ]; then
        echo "        A previous bridge (pid $OLD_PID) is on port $BRIDGE_PORT. Replacing it..."
        log "Killing previous bridge pid $OLD_PID on port $BRIDGE_PORT."
        kill -TERM "$OLD_PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$OLD_PID" 2>/dev/null; then
            kill -9 "$OLD_PID" 2>/dev/null || true
            sleep 1
        fi
    fi
fi

echo
echo "  ############################################################"
echo "  ##   KEEP THIS WINDOW OPEN - DO NOT CLOSE IT              ##"
echo "  ##   CipherScript stops working if you close it. Just       ##"
echo "  ##   minimize this window and leave it running.           ##"
echo "  ############################################################"
echo
log "Launching bridge.py with $PY"

"$PY" bridge.py
BRIDGE_EXIT=$?
log "bridge.py exited with code $BRIDGE_EXIT"

echo
if [ "$BRIDGE_EXIT" -ne 0 ]; then
    echo "  Bridge stopped with ERROR code $BRIDGE_EXIT - scroll up for the Python"
    echo "  error and include this whole window in any bug report (logs/start.log)."
else
    echo "  Bridge stopped normally."
fi
pause_and_exit "$BRIDGE_EXIT"
