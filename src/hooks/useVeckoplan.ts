import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import type { PlannedMeal } from '../domain/aggregate.ts'
import type { Recipe } from '../domain/types.ts'
import {
  hamtaVeckoplan,
  kopieraVecka,
  sattMaltid,
  sparaVeckoplan,
  veckostart,
} from '../services/mealPlans.ts'

export function useVeckoplan(weekStart: string = veckostart()) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['veckoplan', user?.id, weekStart],
    queryFn: () => hamtaVeckoplan(user!.id, weekStart),
    enabled: Boolean(user?.id),
  })
}

export function useSparaVecka(weekStart: string) {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (meals: PlannedMeal[]) =>
      sparaVeckoplan(user!.id, weekStart, meals, (recipe: Recipe) => recipe.id),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', user?.id, weekStart] })
    },
  })
}

export function useSattMaltid(weekStart: string) {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (args: { servedOn: string; recipeId: string | null; servings: number }) =>
      sattMaltid(user!.id, weekStart, args.servedOn, args.recipeId, args.servings),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', user?.id, weekStart] })
    },
  })
}

export function useKopieraVecka() {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (args: { fran: string; till: string }) =>
      kopieraVecka(user!.id, args.fran, args.till),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', user?.id] })
    },
  })
}
