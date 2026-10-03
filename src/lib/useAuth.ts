import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isBackendConfigured } from './supabase'

export interface AuthState {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
}

/** Supabase Auth session with persistence handled by the client library. */
export function useAuth(): AuthState & {
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
} {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isBackendConfigured)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setSession(data.session)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return {
    configured: isBackendConfigured,
    loading,
    session,
    user: session?.user ?? null,
    signInWithGoogle: async () => {
      const supabase = getSupabase()
      if (!supabase) throw new Error('Sign-in is not configured yet')
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    },
    signOut: async () => {
      const supabase = getSupabase()
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }
}
