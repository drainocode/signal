/**
 * Supabase Client
 *
 * Uses the service role key for the intelligence engine —
 * the engine is a trusted backend service that needs full
 * read/write access without RLS restrictions.
 *
 * Never expose the service role key to the frontend.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl      = process.env.SUPABASE_URL
const supabaseKey      = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  },
})
