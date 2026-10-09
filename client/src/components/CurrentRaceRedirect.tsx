import { Navigate } from "react-router";
import { useCurrentRace } from "../queries";
import { QueryState } from "./QueryState";

/** /draft and /live with no race id open the race in focus. */
export function CurrentRaceRedirect({ basePath }: { basePath: string }) {
  const current = useCurrentRace();
  if (!current.isSuccess) return <QueryState query={current} />;
  if (!current.data) return <p className="text-slate-400">No race on the schedule.</p>;
  return <Navigate to={`${basePath}/${current.data.id}`} replace />;
}
