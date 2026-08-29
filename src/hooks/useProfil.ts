import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import { butikFor, hamtaButiker, hamtaProfil, portionerFor, sparaProfil } from '../services/profile.ts'
import type { ProfileRow } from '../types/database.ts'

export function useProfil() {
  const { user } = useAuth()
  const userId = user?.id

  const query = useQuery({
    queryKey: ['profil', userId],
    queryFn: () => hamtaProfil(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  })

  return {
    ...query,
    profil: query.data ?? null,
    portioner: portionerFor(query.data ?? null),
    butik: butikFor(query.data ?? null),
    userId,
  }
}

export function useSparaProfil() {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (andringar: Partial<ProfileRow>) => sparaProfil(user!.id, andringar),
    onSuccess: (profil) => {
      klient.setQueryData(['profil', user?.id], profil)
      void klient.invalidateQueries({ queryKey: ['inkopslista'] })
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
