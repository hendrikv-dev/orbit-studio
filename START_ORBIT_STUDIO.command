#!/bin/zsh
set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

pause_and_exit() {
  local status="${1:-1}"
  print ""
  print "Press Return to close this window."
  read -r
  exit "$status"
}

print ""
print "Orbit Studio"
print "Project: $PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  print ""
  print "Node.js is not installed. Orbit Studio requires Node 24 or 25."
  pause_and_exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  print ""
  print "npm is not available. Reinstall Node.js with npm included."
  pause_and_exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 24 || NODE_MAJOR >= 26 )); then
  print ""
  print "Orbit Studio requires Node 24 or 25."
  print "Installed: $(node --version)"
  pause_and_exit 1
fi

print "Node: $(node --version)"
print "npm:  $(npm --version)"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)
    ROLLUP_NATIVE="@rollup/rollup-darwin-x64"
    ;;
  arm64)
    ROLLUP_NATIVE="@rollup/rollup-darwin-arm64"
    ;;
  *)
    print ""
    print "Unsupported Mac architecture: $ARCH"
    pause_and_exit 1
    ;;
esac

install_dependencies() {
  print ""
  print "Installing fresh Mac dependencies. This is required only after a new extraction."
  rm -rf node_modules
  npm ci --include=optional --no-audit --no-fund
}

validate_rollup() {
  node --input-type=module -e 'await import("rollup")' >/dev/null 2>&1
}

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  if ! install_dependencies; then
    print ""
    print "Dependency installation failed. Check the npm error above and your internet connection."
    pause_and_exit 1
  fi
fi

# A copied node_modules folder can leave Rollup's native binary unusable on macOS.
# Validate it before startup and replace it from npm when needed.
if ! validate_rollup; then
  print ""
  print "Repairing the Rollup binary for this Mac."
  ROLLUP_VERSION="$(node -p 'require("./node_modules/rollup/package.json").version' 2>/dev/null || true)"

  if [[ -z "$ROLLUP_VERSION" ]]; then
    if ! install_dependencies; then
      print ""
      print "Orbit Studio could not reinstall its dependencies."
      pause_and_exit 1
    fi
  else
    rm -rf "node_modules/${ROLLUP_NATIVE}"
    if ! npm install --no-save --package-lock=false --include=optional --no-audit --no-fund "${ROLLUP_NATIVE}@${ROLLUP_VERSION}"; then
      print ""
      print "The targeted Rollup repair failed. Trying one clean reinstall."
      if ! install_dependencies; then
        print ""
        print "Orbit Studio could not install a working Rollup binary."
        pause_and_exit 1
      fi
    fi
  fi

  # Remove download quarantine metadata if macOS attached it to the fresh native package.
  xattr -dr com.apple.quarantine "node_modules/${ROLLUP_NATIVE}" >/dev/null 2>&1 || true

  if ! validate_rollup; then
    print ""
    print "The Rollup binary is still blocked by macOS."
    print "Delete this extracted folder, extract the ZIP again, and rerun the launcher."
    pause_and_exit 1
  fi
fi

PORT=5173
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if (( PORT > 5193 )); then
    print ""
    print "No available local port was found between 5173 and 5193."
    pause_and_exit 1
  fi
done

URL="http://127.0.0.1:$PORT/"
print ""
print "Starting Orbit Studio at $URL"
print "The homepage will open automatically."
print "Keep this Terminal window open. Press Control-C to stop Orbit Studio."
print ""

node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$PORT" --strictPort &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1' EXIT INT TERM

for attempt in {1..100}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    wait "$SERVER_PID"
    exit $?
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID"
    STATUS=$?
    print ""
    print "Orbit Studio stopped before the browser could open."
    pause_and_exit "$STATUS"
  fi

  sleep 0.15
done

print ""
print "Orbit Studio did not become ready in time."
kill "$SERVER_PID" >/dev/null 2>&1 || true
pause_and_exit 1
