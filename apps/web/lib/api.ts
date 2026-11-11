// Browser-side API client. All calls go through the same-origin BFF at /api/tms/*.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { field: string; message: string }[] | null = null,
  ) {
    super(message);
  }
  /** Field-level messages keyed by field name (from 422 validation responses). */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details) out[d.field] = d.message;
    return out;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      // Full reload on auth change: guarantees no cached data from a previous session survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/login");
    }
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details ?? null);
  }
  return data as T;
}

type Options = { idempotencyKey?: string };

function request<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  return fetch(`/api/tms${path}`, { method, headers, body: payload, credentials: "same-origin" }).then((r) => parse<T>(r));
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, opts?: Options) => request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

export async function session<T>(action: "login" | "signup" | "logout" | "password", body?: unknown): Promise<T> {
  const res = await fetch(`/api/session/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return parse<T>(res);
}

/** New key per user action; reuse it for retries of that same action. */
export const newKey = () => crypto.randomUUID();

export type Page<T> = { items: T[]; next_cursor: string | null };
