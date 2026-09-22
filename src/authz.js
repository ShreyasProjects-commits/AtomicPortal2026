import { supabase } from "./supabase.js";

/**
 * Resolves the current session's user + profile row (first_name, last_name,
 * role, active), or {user: null, profile: null} if signed out. Every
 * role-aware page/script should call this (directly, or via requireRole())
 * rather than re-implementing the auth.getUser() + profiles lookup.
 */
export async function getCurrentUserAndProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, active")
    .eq("id", user.id)
    .single();

  return { user, profile: profile ?? null };
}

/**
 * Bearer token for calling role-gated Edge Functions (assign-worker,
 * worker-stats, admin order creation, etc). Those functions verify this
 * token server-side and look up the caller's role themselves — the token
 * alone proves identity, not permission, so every Edge Function still does
 * its own role check rather than trusting the caller's claimed role.
 */
export async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Page guard — call at the very top of a protected page's module script,
 * before rendering anything or firing any fetch:
 *
 *   const auth = await requireRole(["admin"]);
 *   if (!auth) return; // already redirected
 *
 * allowedRoles: array of role strings the page is open to, or null/undefined
 * to just require *some* signed-in user (any role).
 *
 * This only controls what the page *shows* — it is not a substitute for
 * server-side checks. Every Edge Function that does anything admin-only
 * (assign-worker, worker-stats, order creation, /optimize) re-checks the
 * caller's role itself using the service role key, because a page guard
 * can't stop someone from calling the API directly.
 */
export async function requireRole(allowedRoles) {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    location.href = `login.html?next=${next}`;
    return null;
  }

  if (allowedRoles && (!profile || !allowedRoles.includes(profile.role))) {
    // Signed in, but the wrong role for this page — send them to their own
    // home rather than showing a blank/broken page. index.html itself is
    // role-aware (via nav.js) so this always lands somewhere sensible.
    location.href = "index.html";
    return null;
  }

  return { user, profile };
}