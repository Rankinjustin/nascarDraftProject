import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share, SquarePlus } from "lucide-react";
import { api } from "../api";
import { APP_NAME } from "../appName";
import { currentPushSubscription, disablePush, enablePush, isIos, isStandalone, pushConfigured, pushSupported } from "../pwa";

const subscriptionKey = ["push-subscription"] as const;

/** iPhones only get push from the installed Home Screen app, and it keeps its own login (SPEC Sections 5 and 14). */
export function InstallSteps() {
  return (
    <ol className="flex flex-col gap-3 text-sm">
      <li className="flex gap-3">
        <span className="font-bold text-sky-300">1</span>
        <span>
          In Safari, tap <Share size={16} className="inline align-text-bottom" /> <strong>Share</strong>.
        </span>
      </li>
      <li className="flex gap-3">
        <span className="font-bold text-sky-300">2</span>
        <span>
          Tap <SquarePlus size={16} className="inline align-text-bottom" /> <strong>Add to Home Screen</strong>, then{" "}
          <strong>Add</strong>.
        </span>
      </li>
      <li className="flex gap-3">
        <span className="font-bold text-sky-300">3</span>
        <span>
          Open <strong>{APP_NAME}</strong> from your Home Screen and <strong>log in there</strong> — the installed
          app doesn't share Safari's login.
        </span>
      </li>
      <li className="flex gap-3">
        <span className="font-bold text-sky-300">4</span>
        <span>In the app, go to Settings and turn on notifications for this device.</span>
      </li>
    </ol>
  );
}

/** Per-device push setup, test, and turn-off. The account-wide mute lives beside it on the Settings page. */
export function PushSetup() {
  const queryClient = useQueryClient();
  const subscription = useQuery({ queryKey: subscriptionKey, queryFn: currentPushSubscription });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: subscriptionKey });

  const enable = useMutation({ mutationFn: enablePush, onSettled: refresh });
  const disable = useMutation({ mutationFn: disablePush, onSettled: refresh });
  const test = useMutation({ mutationFn: api.testPush });

  if (isIos() && !isStandalone()) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-amber-200">
          On iPhone, notifications only work from the app on your Home Screen.
        </p>
        <InstallSteps />
      </div>
    );
  }
  if (!pushSupported()) return <p className="text-sm text-slate-400">This browser can't receive push notifications.</p>;
  if (!pushConfigured) return <p className="text-sm text-slate-400">Push isn't set up for this build of the app yet.</p>;
  if (Notification.permission === "denied") {
    return (
      <p className="text-sm text-amber-200">
        Notifications are blocked for this app. Allow them in your device or browser settings, then come back here.
      </p>
    );
  }

  const error = enable.error ?? disable.error ?? test.error;
  return (
    <div className="flex flex-col gap-2">
      {subscription.data ? (
        <>
          <p className="text-sm text-green-300">This device gets notifications.</p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? "Sending…" : "Send a test"}
            </button>
            <button type="button" className="btn-secondary" disabled={disable.isPending} onClick={() => disable.mutate()}>
              Turn off here
            </button>
          </div>
          {test.isSuccess && <p className="text-sm text-slate-400">Sent. It should land in a few seconds.</p>}
        </>
      ) : (
        <button type="button" className="btn-primary" disabled={enable.isPending} onClick={() => enable.mutate()}>
          {enable.isPending ? "Turning on…" : "Turn on notifications for this device"}
        </button>
      )}
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </div>
  );
}
