import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useHushall } from './useHushall.ts'
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
  const { hushallId } = useHushall()
  return useQuery({
    queryKey: ['veckoplan', hushallId, weekStart],
    queryFn: () => hamtaVeckoplan(hushallId!, weekStart),
    enabled: Boolean(hushallId),
  })
}

export function useSparaVecka(weekStart: string) {
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (meals: PlannedMeal[]) =>
      sparaVeckoplan(hushallId!, weekStart, meals, (recipe: Recipe) => recipe.id),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', hushallId, weekStart] })
    },
  })
}

export function useSattMaltid(weekStart: string) {
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (args: { servedOn: string; recipeId: string | null; servings: number }) =>
      sattMaltid(hushallId!, weekStart, args.servedOn, args.recipeId, args.servings),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', hushallId, weekStart] })
    },
  })
}

export function useKopieraVecka() {
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: (args: { fran: string; till: string }) =>
      kopieraVecka(hushallId!, args.fran, args.till),
    onSuccess: () => {
      void klient.invalidateQueries({ queryKey: ['veckoplan', hushallId] })
    },
  })
}
