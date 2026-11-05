#!/bin/sh
# Keep path handling independent of PATH so the offline package needs no tools.
case "$0" in
  */*) KARHUTLA_DIRECTORY=${0%/*} ;;
  *) KARHUTLA_DIRECTORY=. ;;
esac
CDPATH= cd -- "$KARHUTLA_DIRECTORY" || exit 1
KARHUTLA_DIRECTORY=$PWD
KARHUTLA_PAUSE_ON_ERROR=1
export KARHUTLA_PAUSE_ON_ERROR

if [ -x "$KARHUTLA_DIRECTORY/runtime/bin/node" ]; then
  exec "$KARHUTLA_DIRECTORY/runtime/bin/node" "$KARHUTLA_DIRECTORY/scripts/start-karhutla.mjs" "$@"
fi
if [ -e "$KARHUTLA_DIRECTORY/runtime/bin/node" ]; then
  printf '%s\n' 'The included Node.js runtime is not executable. Extract a fresh Mac release ZIP with Finder or Archive Utility.' >&2
  if [ -t 0 ]; then
    printf 'Press Return to close this window. '
    IFS= read -r KARHUTLA_REPLY
  fi
  exit 1
fi
if command -v node >/dev/null 2>&1; then
  exec node "$KARHUTLA_DIRECTORY/scripts/start-karhutla.mjs" "$@"
fi
printf '%s\n' 'Karhutla could not find Node.js.' 'Use the Mac release ZIP, which includes its own runtime.' 'For a Git checkout, install Node.js and run npm ci first.' >&2
if [ -t 0 ]; then
  printf 'Press Return to close this window. '
  IFS= read -r KARHUTLA_REPLY
fi
exit 1
