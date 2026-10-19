// Stand-in for @supabase/supabase-js: hands back the current test's fake database.
export function createClient() {
  return globalThis.__fakeDb.client;
}
