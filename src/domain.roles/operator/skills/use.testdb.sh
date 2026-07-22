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

echo "🐈 chartin course..."
echo ""
echo "🦺 use.testdb"

# findsert-fast happy path: `up -d --wait` is a near-instant no-op when the
# container is already healthy — so a re-run is free, no recreate per call.
echo "   ├─ start testdb..."
if npm run start:testdb; then
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🦺 use.testdb"
  echo "   └─ testdb ready at localhost:7821"
  exit 0
fi

# self-heal: a start failure is most often a wedged state — a stale container that
# leaked the port (e.g. after a crash), or a data dir left by an older postgres major
# (pg13 vs the compose's pg15). clear any container that holds the testdb's ports
# (declapract's provision:testdb:docker:clear, by published port so a differently-named
# leftover is still caught), renew the anon volume (down -v), and retry once.
echo "   ├─ start failed — self-heal..."
for port in $(docker compose -f "$COMPOSE_FILE" config --format json | jq -r '.services[].ports[]?.published'); do
  docker rm -f $(docker ps -a -f "publish=$port" -q) 2>/dev/null || true
done
docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true

echo "   └─ retry testdb..."
if npm run start:testdb; then
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🦺 use.testdb"
  echo "   └─ testdb ready at localhost:7821"
  exit 0
fi

# still wedged — surface the container logs so the cause is diagnosable, not opaque,
# then fail loud (a silent absence would let integration tests run against no db).
echo ""
echo "🐈 wet paws..."
echo ""
echo "🦺 use.testdb"
echo "   ├─ testdb did not start (even after volume renewal)"
echo "   └─ container logs follow:"
docker logs ghlitch-testdb 2>&1 || true
exit 1
