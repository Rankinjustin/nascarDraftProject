# Draft & Draft — Technical Specification & Implementation Plan (v2)

A weekly NASCAR fantasy web app for a private league of 9 friends. Built to stay small, testable, and easy to change.

---

## 0. Instructions for the implementing agent

Read this whole document before writing code. Standing rules:

1. **Business rules live in pure functions.** Everything in `shared/rules/` (`snakeOrder`, `whoseTurn`, `roundForPick`, the scoring rules, the race status transition table) and the `normalizePhone()` helper must not import Prisma, Express, or any I/O. They take plain data and return plain data. They are the only things with mandatory unit tests.
2. **The server is the source of truth for anything contestable** — draft order, whose turn it is, pick deadlines, and scores. The client never generates randomness that matters and never decides turn legality.
3. **Every route validates input with Zod at the boundary.** Route handlers parse and delegate; they contain no business logic.
4. **Every write that changes a race's status, draft order, picks, or results goes through `withRaceLock(raceId, fn)`** (Section 6). No exceptions, including cron jobs. This is what keeps concurrent picks, reverts, and status changes from corrupting the draft.
5. **Race status only changes through the transition table in Section 4 (`checkTransition`).** No route or job sets `Race.status` directly.
6. **Do not invent NASCAR feed field names.** Section 7 documents the expected shape, but the feed is undocumented and may have changed. Write the adapter defensively, log the raw payload once on first successful fetch, and fail soft.
7. **Build in the phase order in Section 12.** Each phase should end in a running, demoable state.

---

## 1. Product Overview & Weekly Loop

Every race weekend is independent. No roll-over picks, no cumulative season score in the core loop.

**League size: 9 members × 3 drivers = 27 picks per draft.** Do not hardcode 9. The number of drafters for a race is the number of `DraftOrder` rows for that race — which may be fewer than the active user count on a short week (Section 10).

### The week

| When | What happens |
|---|---|
| Any time before | Commissioner creates the race (or it already exists from the season seed) and loads the entry list. |
| **Wednesday** | Commissioner spins the wheel. The server generates and persists the order; the draft opens. |
| **Wednesday → Sunday** | The snake draft runs **asynchronously over several days**. Each person picks when notified; nobody is expected to sit in the draft room. Practice and qualifying happen during this window, so later pickers can see the starting grid. |
| **Sunday, published race start time** (`Race.raceDate`) | **Picks close.** Any unfilled slots stay empty and score as a DNS (Section 8). The actual green flag usually follows 10–20 minutes later. |
| Race running | Live page: NASCAR running order next to the fantasy leaderboard. |
| After the checkered | Commissioner completes the race; weekly results are frozen. |

1. **Order determination** — the commissioner runs a wheel spinner once per race. The server generates the random order; the wheel animates to a result that has already been decided and persisted.
2. **Snake draft** — 3 rounds, 3 drivers per user. Round 1 forward, round 2 reverse, round 3 forward.
3. **Scoring** — a user's weekly score is the average finishing position of their 3 drivers. Lowest average wins the week. The scoring rule is pluggable (Section 8).
4. **Race day** — one page shows the live NASCAR running order next to the fantasy leaderboard for that week, both updating together.
5. **Season stats** — a separate, read-only page aggregating completed weeks within a NASCAR season. Purely for fun; it does not feed back into weekly play.

Because the draft takes days, **notifications are the primary UX, not the draft room** (Section 14). The draft room is where you go after your phone tells you it's your turn.

### Roles

| Role | Can do |
|---|---|
| `MEMBER` | View everything; make their own picks when it's their turn |
| `COMMISSIONER` | Everything a member can, plus: manage users, create races, manage entries, spin the wheel, pick on behalf of whoever is on the clock, revert the last pick, swap the driver on any pick, reset or regenerate a draft, override race status, complete and reopen races, correct results |

**Have two commissioners.** The role supports any number, and several things depend on one — completing the race, picking on behalf of a stalled member, fixing a withdrawal. A backup means one person's busy Sunday doesn't hold up the league's results.

Commissioner actions are privileged but **not silent** — every one of them writes to the `DraftEvent` audit log and surfaces in the draft room UI ("Commish picked Chase Elliott for Kyle"). The point of the log is that a small group trusts each other but nobody should have to wonder what changed.

---

## 2. Tech Stack

**Frontend:** React + Vite + TypeScript, Tailwind CSS, TanStack Query, React Router, Lucide React icons, CSS animations for the wheel and confetti (no animation library). Installable PWA (manifest + service worker) — required for iOS push (Section 14).

**Backend:** Node.js + Express + TypeScript, Zod validation, Prisma ORM, PostgreSQL, `argon2` for password hashing, `node-cron` for scheduled jobs.

**Shared:** a `shared/` directory containing TypeScript types and the pure rule functions, imported by both client and server. This is what keeps the two halves from drifting.

