#!/usr/bin/env bash
# Deploy origin/main to the EC2 box that serves shathisheba.digigramventures.com.
# Run as the ubuntu user; every step that touches the app directory uses sudo
# because the directory is root-owned and pm2 runs as root.
#
# Usage:  bash /tmp/deploy-ec2.sh [ref]      (ref defaults to origin/main)
#
# THIS BOX IS SHARED. Other production applications run here:
#
#   root's pm2 daemon    (/root/.pm2)        shathisheba-admin      <- ours, only entry
#   ubuntu's pm2 daemon  (/home/ubuntu/.pm2) saathi-app
#                                            saathi-app-production
#                                            digigram-website
#
# Those are separate daemons: `sudo pm2` cannot see ubuntu's processes and vice
# versa. Even so, every pm2 call here names our process explicitly. Never use
# `pm2 restart all`, `pm2 kill`, `pm2 resurrect` or `pm2 update` on this box —
# the first would be scoped to root's daemon today and silently wrong the day
# something else is added to it.
set -euo pipefail

APP=/var/www/html/shathisheba-admin
REF=${1:-origin/main}
PM2_APP=shathisheba-admin

cd "$APP"

# Belt and braces before anything destructive: prove we are where we think we
# are, and that the pm2 process we are about to restart is this checkout and not
# something that merely shares the name.
[ "$(pwd -P)" = "$APP" ] || { echo "ERROR: refusing to run outside $APP (in $(pwd -P))" >&2; exit 1; }
sudo test -d "$APP/.git" || { echo "ERROR: $APP is not a git checkout" >&2; exit 1; }

PM2_CWD=$(sudo pm2 jlist 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=JSON.parse(s).find(x=>x.name===process.argv[1]);
  process.stdout.write(p ? p.pm2_env.pm_cwd : '');
});" "$PM2_APP")
if [ -n "$PM2_CWD" ] && [ "$PM2_CWD" != "$APP" ]; then
  echo "ERROR: pm2 process '$PM2_APP' runs from $PM2_CWD, not $APP. Refusing." >&2
  exit 1
fi

echo "==> current"
sudo git log --oneline -1
PREV=$(sudo git rev-parse HEAD)

# next-env.d.ts is written by `next build`, so it is dirty after every deploy
# through no fault of anyone's. It is tracked because Next wants it committed, and
# it must never be hand-edited — discarding local changes to it is always safe and
# keeps the guard below meaningful instead of permanently tripped.
sudo git checkout -- next-env.d.ts 2>/dev/null || true

# Any other dirty file means someone edited the server directly. Resetting over
# that would destroy work with no copy anywhere, so stop and let a human look.
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
# Absolute path on purpose: an `rm -rf` that depends on the current directory is
# one failed `cd` away from being a very different command.
echo "==> clearing .next"
sudo rm -rf "$APP/.next"

echo "==> building"
sudo npm run build

# Named process only. `sudo pm2 save` rewrites /root/.pm2/dump.pm2, which lists
# our app alone; ubuntu's dump is a different file and is not touched.
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
