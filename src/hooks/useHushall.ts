import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../features/auth/auth-context.ts'
import {
  aterkallaInbjudan,
  hamtaHushall,
  hamtaHushallsallergier,
  hamtaInbjudningar,
  hamtaMedlemmar,
  lamnaHushall,
  losInInbjudan,
  portionerFor,
  skapaHushall,
  skapaInbjudan,
  sparaHushall,
} from '../services/hushall.ts'
import type { HouseholdRow } from '../types/database.ts'
import { somHouseholdId, type HouseholdId } from '../types/ids.ts'

/**
 * Hushållet den inloggade tillhör.
 *
 * `saknarHushall` är sant för en användare som ännu inte skapat eller gått med
 * i något. Det inträffar för nya konton och för den som lämnat sitt hushåll,
 * och är ett läge appen måste hantera i stället för att anta bort.
 */
export function useHushall() {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: ['hushall', user?.id],
    queryFn: hamtaHushall,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  })

  const hushall = query.data ?? null

  return {
    ...query,
    hushall,
    // Märkt typ: gör det till ett kompileringsfel att skicka `user.id` hit.
    hushallId: hushall ? somHouseholdId(hushall.id) : null,
    portioner: portionerFor(hushall),
    butik: hushall?.store_number ?? null,
    saknarHushall: !query.isLoading && hushall === null,
    saknarButik: hushall !== null && hushall.store_number === null,
  }
}

export function useSparaHushall() {
  const { user } = useAuth()
  const klient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, andringar }: { id: HouseholdId; andringar: Partial<HouseholdRow> }) =>
      sparaHushall(id, andringar),
    onSuccess: (hushall) => {
      klient.setQueryData(['hushall', user?.id], hushall)
      // Inköpslistan beror på butik, budget och portioner.
      void klient.invalidateQueries({ queryKey: ['aktivlista'] })
    },
  })
}

export function useMedlemmar() {
  const { hushallId } = useHushall()
  return useQuery({
    queryKey: ['medlemmar', hushallId],
    queryFn: hamtaMedlemmar,
    enabled: Boolean(hushallId),
  })
}

/**
 * Hushållets samlade allergier.
 *
 * Används av veckoplaneraren. En rätt som är olämplig för en medlem är
 * olämplig för måltiden, så det är unionen som gäller, inte den inloggades
 * egna allergier.
 */
export function useHushallsallergier() {
  const { hushallId } = useHushall()
  return useQuery({
    queryKey: ['hushallsallergier', hushallId],
    queryFn: hamtaHushallsallergier,
    enabled: Boolean(hushallId),
    staleTime: 60_000,
  })
}

export function useInbjudningar() {
  const { hushallId } = useHushall()
  const klient = useQueryClient()

  const query = useQuery({
    queryKey: ['inbjudningar', hushallId],
    queryFn: hamtaInbjudningar,
    enabled: Boolean(hushallId),
  })

  const uppdatera = () => klient.invalidateQueries({ queryKey: ['inbjudningar', hushallId] })

  return {
    ...query,
    skapa: useMutation({
      mutationFn: ({ id, userId }: { id: HouseholdId; userId: string }) => skapaInbjudan(id, userId),
      onSuccess: uppdatera,
    }),
    aterkalla: useMutation({ mutationFn: aterkallaInbjudan, onSuccess: uppdatera }),
  }
}

/** Skapa, gå med, lämna. Alla nollställer cachen, eftersom allt byts ut. */
export function useHushallsmedlemskap() {
  const { user } = useAuth()
  const klient = useQueryClient()
  const nollstall = () => klient.invalidateQueries()

  return {
    skapa: useMutation({ mutationFn: skapaHushall, onSuccess: nollstall }),
    gaMed: useMutation({ mutationFn: losInInbjudan, onSuccess: nollstall }),
    lamna: useMutation({ mutationFn: () => lamnaHushall(user!.id), onSuccess: nollstall }),
  }
}