**Deploy:** one always-on Debian server (a Google Cloud e2-micro), set up and updated by `deploy/gcp/dnd.sh` — step-by-step guide in `deploy/gcp/README.md`. On it: Postgres (with nightly `pg_dump` backups, plus one before every deploy), the Express app run by systemd straight from TypeScript through `tsx` (which is why `tsx` is a production dependency of `server/`), and Caddy in front for HTTPS (automatic certificates for the league's domain, e.g. a DuckDNS name). **Express serves both the API and the built client** from one origin (Section 5). The server must never sleep — a host that spins down on idle will not wake up to poll a live race or send a pick reminder. Run exactly **one** app instance; the cron jobs assume they are the only copy running. Pushes to `master` run the typecheck and tests in GitHub Actions and, if they pass, ship the build to the server (`.github/workflows/deploy.yml`).

**Deploy freeze on race weekends.** Every deploy restarts that one process, client changes included: the feed cache is lost and a qualifying capture in progress is interrupted. So `dnd deploy` — manual or from CI — refuses from an hour before qualifying (two days before the race when qualifying's time isn't known) until the race is completed, unless given `--force`. A race left `LIVE` stops blocking a day after its start, like the stale-`LIVE` rule in Section 9. Clients already running pick up a new build through the service worker (see "App updates", Section 11).

**Monitoring.** Scheduled jobs fail silently — a dead sweeper on a Thursday shows up as "nobody got notified," discovered days later. So:
- `GET /api/health` (public, no data) returns `{ ok, db, jobs: { deadline, poller, sweeper } }` with each job's last successful run time, and returns **503** if any job hasn't run in 3× its interval or the database can't be read. The database check reads a real row (not `SELECT 1`), so a build whose schema doesn't match the database — a rollback past a migration — fails it; `dnd deploy` and `dnd rollback` use it to decide the app came up.
- Point a free uptime monitor (e.g. UptimeRobot) at it, alerting the commissioners.
- Send uncaught errors to an error tracker (e.g. Sentry's free tier) via `SENTRY_DSN`. Optional in development; set it in production.

**The frontend and API must be same-site** — see Section 5. This is not optional; it's what makes login work on iPhones.

**No WebSockets.** With nine users, TanStack Query polling is sufficient and removes an entire category of connection-state bugs. Nine clients polling a draft endpoint every 3 seconds is 3 requests/second — trivial. Poll intervals in Section 6.

---

## 3. Database Schema (`schema.prisma`)

The schema lives in **`server/prisma/schema.prisma`** — read it there; it is the source of truth and carries its own comments on the non-obvious parts (the notification-log sentinels, why `QualifyingResult` has no unique on start position).

### Notes on schema decisions

- **`runningPosition` vs `finishPosition`** — the poller overwrites `runningPosition` on every poll while the race is `LIVE`. `finishPosition` is filled in the transaction that moves the race to `COMPLETED`. Scoring reads `finishPosition`; the live leaderboard reads `runningPosition`. Without this split, "who won last week" is a query against mutable data.
- **`LOCKED` status** — the gap between "draft closed" and "green flag". With a deadline at the published start time this is usually 10–20 minutes, but it also covers a draft that finished early and rain delays.
- **`CORRECTING` status** — a reopened completed race. It is a separate state from `LIVE` precisely so the poller never writes to it. Reopening as `LIVE` would let the poller pour next week's practice data into last week's results.
- **`raceDate` is the published race start time and the pick deadline.** Enter the start time from NASCAR's official schedule — this is usually the TV start, and the green flag comes 10–20 minutes later. Closing picks slightly before the green is deliberate: nobody can pick after seeing the first lap. If a race is postponed, the commissioner edits `raceDate` (see "Postponements", Section 6).
- **`wentLiveAt`** — set the first time a race transitions to `LIVE` and never cleared. `checkTransition` uses it to refuse reopening the draft of a race that has already been running, even after a `false_start`.
- **No `User.email`.** Login is phone number + password, and nothing sends email; an unused column only invites someone to start relying on it.
- **No `Driver.isActive`.** Who can be drafted is decided per race by `RaceEntry` (and its `isEligible` flag), not by a global driver flag.
- **No standalone `@@index([raceId])` on `RaceEntry`, `QualifyingResult`, or `NotificationLog`.** Each has a unique constraint that starts with `raceId`, and its index already serves lookups by race.
- **`Driver.nascarDriverId` is nullable** so the commissioner can add a one-off driver by hand without knowing NASCAR's internal ID. The poller backfills it (Section 7).
- **`RaceResult.source`** — `"manual"` rows come from the commissioner's results entry (Section 8). The poller never writes to a race once it is `COMPLETED` or `CORRECTING`, so manual rows can only be overwritten by the feed while the race is still `LIVE`, and only `runningPosition` — never `finishPosition`.
- **`nascarRaceId` is nullable** — you'll create the race and run the whole draft before you necessarily know it. It must be set before the race weekend, because the poller refuses to act on a race without it (Section 7).
- **`DraftEvent.actorUserId` is nullable** — automatic changes (deadline closes the draft, poller promotes to `LIVE`) have no human actor and must still be logged.
- **Store `raceDate` as UTC, display in the user's local zone.** NASCAR schedules in Eastern; most of this league is Central. Never format a date on the server — send ISO strings and let the browser localize, or a 2:30 ET green flag shows up an hour wrong for everyone. The one server-side time-zone concern is quiet hours for notifications, which use `LEAGUE_TIMEZONE`.

---

## 4. Shared Rule Functions (`shared/rules/`)

These are the functions that must be pure and must be tested.

```ts
// shared/rules/draft.ts

/** Round 1 forward, round 2 reverse, round 3 forward. Returns one userId per slot. */
export function snakeOrder(orderedUserIds: string[], rounds: number): string[];

/**
 * Returns the userId on the clock, or null if the draft is complete.
 * `picksMade` is the COUNT of picks so far (0-based index of the next slot),
 * not an overallPickNumber. The next slot's overallPickNumber is picksMade + 1.
 */
export function whoseTurn(snake: string[], picksMade: number): string | null;

/** Convert an overall pick number (1-BASED) to a round number (1-based). */
export function roundForPick(overallPickNumber: number, userCount: number): number;
```

```ts
// shared/rules/raceStatus.ts

export type RaceStatus = "UPCOMING" | "DRAFTING" | "LOCKED" | "LIVE" | "COMPLETED" | "CORRECTING";

export type TransitionReason =
  | "order_generated"      // UPCOMING  → DRAFTING   (wheel spin)
  | "order_regenerated"    // DRAFTING | LOCKED → UPCOMING   (only before raceDate)
  | "draft_filled"         // DRAFTING  → LOCKED     (last pick made)
  | "deadline_passed"      // DRAFTING  → LOCKED     (system at raceDate, or commish closing early — any time)
  | "draft_reopened"       // LOCKED    → DRAFTING   (revert/reset before raceDate, or commish override)
  | "green_flag"           // LOCKED    → LIVE       (poller, or commish override)
  | "false_start"          // LIVE      → LOCKED     (commish override: feed glitch promoted it early)
  | "completed"            // LIVE | CORRECTING → COMPLETED (completion transaction only)
  | "reopened";            // COMPLETED → CORRECTING

/** Returns null if allowed, or a human-readable reason it is not. Pure; the caller supplies `now`. */
export function checkTransition(
  from: RaceStatus,
  reason: TransitionReason,
  ctx: { now: Date; raceDate: Date; picksMade: number; totalSlots: number; hasBeenLive: boolean }
): string | null;
```

`hasBeenLive` is `race.wentLiveAt !== null`.

The transition table is the whole state machine. Rules beyond the arrows above:
- `draft_reopened` is only allowed while `now < raceDate` and `!hasBeenLive`.
- `order_regenerated` is only allowed while `now < raceDate`. After the deadline, fix mistakes with swap and revert instead.
- `deadline_passed` has no time condition, so the commissioner can close a draft early through the status override.
- `green_flag` sets `wentLiveAt` if it is null.
- `completed` is only reachable through the completion transaction (Section 8), never through the status override endpoint.
- Anything not listed is rejected.

```ts
// shared/rules/scoring.ts

export interface ScoredDriver {
  driverId: string | null;        // null = empty roster slot (draft closed before it was filled)
  finishPosition: number | null;  // null = did not take green / no result / empty slot
}

export interface UserEntry {
  userId: string;
  drivers: ScoredDriver[];        // always exactly `rounds` entries; pad empty slots
}

export interface ScoringRule {
  key: string;
  label: string;
  description: string;
  /** "asc" = lower score is better. `rankEntries` must honor this. */
  direction: "asc" | "desc";
  score(entry: UserEntry, context: { fieldSize: number }): number;
}

export const SCORING_RULES: Record<string, ScoringRule>;

export function rankEntries(
  entries: UserEntry[],
  rule: ScoringRule,
  context: { fieldSize: number }
): Array<{ userId: string; score: number; rank: number }>;
```

```ts
// shared/phone.ts
/** Strip non-digits; 10 digits → "+1" + digits; 11 digits starting with 1 → "+" + digits; else null. */
export function normalizePhone(input: string): string | null;
```

**`average_finish` (default):** mean of the 3 finish positions, `direction: "asc"`. A `null` finish position — a driver who never took the green, never appeared in the feed, **or an empty roster slot** — is treated as `fieldSize + 1`, worse than last place. Ties share a rank (both get rank 1; next is rank 3).

**Weekly winners: ties are co-winners, with no tiebreaker.** Everyone at rank 1 has won the week: each gets the confetti, the winner treatment on the history page, and a full win in the season stats' weekly-wins count. "Winner" always means `rank === 1` — never "the first row" — so a tie can't silently pick one person.

**`fieldSize` is defined as the count of `RaceResult` rows for the race**, falling back to the count of eligible `RaceEntry` rows if no results exist yet (pre-race and early-live views). Compute it in one place in the service layer and pass it in — do not let two call sites derive it differently, or the live leaderboard and the final standings will disagree about how a DNF is scored. Store the value used in `WeeklyResult.fieldSize`.

Adding a rule later means adding one object to `SCORING_RULES` and one dropdown option. Because `Race.scoringRuleKey` is stored per race and copied into `WeeklyResult`, changing the default never retroactively rescores an old week.

**Required unit tests:**
- `snakeOrder` with 2, 3, and 9 users → correct forward/reverse/forward pattern
- `whoseTurn` at 0 picks, mid-draft, at both round boundaries (9 users: `picksMade` 8 and 9 return the **same** user; 17 and 18 return the same user), and past the end (returns `null`)
- `roundForPick` at 1, 9, 10, 18, 19, 27 with 9 users
- `average_finish` with a clean 3-driver roster, with a `null` finish, with an empty slot, and with an exact tie between two users
- `rankEntries` with a `"desc"` rule ranks the highest score first
- `checkTransition`: every allowed arrow passes; `draft_reopened` after `raceDate` fails; `draft_reopened` with `hasBeenLive: true` fails even before `raceDate`; `order_regenerated` after `raceDate` fails; `deadline_passed` before `raceDate` passes; `completed` from `LOCKED` fails; `reopened` from `LIVE` fails
- `normalizePhone` (Section 13)

---

## 5. Authentication

**Chosen approach:** commissioner-seeded accounts identified by **phone number**, authenticated with a **password**, server-side sessions in an HTTP-only cookie.

Identity and delivery are separate decisions here. The account is keyed to a phone number — that's how this group thinks of each other, and it means an SMS OTP flow can be layered on later without any data migration. But the *credential* is a password, because sending A2P SMS in the US requires 10DLC brand and campaign registration (an EIN, fees, and a multi-week carrier review), and unregistered traffic gets filtered no matter who the recipient is.

### Deploy topology: same-site is required

Decide this in Phase 1, before there's anything else to debug.

Safari (every iPhone) blocks third-party cookies by default, **even with `SameSite=None; Secure`**. A frontend and an API on different sites — say, two hosts' default subdomains, which sit on the Public Suffix List — produce a working login endpoint followed by a permanently logged-out app on every iPhone, no matter how the cookie is configured.

**Chosen: one origin.** On the single server (Section 2), Caddy terminates HTTPS and proxies everything to Express, which serves the API under `/api` and the built client (`client/dist`) for every other path. The browser only ever talks to one origin, so the API is same-origin and no CORS is needed. `VITE_API_BASE_URL=/api`; in development the Vite dev server proxies `/api` to the API the same way.

The cookie is `HttpOnly; Secure; SameSite=Lax; Path=/`.

**CSRF:** `SameSite=Lax` covers most of it. Additionally, mutating routes must require `Content-Type: application/json` and reject requests whose `Origin` header is present and doesn't match `FRONTEND_ORIGIN`. A few lines of middleware.

**iOS cookie jar:** an iOS Home Screen web app has its own cookie storage, separate from Safari. Someone who logs in in Safari and then installs the app will be logged out inside it. The onboarding flow (Section 14) must have people **install first, then log in inside the installed app**.

### Implementation

- `phoneNumber` is the login field. Normalize with the shared `normalizePhone()` on every write and read: seeding, login, and user admin. `(920) 555-1234`, `920-555-1234`, `+1 920 555 1234`, and `9205551234` must all resolve to the same account. Inconsistent normalization is the classic way this design produces a "my login doesn't work" bug.
- On mobile, the phone field uses `type="tel"` and `inputMode="numeric"` so the number pad opens. Format it visually as the user types; submit the normalized value.
- Passwords hashed with `argon2id`.
- Session token: 32 random bytes, base64url. Store only the SHA-256 hash in `Session.tokenHash`. 30-day expiry with sliding renewal on use (nobody wants to log in every Sunday on their phone). Write the renewal at most once a day (only when the stored `expiresAt` is more than 24 hours short of `now + 30 days`) — otherwise the draft room's 3-second polling turns into a database write every 3 seconds per user.
- **Inactive users:** login rejects `isActive = false` with the same generic 401, and the session middleware rejects existing sessions for inactive users. Deactivating someone must take effect immediately.
- No public signup route. The commissioner creates accounts (phone number + display name) on the admin page or via the seed script. Each new account gets a single-use setup link; the commissioner sends it however the group already talks — group chat, a text from their own phone, Discord. No transactional email or SMS infrastructure required, which is the whole point. **The seed script prints a setup link for every account it creates, including the commissioners'** — on a fresh database that's the only way anyone can log in for the first time.
- Setup tokens live in `SetupToken`. Store only a hash. Expire after 7 days, set `usedAt` on consumption, reject any token that is expired or already used. Issuing a new token invalidates outstanding ones for that user. The same mechanism is password reset: the commissioner reissues a link.
- **Setting a password deletes all of that user's existing sessions**, then creates a fresh one. Otherwise a reset doesn't actually lock anyone out.
- Rate limit `POST /api/auth/login` to 10 attempts per 15 minutes, keyed on **both** IP and normalized phone number. **Behind Caddy, the app sees the proxy's IP, not the phone's** — without configuration, all nine users would share one rate-limit bucket. Set Express `trust proxy` to the number of proxy hops actually in front of the app (`TRUST_PROXY=1` for Caddy on the single server; verify by logging `req.ip` and `X-Forwarded-For` from a real phone) so `req.ip` is the client address. If the client IP can't be recovered reliably, key on phone number alone. (Known trade-off: anyone can lock a specific friend out for 15 minutes by spamming their number. Acceptable for a private league; the commissioner can reissue a setup link.)
- **Never reveal whether a phone number exists.** A wrong number and a wrong password both return the same generic 401, **and take the same time**: when no user matches, still run `argon2.verify` against a fixed dummy hash.

**Swappability:** put this behind an interface so phone OTP can drop in later without touching route handlers.

> **Note on SMS OTP:** if you later decide you want login codes over SMS, **Twilio Verify** is the path — Twilio exempts verification-code traffic from A2P 10DLC registration because it runs on their own pre-registered infrastructure. It bills per verification. This exemption covers verification codes *only*; it cannot be used for the turn notifications in Section 14.

```ts
export interface AuthProvider {
  /** Verify a credential payload; return the user or null. */
  verify(input: unknown): Promise<User | null>;
  /** Optional: send a challenge (OTP code, magic link). No-op for passwords. */
  challenge?(input: unknown): Promise<void>;
}
```

`PhonePasswordProvider` implements it now; `PhoneOtpProvider` can later. Everything downstream depends on the interface and the session cookie, not on the mechanism.

---

## 6. The Draft

### The race lock

Every write that touches a race's status, draft order, picks, or results runs inside:

```ts
async function withRaceLock<T>(raceId: string, fn: (tx: Prisma.TransactionClient, race: Race) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Race[]>`SELECT * FROM "Race" WHERE "id" = ${raceId} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError();
    return fn(tx, rows[0]);
  });
}
```

`FOR UPDATE` makes every pick, revert, swap, reset, regenerate, wheel spin, status change, completion, and poller write for the same race run one at a time. Without it, Postgres's default isolation lets a pick count N picks while a revert deletes pick N; the pick then inserts N+1, leaving a gap that makes every later pick collide forever. The unique constraints stay as a backstop, not the primary guard.

Callers: the pick, revert, swap, reset, regenerate, draft-order, race edit (`PATCH /races/:id`), status, complete, reopen, and results routes; the deadline job; the poller's status and results writes.

### Making a pick

`POST /races/:id/picks` with `{ driverId, overallPickNumber, onBehalfOfUserId? }`. `overallPickNumber` is the slot the client *thinks* it is filling. Inside `withRaceLock`:

1. **Idempotent retry:** if a pick already exists in slot `body.overallPickNumber` with the same `driverId` and `createdByUserId === req.user.id`, this is a repeat of a pick that already succeeded (a double tap, or a phone retrying after a network blip). Return **200** with the current draft state and do nothing else — no new event, no notifications. This check comes first because the original request may have been the last pick, which already moved the race to `LOCKED`.
2. Reject unless `status === "DRAFTING"` → **409 `DRAFT_NOT_OPEN`**.
3. Reject if `now >= race.raceDate` → **409 `PICKS_CLOSED`**. (The deadline job will lock the race within a minute; this check makes the deadline exact.)
4. Load `DraftOrder` rows sorted by `pickPosition` → `snake = snakeOrder(userIds, 3)`.
5. Count existing picks → `picksMade`. `expectedUserId = whoseTurn(snake, picksMade)`.
6. Reject with **409 `DRAFT_COMPLETE`** if `expectedUserId === null`.
7. Reject with **409 `STALE_BOARD`** if `body.overallPickNumber !== picksMade + 1`. ("Someone just picked — here's the updated board.")
8. Authorize:
   - Normal pick (no `onBehalfOfUserId`): `req.user.id === expectedUserId`, else **403 `NOT_YOUR_TURN`**.
   - On-behalf pick: `req.user.role === "COMMISSIONER"` (else **403**) and `onBehalfOfUserId === expectedUserId` (else **409 `STALE_BOARD`**). The commissioner picks *for whoever is on the clock*, never out of order.
9. Validate the driver has a `RaceEntry` for this race with `isEligible: true`, else **400 `DRIVER_NOT_ELIGIBLE`**.
10. Validate the driver isn't already picked in this race, else **409 `DRIVER_TAKEN`**. (Check explicitly so the user gets the right message; the unique constraint is the backstop.)
11. Insert the `Pick` with `overallPickNumber = picksMade + 1`, `roundNumber = roundForPick(...)`, `createdByUserId = req.user.id`.
12. Write a `DraftEvent` (`PICK_MADE` or `PICK_MADE_ON_BEHALF`).
13. If `picksMade + 1 === snake.length`, transition to `LOCKED` (`draft_filled`) and log `STATUS_CHANGED`.

After commit, fire notifications (Section 14). Return the updated draft state so the client can reconcile its optimistic update.

### Commissioner controls

All of these run in `withRaceLock`, log a `DraftEvent`, and **reject with 409 unless the race is `DRAFTING` or `LOCKED`**. Once a race is `LIVE` or later, rosters are historical record — changing them would silently change a result people have already seen.

- **Revert last pick** — deletes the pick with the highest `overallPickNumber`, logs `PICK_REVERTED`. The request carries the `overallPickNumber` the commissioner saw as last; if it isn't the last pick anymore (someone picked while the confirm was open), it's refused with **409 `STALE_BOARD`** and nothing is deleted. Only ever the last one, so pick numbers stay contiguous with no renumbering logic. If the race was `LOCKED` and `now < raceDate`, it returns to `DRAFTING`; after the deadline it stays `LOCKED` (the slot is simply empty again). Clears the matching notification log rows (Section 14).
- **Swap driver on a pick** — replaces the driver on **any** existing pick with another eligible, undrafted driver. The pick keeps its slot, owner, and number; logs `PICK_SWAPPED` with old and new driver. **This is how withdrawals and ineligible drivers are handled.** With a multi-day draft, a driver taken on Wednesday at pick 4 might withdraw on Saturday at pick 20; "revert last pick" would have to unwind 16 picks to reach it. The commissioner swaps instead, usually after asking the affected member what they want.
- **Reset draft** — deletes all picks, keeps the draft order, logs `DRAFT_RESET`, returns status to `DRAFTING`. **Only allowed while `now < raceDate`** (else **409 `PICKS_CLOSED`**) — after the deadline nobody could re-pick, so a reset would just wipe every roster. Requires typed confirmation in the UI. Clears the race's draft notification log rows.
- **Regenerate order** — the more destructive action: deletes picks *and* draft order, returns the race to `UPCOMING` so the wheel can be spun again, logs `ORDER_REGENERATED`. **Only allowed while `now < raceDate`** (else **409 `PICKS_CLOSED`**). Requires typed confirmation. Exists for genuine mistakes (wrong set of players), and because it's logged, it's visible if abused. Clears the race's draft notification log rows.

**Marking a drafted driver ineligible** (`PATCH /races/:id/entries/:entryId`) is allowed, but the response includes a warning, and the draft room shows a "⚠ withdrawn" badge on that pick until the commissioner swaps it. Deleting a drafted entry is rejected with **409**.

### Deadline job

`node-cron`, every minute. For each race in `DRAFTING` with `raceDate <= now`, inside `withRaceLock`: transition to `LOCKED` (`deadline_passed`, `actorUserId: null`), log `STATUS_CHANGED` with `{ picksMade, totalSlots }`, and send the `draft_closed` broadcast. Empty slots stay empty and score as DNS (Section 8).

### Postponements

If a race is postponed before the deadline, the commissioner edits `raceDate` and nothing else is needed. If it's postponed after the draft closed incomplete, the commissioner edits `raceDate` and uses the status override to reopen the draft (`draft_reopened`, only allowed before the new `raceDate` and only if the race never went `LIVE`).

**Changing `raceDate` deletes the race's `deadline_warning` and `draft_closed` notification log rows** (inside the same lock as the edit), so the warning and the close announcement fire again for the new deadline. A `draft_reopened` transition also deletes the `draft_closed` row.

A race that went green and was then red-flagged to another day stays `LIVE` (or `LOCKED` after a `false_start`); its rosters are already final. The commissioner edits `raceDate` so it stays in the poller's active window.

### Polling

- Draft room, when it's not your turn: **3s**
- Draft room, when it is your turn: **10s** (you're the one acting; you don't need fast reads)
- Live race page: **15s**
- Everything else: on focus / on mount

Use TanStack Query's `refetchInterval` with a function that reads the current turn state. TanStack already pauses interval refetches when the tab is hidden (`refetchIntervalInBackground: false`, the default); keep it that way.

---

## 7. NASCAR Live Data

### Adapter isolation

All contact with NASCAR's servers lives in exactly one file: `server/src/integrations/nascarFeed.ts`. Nothing else in the codebase knows the feed's shape. It exports normalized types:

```ts
export interface NormalizedVehicle {
  nascarDriverId: number;
  driverName: string;
  carNumber: string;
  runningPosition: number;
  lapsCompleted: number;
  status: "RUNNING" | "OUT" | "FINISHED";
  delta: number | null;
  bestLapTime: number | null;   // seconds; used for qualifying capture
  bestLapSpeed: number | null;  // mph
}

