/** The confirm-or-cancel pair under a "are you sure?" prompt. */
export function ConfirmRow({
  label,
  pending,
  onConfirm,
  onCancel,
}: {
  label: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button type="button" className="btn-primary flex-1" disabled={pending} onClick={onConfirm}>
        {label}
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
