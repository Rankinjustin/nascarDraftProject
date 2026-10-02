import { useMe } from "../auth";

export function HomePage() {
  const { data: me } = useMe();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">Hey, {me?.displayName}</h1>
      <div className="card text-slate-300">
        The current race, your roster, and whose turn it is will show up here once the draft is built.
      </div>
    </div>
  );
}
