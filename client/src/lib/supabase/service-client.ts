/**
 * lib/supabase/service-client.ts
 *
 * Creates a Supabase client using the service role key.
 * Use this ONLY in server-side tool execution where:
 * - There is no active HTTP request context (so Clerk auth() returns nothing)
 * - The operation is trusted server-side logic
 *
 * Never expose this client or the service role key to the browser.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Singleton — one client reused across tool calls in the same process
let _serviceClient: ReturnType<typeof createSupabaseClient> | null = null;

export function getServiceClient() {
  if (!_serviceClient) {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      );
    }
    _serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _serviceClient;
}
