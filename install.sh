#!/bin/bash -p
# Bash imports exported shell functions (BASH_FUNC_name%%) and sources BASH_ENV before the
# first line of a script runs, so a caller could otherwise replace the built-ins used to
# resolve executables. Privileged mode (-p) blocks both at interpreter startup, before
# anything shadowable can execute. The re-exec covers invocations that bypass the shebang,
# such as `bash install.sh`. Sourcing this file skips the re-exec, so every resolution call
# site below also uses `builtin` and `[[ ]]`, which no function or alias can shadow.
# Captured before anything else runs: calling a shadowed builtin such as `exec` pushes and
# pops a function context, which leaves BASH_SOURCE empty at top level on Bash 3.2. A plain
# assignment cannot be shadowed, so this keeps a trustworthy sourced-versus-executed answer
# even after an imported function has run. An environment-supplied value is overwritten.
__STEWARD_SELF="${BASH_SOURCE[0]}"

# Streamed-install bootstrap. When run from a real file (./install.sh, `bash install.sh`,
# or the privileged re-exec) __STEWARD_SELF is that file and this block is skipped
# entirely, so every hardening step below runs unchanged. When the installer is streamed
# over a pipe (read from stdin, so there is no file and no checkout) clone the repository
# and re-exec its on-disk install.sh, which regains privileged mode from its shebang and
# performs the full hardened install. Cloning uses git by absolute path (a name with a
# slash cannot be shadowed by a shell function). The path that is privileged from line one
# is the git-clone install documented in the README; this convenience path hands control
# to that same hardened file before resolving any executable.
if [[ ! -f "${__STEWARD_SELF:-}" ]]; then
  set -euo pipefail
  umask 077
  __steward_repo="${STEWARD_REPO:-https://github.com/Bhavya031/Steward.git}"
  __steward_dir="${STEWARD_DIR:-${HOME:?HOME must be set}/Steward}"
  if [[ -e "$__steward_dir" ]]; then
    builtin printf 'Steward install: %s already exists. Remove it or set STEWARD_DIR to an unused path.\n' "$__steward_dir" >&2
    exit 1
  fi
  builtin printf 'Fetching Steward into %s ...\n' "$__steward_dir"
  /usr/bin/git clone --depth 1 "$__steward_repo" "$__steward_dir"
  exec /bin/bash -p "$__steward_dir/install.sh"
fi

case $- in
  *p*) ;;
  *)
    if [[ "$__STEWARD_SELF" == "$0" ]]; then
      exec /bin/bash -p "$0" "$@"
    fi
    ;;
esac

# Backstop: `exec` is a builtin, so an imported function can swallow the re-exec above and
# let execution continue unprivileged. A `${name[1]:?}` expansion is resolved during word
# expansion, before command lookup, so no function or alias can intercept it, and the
# subscript keeps it fatal even when the caller exports a same-named environment variable
# (an environment variable is a scalar, so index 1 is always unset).
case $- in
  *p*) ;;
  *)
    if [[ "$__STEWARD_SELF" == "$0" ]]; then
      : "${__STEWARD_PRIVILEGED_REEXEC_FAILED[1]:?install.sh must run under bash -p; re-exec was blocked}"
    fi
    ;;
esac

set -euo pipefail
IFS=$'\n\t'
umask 077

case $- in
  *p*)
    unalias -a || true
    shopt -u expand_aliases
    unset -f cd pwd printf read command test '[' builtin type exec unset unalias shopt || true
    ;;
esac

