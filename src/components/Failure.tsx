import { describeFailure } from "../lib/errors";
import type { AppFailure } from "../backend/contract";

export function Failure({ failure }: { failure: AppFailure | null }) {
  if (!failure) return null;
  return (
    <p className="notice notice-danger" role="alert">
      {describeFailure(failure)}
    </p>
  );
}
