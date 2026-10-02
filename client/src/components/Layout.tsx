import { CalendarRange, Flag, House, ListOrdered, Settings, Shield, type LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { useMe } from "../auth";

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
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
  }`;

/** Bottom tab bar on mobile, sidebar from md: up (SPEC Section 11). */
export function Layout() {
  const { data: me } = useMe();
  const extra: Tab[] = [
    { to: "/settings", label: "Settings", icon: Settings },
    ...(me?.role === "COMMISSIONER" ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-800 p-4 md:flex">
        <div className="mb-4 px-3 text-lg font-bold">Draft &amp; Draft</div>
        {[...TABS, ...extra].map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={linkClass}>
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 md:hidden">
          <span className="font-bold">Draft &amp; Draft</span>
          <div className="flex gap-1">
            {extra.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                aria-label={t.label}
                className={({ isActive }) =>
                  `flex h-11 w-11 items-center justify-center rounded-lg ${isActive ? "text-white" : "text-slate-400"}`
                }
              >
                <t.icon size={20} />
              </NavLink>
            ))}
          </div>
        </header>

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
                  isActive ? "text-white" : "text-slate-500"
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