SCRIPT_PATH="${BASH_SOURCE[0]}"
case "$SCRIPT_PATH" in
  /*) ;;
  *) SCRIPT_PATH="$PWD/$SCRIPT_PATH" ;;
esac
SCRIPT_PARENT="${SCRIPT_PATH%/*}"
if [[ -z "$SCRIPT_PARENT" ]]; then
  SCRIPT_PARENT="/"
fi
SCRIPT_DIR="$(builtin cd -- "$SCRIPT_PARENT" && builtin pwd -P)"
BUN_BIN=""
CODEX_BIN=""

fail() {
  builtin printf 'Steward install: %s\n' "$*" >&2
  return 1
}

require_macos() {
  if [[ "$1" != "Darwin" ]]; then
    fail "unsupported platform '$1'; Steward requires macOS."
  fi
}

brew_prefix_for_arch() {
  case "$1" in
    arm64) builtin printf '/opt/homebrew\n' ;;
    x86_64) builtin printf '/usr/local\n' ;;
    *) fail "unsupported Mac architecture '$1'; expected arm64 or x86_64." ;;
  esac
}

require_executable() {
  local label="$1"
  local path="$2"
  local action="$3"
  if [[ ! -f "$path" || ! -x "$path" ]]; then
    fail "$label is required at $path. $action"
  fi
}

absolute_executable_path() {
  local candidate="$1"
  local parent=""
  local name=""
  case "$candidate" in
    /*) ;;
    *) candidate="$PWD/$candidate" ;;
  esac
  parent="${candidate%/*}"
  name="${candidate##*/}"
  if [[ -z "$parent" ]]; then
    parent="/"
  fi
  if [[ -z "$name" ]]; then
    return 1
  fi
  parent="$(builtin cd -- "$parent" 2>/dev/null && builtin pwd -P)" || return 1
  builtin printf '%s/%s\n' "$parent" "$name"
}

executable_from_path() {
  local name="$1"
  local remaining="${PATH:-}"
  local entry=""
  local candidate=""
  local has_more=""

  if [[ -z "$remaining" ]]; then
    return 1
  fi
  while :; do
    case "$remaining" in
      *:*)
        entry="${remaining%%:*}"
        remaining="${remaining#*:}"
        has_more="yes"
        ;;
      *)
        entry="$remaining"
        has_more=""
        ;;
    esac
    if [[ -z "$entry" ]]; then
      entry="."
    fi
    candidate="$(absolute_executable_path "$entry/$name")" || candidate=""
    if [[ -n "$candidate" && -f "$candidate" && -x "$candidate" ]]; then
      builtin printf '%s\n' "$candidate"
      return
    fi
    if [[ -z "$has_more" ]]; then
      break
    fi
  done
  return 1
}

require_command() {
  local command_name="$1"
  local action="$2"
  if ! builtin command -v "$command_name" >/dev/null 2>&1; then
    fail "$command_name is required. $action"
  fi
}

ensure_bun() {
  local brew_prefix="$1"
  local brew_bin="$brew_prefix/bin/brew"
  local existing=""
  existing="$(executable_from_path bun 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    existing="$(absolute_executable_path "$existing")" || {
      fail "Bun was found but its executable path could not be resolved."
      return 1
    }
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
  builtin read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) fail "Bun installation was not approved; no changes were made." ;;
  esac
  "$brew_bin" install bun
  BUN_BIN="$(absolute_executable_path "$brew_prefix/bin/bun")" || {
    fail "Homebrew completed but the Bun executable path could not be resolved."
    return 1
  }
  require_executable "Bun" "$BUN_BIN" \
    "Homebrew completed without providing $BUN_BIN."
  printf 'Bun installed: %s\n' "$BUN_BIN"
}

resolve_codex() {
  local candidate=""
  if [[ "${STEWARD_CODEX_BIN+x}" == "x" ]]; then
    candidate="${STEWARD_CODEX_BIN:-}"
    if [[ -z "$candidate" ]]; then
      fail "STEWARD_CODEX_BIN is set but empty. Set it to an executable Codex CLI path or unset it."
      return 1
    fi
    candidate="$(absolute_executable_path "$candidate")" || {
      fail "STEWARD_CODEX_BIN could not be resolved: $STEWARD_CODEX_BIN"
      return 1
    }
    require_executable "Codex CLI from STEWARD_CODEX_BIN" "$candidate" \
      "Fix STEWARD_CODEX_BIN or unset it to use \$HOME/.local/bin/codex or PATH." || return
    CODEX_BIN="$candidate"
    return
  fi

  if [[ -n "${HOME:-}" ]]; then
    candidate="$HOME/.local/bin/codex"
    if [[ -f "$candidate" && -x "$candidate" ]]; then
      CODEX_BIN="$(absolute_executable_path "$candidate")" || {
        fail "Codex CLI at $candidate could not be resolved."
        return 1
      }
      return
    fi
  fi

  candidate="$(executable_from_path codex 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    candidate="$(absolute_executable_path "$candidate")" || {
      fail "Codex CLI was found on PATH but its executable path could not be resolved."
      return 1
    }
    require_executable "Codex CLI" "$candidate" \
      "Repair Codex CLI or set STEWARD_CODEX_BIN to a working executable." || return
    CODEX_BIN="$candidate"
    return
  fi

  fail "Codex CLI was not found. Install it with 'npm install -g @openai/codex', or set STEWARD_CODEX_BIN to its executable path."
}