export type SessionType = "practice" | "qualifying" | "race" | "unknown";

export interface NormalizedRaceFeed {
  nascarRaceId: number | null;
  sessionType: SessionType;
  currentLap: number | null;
  totalLaps: number | null;
  flagState: number | null;   // 1 green, 2 yellow, 3 red, 4 checkered (verify) — 9 observed after a finished race, see below
  vehicles: NormalizedVehicle[];
  fetchedAt: Date;
}
```

**Feed source:** `${NASCAR_FEED_BASE_URL}/live/feeds/live-feed.json` (currently `https://cf.nascar.com`).

**Warnings for the implementer:**
- This endpoint is undocumented and unofficial. It can change or disappear without notice.
- Series live at different paths (Cup / Xfinity / Trucks). Confirm the correct path for the series in `Season.seriesId` before hardcoding.
- The feed is stale, empty, or returns the *previous* race when nothing is running. Never trust it to tell you a race is over — the commissioner confirms completion (Section 8).
- **Verify the actual field names at runtime.** Log the first successful raw response and map from what's really there. Do not assume the names above.
- **Cacher endpoints — confirmed 2026-10-02.** NASCAR's CDN serves static JSON alongside the live feed. Samples are saved in `server/test/fixtures/`:
  - `/cacher/{year}/race_list_basic.json` — the season schedule, keyed `series_1` / `series_2` / `series_3`, with `race_id` (this is `nascarRaceId`), `race_name`, `track_name`, `race_type_id` (1 = points race, 2 = exhibition), `scheduled_laps`, and start times as **zone-less Eastern wall-clock strings** (`date_scheduled` = original, `race_date` = current, which differs after a postponement). The seed uses this to fill `nascarRaceId` for every race.
  - `/cacher/{year}/{seriesId}/{raceId}/weekend-feed.json` — `weekend_race[0].results[]` has the official finishing order (`finishing_position`, `starting_position`, `car_number`, `driver_id`, `driver_fullname`, `team_name`, `laps_completed`, `finishing_status`), and `weekend_runs[]` has each session (`run_type` 2 = qualifying) with its own results. This is a candidate source for the entry-list import, a missed-qualifying backfill, and a manual-results prefill — verify before a weekend that it is populated *before* the race, not just after.
  - The same file's `weekend_race[].schedule[]` lists the weekend's events (`event_name`, `start_time_utc` with no zone suffix, `run_type`). The entry-list import stores the `run_type` 2 entry as `Race.qualifyingAt`; the commissioner can edit it on the admin race page. The top-level `qualifying_date` is a `1900-01-01` placeholder and is not used.
  - `/cacher/drivers.json` — every driver NASCAR has on file (all series, historical), keyed `Nascar_Driver_ID`. Not useful for the current field; use a recent weekend feed instead.
  - The live feed's `flag_state` read **9** (with `laps_to_go: 0` and empty `vehicles`) the Friday after a finished race — not the guessed 4. Confirm the real checkered value on a race day before writing `checkeredSeenAt` logic.

