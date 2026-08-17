#!/usr/bin/env bash
# Deploy origin/main to the EC2 box that serves shathisheba.digigramventures.com.
# Run as the ubuntu user; every step that touches the app directory uses sudo
# because the directory is root-owned and pm2 runs as root.
#
# Usage:  bash /tmp/deploy-ec2.sh [ref]      (ref defaults to origin/main)
set -euo pipefail

APP=/var/www/html/shathisheba-admin
REF=${1:-origin/main}
PM2_APP=shathisheba-admin

cd "$APP"

echo "==> current"
sudo git log --oneline -1
PREV=$(sudo git rev-parse HEAD)

# A dirty tree means someone edited the server directly. Resetting over that
# would destroy work with no copy anywhere, so stop and let a human look.
if [ -n "$(sudo git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit, stash or discard before deploying." >&2
  sudo git status --porcelain >&2
  exit 1
fi

echo "==> fetching $REF"
sudo git fetch origin --quiet
sudo git reset --hard "$REF"
sudo git log --oneline -1

echo "==> installing"
sudo npm ci --no-audit --no-fund

# Next reuses whatever is already in .next. A directory left from a different
# Next major fails at page-data collection with PageNotFoundError, which reads
# like a missing route rather than a stale cache.
echo "==> clearing .next"
sudo rm -rf .next

echo "==> building"
sudo npm run build

echo "==> restarting pm2"
sudo pm2 restart "$PM2_APP" --update-env
sudo pm2 save

sleep 4
echo "==> health"
for path in /api/v1/catalog /api/v1/geo/divisions /api/v1/app/finance/loan-products; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000$path" || echo '---')
  printf '  %-42s %s\n' "$path" "$code"
done

echo
echo "previous commit was $PREV — roll back with:"
echo "  sudo git -C $APP reset --hard $PREV && sudo rm -rf $APP/.next && sudo npm --prefix $APP ci && sudo npm --prefix $APP run build && sudo pm2 restart $PM2_APP"
