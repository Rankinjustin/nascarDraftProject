import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useMe, useSetMe } from "../auth";

export function SettingsPage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setNotifications(enabled),
    onSuccess: setMe,
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      setMe(null);
      navigate("/login", { replace: true });
    },
  });

  if (!me) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="card flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold">Notifications</div>
          <div className="text-sm text-slate-400">Turn alerts and reminders. Push setup arrives in Phase 4.</div>
        </div>
        <button
          type="button"
          className={me.notificationsEnabled ? "btn-primary" : "btn-secondary"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!me.notificationsEnabled)}
        >
          {me.notificationsEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="card">
        <div className="text-sm text-slate-400">Logged in as</div>
        <div className="font-semibold">{me.displayName}</div>
        <div className="text-sm text-slate-400">{me.phoneNumber}</div>
        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>
    </div>
  );
}
