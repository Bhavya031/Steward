#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BUN_BIN=""

fail() {
  printf 'Steward install: %s\n' "$*" >&2
  return 1
}

require_macos() {
  if [ "$1" != "Darwin" ]; then
    fail "unsupported platform '$1'; Steward requires macOS."
  fi
}

brew_prefix_for_arch() {
  case "$1" in
    arm64) printf '/opt/homebrew\n' ;;
    x86_64) printf '/usr/local\n' ;;
    *) fail "unsupported Mac architecture '$1'; expected arm64 or x86_64." ;;
  esac
}

require_executable() {
  local label="$1"
  local path="$2"
  local action="$3"
  if [ ! -x "$path" ]; then
    fail "$label is required at $path. $action"
  fi
}

require_command() {
  local command_name="$1"
  local action="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail "$command_name is required. $action"
  fi
}

ensure_bun() {
  local brew_prefix="$1"
  local brew_bin="$brew_prefix/bin/brew"
  local existing=""
  existing="$(command -v bun 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    require_executable "Bun" "$existing" "Repair or reinstall Bun."
    BUN_BIN="$existing"
    printf 'Bun already available: %s\n' "$BUN_BIN"
    return
  fi

  require_executable "Homebrew" "$brew_bin" \
    "Install Homebrew from https://brew.sh and rerun ./install.sh."
  printf 'Bun is missing. Steward can run this approved Homebrew command:\n'
  printf '  %s install bun\n' "$brew_bin"
  printf 'Install Bun now? [y/N] '
  local reply=""
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) fail "Bun installation was not approved; no changes were made." ;;
  esac
  "$brew_bin" install bun
  BUN_BIN="$brew_prefix/bin/bun"
  require_executable "Bun" "$BUN_BIN" \
    "Homebrew completed without providing $BUN_BIN."
  printf 'Bun installed: %s\n' "$BUN_BIN"
}

prepare_steward_state() {
  local home_dir="$1"
  case "$home_dir" in
    /*) ;;
    *) fail "HOME must be an absolute path." ;;
  esac
  local steward_cache="$home_dir/Library/Caches/Steward"
  local model_cache="$steward_cache/models"
  mkdir -p "$model_cache"
  chmod 700 "$steward_cache" "$model_cache"
}

install_project() {
  local bun_bin="$1"
  local repository="$2"
  local home_dir="$3"
  if [ ! -f "$repository/package.json" ] || [ ! -f "$repository/bun.lockb" ]; then
    fail "package.json and the committed bun.lockb are required in $repository."
  fi
  printf 'Installing locked dependencies from bun.lockb...\n'
  (
    cd "$repository"
    "$bun_bin" install --frozen-lockfile
    printf 'Building the production UI...\n'
    "$bun_bin" run ui:build
  )
  if [ ! -f "$repository/ui/dist/index.html" ]; then
    fail "production UI build did not create ui/dist/index.html."
  fi
  prepare_steward_state "$home_dir"
}

main() {
  require_macos "$(uname -s)"
  local machine
  machine="$(uname -m)"
  local brew_prefix
  brew_prefix="$(brew_prefix_for_arch "$machine")"
  local brew_bin="$brew_prefix/bin/brew"
  require_executable "Homebrew" "$brew_bin" \
    "Install Homebrew from https://brew.sh and rerun ./install.sh."
  if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    fail "Apple Command Line Tools are required. Run: xcode-select --install"
  fi
  export PATH="$brew_prefix/bin:$PATH"
  require_command "git" "Install Apple Command Line Tools with: xcode-select --install"
  ensure_bun "$brew_prefix"
  install_project "$BUN_BIN" "$SCRIPT_DIR" "$HOME"
  printf '\nSteward installation complete for %s using %s.\n' "$machine" "$brew_prefix"
  printf 'From the repository root, start Steward with:\n'
  printf '  bun run server/index.ts --serve\n'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
