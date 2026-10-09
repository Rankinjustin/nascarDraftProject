import { useNavigate } from "react-router";
import { useSeasons } from "../queries";

/** Switches `${basePath}/:seasonId`, so the chosen season lives in the URL. Hidden until there's a second season. */
export function SeasonSelect({ basePath, seasonId }: { basePath: string; seasonId: string | undefined }) {
  const seasons = useSeasons();
  const navigate = useNavigate();
  if (!seasons.data || seasons.data.length < 2) return null;
  const value = seasonId ?? seasons.data.find((s) => s.isCurrent)?.id ?? "";
  return (
    <select className="input w-auto" value={value} onChange={(e) => navigate(`${basePath}/${e.target.value}`)}>
      {seasons.data.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
