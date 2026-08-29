import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { supabase } from '../../lib/supabase.ts'
import { AuthContext, type AuthContextValue } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [laddar, setLaddar] = useState(true)

  useEffect(() => {
    let avbruten = false

    // Läs befintlig session först, så att en omladdning inte blinkar förbi
    // inloggningssidan för någon som redan är inloggad.
    supabase.auth.getSession().then(({ data }) => {
      if (avbruten) return
      setSession(data.session)
      setLaddar(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLaddar(false)
    })

    return () => {
      avbruten = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      laddar,
      loggaUt: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, laddar],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
