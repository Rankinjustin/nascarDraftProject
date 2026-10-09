/** A failed request or mutation's message; renders nothing without an error. */
export function ErrorText({ error }: { error: Error | null | undefined }) {
  return error ? <p className="text-sm text-red-400">{error.message}</p> : null;
}

/** "Loading…" while a query is pending, its error once it fails, nothing otherwise. */
export function QueryState({ query }: { query: { isPending: boolean; error: Error | null } }) {
  if (query.isPending) return <p className="text-slate-400">Loading…</p>;
  return <ErrorText error={query.error} />;
}
