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

On your PC: commit, then `npm run release`. Upload the new `release.tar.gz` in the SSH window, then:

```bash
sudo nohup dnd deploy ~/release.tar.gz > ~/deploy.log 2>&1 &
tail -f ~/deploy.log
```

The database, push keys, and settings are kept. If the new build doesn't start, the old one is left in
`/opt/draft-and-draft.previous`. **Don't deploy from the start of qualifying until the race is completed**
(SPEC Section 2): a restart drops the live-feed cache and can miss a qualifying capture.

## Day to day

| Command | What it does |
|---|---|
| `sudo dnd status` | Is the app, HTTPS, and the database running? |
| `sudo dnd logs` | Follow the app's log (Ctrl+C to stop) |
| `sudo dnd backup` | Take a database backup now |

- **The app's name** (header, login page, Home Screen label) is the `APP_NAME="..."` line in
  `/etc/draft-and-draft/server.env` (add the line if it isn't there; keep the quotes). It takes effect on the next
  `dnd deploy`. Anyone who already added the app to their Home Screen keeps the old label until they re-add it.
- **Settings** live in `/etc/draft-and-draft/server.env` (Discord webhook, quiet hours, reminder timing). After editing:
  `sudo systemctl restart draft-and-draft`. Never change the `VAPID_` keys — every phone would have to turn
  notifications on again.
- **Backups** run nightly to `/var/backups/draft-and-draft` and are kept 14 days. They protect against mistakes, not
  against deleting the VM — now and then, download the newest one with the SSH window's **Download file** button.
- **Uptime alerts (optional):** a free monitor such as UptimeRobot pointed at `https://ourleague.duckdns.org/api/health`
  emails you when the app or one of its scheduled jobs stops.

## If something's wrong

- **The site won't load at all:** check DuckDNS still has the VM's static IP, and that the VM has the HTTP/HTTPS
  firewall boxes checked. `sudo journalctl -u caddy -n 50` shows certificate problems.
- **"Can't reach the server" in the app:** `sudo dnd status`, then `sudo dnd logs`.
- **Logged in in Safari but logged out in the Home Screen app:** expected — log in again inside the app.
