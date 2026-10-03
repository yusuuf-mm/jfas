import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when the frontend has Supabase credentials and can use auth/orders. */
export const isBackendConfigured = Boolean(url && anonKey)

/** True in `vite build` output (e.g. Vercel). Demo fallbacks stay dev-only. */
export const isProduction = import.meta.env.PROD === true

let client: SupabaseClient | null = null

/** Browser Supabase client (anon key only — never put secrets in VITE_ vars). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}
