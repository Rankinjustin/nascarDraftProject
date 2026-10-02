import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { useMe, useSetMe } from "../auth";
import { PhoneInput } from "../components/PhoneInput";

export function LoginPage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.login(phone, password),
    onSuccess: (user) => {
      setMe(user);
      navigate(from, { replace: true });
    },
  });

  if (me) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-3xl font-bold">Draft &amp; Draft</h1>
      <p className="mb-8 text-slate-400">Weekly NASCAR fantasy for the league.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="phone" className="label">
            Phone number
          </label>
          <PhoneInput id="phone" value={phone} onChange={setPhone} autoFocus />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {login.isError && <p className="text-sm text-red-400">{login.error.message}</p>}

        <button type="submit" className="btn-primary" disabled={login.isPending || !phone || !password}>
          {login.isPending ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-8 text-sm text-slate-500">
        No password yet, or forgot it? Ask the commissioner for a setup link.
      </p>
    </div>
  );
}
