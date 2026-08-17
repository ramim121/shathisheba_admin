# Deployment

There are two deployments. Only one of them is the app's backend.

| | `shathisheba.digigramventures.com` | `shathisheba-admin.vercel.app` |
|---|---|---|
| Host | EC2 `18.143.126.210` (`ap-southeast-1`) | Vercel |
| Process | pm2, as `root` | Vercel functions |
| Reaches RDS | **yes** | no — see `OPEN-ISSUES.md` §1.1 |
| Used by the APK | **yes** | no |
| Role | production backend | build preview / spare |

The mobile release build points at the EC2 domain. Vercel is kept because it
builds every push and catches build breakage early, but it cannot serve app data
until the RDS security group question in `OPEN-ISSUES.md` §1.1 is settled.

---

## EC2

> ⚠️ **This box is shared with other production applications.** Two pm2 daemons
> run on it, and only one entry in one of them is ours:
>
> | Daemon | Apps | Port |
> |---|---|---|
> | root — `/root/.pm2` | **`shathisheba-admin`** (ours, the only entry) | 3000 |
> | ubuntu — `/home/ubuntu/.pm2` | `saathi-app`, `saathi-app-production`, `digigram-website` | 4200, 4100, static |
>
> They are separate daemons: `sudo pm2` cannot see ubuntu's processes and plain
> `pm2` cannot see root's. **Never run `pm2 restart all`, `pm2 kill`,
> `pm2 resurrect` or `pm2 update` here** — `all` is scoped to one daemon today and
> would be silently wrong the day a second app joins it. Always name the process.
>
> Likewise, the only directory to modify is `/var/www/html/shathisheba-admin`.
> `digigram-website-redesign`, `saathi-web-application*` and the backup folders
> beside it belong to other deployments.

```
host      ubuntu@18.143.126.210          (key: Resources/saathi-main-new.pem)
app       /var/www/html/shathisheba-admin   (owned by root)
process   pm2 "shathisheba-admin" → node_modules/next/dist/bin/next start -p 3000
nginx     /etc/nginx/sites-enabled/shathisheba-admin → proxy_pass 127.0.0.1:3000
tls       certbot, /etc/letsencrypt/live/shathisheba.digigramventures.com/
env       /var/www/html/shathisheba-admin/.env      (NOT .env.local)
```

The app directory is root-owned, so every git/npm/pm2 command there needs `sudo`.

### Deploying

`scripts/deploy-ec2.sh` does the whole sequence. Copy it up and run it:

```bash
scp -i Resources/saathi-main-new.pem \
    ShathiShebaAdmin/scripts/deploy-ec2.sh ubuntu@18.143.126.210:/tmp/
ssh -i Resources/saathi-main-new.pem ubuntu@18.143.126.210 'bash /tmp/deploy-ec2.sh'
```

It fetches `origin/main`, hard-resets to it, reinstalls with `npm ci`, removes the
old `.next`, builds, and restarts pm2 with `--update-env`. It refuses to start if
the working tree is dirty, and it does not touch `.env`.

**`.next` is removed before every build.** A Next build reuses whatever is in
`.next`, and a directory left over from a different Next major produces
`PageNotFoundError: Cannot find module for page: /…` at the page-data step — a
failure that reads like a missing route and is not.

### Verifying

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://shathisheba.digigramventures.com/api/v1/geo/divisions
# 200 = database reachable

curl -s -o /dev/null -w "%{http_code}\n" https://shathisheba.digigramventures.com/api/v1/app/finance/loan-products
# 401 = current code (the route exists and wants a session)
# 404 = the box is still serving an older build
```

`/api/v1/catalog` is useless as a health check — it returns a hard-coded array and
answers 200 with no database at all.

### Rolling back

Every deploy records the commit it replaced:

```bash
sudo git -C /var/www/html/shathisheba-admin log --oneline -5
sudo git -C /var/www/html/shathisheba-admin reset --hard <previous-sha>
# then npm ci && rm -rf .next && npm run build && sudo pm2 restart shathisheba-admin
```

The Next 16 upgrade that lived only on this box before 2026-08-17 is preserved on
the branch `server-next16-jun11` in case anything on the server depended on it.

### Memory

The box has 3.7 GB RAM and a 2 GB swapfile; Node's default heap ceiling there is
~1.9 GB. The build fits, but not with much room. If a build is ever OOM-killed:

```bash
sudo NODE_OPTIONS=--max-old-space-size=3072 npm run build
```

---

## Vercel

Project `shathisheba-admin` under scope `ramim121s-projects`, deploying from
`main` automatically.

Environment variables are set for Production, Preview and Development — the same
fifteen listed in the README. To change them:

```bash
vercel link --yes --scope ramim121s-projects --project shathisheba-admin
vercel env ls
printf '%s' "<value>" | vercel env add MYSQL_HOST production
vercel redeploy <deployment-url>       # required — the runtime reads them at boot
```

`vercel link` appends `VERCEL_OIDC_TOKEN` to your local `.env.local` and adds
`.vercel` and `.env*` to `.gitignore`. Both are expected; neither is committed.

---

## Environment files

| Location | File | Why |
|---|---|---|
| Local dev | `.env.local` | Next.js precedence; gitignored |
| EC2 | `.env` | what the box was set up with |
| Vercel | project settings | no file |

The EC2 `.env` has no `S3_*` variables, so uploads through that box fail. It is
listed in `OPEN-ISSUES.md`; adding the five values from `.env.local` fixes it.
