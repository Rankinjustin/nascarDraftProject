import type { PublicUser } from "@dnd/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NavLink, Outlet } from "react-router";
import { api } from "../api";
import { meKey, useMe } from "../auth";
import { PhoneInput } from "../components/PhoneInput";

const usersKey = ["users"] as const;

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 flex-1 items-center justify-center rounded-lg font-semibold ${
    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
  }`;

/** Commissioner tools: races and entries, league members. */
export function AdminPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Commissioner</h1>
      <nav className="flex gap-1 rounded-xl border border-slate-800 p-1">
        <NavLink to="/admin" end className={tabClass}>
          Races
        </NavLink>
        <NavLink to="/admin/members" className={tabClass}>
          Members
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

export function MembersTab() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: usersKey, queryFn: api.listUsers });
  // The most recent setup link, shown once so the commissioner can copy it into the group chat.
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersKey });
    void queryClient.invalidateQueries({ queryKey: meKey });
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">League members</h2>

      {link && <SetupLinkCard name={link.name} url={link.url} onDismiss={() => setLink(null)} />}

      <AddUserForm
        onCreated={(user, url) => {
          setLink({ name: user.displayName, url });
          refresh();
        }}
      />

      {users.isPending && <p className="text-slate-400">Loading…</p>}
      {users.isError && <p className="text-red-400">{users.error.message}</p>}
      <ul className="flex flex-col gap-2">
        {users.data?.map((u) => (
          <UserRow key={u.id} user={u} onChanged={refresh} onLink={(url) => setLink({ name: u.displayName, url })} />
        ))}
      </ul>
    </section>
  );
}

function SetupLinkCard({ name, url, onDismiss }: { name: string; url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="card border-sky-700">
      <div className="mb-2 font-semibold">Setup link for {name}</div>
      <p className="mb-3 text-sm text-slate-400">Single use, valid 7 days. Send it however the group talks.</p>
      <input readOnly className="input mb-3 font-mono text-xs" value={url} onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary gap-2" onClick={copy}>
          <Copy size={16} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: (user: PublicUser, setupLink: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const create = useMutation({
    mutationFn: () => api.createUser({ displayName, phoneNumber: phone }),
    onSuccess: ({ user, setupLink }) => {
      setDisplayName("");
      setPhone("");
      onCreated(user, setupLink);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <div className="font-semibold">Add a member</div>
      <input
        className="input"
        placeholder="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <PhoneInput value={phone} onChange={setPhone} />
      {create.isError && <p className="text-sm text-red-400">{create.error.message}</p>}
      <button type="submit" className="btn-primary" disabled={create.isPending || !displayName || !phone}>
        Add and get setup link
      </button>
    </form>
  );
}

function UserRow({
  user,
  onChanged,
  onLink,
}: {
  user: PublicUser;
  onChanged: () => void;
  onLink: (url: string) => void;
}) {
  const { data: me } = useMe();
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateUser>[1]) => api.updateUser(user.id, body),
    onSuccess: onChanged,
  });
  const reissue = useMutation({
    mutationFn: () => api.newSetupLink(user.id),
    onSuccess: ({ setupLink }) => onLink(setupLink),
  });
  const error = update.error ?? reissue.error;
  const isCommish = user.role === "COMMISSIONER";

  return (
    <li className={`card flex flex-col gap-3 ${user.isActive ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {user.displayName}
            {user.id === me?.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
          </div>
          <div className="text-sm text-slate-400">{user.phoneNumber}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1 text-xs">
          {isCommish && <span className="rounded bg-amber-900 px-2 py-0.5 text-amber-200">Commish</span>}
          {!user.hasPassword && <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">No password</span>}
          {!user.isActive && <span className="rounded bg-red-950 px-2 py-0.5 text-red-300">Inactive</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary gap-2 text-sm"
          disabled={!user.isActive || reissue.isPending}
          onClick={() => reissue.mutate()}
        >
          <Link2 size={16} />
          {user.hasPassword ? "Reset link" : "Setup link"}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ role: isCommish ? "MEMBER" : "COMMISSIONER" })}
        >
          {isCommish ? "Remove commish" : "Make commish"}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ isActive: !user.isActive })}
        >
          {user.isActive ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </li>
  );
}
