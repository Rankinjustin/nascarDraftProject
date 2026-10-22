# Deploying to Google Cloud (one small server)

The whole app — website, API, scheduled jobs, and the Postgres database — runs on one Google Cloud **e2-micro**
virtual machine. The server hands out the website itself, so the app and API share one address; that's what makes
login work on iPhones (SPEC Section 5). Caddy in front of it gets and renews the HTTPS certificate automatically.

**Cost.** Per Google's free-tier page, one e2-micro VM in `us-west1`, `us-central1`, or `us-east1`, 30 GB of
*standard* persistent disk, and 1 GB/month of outbound data are free. The VM's public IP address is not:
$0.005/hour, about **$3.65/month**. Outbound data past 1 GB/month is a few cents per GB. Check
https://cloud.google.com/free/docs/free-cloud-features and https://cloud.google.com/vpc/pricing before you start;
prices change.

Plan on about an hour the first time, most of it waiting on installs.

---

## 1. Google Cloud account and server

1. Go to https://console.cloud.google.com and sign in. Set up billing when it asks (a card is required even for the
   free tier).
2. Create a project, e.g. `draft-and-draft`.
3. **Set a budget alert first:** Billing → Budgets & alerts → Create budget → $5/month, email alerts on. That way any
   surprise charge shows up as an email, not a bill.
4. Compute Engine → VM instances (enable the API if asked) → **Create instance**:
   - **Name:** `draft-and-draft`
   - **Region:** `us-central1 (Iowa)` (or `us-west1` / `us-east1` — only these three are free). Any zone.
   - **Machine type:** series **E2**, type **e2-micro**.
   - **Boot disk:** click Change → **Debian** (latest version offered), disk type **Standard persistent disk**,
     size **30 GB**. The default "Balanced" disk is *not* free — change it.
   - **Firewall:** check **Allow HTTP traffic** and **Allow HTTPS traffic**.
   - Create.
5. **Make the IP address permanent:** VPC network → IP addresses → find the address next to your VM → **Promote to
   static IP address**. Write it down. (Without this the address can change on a restart and the site goes dark.)

## 2. A free web address (DuckDNS)

1. Go to https://www.duckdns.org and sign in (Google or GitHub works).
2. Add a subdomain, e.g. `ourleague` → you now own `ourleague.duckdns.org`.
3. Put your VM's static IP in its **current ip** box → **update ip**.

## 3. Package the app (on your PC)

1. Make sure everything is committed (`git status` shows nothing). The package is built from the last commit.
2. In the project folder: `npm run release` → creates `release.tar.gz`.
3. Make your league file: copy `server/prisma/seed-data/users.example.json` somewhere *outside* the project, rename it
   `users.json`, and fill in real names and phone numbers. Give yourself and a backup commissioner
   `"role": "COMMISSIONER"`.

## 4. Install on the server

1. Compute Engine → VM instances → **SSH** next to your VM. A terminal opens in your browser.
2. In that window, click **Upload file** (top right) and upload `release.tar.gz`, then again for `users.json`. They
   land in your home folder.
3. Paste these, using your own address and email (the email is only given to the push services as a contact):

   ```bash
   mkdir -p ~/dnd && tar -xzf ~/release.tar.gz -C ~/dnd
   sudo nohup bash ~/dnd/deploy/gcp/dnd.sh setup ourleague.duckdns.org you@example.com ~/release.tar.gz > ~/setup.log 2>&1 &
   tail -f ~/setup.log
   ```

   This takes 10–20 minutes and runs in the background, because the browser SSH window often disconnects while the
   small server is busy installing. If it drops, reconnect and run `tail -f ~/setup.log` again (Ctrl+C only stops
   watching). It's done when the log ends with `Running. https://ourleague.duckdns.org` and `Setup complete.`
   Re-running the setup is safe; if a run was cut off mid-install, run `sudo dpkg --configure -a` first.
4. Load the season, drivers, and your league:

   ```bash
   sudo dnd seed ~/users.json
   rm ~/users.json
   ```

   It prints a **setup link** for each person. Each link works once and expires in 7 days.

## 5. Test it on your own iPhone before sending links

The installed Home Screen app keeps its own login, separate from Safari, so the order matters:

1. Tap your setup link → set a password (this happens in Safari).
2. In Safari, open `https://ourleague.duckdns.org` → Share → **Add to Home Screen**.
3. Open the app from the Home Screen and **log in there** with your phone number and that password.
4. Settings → **Turn on notifications for this device** → **Send a test**.

If that test notification lands, send everyone else their links with the same four steps. Lost or expired link:
Admin → Members → **New setup link**.

## Updating the app later

Once automatic deploys are set up (below), just commit and `git push`. Until then, or whenever GitHub is down:
on your PC commit, then `npm run release`. Upload the new `release.tar.gz` in the SSH window, then:

```bash
sudo nohup dnd deploy ~/release.tar.gz > ~/deploy.log 2>&1 &
tail -f ~/deploy.log
```

Every deploy backs up the database first, and stops before touching anything if that backup fails. The database, push
keys, and settings are kept; settings added in a newer build are appended to `server.env` with their defaults. The server runs the TypeScript directly through `tsx` (a
production dependency), and the deploy runs only the Vite build, not the typecheck, which CI or your PC already ran.