### Matching the feed to a race

The poller only acts on a race when **`Race.nascarRaceId` is set and equals `feed.nascarRaceId`**. A race without `nascarRaceId` is never promoted, never gets qualifying captured, and never gets results written by the poller. The admin page shows a prominent warning on any `DRAFTING`/`LOCKED` race within 3 days of `raceDate` that has no `nascarRaceId`.

### Resilience

- 10-second timeout, 3 retries with exponential backoff.
- **No overlapping runs.** The poller holds an in-process `running` flag; a tick that finds the previous run still going skips. Retries can outlast the poll interval.
- Cache the last successful `NormalizedRaceFeed` in memory. On failure, serve the cache and set a `stale: true` flag that the UI displays as "Feed unavailable — showing last update at 3:42pm." After a restart there is no cache; the endpoints must handle `feed: null`.
- **Client requests never call NASCAR.** `GET /races/:id/live` reads `RaceResult` from the database and the poller's in-memory cache. Nine phones polling every 15s must not turn into nine upstream fetches.
- A feed failure must never 500 the leaderboard endpoint. Fantasy standings come from the database and should keep rendering.

### Poller

One `node-cron` job at `*/20 * * * * *` (every 20 seconds) with the overlap guard. Each tick:

1. Find **active-window races**: status `DRAFTING`, `LOCKED`, or `LIVE`, with `nascarRaceId` set and `raceDate` between 4 days ago and 3 days ahead. If none, no-op without fetching.
2. Decide whether a fetch is due: every tick if any race is `LIVE` or the last fetch showed an active qualifying session; otherwise every 2 minutes. (Practice and idle weekend time don't need 20-second resolution.)
3. Fetch and normalize once. If `feed.nascarRaceId` matches none of the active races, stop.
4. For the matching race, inside `withRaceLock`:
   - **Qualifying** (`sessionType === "qualifying"`, race `DRAFTING` or `LOCKED`): capture the grid (below).
   - **Promotion** (`sessionType === "race"`, race `LOCKED`, flag is green or later, `now >= raceDate - 1 hour`): transition to `LIVE` (`green_flag`, `actorUserId: null`), set `wentLiveAt` if null, log it.
   - **Results** (race `LIVE`): resolve each vehicle to a `Driver` (below), then upsert `RaceResult.runningPosition`, `lapsCompleted`, `status` per vehicle; update `currentLap`, `totalLaps`, `flagState`, `feedUpdatedAt`. Never touch `finishPosition`. If the flag is checkered and `checkeredSeenAt` is null, set it.
   - Races in `COMPLETED` or `CORRECTING` are never written. That's the whole point of `CORRECTING`.

A race that's still `DRAFTING` at green flag time is closed by the deadline job first, then promoted on the next tick.

### Resolving feed vehicles to drivers

Every vehicle in the feed must map to a `Driver` row — skipping unknown cars would make `fieldSize` too small and quietly change how DNFs score. For each vehicle, in this order:

1. A `Driver` with this `nascarDriverId` → use it.
2. Otherwise, a `RaceEntry` for this race whose driver has `nascarDriverId: null` and the same `carNumber` → this is a driver the commissioner added by hand. **Backfill** `Driver.nascarDriverId` and use it.
3. Otherwise → create the `Driver` from the feed's ID, name, and car number. Do not create a `RaceEntry` for them (they weren't draftable), but do write their `RaceResult` so they count toward `fieldSize`.

Qualifying capture and entry-list import use the same resolution function, in one place in the adapter's caller.

Race day is roughly 4 hours of polling at 20s, plus a slower trickle across the weekend. That's fine.

### Qualifying capture

The live feed serves **whichever session is currently running** — practice, qualifying, or the race (commonly a `run_type` field: 1 = practice, 2 = qualifying, 3 = race — **verify this at runtime**). Qualifying results are available only while qualifying is the current session. Once the next session starts, that data is gone from the feed.

Qualifying usually happens on Saturday, **while the draft is still open**. That's a feature: once the grid is captured, the driver-selection list shows each driver's starting position, and people picking late in the week get to use it.

So qualifying must be **captured, not fetched**:

- When the matching race is `DRAFTING` or `LOCKED` and the feed reports a qualifying session, write `QualifyingResult` rows on every poll.
- **Replace the whole grid on each poll — do not upsert row by row.** Positions reshuffle constantly during a live session. Inside the lock: `deleteMany({ raceId, source: "feed" })` then `createMany(...)`. This is also why `QualifyingResult` has no unique constraint on `[raceId, startPosition]`.
- **Skip capture entirely if any `source: "manual"` row exists for the race.** Manual data is the commissioner's word; a poller restart mid-session must not overwrite it.
- Set `isPole` on `startPosition === 1`.
- **End of session:** capture stops when the feed's session type changes away from qualifying (or its race ID changes). The last grid written before that is kept. If the feed shows a checkered flag for the qualifying session, that grid is already final.
- After the session, rows are immutable except through `POST /races/:id/qualifying` (commissioner), which replaces the grid with `source: "manual"`.
- **Manual fallback is required.** The capture window is easy to miss — a deploy, a feed hiccup. Give the commissioner a screen to paste or enter the starting lineup. Without this, one missed window means the race page is permanently missing its starting grid.
- **Handle no-qualifying gracefully.** Rain-outs happen and the lineup gets set by formula or owner points. Then `qualifyingTime` and `qualifyingSpeed` are null but `startPosition` still exists. The UI must never assume a lap time is present.

### Driver / entry list ingestion

The entry list needs to be in place **by Wednesday's wheel spin**, since the draft opens immediately. Two paths, both landing in `RaceEntry`:

