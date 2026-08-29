import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import { useHushall } from './useHushall.ts'
import {
  hamtaFavoriter,
  hamtaLagningshistorik,
  hamtaRecept,
  markeraLagad,
  skapaRecept,
  sparaRecept,
  taBortRecept,
  vaxlaFavorit,
  type Receptutkast,
} from '../services/recipes.ts'

export function useRecept() {
  const { hushallId } = useHushall()
  return useQuery({
    queryKey: ['recept', hushallId],
    queryFn: () => hamtaRecept(hushallId!),
    enabled: Boolean(hushallId),
    staleTime: 5 * 60_000,
  })
}

export function useFavoritrecept() {
  const { user } = useAuth()
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  const query = useQuery({
    queryKey: ['favoritrecept', hushallId],
    queryFn: () => hamtaFavoriter(hushallId!),
    enabled: Boolean(hushallId),
  })

  const vaxla = useMutation({
    mutationFn: ({ recipeId, favorit }: { recipeId: string; favorit: boolean }) =>
      vaxlaFavorit(hushallId!, user!.id, recipeId, favorit),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['favoritrecept', hushallId] }),
  })

  return { favoriter: query.data ?? new Set<string>(), vaxla }
}

export function useLagningshistorik() {
  const { hushallId } = useHushall()
  return useQuery({
    queryKey: ['lagningshistorik', hushallId],
    queryFn: () => hamtaLagningshistorik(hushallId!),
    enabled: Boolean(hushallId),
    staleTime: 60_000,
  })
}

export function useMarkeraLagad() {
  const { user } = useAuth()
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: ({ recipeId, servings }: { recipeId: string; servings: number }) =>
      markeraLagad(hushallId!, user!.id, recipeId, servings),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['lagningshistorik', hushallId] }),
  })
}

/**
 * Skapa, ändra och radera recept.
 *
 * Allt nollställer både receptlistan och det enskilda receptet. Matsedeln
 * invalideras också: den visar receptnamn, och ett raderat recept lämnar en
 * tom dag efter sig.
 */
export function useReceptredigering() {
  const { user } = useAuth()
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  const uppdatera = () => {
    void klient.invalidateQueries({ queryKey: ['recept'] })
    void klient.invalidateQueries({ queryKey: ['recept-detalj'] })
    void klient.invalidateQueries({ queryKey: ['veckoplan'] })
  }

  return {
    skapa: useMutation({
      mutationFn: (utkast: Receptutkast) => skapaRecept(hushallId!, user!.id, utkast),
      onSuccess: uppdatera,
    }),
    spara: useMutation({
      mutationFn: ({ recipeId, utkast }: { recipeId: string; utkast: Receptutkast }) =>
        sparaRecept(recipeId, utkast),
      onSuccess: uppdatera,
    }),
    taBort: useMutation({ mutationFn: taBortRecept, onSuccess: uppdatera }),
  }
}
