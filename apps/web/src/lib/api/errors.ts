import type { components } from "@/lib/api/schema";

type ErrorBody = components["schemas"]["ErrorBody"];

/** An error returned by the API, in the one shape it always uses. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(status: number, body: Partial<ErrorBody> | undefined) {
    super(body?.message || fallbackMessage(status));
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? "UNKNOWN";
    this.fieldErrors = body?.field_errors ?? {};
    this.details = body?.details ?? {};
    this.requestId = body?.request_id ?? null;
  }

  /** True when retrying after refreshing the data is the right response. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 403) return "Your role does not allow this.";
  if (status === 404) return "That record could not be found.";
  if (status >= 500) return "Something went wrong on our side. Try again in a moment.";
  return "The request could not be completed.";
}

/** Turn whatever a failed response carried into an ApiError. */
export function toApiError(status: number, payload: unknown): ApiError {
  const body = payload && typeof payload === "object" && "error" in payload ? (payload as { error: Partial<ErrorBody> }).error : undefined;
  return new ApiError(status, body);
}

/** A sentence for a toast or banner, whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Could not reach FlyFleet. Check your connection and try again.";
  return "Something went wrong. Try again.";
}
