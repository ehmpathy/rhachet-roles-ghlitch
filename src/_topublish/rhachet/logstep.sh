#!/usr/bin/env bash
set -Eeuo pipefail

logrun() {
  local label="$1"; shift
  [[ "${1-}" == "--" ]] && shift || true

  local start_us end_us dur_us
  if [[ -n ${EPOCHREALTIME-} ]]; then start_us="${EPOCHREALTIME/./}"; else start_us="$(( $(date +%s) * 1000000 ))"; fi
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') ▶ ${label} …" >&2

  "$@"; local rc=$?

  if [[ -n ${EPOCHREALTIME-} ]]; then end_us="${EPOCHREALTIME/./}"; else end_us="$(( $(date +%s) * 1000000 ))"; fi
  dur_us=$(( end_us - start_us ))
  local ms=$(( (dur_us + 500) / 1000 )); local s=$(( ms / 1000 )); local rem_ms=$(( ms % 1000 ))

  if (( rc == 0 )); then
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') ✔ ${label} (${s}s ${rem_ms}ms)" >&2
  else
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') ✖ ${label} (exit ${rc}, ${s}s ${rem_ms}ms)" >&2
  fi
  return "$rc"
}

# nested step helper (uses logrun under the hood, indented label)
logstep() {
  local label="$1"; shift
  logrun " ↳ ${label}" -- "$@"
}

# your multi-step procedure
release() {
  logstep "clean"         -- rm -rf dist
  logstep "build"         -- npm run build
  logstep "unit tests"    -- npm test
  logstep "package"       -- npm pack
  logstep "publish dryrun" -- npm publish --dry-run
}

# run the whole flow with one timed wrapper
logrun "release pipeline" release
