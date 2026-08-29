import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import { hamtaButiker, hamtaProfil, sparaProfil } from '../services/profile.ts'
import type { ProfileRow } from '../types/database.ts'

/**
 * Den inloggades egen profil.
 *
 * Hushållets inställningar ligger i useHushall. Här finns bara identitet,
 * allergier och smak.
 */
export function useProfil() {
  const { user } = useAuth()
  const userId = user?.id

  const query = useQuery({
    queryKey: ['profil', userId],
    queryFn: () => hamtaProfil(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  })

  return { ...query, profil: query.data ?? null, userId }
}

export function useSparaProfil() {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (andringar: Partial<ProfileRow>) => sparaProfil(user!.id, andringar),
    onSuccess: (profil) => {
      klient.setQueryData(['profil', user?.id], profil)
      // Allergier påverkar både matsedeln och inköpslistan för hela hushållet.
      void klient.invalidateQueries({ queryKey: ['hushallsallergier'] })
      void klient.invalidateQueries({ queryKey: ['medlemmar'] })
    },
  })
}

export function useButiker() {
  return useQuery({
    queryKey: ['butiker'],
    queryFn: hamtaButiker,
    staleTime: 24 * 60 * 60 * 1000,
  })
}
