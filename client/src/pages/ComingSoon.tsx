export function ComingSoon({ title, phase }: { title: string; phase?: number }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      <div className="card text-slate-400">{phase ? `Coming in Phase ${phase}.` : "Nothing here."}</div>
    </div>
  );
}
