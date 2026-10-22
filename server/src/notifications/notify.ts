import { draftTurn } from "@dnd/shared";
import type { NotificationLog, Race, User } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { reportError } from "../instrument";
import { discordChannel } from "./discord";
import { isQuietHours } from "./quietHours";
import { HELD_KINDS, type NotificationChannel, type NotificationKind, type NotificationPayload } from "./types";
import { webPushChannel, webPushConfigured } from "./webPush";

let channels: NotificationChannel[] = [
  ...(webPushConfigured ? [webPushChannel] : []),
  ...(env.DISCORD_WEBHOOK_URL ? [discordChannel] : []),
];

/** Integration tests swap in fake channels. */
export function setChannels(next: NotificationChannel[]): void {
  channels = next;
}

export interface Notice {
  raceId: string;
  kind: NotificationKind;
  /** The slot for turn kinds; 0 otherwise. */
  overallPickNumber: number;
  to: "league" | "commissioners" | { userId: string };
}

interface RaceContext {
  race: Race;
  users: Map<string, User>;
  picksMade: number;
  totalSlots: number;
  firstPickName: string | null;
  onTheClockName: string | null;
}

async function loadContext(raceId: string): Promise<RaceContext | null> {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: { draftOrders: { orderBy: { pickPosition: "asc" } }, _count: { select: { picks: true } } },
  });
  if (!race) return null;
  const users = new Map((await prisma.user.findMany()).map((u) => [u.id, u]));
  const { snake, onTheClock } = draftTurn(race.draftOrders.map((o) => o.userId), race._count.picks);
  const name = (id: string | null | undefined) => (id ? (users.get(id)?.displayName ?? null) : null);
  return {
    race,
    users,
    picksMade: race._count.picks,
    totalSlots: snake.length,
    firstPickName: name(snake[0]),
    onTheClockName: name(onTheClock),
  };
}

function compose(kind: NotificationKind, ctx: RaceContext, slot: number): { title: string; body: string } {
  const name = ctx.race.raceName;
  switch (kind) {
    case "draft_open":
      return {
        title: "The draft is open",
        body: `${name}: the order is set${ctx.firstPickName ? ` and ${ctx.firstPickName} picks first` : ""}.`,
      };
    case "on_the_clock":
      return { title: "You're on the clock", body: `You're up: pick ${slot} of ${ctx.totalSlots} — ${name}.` };
    case "pick_reminder":
      return { title: "Still your pick", body: `Pick ${slot} of ${ctx.totalSlots} for ${name} is waiting on you.` };
    case "deadline_warning": {
      const left = ctx.totalSlots - ctx.picksMade;
      const who = ctx.onTheClockName ? `, ${ctx.onTheClockName} on the clock` : "";
      return {
        title: "Draft closes soon",
        body: `${name}: ${left} pick${left === 1 ? "" : "s"} left${who}. Picks close at the race start.`,
      };
    }
    case "draft_complete":
      return { title: "The draft is done", body: `All ${ctx.totalSlots} picks are in for ${name}.` };
    case "draft_closed":
      return {
        title: "Picks are closed",
        body: `${name}: the draft closed with ${ctx.picksMade} of ${ctx.totalSlots} picks. Empty slots score as DNS.`,
      };
    case "results_posted":
      return { title: "Results are in", body: `${name} is final. See who won the week.` };
    case "complete_reminder":
      return { title: "Race needs completing", body: `${name} is still live. Complete it to post the week's results.` };
  }
}

/** Deep links: the reminder opens the race's Complete button; the results open the final standings. */
function urlFor(kind: NotificationKind, raceId: string): string {
  if (kind === "complete_reminder") return `/admin/races/${raceId}`;
  if (kind === "results_posted") return `/live/${raceId}`;
  return `/draft/${raceId}`;
}

function quietNow(now: Date): boolean {
  return isQuietHours(now, env.LEAGUE_TIMEZONE, env.QUIET_HOURS_START, env.QUIET_HOURS_END);
}

/**
 * Claim, then send (SPEC Section 14). The ledger row is written first; the conditional claim makes
 * delivery at-most-once even when the after-commit dispatch and the sweeper see the same row.
 */