validate_codex_readiness() {
  local codex_bin="$1"
  local version=""
  local status=""
  local status_exit=0
  local diagnostic=""
  local login_command=""

  if ! version="$("$codex_bin" --version 2>&1)"; then
    fail "Codex CLI version check failed for $codex_bin. Repair Codex CLI or set STEWARD_CODEX_BIN to a working executable."
    return 1
  fi
  status="$("$codex_bin" login status 2>&1)" || status_exit="$?"
  if [[ "$status_exit" -ne 0 ]]; then
    if [[ -n "$status" ]]; then
      diagnostic=" (exit $status_exit): $status"
    else
      diagnostic=" with exit $status_exit"
    fi
    builtin printf -v login_command '%q login' "$codex_bin"
    fail "Codex CLI authentication is unavailable$diagnostic. Run: $login_command"
    return 1
  fi
  printf 'Codex ready: %s\n' "$version"
}

require_absolute_home() {
  local home_dir="$1"
  if [[ -z "$home_dir" ]]; then
    fail "HOME must be set to an absolute user directory before installing Steward."
    return 1
  fi
  case "$home_dir" in
    /*) ;;
    *)
      fail "HOME must be an absolute path; received: $home_dir"
      return 1
      ;;
  esac
}

prepare_steward_state() {
  local home_dir="$1"
  require_absolute_home "$home_dir"
  local steward_cache="$home_dir/Library/Caches/Steward"
  local model_cache="$steward_cache/models"
  mkdir -p "$model_cache"
  chmod 700 "$steward_cache" "$model_cache"
}

install_project() {
  local bun_bin="$1"
  local repository="$2"
  local home_dir="$3"
  if [[ ! -f "$repository/package.json" || ! -f "$repository/bun.lockb" ]]; then
    fail "package.json and the committed bun.lockb are required in $repository."
  fi
  printf 'Installing locked dependencies from bun.lockb...\n'
  (
    builtin cd -- "$repository"
    "$bun_bin" install --frozen-lockfile
    printf 'Building the production UI...\n'
    "$bun_bin" run ui:build
  )
  if [[ ! -f "$repository/ui/dist/index.html" ]]; then
    fail "production UI build did not create ui/dist/index.html."
  fi
  prepare_steward_state "$home_dir"
}

print_launch_instructions() {
  local bun_bin="$1"
  printf 'From the repository root, start Steward with:\n'
  printf '  %q run server/index.ts --serve\n' "$bun_bin"
}

main() {
  require_macos "$(/usr/bin/uname -s)"
  require_absolute_home "${HOME:-}"
  local machine
  machine="$(/usr/bin/uname -m)"
  local brew_prefix
  brew_prefix="$(brew_prefix_for_arch "$machine")"
  local brew_bin="$brew_prefix/bin/brew"
  require_executable "Homebrew" "$brew_bin" \
    "Install Homebrew from https://brew.sh and rerun ./install.sh."
  if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    fail "Apple Command Line Tools are required. Run: xcode-select --install"
  fi
  if [[ -n "${PATH:-}" ]]; then
    PATH="$brew_prefix/bin:$PATH"
  else
    PATH="$brew_prefix/bin"
  fi
  export PATH
  require_command "git" "Install Apple Command Line Tools with: xcode-select --install"
  ensure_bun "$brew_prefix"
  resolve_codex
  validate_codex_readiness "$CODEX_BIN"
  install_project "$BUN_BIN" "$SCRIPT_DIR" "${HOME:-}"
  printf '\nSteward installation complete for %s using %s.\n' "$machine" "$brew_prefix"
  print_launch_instructions "$BUN_BIN"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
