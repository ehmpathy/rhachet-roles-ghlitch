with_logrun() {
  local label="$1"; shift
  local tmp; tmp="$(mktemp)"
  # read the body (heredoc) into a temp file
  cat > "$tmp"
  # run the block in a fresh bash with strict flags and your env
  logrun "$label" -- bash -Eeuo pipefail "$tmp"
  local rc=$?
  rm -f "$tmp"
  return "$rc"
}

# # usage
# with_logrun "release pipeline" <<'BASH'
# rm -rf dist
# npm run build
# npm test
# npm pack
# npm publish --dry-run
# BASH
