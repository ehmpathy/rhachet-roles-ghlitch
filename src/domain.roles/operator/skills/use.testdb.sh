#!/usr/bin/env bash
######################################################################
# 🦺 use.testdb — start local testdb (docker postgres with schema)
#
# .what = provisions local postgres instance for integration tests
#
# .why  = integration tests require a real postgres instance with
#         the full schema applied. this skill provisions one locally.
#
# .when = use before:
#         - npm run test:integration
#         - npm run test:acceptance:locally
#         - manual database exploration
#
# usage:
#   rhx use.testdb
#   rhx use.testdb help
#
# prerequisites:
#   - docker daemon active
#
# provides:
#   - postgres 13 at localhost:7821
#   - database and schema applied from provision/schema/sql
#   - full schema migrations applied
#
# guarantee:
#   - exit 0 = testdb ready
#   - exit 1 = malfunction (docker error, schema failure)
#   - exit 2 = constraint (docker not active)
######################################################################
set -euo pipefail

# parse args (skip rhachet args, check for help)
while [[ $# -gt 0 ]]; do
  case $1 in
    --skill|--repo|--role)
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🦺 use.testdb"
      echo ""
      echo "usage:"
      echo "  rhx use.testdb"
      echo ""
      echo "prerequisites:"
      echo "  - docker daemon active"
      echo ""
      echo "provides:"
      echo "  - postgres at localhost:7821"
      echo "  - schema from provision/schema/sql applied"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# check docker is active
if ! docker info >/dev/null 2>&1; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 use.testdb"
  echo "   ├─ docker daemon not active"
  echo "   └─ hint: start docker desktop or 'systemctl start docker'"
  exit 2
fi

COMPOSE_FILE="provision/docker/testdb/docker-compose.yml"

# ── nest ────────────────────────────────────────────────────────────────────────────
# sourced ONCE, unconditionally, above the header: this skill frames THREE children
# (the start, the self-heal, the retry) plus the log dump on the failure path. every
# one of them RENDERS — npm prints its own banner and docker compose narrates each
# container it touches — so un-framed they stacked at column 0 inside this skill's own
# tree (rule.require.nest-subskill-output-in-buckets).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_.nest.sh"

# .what = clear whatever container holds a testdb port, then renew the anon volume
# .why  = a start failure is most often a wedged state — a stale container that leaked
#         the port (e.g. after a crash), or a data dir left by an older postgres major
#         (pg13 vs the compose's pg15). matched by PUBLISHED PORT, so a leftover under a
#         different name is still caught (declapract's provision:testdb:docker:clear).
# .note = a shell function, so the whole self-heal is ONE child and therefore ONE bucket.
#         two buckets would claim two independent steps; this is one remedy.
# .note = no `2>/dev/null || true` per command. that was a failhide — it hid the reason a
#         heal did not help, right at the moment a human needed it. the caller's `|| true`
#         keeps a heal miss non-fatal, and the bucket now shows what actually happened.
heal_testdb_state() {
  local ports=()
  local held=()
  mapfile -t ports < <(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.services[].ports[]?.published')
  for port in "${ports[@]}"; do
    mapfile -t held < <(docker ps -a -f "publish=$port" -q)
    [[ ${#held[@]} -gt 0 ]] && docker rm -f "${held[@]}"
  done
  docker compose -f "$COMPOSE_FILE" down -v
}

echo "🐈 chartin course..."
echo ""
echo "🦺 use.testdb"

# findsert-fast happy path: `up -d --wait` is a near-instant no-op when the
# container is already healthy — so a re-run is free, no recreate per call.
echo "   ├─ start testdb..."
if run_sub_bucket "   │  " npm run start:testdb; then
  echo "   └─ testdb up"
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🦺 use.testdb"
  echo "   └─ testdb ready at localhost:7821"
  exit 0
fi

# self-heal, then retry once.
echo "   ├─ start failed — self-heal..."
run_sub_bucket "   │  " heal_testdb_state || true

echo "   ├─ retry testdb..."
if run_sub_bucket "   │  " npm run start:testdb; then
  echo "   └─ testdb up"
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🦺 use.testdb"
  echo "   └─ testdb ready at localhost:7821"
  exit 0
fi

# still wedged — surface the container logs so the cause is diagnosable, not opaque,
# then fail loud (a silent absence would let integration tests run against no db).
echo "   └─ halted: testdb did not start"
echo ""
echo "🐈 wet paws..."
echo ""
echo "🦺 use.testdb"
echo "   ├─ testdb did not start (even after volume renewal)"
echo "   └─ container logs..."
run_sub_bucket "      " docker logs ghlitch-testdb || true
exit 1