**Rolling back.** The build before the last deploy is kept in `/opt/draft-and-draft.previous`. If a new build doesn't
come up and the deploy didn't change the database, the deploy puts the previous build back on its own (and still
reports a failure). Otherwise `sudo dnd rollback` swaps it back in and restarts (run it again to undo). It does **not**
undo database migrations: if the newer build changed the database, the older code may not work with it, so also
restore the backup taken just before that deploy. The deploy log names it (`Backed up to ...`):

```bash
sudo dnd rollback
sudo dnd restore /var/backups/draft-and-draft/draft_and_draft-2026-10-22-140512.dump
```

`dnd restore` backs up the current database first (in case it's the wrong file), and runs as one transaction, so a
failed restore changes nothing.

**Race weekend freeze.** A restart drops the live-feed cache and can miss a qualifying capture or live results
(SPEC Section 2), so every `dnd deploy`, manual or from GitHub, refuses from an hour before qualifying until the race is completed (a race
left LIVE stops blocking a day after its start). If you really
must ship (say, a fix for the race itself), add `--force` to the end of the deploy command.

## Automatic deploys from GitHub

Every push to `master` runs the typecheck and tests on GitHub, and if they pass, ships the build to the server
(`.github/workflows/deploy.yml`). A failing test means nothing is deployed. Watch it under your repo's **Actions** tab.

One-time setup:

1. Do one manual deploy (above) of a build that includes this section, so the server has the newest `dnd`.
2. In the SSH window: `sudo dnd ci-setup`. It makes a `deploy` user whose key can only run a deploy, and prints
   three values.
3. On GitHub: your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add
   `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, and `DEPLOY_SSH_KEY`, pasting each value exactly as printed (for the key, every
   line, including `BEGIN` and `END`). Then clear the SSH window.
4. `git push`. The first run redeploys the same build; that's fine.

A push during a race weekend fails on the server's freeze. That's expected: after the race is completed, open the
failed run in **Actions** → **Re-run all jobs**, or push again. The same button re-runs a deploy any time, and
**Run workflow** on the Deploy workflow ships the latest `master` without a new commit.

If the key leaks or you want a new one, run `sudo dnd ci-setup` again and replace the three secrets. The old key
stops working immediately.

## Day to day

| Command | What it does |
|---|---|
| `sudo dnd status` | Is the app, HTTPS, and the database running? |
| `sudo dnd logs` | Follow the app's log (Ctrl+C to stop) |
| `sudo dnd backup` | Take a database backup now |
| `sudo dnd restore <file>` | Replace the database with a backup (see "Rolling back") |
| `sudo dnd rollback` | Go back to the previous build (see "Rolling back") |

- **The app's name** (header, login page, Home Screen label) is the `APP_NAME="..."` line in
  `/etc/draft-and-draft/server.env` (keep the quotes; blank uses the built-in default). It takes effect on the next
  `dnd deploy`. Anyone who already added the app to their Home Screen keeps the old label until they re-add it.
- **Settings** live in `/etc/draft-and-draft/server.env` (Discord webhook, quiet hours, reminder timing). After editing:
  `sudo systemctl restart draft-and-draft`. Never change the `VAPID_` keys — every phone would have to turn
  notifications on again.
- **Backups** run nightly and before every deploy, each to its own timestamped file in `/var/backups/draft-and-draft`,
  and are kept 14 days. They live on the VM's own disk, so they protect against mistakes, not against losing the VM.
  For that, give the disk a snapshot schedule (one time, in the console): Compute Engine → **Snapshots** →
  **Snapshot schedules** → **Create** — same region as the VM, daily, delete after 7 days, keep snapshots if the disk
  is deleted. Then Compute Engine → **Disks** → the VM's disk → **Edit** → pick that schedule → **Save**. Snapshot
  storage is not in the free tier; for this disk it should be well under a dollar a month (your budget alert will
  say if not). Now and then, also download the newest backup with the SSH window's **Download file** button.
- **New season:** after the last race, once NASCAR has published next year's schedule, on your PC run
  `npm run season:schedule -w server -- 2027`, commit the `races-2027.json` it writes, and push. Then on the server:
  `sudo dnd seed`. That adds the season, makes it current, and leaves last season's history alone. Without a
  `users.json` it doesn't touch members; with one, it only adds the people who are new.
- **Try a restore once,** off a race weekend, so the first one isn't in a hurry: `sudo dnd backup`, then
  `sudo dnd restore` the newest file it lists. The app is down for a few seconds, and nothing changes unless someone
  made a pick in between.
- **Uptime alerts (optional):** a free monitor such as UptimeRobot pointed at `https://ourleague.duckdns.org/api/health`
  emails you when the app or one of its scheduled jobs stops.

## If something's wrong

- **The site won't load at all:** check DuckDNS still has the VM's static IP, and that the VM has the HTTP/HTTPS
  firewall boxes checked. `sudo journalctl -u caddy -n 50` shows certificate problems.
- **"Can't reach the server" in the app:** `sudo dnd status`, then `sudo dnd logs`.
- **Logged in in Safari but logged out in the Home Screen app:** expected — log in again inside the app.
