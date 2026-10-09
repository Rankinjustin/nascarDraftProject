import { CalendarRange, Flag, History, House, ListOrdered, RefreshCw, Settings, Shield, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { APP_NAME } from "../appName";
import { useMe } from "../auth";
import { applyUpdate, syncPushSubscription, useUpdateAvailable } from "../pwa";

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/draft", label: "Draft", icon: ListOrdered },
  { to: "/live", label: "Live", icon: Flag },
  { to: "/season", label: "Season", icon: CalendarRange },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-3 rounded-lg px-3 ${
    isActive ? "bg-slate-800 text-slate-50" : "text-slate-400 hover:text-slate-50"
  }`;

/** Bottom tab bar on mobile, sidebar from md: up (SPEC Section 11). */
export function Layout() {
  const { data: me } = useMe();
  const updateAvailable = useUpdateAvailable();

  // A device subscribed under someone else's login moves to whoever is logged in now (upsert on endpoint).
  useEffect(() => {
    if (me) void syncPushSubscription().catch(() => undefined);
  }, [me?.id]);

  const extra: Tab[] = [
    { to: "/history", label: "Past weeks", icon: History },
    { to: "/settings", label: "Settings", icon: Settings },
    ...(me?.role === "COMMISSIONER" ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];

  return (
    <div className="flex min-h-screen pt-[env(safe-area-inset-top)]">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-800 p-4 md:flex">
        <img src="/logo.svg" alt={APP_NAME} className="mb-2 w-full" />
        <div className="racing-stripe mb-4 rounded-full" />
        {[...TABS, ...extra].map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={linkClass}>
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 py-2 md:hidden">
          <img src="/logo.svg" alt={APP_NAME} className="h-8 min-w-0" />
          <div className="flex gap-1">
            {extra.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                aria-label={t.label}
                className={({ isActive }) =>
                  `flex h-11 w-11 items-center justify-center rounded-lg ${isActive ? "text-sky-400" : "text-slate-400"}`
                }
              >
                <t.icon size={20} />
              </NavLink>
            ))}
          </div>
        </header>
        <div className="racing-stripe md:hidden" />

        {updateAvailable && (
          // Never reloads on its own: someone may be mid-pick.
          <button
            type="button"
            onClick={applyUpdate}
            className="flex min-h-11 items-center justify-center gap-2 bg-sky-700 px-4 text-sm font-semibold text-white"
          >
            <RefreshCw size={16} />
            New version available — tap to reload
          </button>
        )}

        <main className="flex-1 px-4 pb-24 pt-4 md:pb-8">
          <Outlet />
        </main>

        <nav className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)] md:hidden">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                  isActive ? "text-sky-400" : "text-slate-500"
                }`
              }
            >
              <t.icon size={22} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
