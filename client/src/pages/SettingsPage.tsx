import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useMe, useSetMe } from "../auth";
import { PushSetup } from "../components/PushSetup";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../theme";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Match phone" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(getThemeChoice);

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
          <div className="text-sm text-slate-400">
            Turn alerts and reminders, on every device and in Discord. League-wide announcements still post to Discord.
          </div>
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

      <div className="card flex flex-col gap-3">
        <div className="font-semibold">This device</div>
        <PushSetup />
        <div>
          <div className="label">Appearance</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-700 p-1" role="group" aria-label="Appearance">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={theme === t.value}
                className={`min-h-11 rounded-md text-sm font-semibold ${theme === t.value ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                onClick={() => {
                  setThemeChoice(t.value);
                  setTheme(t.value);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="text-sm text-slate-400">Logged in as</div>
        <div className="font-semibold">{me.displayName}</div>
        <div className="text-sm text-slate-400">{me.phoneNumber}</div>
        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>

      {/* The photo and map licenses ask for credit. */}
      <a href="/tracks/credits.txt" className="text-center text-xs text-slate-500 underline">
        Track photo and map credits
      </a>
    </div>
  );
}
