/**
 * Leave the current page with a full page load instead of a client-side transition.
 *
 * Used when the session changes (signing in or out, switching company): a full load discards everything the
 * browser had cached in memory, so data from one session or company can never be shown inside another.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
