/**
 * Opt-in for viewing the app inside another site's frame: hosted preview panes, IDE browsers and similar.
 *
 * When on, the app may be framed by any site and the session cookie is issued so that it works in a
 * cross-site frame. That removes clickjacking protection, so it is for previews and demos only.
 * Never enable it in production.
 */
export const allowEmbedding = (): boolean => process.env.FLYFLEET_ALLOW_EMBEDDING === "true";