1. **Automatic** — a commissioner-triggered "Import entry list" button hits the feed, upserts any unknown drivers into `Driver`, and creates `RaceEntry` rows. The live feed often doesn't carry next weekend's entries midweek, so expect this to fail early in the week unless the cacher lead pans out.
2. **Manual (primary for now)** — a commissioner screen to add/remove entries by hand and toggle `isEligible`, with a "copy entries from last race" shortcut. Most weeks the field barely changes, so this is one tap plus a couple of edits. Manual add picks an existing `Driver` or creates a new one with just a name and car number (`nascarDriverId` left null; the poller backfills it — Section 7, "Resolving feed vehicles to drivers").

Seed the `Driver` table with the current full-time field so the first draft works even if ingestion isn't ready.

---

## 8. Scoring & Race Completion

Completing a race is a **commissioner action**, not an automatic one, because the feed cannot be trusted to signal the end cleanly.

The Complete button is **always available to the commissioner** on a `LIVE` or `CORRECTING` race. If `checkeredSeenAt` is null, the confirm dialog says so ("The feed hasn't reported a checkered flag. Complete anyway?"). This covers a feed that died before the finish, and re-completing a corrected race days later when the feed has long moved on.

`POST /api/races/:id/complete` runs inside `withRaceLock`:

1. Reject unless status is `LIVE` or `CORRECTING` → **409**. Reject a race with no `RaceResult` rows at all → **409 `NO_RESULTS`**: every roster would score `fieldSize + 1`, the whole league would tie for the win, and `results_posted` can't be sent again after a correction. Enter the finishing order first (below).
2. Copy `runningPosition` → `finishPosition` **only for rows where `finishPosition` is null**. A re-completion must never overwrite a position the commissioner corrected by hand — that is the entire reason someone would reopen a race.
3. Compute `fieldSize` (Section 4).
4. Load each drafter's picks; build `UserEntry[]` with a **left join** to `RaceResult`, so a drafted driver with no result row arrives as `finishPosition: null`. **Pad every roster to 3 entries** with `{ driverId: null, finishPosition: null }` for slots left empty when the deadline closed the draft. Do not throw on either.
5. Run `rankEntries` with the race's `scoringRuleKey`.
6. Insert `WeeklyResult` rows, including `fieldSize` and the denormalized `driverFinishes` blob (3 entries per user, empty slots shown as "No pick").
7. Set `completedAt`, transition to `COMPLETED`, log `STATUS_CHANGED`.

After commit, send the `results_posted` broadcast.

### Entering results by hand

The feed can fail for a whole race, `nascarRaceId` can be missing, or a drafted driver can be absent from the feed. In each case there are no `RaceResult` rows to correct, and completing the race would score every affected driver as `fieldSize + 1`. So results, like qualifying, need a manual path:

`PUT /races/:id/results` (commissioner, `LIVE` or `CORRECTING` only) takes the full finishing order — `[{ driverId, finishPosition, lapsCompleted?, status? }]` — and inside `withRaceLock` **upserts** a `RaceResult` row per driver, setting `finishPosition` (and `runningPosition` to the same value) with `source: "manual"`. Rows not in the payload are left alone. Logs `RESULTS_CORRECTED` with the before/after. The admin screen accepts a pasted finishing order (one car number per line, in order) and maps car numbers through the race's entries, flagging any it can't match.

If the poller never promoted the race (feed down, or no `nascarRaceId`), the commissioner first uses the status override (`green_flag`) to move it to `LIVE`, then enters results, then completes.

`PATCH /races/:id/results` stays for single-row fixes, and it **also upserts**: patching a driver with no row creates one (`source: "manual"`), so a drafted driver who never appeared in the feed can still be given a finish.

**Empty slots** score exactly like a driver who never took the green: `fieldSize + 1`. That's a real penalty, which is the incentive to pick before Sunday. The commissioner can always pick on behalf of a stalled member before the deadline.

### Correction flow

1. `POST /races/:id/reopen` (commissioner) — `COMPLETED → CORRECTING`, deletes the race's `WeeklyResult` rows, logs `STATUS_CHANGED`. The poller ignores `CORRECTING` races, so nothing changes underneath the commissioner.
2. `PATCH /races/:id/results` (commissioner, `LIVE` or `CORRECTING` only) — sets `finishPosition` on individual drivers, creating the row if it doesn't exist; logs `RESULTS_CORRECTED` with before/after. For a full re-order, use `PUT /races/:id/results` (above).
   To fix a member's driver, `PUT /races/:id/picks/:overallPickNumber` (swap) is also allowed while `CORRECTING`; the pick keeps its slot and owner and logs `PICK_SWAPPED`. Revert, reset, and regenerate stay `DRAFTING`/`LOCKED` only.
   **Filling a missed slot:** the same `PUT` on a slot with no pick creates it, while `LOCKED`, `LIVE`, or `CORRECTING`. Only the next empty slot (`picksMade + 1`) can be filled, so picks stay contiguous; it goes to that slot's snake owner and logs `PICK_MADE_ON_BEHALF`. A `COMPLETED` race is reopened first. While `DRAFTING`, the commissioner uses pick-on-behalf instead.
3. `POST /races/:id/complete` — re-completes. Because step 2 of completion only fills nulls, the patched values survive.

`results_posted` is deduped, so re-completion doesn't re-notify the league. The commissioner can post a note in the group chat if a correction changed the winner.

The live leaderboard during a race runs the *same* `rankEntries` function against `runningPosition`, so the projected standings and the final standings can never disagree on methodology.

---

## 9. API Surface

All routes under `/api`. All authenticated except where noted. `[C]` = commissioner only. Error responses are `{ code, message }` with the codes named in this document.

**Auth**
```
POST   /auth/login                 (public)  { phoneNumber, password } → sets cookie
POST   /auth/logout
GET    /auth/me                              → current user + role
POST   /auth/set-password          (public)  { token, password } → kills old sessions, sets cookie
```

**Users**
```
GET    /users                        [C]     → all users incl. inactive
POST   /users                        [C]     { phoneNumber, displayName, role? } → user + setup link
PATCH  /users/:id                    [C]     { phoneNumber?, displayName?, role?, isActive?, discordUserId? }
POST   /users/:id/setup-link         [C]     → new single-use link (invalidates outstanding ones)
PATCH  /users/me/notifications               { notificationsEnabled }
```

**Seasons**
```
GET    /seasons                              → list, newest first; marks the isCurrent one
```

**Races**
```
GET    /races                                → list, filterable by seasonId (defaults to the current season)
GET    /races/current                        → the race in focus (see below)
GET    /races/:id                            → race + entries + draft order + picks
POST   /races                        [C]
PATCH  /races/:id                    [C]     → edit metadata only (raceName, trackName, raceDate, qualifyingAt, trackMapUrl, imageUrl, nascarRaceId, totalLaps, scoringRuleKey)
POST   /races/:id/status             [C]     { reason, note? } → status override, validated by checkTransition
POST   /races/:id/complete           [C]
POST   /races/:id/reopen             [C]
```

`GET /races/current`: the `DRAFTING`, `LOCKED`, or `LIVE` race with the earliest `raceDate`; else the next `UPCOMING`; else the most recent `COMPLETED`. `CORRECTING` races are never "current". **A `LIVE` race whose `raceDate` is more than 24 hours past is skipped** if another `DRAFTING`/`LOCKED`/`LIVE` race exists — otherwise a race the commissioner forgot to complete would hide next week's draft from the dashboard. The admin page shows a prominent "Complete this race" warning on any such stale `LIVE` race.

`PATCH /races/:id` runs in `withRaceLock`. Changing `raceDate` clears the race's `deadline_warning` and `draft_closed` notification rows (Section 6, "Postponements").

The status override accepts only these reasons: `draft_reopened`, `deadline_passed` (close the draft early), `green_flag`, and `false_start`. Every other transition happens only through its dedicated action (wheel spin, pick, regenerate, complete, reopen). `scoringRuleKey` can only be changed before the race is `COMPLETED`.

**Entries**
```
GET    /races/:id/entries
POST   /races/:id/entries/import     [C]     → pull from feed
POST   /races/:id/entries/copy-from  [C]     { sourceRaceId }
POST   /races/:id/entries            [C]     → manual add
PATCH  /races/:id/entries/:entryId   [C]     → toggle isEligible (warns if drafted)
DELETE /races/:id/entries/:entryId   [C]     → 409 if drafted
```

**Draft**
```
POST   /races/:id/draft-order                [C]  → spin the wheel; optional { userIds[] } (see §10)
GET    /races/:id/draft                           → { order, snake, picks, onTheClock, nextOverallPickNumber, deadline, availableDrivers }
POST   /races/:id/picks                           → { driverId, overallPickNumber, onBehalfOfUserId? }
DELETE /races/:id/picks/last                 [C]  → { overallPickNumber } revert, if that's still the last pick
PUT    /races/:id/picks/:overallPickNumber   [C]  → { driverId } swap the driver on that pick, or fill the next missed slot (Section 8)
POST   /races/:id/draft/reset                [C]
POST   /races/:id/draft/regenerate           [C]
GET    /races/:id/events                          → audit log
```

**Live & standings**
```
PUT    /races/:id/results      [C]   → enter/replace the finishing order by hand (upserts, source "manual")
PATCH  /races/:id/results      [C]   → correct individual finishPositions (upserts missing rows)
GET    /races/:id/qualifying         → starting lineup (empty array if not yet captured)
POST   /races/:id/qualifying   [C]   → manual entry / overwrite of the starting lineup
GET    /races/:id/live               → { feed, stale, qualifying, fantasyStandings }
GET    /races/:id/standings          → weekly results (live projection or final)
GET    /seasons/:id/stats            → aggregated season page
```

