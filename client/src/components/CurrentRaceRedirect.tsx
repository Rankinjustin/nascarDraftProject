import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { api } from "../api";

/** /draft and /live with no race id open the race in focus. */
export function CurrentRaceRedirect({ basePath }: { basePath: string }) {
  const current = useQuery({ queryKey: ["race", "current"], queryFn: api.currentRace });
  if (current.isPending) return <p className="text-slate-400">Loading…</p>;
  if (current.isError) return <p className="text-red-400">{current.error.message}</p>;
  if (!current.data) return <p className="text-slate-400">No race on the schedule.</p>;
  return <Navigate to={`${basePath}/${current.data.id}`} replace />;
}
