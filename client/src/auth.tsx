import type { PublicUser } from "@dnd/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError } from "./api";
import { keys } from "./queries";

/** The logged-in user, or null when logged out. */
export function useMe() {
  return useQuery<PublicUser | null>({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetMe() {
  const queryClient = useQueryClient();
  return (user: PublicUser | null) => {
    queryClient.setQueryData(keys.me, user);
    if (!user) queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  };
}

export function RequireAuth({ children, commissioner = false }: { children: ReactNode; commissioner?: boolean }) {
  const { data: me, isPending, isError, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <div className="p-6 text-slate-400">Loading…</div>;
  // Only when there's no user to fall back on. A failed background refetch keeps the cached user, so a weak signal
  // at the track doesn't replace the page (and its stale-but-useful data) with this message.
  if (isError && me === undefined) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-red-400">Can't reach the server. Check your connection and try again.</p>
        <button type="button" className="btn-secondary" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (commissioner && me.role !== "COMMISSIONER") return <Navigate to="/" replace />;
  return <>{children}</>;
}
