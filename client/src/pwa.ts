/**
 * Browser-only PWA plumbing: service worker registration, the update banner's state, and web push.
 * Kept in one place so a future native wrapper (SPEC Section 15) only has to replace this file.
 */
import { useSyncExternalStore } from "react";
import { api } from "./api";

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY || undefined;

export function isIos(): boolean {
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY);

// --- Update banner ----------------------------------------------------------------------------

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  listeners.forEach((l) => l());
}

/** True when a new build is installed and waiting for the user to tap reload. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => waiting !== null,
  );
}

/** Activates the waiting worker; the controllerchange handler reloads the page. */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
  else window.location.reload();
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Only reload on a controller change when an old worker was in charge — not on the very first install.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
        });
      });
      // Installed apps stay open for days; look for a new build whenever the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
      });
    })
    .catch((err) => console.warn("Service worker registration failed:", err));
}

// --- Web push ---------------------------------------------------------------------------------

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function saveSubscription(subscription: PushSubscription): Promise<void> {
  const { p256dh, auth } = subscription.toJSON().keys ?? {};
  if (!p256dh || !auth) throw new Error("This browser returned an incomplete push subscription.");
  return api.subscribePush({ endpoint: subscription.endpoint, keys: { p256dh, auth } });
}

/** Re-sends this device's subscription, so a device subscribed under someone else's login moves to the current user. */
export async function syncPushSubscription(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (subscription) await saveSubscription(subscription);
}

/** Must run from a tap: browsers only show the permission prompt in response to a user gesture. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("This browser can't receive push notifications.");
  if (!VAPID_PUBLIC_KEY) throw new Error("Push isn't configured for this build of the app.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow them in your device settings, then try again.");

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }));
  await saveSubscription(subscription);
}

export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await api.unsubscribePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
