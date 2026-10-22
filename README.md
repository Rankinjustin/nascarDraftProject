# Draft & Draft

Weekly NASCAR fantasy for a private league. Spec: [`docs/SPEC.md`](docs/SPEC.md).

## Layout

| Folder    | What                                                                   |
|-----------|------------------------------------------------------------------------|
| `client/` | React + Vite + Tailwind PWA                                            |
| `server/` | Express + Prisma + Postgres API                                        |
| `shared/` | Types and pure rule functions used by both (the only mandatory tests)  |
| `deploy/` | The single-server Google Cloud deploy (`deploy/gcp/dnd.sh`)            |
| `docs/`   | `SPEC.md`, the source of truth for how the app behaves                 |

## Local setup

Needs Node 22+ and a Postgres database.

```sh
npm install
cp server/.env.example server/.env        # then set DATABASE_URL
cp server/prisma/seed-data/users.example.json server/prisma/seed-data/users.json   # then fill in the league
npm run db:migrate                         # creates the tables
npm run db:seed                            # season, schedule, drivers, users — prints each user's setup link
npm run dev                                # API on :3001, app on http://localhost:5173
```

Open a printed setup link, set a password, and you're in. `users.json` is gitignored so phone numbers stay out of the repo.

## Commands

| Command             | Does                                     |
|---------------------|------------------------------------------|
| `npm run dev`       | API + client with reload                 |
| `npm test`          | Unit tests, plus integration tests when `TEST_DATABASE_URL` is set (a separate `_test` database; its tables are emptied on every run) |
| `npm run typecheck` | TypeScript across all three packages     |
| `npm run db:migrate`| Create/apply a migration after editing `schema.prisma` |
| `npm run db:seed`   | Re-run the seed (safe to repeat)         |
| `npm run capture:feed -w server -- <nascarRaceId>` | Save raw NASCAR feed responses under `server/test/fixtures/capture/` during a race weekend |
| `npm run release`   | Package the last commit as `release.tar.gz` for a manual deploy |

## Deploying

One Google Cloud server runs everything (Postgres, the app, HTTPS); step by step in
[`deploy/gcp/README.md`](deploy/gcp/README.md). Pushes to `master` deploy automatically once that's set up. The server
runs the TypeScript directly through `tsx`, which is why it's a production dependency of `server/`.

## Seed data

`server/prisma/seed-data/races-<year>.json` is a season's Cup points races from NASCAR's public cacher JSON (SPEC Section 7), and `drivers.json` is the field from a 2026 weekend feed; the raw responses are in `server/test/fixtures/`. The newest `races-<year>.json` is the current season. For a new season, once NASCAR has published it: `npm run season:schedule -w server -- 2027`, commit the file it writes, and re-run the seed (on the server, `sudo dnd seed`). The seed only adds what's missing; members, drivers, and races that already exist are left as the app has them.
