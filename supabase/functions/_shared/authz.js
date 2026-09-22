import { getServiceClient } from "./supabase.js";

/**
 * Verifies the caller's Supabase access token (from the Authorization:
 * Bearer header the client attaches — see src/authz.js's getAccessToken())
 * and looks up their profile role, using the service role key so this
 * works regardless of RLS.
 *
 * Every Edge Function that does anything role-gated calls this itself and
 * checks the result — a page hiding a button client-side is not security,
 * this is. Returns { user, profile } on success, or an object with `error`
 * set (and `status`) when the caller isn't authenticated or lacks the role.
 *
 * Usage:
 *   const auth = await requireRole(req, ["admin"]);
 *   if (auth.error) return errorResponse(auth.error, auth.message, auth.status);
 */
export async function requireRole(req, allowedRoles) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: "unauthorized", message: "Missing bearer token", status: 401 };
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return { error: "supabase_not_configured", message: "Server misconfigured", status: 500 };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { error: "unauthorized", message: "Invalid or expired session", status: 401 };
  }
  const user = userData.user;

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { error: "no_profile", message: "No profile row for this user", status: 403 };
  }
  if (profile.active === false) {
    return { error: "account_disabled", message: "This account is disabled", status: 403 };
  }
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return { error: "forbidden", message: "Not allowed for this role", status: 403 };
  }

  return { user, profile, supabase };
}