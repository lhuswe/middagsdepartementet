import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  /** Sant tills vi vet om det finns en session eller inte. */
  laddar: boolean
  loggaUt: () => Promise<void>
}

/**
 * Kontexten och dess hook bor i egen fil, skild från komponenten.
 * En modul som exporterar både komponenter och annat bryter fast refresh.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth måste användas inuti AuthProvider')
  return context
}
