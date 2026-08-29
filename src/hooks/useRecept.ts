import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import {
  hamtaFavoriter,
  hamtaLagningshistorik,
  hamtaRecept,
  markeraLagad,
  vaxlaFavorit,
} from '../services/recipes.ts'

export function useRecept() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['recept', user?.id],
    queryFn: () => hamtaRecept(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  })
}

export function useFavoritrecept() {
  const { user } = useAuth()
  const klient = useQueryClient()

  const query = useQuery({
    queryKey: ['favoritrecept', user?.id],
    queryFn: () => hamtaFavoriter(user!.id),
    enabled: Boolean(user?.id),
  })

  const vaxla = useMutation({
    mutationFn: ({ recipeId, favorit }: { recipeId: string; favorit: boolean }) =>
      vaxlaFavorit(user!.id, recipeId, favorit),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['favoritrecept', user?.id] }),
  })

  return { favoriter: query.data ?? new Set<string>(), vaxla }
}

export function useLagningshistorik() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['lagningshistorik', user?.id],
    queryFn: () => hamtaLagningshistorik(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  })
}

export function useMarkeraLagad() {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: ({ recipeId, servings }: { recipeId: string; servings: number }) =>
      markeraLagad(user!.id, recipeId, servings),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['lagningshistorik', user?.id] }),
  })
}
