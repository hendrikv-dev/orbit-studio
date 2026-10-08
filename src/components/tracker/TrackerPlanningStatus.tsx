export function TrackerPlanningStatus({
  status,
  completed,
  total,
  message,
  onRetry,
}: {
  status: "loading" | "error";
  completed: number;
  total: number;
  message?: string;
  onRetry?: () => void;
}) {
  if (status === "error") {
    return (
      <div className="tk-planning-status" role="alert">
        <p>That plan could not be calculated. {message}</p>
        {onRetry ? (
          <button type="button" className="tracker-secondary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tk-planning-status" role="status" aria-live="polite">
      <progress value={completed} max={Math.max(1, total)} aria-label="Planning nights" />
      <p>
        Planning the sky… {completed > 0 ? `${completed} of ${total} nights` : "starting"}
      </p>
    </div>
  );
}