**Notifications**
```
POST   /notifications/subscribe      → upsert a PushSubscription by endpoint
DELETE /notifications/subscribe      → remove one
POST   /notifications/test           → send yourself a test push (essential for debugging iOS)
```

**Ops**
```
GET    /health                       (public)  → { ok, db, jobs } — last run of each scheduled job; 503 if one is overdue or the database can't be read (Section 2)
```

`GET /races/:id/live` is the workhorse of race day and returns both halves of the page in one response — one poll, one render, no chance of the two panels showing different laps.

---

## 10. The Wheel Spinner

**Constraints:** commissioner-only, once per race, server-generated, non-riggable. **By league convention it's spun on Wednesday**; the app doesn't enforce the day.

`POST /api/races/:id/draft-order`, inside `withRaceLock`:
1. Reject unless `req.user.role === "COMMISSIONER"` → **403**.
2. Reject unless `race.status === "UPCOMING"` → **409**. Reject if `now >= race.raceDate` → **409 `PICKS_CLOSED`** (otherwise the deadline job would close the new draft within a minute).
3. Reject if any `DraftOrder` rows already exist → **409**. With the race lock, a double-click can't produce two orders.
4. Reject if the race has no eligible entries, or fewer eligible entries than `participants × 3` → **409 `NOT_ENOUGH_DRIVERS`**.
5. Fisher–Yates shuffle of the participants using `crypto.randomInt` (not `Math.random`). Participants default to all `isActive` users; the body accepts an optional `userIds[]` (each must be an active user; at least 2) so the commissioner can run a short week when someone is out of town. Anyone excluded simply has no `DraftOrder` row and no picks; the snake and all scoring read from `DraftOrder`, so nothing else needs to change.
6. Insert `DraftOrder` rows, write an `ORDER_GENERATED` event containing the full resulting order, transition to `DRAFTING`.
7. Return the order.

After commit: `draft_open` broadcast, then `on_the_clock` to the person with pick 1.

**Client behavior:** the response arrives with the order already decided. The wheel then animates through N spins, revealing one name at a time and removing it from the wheel. The animation is theater over a settled result — which is exactly what makes it unriggable. Nobody can refresh for a better spot, because the spot is already in the database before the wheel starts turning.

**Most people won't be watching live**, since the draft is asynchronous. The first time each user opens the draft room after the order exists, play the reveal for them, then remember (in `localStorage`, keyed by race ID, wrapped in try/catch) that they've seen it, with a "Replay the spin" link. People polling the draft room at the moment of the spin see it immediately.

---

## 11. Frontend Structure & Mobile

**Mobile-first is a hard requirement.** Build at 375px and scale up; do not build desktop-first and add breakpoints after.

```
/                    Dashboard — current race, your roster, whose turn it is, deadline countdown
/draft/:raceId       Draft room (wheel → board → picks)
/live/:raceId        Live race + fantasy standings
/history             Past weeks
/season/:seasonId    Season stats (for fun)
/settings            Notifications on/off, install-the-app help, test push
/admin               Commissioner tools
```

**Layout:** bottom tab bar on mobile (Home / Draft / Live / Season), sidebar at `md:` and up. Minimum 44px tap targets. The driver-selection list must be a single scrollable column with search — not a grid of small tiles.

