#!/bin/sh
# Use absolute macOS tools so the offline package needs no system Node or PATH.
case "$0" in
  */*) KARHUTLA_DIRECTORY=${0%/*} ;;
  *) KARHUTLA_DIRECTORY=. ;;
esac
CDPATH= cd -- "$KARHUTLA_DIRECTORY" || exit 1
KARHUTLA_DIRECTORY=$PWD
KARHUTLA_PAUSE_ON_ERROR=1
export KARHUTLA_PAUSE_ON_ERROR

karhutla_fail() {
  printf '%s\n' "$@" >&2
  if [ -t 0 ]; then
    printf 'Press Return to close this window. '
    IFS= read -r KARHUTLA_REPLY
  fi
  exit 1
}

karhutla_hash() {
  KARHUTLA_HASH_OUTPUT=$(/usr/bin/shasum -a 256 "$1") || return 1
  KARHUTLA_HASH=${KARHUTLA_HASH_OUTPUT%% *}
  case "$KARHUTLA_HASH" in ''|*[!0-9a-f]*) return 1 ;; esac
  [ "${#KARHUTLA_HASH}" -eq 64 ]
}

karhutla_check_cached_node() {
  [ ! -L "$KARHUTLA_CACHED_NODE" ] && [ -f "$KARHUTLA_CACHED_NODE" ] && [ -x "$KARHUTLA_CACHED_NODE" ] || return 1
  karhutla_hash "$KARHUTLA_CACHED_NODE" && [ "$KARHUTLA_HASH" = "$KARHUTLA_NODE_HASH" ]
}

if [ -x "$KARHUTLA_DIRECTORY/runtime/bin/node" ]; then
  KARHUTLA_BUNDLED_NODE=$KARHUTLA_DIRECTORY/runtime/bin/node
  [ ! -L "$KARHUTLA_BUNDLED_NODE" ] && [ -f "$KARHUTLA_BUNDLED_NODE" ] || karhutla_fail 'The included Node.js runtime must be a regular file. Extract a fresh Mac release ZIP.'
  karhutla_hash "$KARHUTLA_BUNDLED_NODE" || karhutla_fail 'Could not verify the included Node.js runtime.'
  KARHUTLA_NODE_HASH=$KARHUTLA_HASH
  if [ -z "${KARHUTLA_RUNTIME_CACHE:-}" ]; then
    [ -n "${HOME:-}" ] || karhutla_fail 'Karhutla could not locate your user Library for its reusable runtime.'
    KARHUTLA_RUNTIME_CACHE=$HOME/Library/Application\ Support/Karhutla/RuntimeCache
  fi
  case "$KARHUTLA_RUNTIME_CACHE" in /*) ;; *) karhutla_fail 'The runtime cache must use an absolute folder path.' ;; esac
  [ ! -L "$KARHUTLA_RUNTIME_CACHE" ] || karhutla_fail 'The Karhutla runtime cache cannot be a symbolic link.'
  umask 077
  /bin/mkdir -p "$KARHUTLA_RUNTIME_CACHE" || karhutla_fail 'Could not create the Karhutla runtime cache in your user Library.'
  KARHUTLA_CACHE_ENTRY=$KARHUTLA_RUNTIME_CACHE/$KARHUTLA_NODE_HASH
  [ ! -L "$KARHUTLA_CACHE_ENTRY" ] || karhutla_fail 'The Karhutla runtime cache entry cannot be a symbolic link.'
  /bin/mkdir -p "$KARHUTLA_CACHE_ENTRY" || karhutla_fail 'Could not prepare the Karhutla runtime cache.'
  KARHUTLA_CACHED_NODE=$KARHUTLA_CACHE_ENTRY/node
  if [ ! -e "$KARHUTLA_CACHED_NODE" ] && [ ! -L "$KARHUTLA_CACHED_NODE" ]; then
    printf '%s\n' 'Preparing a reusable Node.js runtime for this Mac.' 'If macOS blocks node, approve it in System Settings → Privacy & Security → Open Anyway, then run this launcher again.'
    KARHUTLA_TEMP_NODE=$(/usr/bin/mktemp "$KARHUTLA_CACHE_ENTRY/.node.XXXXXXXX") || karhutla_fail 'Could not prepare the reusable Node.js runtime.'
    trap '[ -z "${KARHUTLA_TEMP_NODE:-}" ] || /bin/rm -f "$KARHUTLA_TEMP_NODE"' 0
    # macOS cp preserves extended attributes, including first-open quarantine.
    /bin/cp -p "$KARHUTLA_BUNDLED_NODE" "$KARHUTLA_TEMP_NODE" || karhutla_fail 'Could not copy the reusable Node.js runtime.'
    karhutla_hash "$KARHUTLA_TEMP_NODE" && [ "$KARHUTLA_HASH" = "$KARHUTLA_NODE_HASH" ] || karhutla_fail 'The reusable Node.js runtime failed verification.'
    # A hard link installs atomically without replacing an already approved
    # runtime when two launchers prepare the same cache at the same time.
    /bin/ln "$KARHUTLA_TEMP_NODE" "$KARHUTLA_CACHED_NODE" 2>/dev/null || karhutla_check_cached_node || karhutla_fail 'Could not install the reusable Node.js runtime. The existing cache entry was left in place.'
    /bin/rm -f "$KARHUTLA_TEMP_NODE"
    KARHUTLA_TEMP_NODE=
  fi
  karhutla_check_cached_node || karhutla_fail 'The cached Node.js runtime is damaged, not executable, or a symbolic link.' "Move this cache folder to the Trash and try again: $KARHUTLA_CACHE_ENTRY"
  exec "$KARHUTLA_CACHED_NODE" "$KARHUTLA_DIRECTORY/scripts/start-karhutla.mjs" "$@"
fi
if [ -e "$KARHUTLA_DIRECTORY/runtime/bin/node" ] || [ -L "$KARHUTLA_DIRECTORY/runtime/bin/node" ]; then
  karhutla_fail 'The included Node.js runtime is not executable. Extract a fresh Mac release ZIP with Finder or Archive Utility.'
fi
if command -v node >/dev/null 2>&1; then
  exec node "$KARHUTLA_DIRECTORY/scripts/start-karhutla.mjs" "$@"
fi
karhutla_fail 'Karhutla could not find Node.js.' 'Use the Mac release ZIP, which includes its own runtime.' 'For a Git checkout, install Node.js and run npm ci first.'