async function deliver(
  channel: NotificationChannel,
  ctx: RaceContext,
  kind: NotificationKind,
  slot: number,
  userId: string | null,
  now: Date,
): Promise<void> {
  if (userId) {
    const user = ctx.users.get(userId);
    // Per-user mute is respected on every channel.
    if (!user || !user.isActive || !user.notificationsEnabled) return;
  }
  const payload: NotificationPayload = {
    raceId: ctx.race.id,
    userId,
    kind,
    overallPickNumber: slot,
    url: urlFor(kind, ctx.race.id),
    ...compose(kind, ctx, slot),
  };
  if (!(await channel.canReach(payload))) return;

  const key = { raceId: ctx.race.id, userId: userId ?? "BROADCAST", channel: channel.key, kind, overallPickNumber: slot };
  await prisma.notificationLog.createMany({ data: [key], skipDuplicates: true });

  // Held rows stay unsent; the sweeper delivers them when quiet hours end.
  if (HELD_KINDS.includes(kind) && quietNow(now)) return;

  const claimed = await prisma.$executeRaw`
    UPDATE "NotificationLog" SET "claimedAt" = now(), "updatedAt" = now()
    WHERE "raceId" = ${key.raceId} AND "userId" = ${key.userId} AND "channel" = ${key.channel}
      AND "kind" = ${key.kind} AND "overallPickNumber" = ${key.overallPickNumber}
      AND "succeeded" = false AND "attempts" < 5
      AND ("claimedAt" IS NULL OR "claimedAt" < now() - interval '2 minutes')`;
  if (claimed === 0) return;

  let error: string | null = null;
  try {
    await channel.send(payload);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // At most five times per row (the attempts limit), so a dead phone can't flood the error tracker.
    reportError(`Notification ${kind} via ${channel.key} to ${userId ?? "the league"} failed:`, err);
  }
  // updateMany: a revert may have cleared this row while the send was in flight.
  await prisma.notificationLog.updateMany({
    where: key,
    data: { succeeded: error === null, attempts: { increment: 1 }, error, claimedAt: null },
  });
}

/** Sends one notification on every channel. Never throws: a failed push must not break the caller. */
export async function notify(notice: Notice, now = new Date()): Promise<void> {
  try {
    const ctx = await loadContext(notice.raceId);
    if (!ctx) return;
    const all = [...ctx.users.values()];
    for (const channel of channels) {
      let targets: (string | null)[];
      if (notice.to === "league") {
        targets = channel.broadcastAsOne ? [null] : all.map((u) => u.id);
      } else if (notice.to === "commissioners") {
        targets = all.filter((u) => u.role === "COMMISSIONER").map((u) => u.id);
      } else {
        targets = [notice.to.userId];
      }
      for (const userId of targets) {
        try {
          await deliver(channel, ctx, notice.kind, notice.overallPickNumber, userId, now);
        } catch (err) {
          reportError(`Notification ${notice.kind} via ${channel.key} failed:`, err);
        }
      }
    }
  } catch (err) {
    reportError(`Notification ${notice.kind} failed:`, err);
  }
}

/** Re-attempts one ledger row on its own channel and recipient (sweeper step 6). */
export async function retryRow(row: NotificationLog, now = new Date()): Promise<void> {
  const channel = channels.find((c) => c.key === row.channel);
  const ctx = channel && (await loadContext(row.raceId));
  if (!channel || !ctx) return;
  const userId = row.userId === "BROADCAST" ? null : row.userId;
  await deliver(channel, ctx, row.kind as NotificationKind, row.overallPickNumber, userId, now).catch((err) =>
    reportError(`Retry of ${row.kind} via ${row.channel} failed:`, err),
  );
}

const pending = new Set<Promise<void>>();

/** Fire after the transaction commits, never inside it. Sent in order, so draft_open lands before on_the_clock. */
export function dispatchAfterCommit(notices: Notice[]): void {
  if (notices.length === 0) return;
  const run: Promise<void> = (async () => {
    for (const notice of notices) await notify(notice);
  })().finally(() => pending.delete(run));
  pending.add(run);
}

/** Waits for in-flight after-commit dispatches (tests, and graceful shutdown). */
export async function settleNotifications(): Promise<void> {
  await Promise.all([...pending]);
}