**The live page on mobile** stacks: fantasy standings first (that's what your friends actually care about), then the full running order below. On desktop they sit side by side. Fantasy standings come first in the DOM either way.

**Starting positions.** Once `QualifyingResult` rows exist for a race, the live page gains a start column and a **position-change indicator** — `start − current`, rendered as green `+12` for positions gained and red `−3` for positions lost. This is the single best piece of context you can put on a race page, and it costs one join.

Live page states, driven by race status:

| Status | What the page shows |
|---|---|
| `DRAFTING` / `LOCKED`, no qualifying yet | Rosters so far, each user's drivers with "grid TBD" |
| `DRAFTING` / `LOCKED`, qualifying captured | **Starting lineup view** — full grid, each user's roster annotated with start positions, and each user's *average starting position* as a preview of the week |
| `LIVE` / `COMPLETED` / `CORRECTING` | Running order with start, current, and change columns; fantasy standings with average start vs. average current |

**Average start vs. average current** on the fantasy leaderboard is worth building. Since the weekly score is average finish, showing average start alongside it tells you at a glance whose roster is gaining ground and whose is going backwards. Cheap to compute, and it's the kind of thing that makes the group check the app mid-race.

**Draft room specifics:**
- A persistent, high-contrast banner: "**You're on the clock**" or "Waiting on Kyle — pick 7 of 27", plus the deadline ("Picks close Sun 1:30 PM", in the viewer's time zone).
- Optimistic UI on pick submission, with rollback on `STALE_BOARD` / `DRIVER_TAKEN` and a clear "Someone just picked — here's the updated board" message. Disable the confirm button while a pick is in flight; the server's idempotent-retry rule (Section 6) covers the double tap that gets through anyway.
- The draft board (grid of rounds × users) is horizontally scrollable on mobile with the round labels pinned. Withdrawn drivers show a "⚠ withdrawn" badge.
- The driver-selection list is a single scrollable column with search. Sort order: **starting position** once qualifying is captured; otherwise **last completed race's finish**; otherwise **car number**. Show start position and last-race finish on each row when known.
- Commissioner controls live behind a collapsed "Commish" panel so they're not tappable by accident.

### App updates (service worker)

An installed iPhone web app holds onto its cached files aggressively. Without a plan, half the league runs last week's build after a deploy, sending requests the server no longer accepts.

- **The service worker never caches `/api/*`.** It caches the app shell and static assets only. API responses always go to the network.
- Hashed asset filenames (Vite's default) plus a non-cached `index.html` and service worker file (`Cache-Control: no-cache` on both).
- When a new service worker is waiting, show a **"New version available — tap to reload"** banner. Tapping it activates the new worker and reloads. Don't auto-reload mid-pick.
- **Version floor:** the client sends its build number in an `X-App-Version` header on every API request (`VITE_APP_VERSION`, set at build time — a timestamp or incrementing integer). The server rejects anything below `MIN_CLIENT_VERSION` with **426 `CLIENT_OUTDATED`**, and the client responds by forcing the reload. Requests with no header at all (the uptime monitor, `curl`) are not rejected. Bump `MIN_CLIENT_VERSION` only when a deploy changes the API in a way old clients can't handle; leave it alone otherwise.

**Loading states:** every polled view needs a stale indicator rather than a spinner. Replacing a leaderboard with a spinner every 15 seconds is miserable to watch.

---

## 12. Build Phases

Each phase ends running and demoable.

**Phase 1 — Foundation**
Repo structure (`client/`, `server/`, `shared/`), TypeScript configs, Prisma schema + first migration, seed script (one season with its schedule, the driver field, your 9 users). Auth end to end: login, session cookie, `/auth/me`, protected route wrapper on the client, user admin and setup links. **Deploy both halves now, same-site (Section 5), and log in from an iPhone** while there's nothing else to debug. While you're there, log `req.ip` from the phone's request and confirm it's the phone's address, not the proxy's (Section 5, rate limiting). Add `GET /api/health`, the uptime monitor, and Sentry now, so every later phase is monitored from its first deploy. Create `.env.example`.

**Phase 2 — Rules & tests**
Implement `shared/rules/` in full: `snakeOrder`, `whoseTurn`, `roundForPick`, `checkTransition`, `SCORING_RULES`, `rankEntries`, plus `normalizePhone`. Write the unit tests listed in Section 4. No UI, no I/O. This phase is entirely pure functions and takes an afternoon; skipping it is how the project accumulates the debt you're trying to avoid.

**Phase 3 — Races & entries**
Race CRUD, status override endpoint, `withRaceLock`, commissioner admin page, manual entry-list management with copy-from-last-race. No feed integration yet. This proves the whole draft can run without NASCAR's servers cooperating.

**Phase 4 — Draft & notifications**
Wheel spinner endpoint + animation (with replay for late viewers). Draft room with polling, turn enforcement, pick submission, the draft board, deadline job. Then commissioner controls: pick on behalf, revert, swap, reset, regenerate. Audit log view. Then notifications per Section 14 — web push, the Discord webhook, the sweeper, install-to-Home-Screen onboarding, and the service worker update flow and version floor (Section 11, "App updates") — before anyone installs the app. **Run a full mock draft with your friends at the end of this phase, over a real Wednesday-to-Sunday week** — it's the highest-risk surface, and it's the only way to find out whether the UX works, whether reminders are annoying or useful, and whether notifications actually land on everyone's phone.

**Phase 5 — Live feed & qualifying**
Build the adapter against the fixtures you've been capturing (Section 16). Map real field names (including session type and race ID), write the normalizer. The poller. Manual qualifying entry screen. `GET /races/:id/live`. Live page with both panels, start column, and position-change indicators. Starting positions in the draft room's driver list. Entry-list import button.

**Phase 6 — Completion & history**
Race completion transaction, reopen/correction flow, manual results entry (paste a finishing order), `complete_reminder` notifications, `WeeklyResult` snapshots, history page, confetti for the weekly winner (every co-winner on a tie — Section 4).

**Phase 7 — Season stats**
Aggregate page: weekly wins (count of `rank === 1` rows, so a tie is a win for each co-winner), best/worst weeks, average score, most-drafted drivers, and **top-10 rate by user** (share of a user's drafted drivers who finished top 10). Read exclusively from `WeeklyResult`. This is the fun page — build it last, when you have real data to look at.

---

## 13. Testing

Not aiming for high coverage. Aiming for the tests that would have caught a Sunday-afternoon disaster.

**Unit (required):** everything in `shared/rules/`, per Section 4. Plus `normalizePhone()` — 10-digit, 11-digit with leading 1, already-E.164, every common punctuation style (`(920) 555-1234`, `920.555.1234`, `920 555 1234`, `+1-920-555-1234`) collapse to one value; 9 digits, 12 digits, and letters return `null`.

**Integration (a handful, against a test database):**
- Two simultaneous pick requests for the same slot with **different drivers** → one 201, one 409, exactly one `Pick` row. (Same driver from the same user is a retry — see the idempotency test below.)
- **A pick and a revert fired simultaneously, repeated 50 times → pick numbers are always contiguous `1..count`.**
- A pick with a stale `overallPickNumber` → 409 `STALE_BOARD`.
- A member picking out of turn → 403.
- Picking a driver with no eligible `RaceEntry` → 400; picking an already-drafted driver → 409 `DRIVER_TAKEN`.
- A pick after `raceDate` → 409 `PICKS_CLOSED`; the deadline job then locks the race and logs an event with a null actor.
- Full draft → `LOCKED`; revert before the deadline → back to `DRAFTING` with contiguous pick numbers.
- Revert naming a pick that's no longer the last → 409 `STALE_BOARD`, no rows deleted.
- Swap the driver on pick 4 of 20 → pick 4 has the new driver, picks 5–20 untouched.
- Complete a race → correct `WeeklyResult` scores and ranks, `finishPosition` populated.
- Complete a race with no `RaceResult` rows → 409 `NO_RESULTS`; still `LIVE`, no `WeeklyResult` rows, no `results_posted`.
- Complete a race whose draft closed with 2 empty slots → those slots score as `fieldSize + 1`, does not throw.
- Scoring a roster where one drafted driver has no `RaceResult` row at all → scores as `fieldSize + 1`, does not throw.
- Complete → reopen → patch a `finishPosition` → poller tick with a feed for this race → re-complete → the patched value survives, the poller wrote nothing, `WeeklyResult` reflects the patch.
- Feed adapter given a malformed payload → returns cached data with `stale: true`, does not throw.
- Feed for a different `nascarRaceId` → poller writes nothing.
- Live page data assembled with no `QualifyingResult` rows → renders without start/change columns, does not throw.
- Two qualifying polls where two drivers swap positions → grid is fully replaced, no constraint error, no orphaned row.
- Qualifying poll when manual rows exist → no change.
- Revert attempted on a `COMPLETED` race → 409, no rows deleted.
- Status override with a disallowed transition (e.g. `LOCKED → COMPLETED`) → 409.
- Notification send fails → log row has `succeeded: false`; the sweeper retries and succeeds; a second sweep sends nothing.
- After-commit dispatch and a sweeper run racing on the same unsent row → exactly one send.
- Web-push broadcast where one of nine sends fails → only that user's row is retried.
- Reset draft → the re-draft's first `on_the_clock` is delivered (not blocked by the old log rows).
- Race with no `RaceResult` rows → `green_flag` override, `PUT /results` with a pasted order, complete → correct `WeeklyResult` scores.
- `PATCH /results` for a drafted driver with no row → row created, driver scored at the patched position.
- Feed vehicle with an unknown `nascarDriverId` whose car number matches a hand-added entry → `nascarDriverId` backfilled on that driver, no duplicate `Driver` row.
- `draft_reopened` override on a race that went `LIVE` then `false_start` → 409.
- Reset or regenerate after `raceDate` → 409 `PICKS_CLOSED`, no rows deleted.
- Draft closes incomplete → `raceDate` moved later → reopen → deadline job closes it again → a second `draft_closed` is sent.
- The same pick request sent twice → both return 2xx, exactly one `Pick` row, one `PICK_MADE` event, one `on_the_clock` notification. Also when it's the final pick (the retry arrives after the race is `LOCKED`).
- Wheel spin after `raceDate` → 409 `PICKS_CLOSED`, no `DraftOrder` rows.
- Race `LIVE` with `checkeredSeenAt` 61 minutes ago → one `complete_reminder` per commissioner; a second sweep sends nothing.
- Two users tied at the best score → both `WeeklyResult` rows have `rank: 1`, and both count as a weekly win in season stats.
- Request with `X-App-Version` below `MIN_CLIENT_VERSION` → 426 `CLIENT_OUTDATED`.
- Login rate limit: requests from two different `X-Forwarded-For` client IPs through the proxy hop get separate buckets.

No E2E suite. The mock draft in Phase 4 is your E2E test, and it has nine humans in it.

---

## 14. Notifications

With a draft that runs from Wednesday to Sunday, notifications aren't a nicety — they *are* the draft. Nobody watches a draft room for four days. The phone buzzes, you open the app, you pick, you close it.

### Channels

Implement behind one interface so channels can be added or dropped without touching the code that decides *when* to notify:

```ts
export interface NotificationChannel {
  key: "web_push" | "discord";
  /** Returns false if this channel can't reach this user (no subscription, muted, etc.). */
  canReach(userId: string | null): Promise<boolean>;
  send(payload: NotificationPayload): Promise<void>;
}

export interface NotificationPayload {
  raceId: string;
  userId: string | null;   // null = broadcast to the whole league
  kind: NotificationKind;
  overallPickNumber: number; // 0 for non-slot notifications
  title: string;
  body: string;
  url: string;             // deep link, e.g. /draft/:raceId
}

export type NotificationKind =
  | "draft_open" | "on_the_clock" | "pick_reminder"
  | "deadline_warning" | "draft_complete" | "draft_closed" | "results_posted"
  | "complete_reminder";
```

**1. Web Push (primary).** Free, no carrier involvement, lands on the lock screen like a text.

- Server: the `web-push` npm package with a VAPID keypair generated once and stored in env vars.
- Client: a service worker plus a subscribe prompt, triggered by a tap (browsers require a user gesture). Store the subscription in `PushSubscription`, upserting on `endpoint`.
- **iOS requires the site be installed to the Home Screen** before web push works at all — Safari will not deliver notifications to a site open in a normal tab. Build an onboarding screen that detects iOS, detects standalone display mode, and walks the user through Share → Add to Home Screen, **then has them log in inside the installed app** (it has its own cookie jar, Section 5), then enable notifications. If you skip this, your iPhone friends silently get nothing and you'll spend an evening debugging a permissions API that's working fine.
- Handle `410 Gone` / `404` responses by deleting the dead subscription row. Subscriptions expire routinely.

**2. Discord webhook (second channel).** If the league has a Discord server, a webhook is a single unauthenticated POST to a URL. Store the URL in an env var. Broadcast kinds post a plain message. **Turn kinds (`on_the_clock`, `pick_reminder`) post `<@discordUserId>` so only that person gets pinged**; if the user has no `discordUserId`, use their display name (no ping). Skip turn messages for muted users. A channel full of "Kyle, you're up — pick 7 of 27" across the week doubles as a readable draft log.

**3. SMS (future).** Slots into the same interface if you ever complete 10DLC registration. Do not build now.

### When to fire

| Trigger | Recipient | Kind | `overallPickNumber` |
|---|---|---|---|
| Draft order generated | broadcast | `draft_open` | 0 |
| Draft order generated | user with pick 1 | `on_the_clock` | 1 |
| A pick is made and the turn advances | the next user | `on_the_clock` | the next slot |
| A pick is reverted | the user now on the clock | `on_the_clock` | the reverted slot |
| Same user on the clock for `PICK_REMINDER_HOURS` | that user | `pick_reminder` | the slot |
| `DEADLINE_WARNING_HOURS` before `raceDate`, draft incomplete | each commissioner | `deadline_warning` | 0 |
| Final pick made | broadcast | `draft_complete` | 0 |
| Deadline closes an incomplete draft | broadcast | `draft_closed` | 0 |
| Race completed | broadcast | `results_posted` | 0 |
| Race still `LIVE` 1 hour after `checkeredSeenAt` (or 6 hours after `raceDate` if no checkered was seen) | each commissioner | `complete_reminder` | 1 (first reminder) |
| Race still `LIVE` at 09:00 `LEAGUE_TIMEZONE` the next morning | each commissioner | `complete_reminder` | 2 (follow-up) |

For `complete_reminder`, `overallPickNumber` is the reminder's sequence number rather than a slot — it's what lets the dedupe key allow exactly two. The reminder deep-links to the race's Complete button. It is held during quiet hours like a turn notification; nobody needs to be woken to press Complete.

`overallPickNumber` on turn kinds is **the slot the user is on the clock for**, which makes the dedupe key exact.

### Delivery rules

- **Fire after the transaction commits, never inside it.** A push failure must not roll back a pick.
- **Claim, then send.** For each (recipient, channel):
  1. Insert the `NotificationLog` row with `succeeded: false` (`ON CONFLICT DO NOTHING`).
  2. **Claim it atomically** with one conditional update:
     ```sql
     UPDATE "NotificationLog" SET "claimedAt" = now()
     WHERE <unique key> AND "succeeded" = false AND "attempts" < 5
       AND ("claimedAt" IS NULL OR "claimedAt" < now() - interval '2 minutes')
     ```
     If it updated zero rows, someone else is sending it, it already succeeded, or it has given up — skip.
  3. Send, then update the row with `succeeded`, `attempts + 1`, `error`, and `claimedAt = null`.

  The conditional update is what makes delivery at-most-once while two senders (the after-commit dispatch and the sweeper) can see the same row. The 2-minute expiry lets a claim abandoned by a crashed process be picked up again. A failure is recorded but doesn't block a retry.
- **Broadcast rows are per recipient on web push.** A web-push broadcast writes one row per user (`userId` = that user), so one failed phone is retried alone. Discord delivers a broadcast as a single message, so it uses one row with `userId: "BROADCAST"`.
- **Only the person on the clock gets turn notifications.** Do not broadcast every pick. Nine people getting nine notifications each per round — 243 pushes per draft — is how a group mutes an app permanently.
- **Commissioner picks on behalf of someone still advance the turn and still notify the next person.** Notification logic keys off `whoseTurn`, not off who submitted the request.
- **Clearing the ledger:**
  - Revert of slot N: delete the race's `on_the_clock` and `pick_reminder` rows for slots ≥ N, and the `draft_complete` row. The user back on the clock for N is re-notified; whoever is next after the re-pick will be too.
  - Reset: delete all of the race's turn rows and `draft_complete`/`draft_closed` rows.
  - `raceDate` changed: delete the race's `deadline_warning` and `draft_closed` rows. `draft_reopened`: delete the `draft_closed` row.
  - Regenerate: delete all of the race's draft rows, including `draft_open`.
  - `results_posted` is never cleared; a re-completion doesn't re-announce.
- **Per-user mute** (`User.notificationsEnabled`) is respected by every per-user notification on every channel. Broadcasts go to Discord regardless; web-push broadcasts skip muted users.
- **Quiet hours** (`QUIET_HOURS_START`–`QUIET_HOURS_END` in `LEAGUE_TIMEZONE`, default 22:00–08:00): no web push or Discord turn notifications are *sent* in that window. The claim row is still written; the sweeper delivers it when quiet hours end. A 1 a.m. pick from a night owl shouldn't wake up the next person. Broadcasts and `deadline_warning` are not held — on race morning, the deadline matters more than sleep.

### Sweeper job

`node-cron`, every 5 minutes, **around the clock**. During quiet hours it skips the held kinds (`on_the_clock`, `pick_reminder`, `complete_reminder`) and still runs steps 4 and 6, since broadcasts and `deadline_warning` are not held. It is the safety net that makes delivery reliable without a queue:

1. For each `DRAFTING` race, find who's on the clock and for which slot.
2. If that user has no `succeeded` `on_the_clock` row for the slot → send it (covers failures, quiet-hours holds, and server restarts between commit and dispatch).
3. If the slot has been open longer than `PICK_REMINDER_HOURS` (default 12) and no `pick_reminder` row exists → send one reminder. One reminder per slot; after that, it's the commissioner's call to nudge or pick on behalf.
4. If `raceDate - now <= DEADLINE_WARNING_HOURS` (default 12) and the draft is incomplete → `deadline_warning` to each commissioner, naming who is on the clock and how many picks remain.
5. For each `LIVE` race, send any `complete_reminder` that is due (table above). Held during quiet hours.
6. Retry any `succeeded: false` broadcast rows (the per-user web-push rows and the Discord `BROADCAST` rows) with `attempts < 5`, using the same claim step.

"Slot open since" for step 3 is the `createdAt` of the most recent `DraftEvent` that put this user on the clock for this slot: `ORDER_GENERATED`, `PICK_MADE`/`PICK_MADE_ON_BEHALF` for the previous slot, `PICK_REVERTED`, `DRAFT_RESET`, or the `STATUS_CHANGED` for a `draft_reopened`.

---

## 15. Deliberately Out of Scope

Listed so they don't get built by accident, and so the reasoning is on record:

- **WebSockets** — nine users, polling is fine.
- **Season-long fantasy standings that affect play** — weeks are independent by design; the season page is read-only trivia.
- **DQ / post-race penalty handling** — rare enough that the commissioner reopening a race and editing positions by hand is the right amount of machinery.
- **Public signup, password reset emails, multi-league support** — closed group; the commissioner is the user administration system.
- **SMS notifications** — web push and Discord cover the same need for free. Revisit only if someone genuinely can't receive push.
- **Auto-pick on timeout** — the commissioner can pick on behalf, which covers the stalled-draft case with code that already exists for another reason. Reminders and the deadline warning reduce how often that's needed.
- **A pick clock per turn** — with a Wednesday-to-Sunday draft, a hard per-turn timer would punish people for having jobs. The race-day deadline is the only hard limit.
- **A native iOS app — for now.** See below.

### Future: native iOS (and Android) app

A native app isn't feasible right now (no Mac/Xcode toolchain or Apple Developer account available), and the installable PWA covers the need: push notifications, a Home Screen icon, full-screen launch. If it becomes feasible later, the cheapest path is to **wrap the existing React app with Capacitor** rather than rewrite it:

- The React UI, the shared rules, and the whole backend are reused unchanged.
- Push moves from web push to APNs (via Capacitor's push plugin or Firebase Cloud Messaging). That's a new `NotificationChannel` implementation plus a `deviceToken` table — the channel interface in Section 14 was designed for exactly this.
- It removes the Add-to-Home-Screen onboarding step, which is the biggest friction point for iPhone users.
- Costs: an Apple Developer account ($99/year), a Mac (or a cloud macOS build service) to build and sign, and App Store or TestFlight distribution. TestFlight is enough for a private league of nine.
- Session cookies need re-checking inside the native webview; a bearer token in secure storage may be simpler there. The `AuthProvider` and session layer keep that change contained.

Nothing in this spec should be built in a way that blocks this. In practice that means: keep all API calls going through one client module, keep notification sending behind the channel interface, and don't rely on browser-only APIs outside the PWA/onboarding code.

---

## 16. Handoff Notes

### Repo layout for the agent

Put **Section 0 (standing rules) into `CLAUDE.md` at the repo root** — Claude Code reads that file automatically on every session, so those rules survive context resets. Put this full document at `docs/SPEC.md` and reference it from `CLAUDE.md`.

Then work **one phase per session**, not the whole spec at once. At the start of each: "Read docs/SPEC.md, implement Phase N only, stop when it runs." Long specs pasted into a single session get skimmed; a phase-sized instruction with a file to consult does not.

### Environment variables

Create `.env.example` in Phase 1 with every one of these present — discovering a missing var during a live draft is avoidable.

```
DATABASE_URL=              # Postgres connection string
TEST_DATABASE_URL=         # integration tests only: a separate database whose name ends in _test; wiped every run
NODE_ENV=
PORT=

SESSION_COOKIE_NAME=       # e.g. dnd_session
FRONTEND_ORIGIN=           # exact frontend URL (https://<domain> on the server); used for the Origin check
TRUST_PROXY=               # proxy hops in front of the API, for req.ip (Section 5); 0 locally

VAPID_PUBLIC_KEY=          # web-push; generate once, never rotate casually
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=             # mailto: address

DISCORD_WEBHOOK_URL=       # optional second notification channel
NASCAR_FEED_BASE_URL=      # https://cf.nascar.com — swappable without a code change
FEED_POLL_ENABLED=         # kill switch for the poller

SENTRY_DSN=                # error tracking; optional in dev, set in production
MIN_CLIENT_VERSION=        # oldest client build the API accepts (Section 11, "App updates")

LEAGUE_TIMEZONE=           # America/Chicago — quiet hours only
QUIET_HOURS_START=         # 22:00
QUIET_HOURS_END=           # 08:00
PICK_REMINDER_HOURS=       # 12
DEADLINE_WARNING_HOURS=    # 12
```

Frontend (`client/.env.example`): `VITE_API_BASE_URL` (`/api`; same origin), `VITE_VAPID_PUBLIC_KEY`, `VITE_APP_VERSION` (normally unset — the build stamps its own time; read from the shell environment only), and `VITE_APP_NAME` (the name shown in the app; blank uses the built-in default).

Deploy only: `APP_NAME` in the server's `/etc/draft-and-draft/server.env`, which `dnd deploy` passes to the client build as `VITE_APP_NAME` (`deploy/gcp/README.md`).

### Capture feed fixtures at the first opportunity

The feed only serves data while a session is actually running. That means **the adapter in Phase 5 can only be developed and tested during a race weekend** — a few hours a week, and the season ends in the fall.

Do not wait until Phase 5. The very first weekend after you start, run a throwaway script that fetches the feed every 30 seconds during practice, qualifying, and the race, and writes each raw response to `server/test/fixtures/`. Ten minutes of work, and it buys you:

- Real field names to map against, instead of the guesses in Section 7 (including the session type and race ID fields the poller depends on)
- Offline development of the adapter, normalizer, and live page at any hour
- Replayable fixtures for the integration tests, including a qualifying session and a mid-race caution

That same weekend, check whether the cacher endpoints mentioned in Section 7 exist. If they do, save samples of those too.

**If you're starting late in the season** (the Cup season ends in early November), every remaining race weekend is a fixture-capture opportunity you won't get back until February. Run the capture script on all of them — you want at least one practice, one qualifying session, one caution-heavy race, and one rain delay if you can get it. Plan for the mock draft (Phase 4) to either squeeze into the last few weeks or happen during the first weeks of next season.

Without fixtures, Phase 5 is gated on the NASCAR schedule and you will be debugging a JSON parser at 3pm on a Sunday instead of watching the race.

### Seed with real names

Seed the 9 actual league members, the real driver field, and the season's race schedule in Phase 1. Every phase after that is demoable to the group, which is how you find out the draft board is confusing before you've built six more things on top of it.
