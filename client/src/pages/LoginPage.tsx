import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { APP_NAME } from "../appName";
import { useMe, useSetMe } from "../auth";
import { PhoneInput } from "../components/PhoneInput";
import { InstallSteps } from "../components/PushSetup";
import { ErrorText } from "../components/QueryState";
import { isIos, isStandalone } from "../pwa";

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
      <h1 className="mb-3">
        <img src="/logo.svg" alt={APP_NAME} className="w-full" />
      </h1>
      <p className="mb-8 text-slate-400">Weekly NASCAR fantasy for the league.</p>

      {isIos() && !isStandalone() && (
        // Install first: the Home Screen app has its own cookie jar, so a Safari login doesn't carry over.
        <div className="card mb-6 flex flex-col gap-3 border-sky-800">
          <div className="font-semibold">On iPhone? Install the app first.</div>
          <p className="text-sm text-slate-400">
            Turn notifications only reach the Home Screen app, and it keeps its own login.
          </p>
          <InstallSteps />
        </div>
      )}

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

        <ErrorText error={login.error} />

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
