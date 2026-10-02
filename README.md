# Draft & Draft

Weekly NASCAR fantasy for a private league. Spec: [`docs/SPEC.md`](docs/SPEC.md).

## Layout

| Folder    | What                                                                   |
|-----------|------------------------------------------------------------------------|
| `client/` | React + Vite + Tailwind PWA                                            |
| `server/` | Express + Prisma + Postgres API                                        |
| `shared/` | Types and pure rule functions used by both (the only mandatory tests)  |

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
| `npm test`          | Unit tests                               |
| `npm run typecheck` | TypeScript across all three packages     |
| `npm run db:migrate`| Create/apply a migration after editing `schema.prisma` |
| `npm run db:seed`   | Re-run the seed (safe to repeat)         |

## Seed data

`server/prisma/seed-data/races-2026.json` and `drivers.json` were generated from NASCAR's public cacher JSON (see SPEC Section 7); the raw responses are in `server/test/fixtures/`. To refresh for a new season, re-fetch `race_list_basic.json` for that year and a recent `weekend-feed.json`.
