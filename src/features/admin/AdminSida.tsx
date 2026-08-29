import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { SaknarButik } from '../../components/SaknarButik.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { SelectField } from '../../components/ui/form.tsx'
import { INGREDIENTS, getIngredient } from '../../domain/ingredients.ts'
import { matchIngredient, searchTermsFor } from '../../domain/matching.ts'
import { useHushall } from '../../hooks/useHushall.ts'
import { useProfil } from '../../hooks/useProfil.ts'
import { supabase } from '../../lib/supabase.ts'
import { antalProdukter, senasteSynk, sokProdukter } from '../../services/catalog.ts'
import { formatKr } from '../../lib/utils.ts'

/**
 * Diagnostik och tillsyn.
 *
 * Ligger bakom `profiles.is_admin` och är inte länkad för andra användare. RLS
 * skyddar dessutom `sync_runs` på databasnivå - sidan döljs, men det är inte
 * döljandet som är skyddet.
 */
export function AdminSida() {
  const { profil, isLoading } = useProfil()
  const { butik } = useHushall()
  const klient = useQueryClient()
  const [sokterm, setSokterm] = useState('potatis')
  const [testIngrediens, setTestIngrediens] = useState('mjolk')
  const [synkbesked, setSynkbesked] = useState<string | null>(null)

  const korningar = useQuery({
    queryKey: ['synkkorningar', butik],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_runs')
        .select('*')
        .eq('store_number', butik!)
        .order('started_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(profil?.is_admin && butik),
  })

  const antal = useQuery({
    queryKey: ['antalprodukter', butik],
    queryFn: () => antalProdukter(butik!),
    enabled: Boolean(profil?.is_admin && butik),
  })

  const senast = useQuery({
    queryKey: ['senastesynk', butik],
    queryFn: () => senasteSynk(butik!),
    enabled: Boolean(profil?.is_admin && butik),
  })

  const traffar = useQuery({
    queryKey: ['admin-produktsok', butik, sokterm],
    queryFn: () => sokProdukter(sokterm, butik!, 20),
    enabled: Boolean(profil?.is_admin && butik) && sokterm.length >= 2,
  })

  const matchning = useQuery({
    queryKey: ['admin-matchning', butik, testIngrediens],
    queryFn: async () => {
      const ingredient = getIngredient(testIngrediens)
      if (!ingredient) return null
      const kandidater: Awaited<ReturnType<typeof sokProdukter>> = []
      for (const term of searchTermsFor(ingredient)) {
        kandidater.push(...(await sokProdukter(term, butik!, 25)))
      }
      const unika = [...new Map(kandidater.map((p) => [p.gtin, p])).values()]
      return { ingredient, resultat: matchIngredient(ingredient, unika), antal: unika.length }
    },
    enabled: Boolean(profil?.is_admin && butik),
  })

  const korSynk = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('citygross-sync', {
        body: { storeNumber: butik! },
      })
      if (error) throw error
      return data as { status?: string; productsUpserted?: number; failures?: string[] }
    },
    onSuccess: (data) => {
      setSynkbesked(
        `Inhämtningen är klar: ${data.productsUpserted ?? 0} varor uppdaterade` +
          (data.failures?.length ? `, ${data.failures.length} kategorier misslyckades.` : '.'),
      )
      void klient.invalidateQueries({ queryKey: ['synkkorningar'] })
      void klient.invalidateQueries({ queryKey: ['antalprodukter'] })
      void klient.invalidateQueries({ queryKey: ['senastesynk'] })
    },
    onError: (error: unknown) =>
      setSynkbesked(
        `Inhämtningen misslyckades: ${error instanceof Error ? error.message : 'okänt fel'}`,
      ),
  })

  if (isLoading) return <SidLaddning />
  if (!profil?.is_admin) return <Navigate to="/" replace />

  if (!butik) {
    return (
      <>
        <SidHuvud rubrik="Diagnostik och tillsyn" />
        <SaknarButik vad="Sortimentsuppgifter" />
      </>
    )
  }

  return (
    <>
      <SidHuvud
        rubrik="Diagnostik och tillsyn"
        underrubrik="Intern sida. Uppgifterna avser sortimentsinhämtningen."
      />

      <Card className="mb-4">
        <CardBody className="pt-4">
          <h2 className="mb-3 font-semibold">Sortimentsinhämtning</h2>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Uppgift etikett="Butik" varde={butik} />
            <Uppgift etikett="Varor i katalogen" varde={String(antal.data ?? '-')} />
            <Uppgift
              etikett="Senast hämtat"
              varde={
                senast.data
                  ? format(parseISO(senast.data), 'd MMM HH:mm', { locale: sv })
                  : 'aldrig'
              }
            />
            <Uppgift
              etikett="Senaste körning"
              varde={korningar.data?.[0]?.status ?? '-'}
            />
          </dl>

          <Button
            className="mt-4"
            disabled={korSynk.isPending}
            onClick={() => {
              setSynkbesked(null)
              korSynk.mutate()
            }}
          >
            {korSynk.isPending ? 'Inhämtning av sortimentsuppgifter pågår…' : 'Kör inhämtning nu'}
          </Button>

          {korSynk.isPending ? (
            <p className="mt-2 text-xs text-[var(--text-dampad)]">
              Körningen tar flera minuter. Den hämtar en kategori i taget med en sekunds paus
              mellan anropen.
            </p>
          ) : null}

          {synkbesked ? (
            <Notis ton={synkbesked.startsWith('Inhämtningen är klar') ? 'positiv' : 'fel'} className="mt-3">
              {synkbesked}
            </Notis>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <h2 className="border-b border-[var(--kant)] px-4 py-2.5 font-semibold">Körningar</h2>
        {korningar.data && korningar.data.length > 0 ? (
          <ul>
            {korningar.data.map((rad) => (
              <li
                key={rad.id}
                className="flex flex-wrap items-center gap-3 border-t border-[var(--kant)] px-4 py-3 text-sm first:border-t-0"
              >
                <span className="tabular-nums text-[var(--text-dampad)]">
                  {format(parseISO(rad.started_at), 'd MMM HH:mm', { locale: sv })}
                </span>
                <StatusMarke status={rad.status} />
                <span>{rad.products_upserted} varor</span>
                <span className="text-[var(--text-dampad)]">
                  {rad.categories_processed} kategorier
                </span>
                {rad.error_message ? (
                  <span className="w-full text-xs text-[var(--color-lingon)]">
                    {rad.error_message.split('\n').slice(0, 2).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-[var(--text-dampad)]">
            Inga körningar är registrerade.
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <CardBody className="pt-4">
          <h2 className="mb-3 font-semibold">Söktestare</h2>
          <input
            value={sokterm}
            onChange={(event) => setSokterm(event.target.value)}
            aria-label="Sökterm"
            className="min-h-11 w-full rounded-lg border border-[var(--kant)] bg-[var(--yta)] px-3 text-sm"
          />
          <ul className="mt-3 divide-y divide-[var(--kant)] text-sm">
            {(traffar.data ?? []).map((produkt) => (
              <li key={produkt.gtin} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="font-medium">{produkt.name}</span>
                <span className="text-[var(--text-dampad)]">{produkt.descriptiveSize}</span>
                <span className="text-[var(--text-dampad)]">
                  {produkt.netContent
                    ? `${produkt.netContent.value} ${produkt.netContent.unit}`
                    : 'storlek otolkad'}
                </span>
                <span className="text-[var(--text-dampad)]">{produkt.sellingUnit}</span>
                <span className="tabular-nums">{formatKr(produkt.price)}</span>
                <span className="w-full text-xs text-[var(--text-dampad)]">
                  {produkt.categoryPath.join(' › ')} · {produkt.gtin}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="pt-4">
          <h2 className="mb-3 font-semibold">Matchningstestare</h2>
          <SelectField
            label="Ingrediens"
            value={testIngrediens}
            onChange={(event) => setTestIngrediens(event.target.value)}
          >
            {Object.values(INGREDIENTS)
              .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </SelectField>

          {matchning.data ? (
            <>
              <p className="mt-3 text-sm">
                <strong>{matchning.data.resultat.confidence}</strong> - {matchning.data.antal}{' '}
                kandidater slogs upp, {matchning.data.resultat.candidates.length} klarade tröskeln.
              </p>
              {matchning.data.resultat.note ? (
                <p className="text-sm text-[var(--text-dampad)]">{matchning.data.resultat.note}</p>
              ) : null}

              <ol className="mt-3 divide-y divide-[var(--kant)] text-sm">
                {matchning.data.resultat.candidates.slice(0, 10).map((kandidat) => (
                  <li key={kandidat.product.gtin} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-medium tabular-nums">{kandidat.score}</span>
                      <span>{kandidat.product.name}</span>
                      <span className="text-[var(--text-dampad)]">
                        {kandidat.product.descriptiveSize}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-dampad)]">
                      {kandidat.reasons.join(' · ') || 'inga särskilda skäl'}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </CardBody>
      </Card>
    </>
  )
}

function Uppgift({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-dampad)]">{etikett}</dt>
      <dd className="text-lg font-semibold">{varde}</dd>
    </div>
  )
}

function StatusMarke({ status }: { status: string }) {
  if (status === 'success') return <Badge ton="positiv">lyckades</Badge>
  if (status === 'failed') return <Badge ton="fel">misslyckades</Badge>
  return <Badge ton="varning">pågår</Badge>
}
