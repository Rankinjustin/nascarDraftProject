# Draft & Draft

Weekly NASCAR fantasy web app for a private 9-person league. The full spec is
`docs/SPEC.md` — read the relevant sections before changing anything, and treat
it as the source of truth. If the code and the spec disagree, stop and ask.

## Standing rules

1. **Business rules live in pure functions.** Everything in `shared/rules/` (`snakeOrder`, `whoseTurn`, `roundForPick`, the scoring rules, the race status transition table) and the `normalizePhone()` helper must not import Prisma, Express, or any I/O. They take plain data and return plain data. They are the only things with mandatory unit tests.
2. **The server is the source of truth for anything contestable** — draft order, whose turn it is, pick deadlines, and scores. The client never generates randomness that matters and never decides turn legality.
3. **Every route validates input with Zod at the boundary.** Route handlers parse and delegate; they contain no business logic.
4. **Every write that changes a race's status, draft order, picks, or results goes through `withRaceLock(raceId, fn)`** (SPEC Section 6). No exceptions, including cron jobs.
5. **Race status only changes through the transition table** (`checkTransition`, SPEC Section 4). No route or job sets `Race.status` directly.
6. **Do not invent NASCAR feed field names.** SPEC Section 7 documents the expected shape, but the feed is undocumented and may have changed. Write the adapter defensively, log the raw payload once on first successful fetch, and fail soft.
7. **Build in the phase order in SPEC Section 12.** Each phase should end in a running, demoable state.

## Working on this repo

- Work one phase per session: "Read docs/SPEC.md, implement Phase N only, stop when it runs."
- Repo layout: `client/` (React + Vite), `server/` (Express + Prisma), `shared/` (types and pure rules, imported by both).
- Never format dates on the server; send ISO strings and let the browser localize.
- Every environment variable lives in `.env.example` (SPEC Section 16).
