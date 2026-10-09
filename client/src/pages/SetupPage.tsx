import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { useSetMe } from "../auth";
import { ErrorText } from "../components/QueryState";

/** Landing page for the commissioner's single-use setup / password-reset link. */
export function SetupPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const setMe = useSetMe();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;

  const savePassword = useMutation({
    mutationFn: () => api.setPassword(token, password),
    onSuccess: (user) => {
      setMe(user);
      navigate("/", { replace: true });
    },
  });

  if (!token) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <p className="text-slate-300">This link is missing its token. Ask the commissioner for a new one.</p>
        <Link to="/login" className="btn-secondary mt-6">
          Go to login
        </Link>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) savePassword.mutate();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold">Set your password</h1>
      <p className="mb-6 text-slate-400">
        On an iPhone? After this, add the app to your Home Screen and log in there with your phone number and
        this password — the installed app keeps its own login, separate from Safari.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="new-password" className="label">
            New password (8+ characters)
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="label">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {mismatch && <p className="text-sm text-red-400">Passwords don't match.</p>}
        <ErrorText error={savePassword.error} />

        <button
          type="submit"
          className="btn-primary"
          disabled={savePassword.isPending || password.length < 8 || password !== confirm}
        >
          {savePassword.isPending ? "Saving…" : "Set password and log in"}
        </button>
      </form>
    </div>
  );
}
