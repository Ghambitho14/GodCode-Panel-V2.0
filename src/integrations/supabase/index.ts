export { supabase, createEphemeralSupabaseClient } from "./client";
export { TABLES } from "./tables";
export {
  login,
  logout,
  bootstrapSession,
  getAccessToken,
  getCurrentUser,
  onAuthEvent,
  type SessionUser,
} from "./auth-session";
