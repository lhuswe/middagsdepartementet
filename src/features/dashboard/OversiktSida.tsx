import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { ArrowRight, Clock } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { LinkButton } from '../../components/ui/button.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { useHushall } from '../../hooks/useHushall.ts'
import { useProfil } from '../../hooks/useProfil.ts'
import { useRecept } from '../../hooks/useRecept.ts'
import { useVeckoplan } from '../../hooks/useVeckoplan.ts'
import { senasteSynk } from '../../services/catalog.ts'
import { VECKODAGAR, veckansDagar, veckostart } from '../../services/mealPlans.ts'
import { hamtaSkafferi, utgarSnart } from '../../services/pantry.ts'
import { senasteOppnaLista } from '../../services/shoppingLists.ts'
import { formatKrRound, formatMinutes } from '../../lib/utils.ts'

export function OversiktSida() {
  const { profil, isLoading: profilLaddar } = useProfil()
  const { butik, hushallId } = useHushall()
  const { data: recept } = useRecept()
  const weekStart = veckostart()
  const { data: plan, isLoading: planLaddar } = useVeckoplan(weekStart)

  const lista = useQuery({
    queryKey: ['oppenlista', hushallId],
    queryFn: () => senasteOppnaLista(hushallId!),
    enabled: Boolean(hushallId),
  })

  const skafferi = useQuery({
    queryKey: ['skafferi', hushallId],
    queryFn: () => hamtaSkafferi(hushallId!),
    enabled: Boolean(hushallId),
  })

  const synk = useQuery({
    queryKey: ['senastesynk', butik],
    queryFn: () => senasteSynk(butik!),
    enabled: Boolean(butik),
    staleTime: 10 * 60_000,
  })

  const receptPerId = useMemo(
    () => new Map((recept ?? []).map((item) => [item.id, item])),
    [recept],
  )

  if (profilLaddar || planLaddar) return <SidLaddning />

  const dagar = veckansDagar(weekStart)
  const idag = format(new Date(), 'yyyy-MM-dd')
  const middagar = (plan?.poster ?? []).filter((post) => post.meal_type === 'dinner')
  const utgar = utgarSnart(skafferi.data ?? [], 7)
  const kommande = dagar
    .map((dag, index) => {
      const datum = format(dag, 'yyyy-MM-dd')
      const post = middagar.find((item) => item.served_on === datum)
      const recipe = post?.recipe_id ? receptPerId.get(post.recipe_id) : undefined
      return { datum, dagnamn: VECKODAGAR[index]!, recipe, servings: post?.servings ?? 0 }
    })
    .filter((rad) => rad.datum >= idag)

  const forst = kommande.find((rad) => rad.recipe)

  return (
    <>
      <SidHuvud
        rubrik={halsning(profil?.display_name ?? null)}
        underrubrik={format(new Date(), "EEEE d MMMM", { locale: sv })}
      />

      {!butik ? (
        <Notis ton="varning" titel="Ingen butik är vald" className="mb-4">
          Priser och sortiment är butiksspecifika. Välj butik under{' '}
          <Link to="/installningar" className="underline">
            Inställningar
          </Link>{' '}
          för att kunna prissätta inköpslistan.
        </Notis>
      ) : null}

      {butik && synk.data === null && !synk.isLoading ? (
        <Notis ton="varning" titel="Sortimentet är inte inläst" className="mb-4">
          Produktkatalogen för butiken är tom, så inköpslistan kan inte prissättas. Kör en synk från{' '}
          <Link to="/admin" className="underline">
            Diagnostik och tillsyn
          </Link>
          .
        </Notis>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader
            title="Den här veckan"
            description={format(parseISO(weekStart), "'vecka' w", { locale: sv })}
            action={
              <LinkButton to="/vecka" variant="ghost" size="sm">
                Öppna <ArrowRight className="size-4" aria-hidden />
              </LinkButton>
            }
          />
          <CardBody className="pt-0">
            {kommande.every((rad) => !rad.recipe) ? (
              <TomtLage
                rubrik="Ingen matsedel är registrerad."
                beskrivning="Departementet inväntar underlag."
                action={<LinkButton to="/vecka">Generera matsedel</LinkButton>}
              />
            ) : (
              <ul className="divide-y divide-[var(--kant)]">
                {kommande.slice(0, 5).map((rad) => (
                  <li key={rad.datum} className="flex items-center gap-3 py-2.5">
                    <span className="w-20 shrink-0 text-sm text-[var(--text-dampad)]">
                      {rad.dagnamn}
                    </span>
                    {rad.recipe ? (
                      <>
                        <Link
                          to={`/recept/${rad.recipe.id}`}
                          className="min-w-0 flex-1 truncate font-medium"
                        >
                          {rad.recipe.name}
                        </Link>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-dampad)]">
                          <Clock className="size-3.5" aria-hidden />
                          {formatMinutes(rad.recipe.prepMinutes + rad.recipe.cookMinutes)}
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-sm text-[var(--text-dampad)]">
                        Ingen måltid planerad
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {forst ? (
          <Card>
            <CardHeader title="Ska lagas först" description={forst.dagnamn} />
            <CardBody className="pt-0">
              <Link to={`/recept/${forst.recipe!.id}`} className="block font-medium">
                {forst.recipe!.name}
              </Link>
              <p className="mt-1 text-sm text-[var(--text-dampad)]">
                {forst.recipe!.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{formatMinutes(forst.recipe!.prepMinutes + forst.recipe!.cookMinutes)}</Badge>
                <Badge>{forst.servings} portioner</Badge>
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Inköpslista"
            description={lista.data ? 'Öppen lista' : 'Ingen aktiv lista'}
          />
          <CardBody className="pt-0">
            {lista.data ? (
              <>
                <p className="text-2xl font-semibold">
                  {formatKrRound(Number(lista.data.estimated_total))}
                </p>
                <p className="text-sm text-[var(--text-dampad)]">
                  {lista.data.name}
                  {lista.data.items_without_price > 0
                    ? ` · ${lista.data.items_without_price} utan pris`
                    : ''}
                </p>
                <LinkButton to={`/inkopslista/${lista.data.id}`} full className="mt-3">
                  Öppna listan
                </LinkButton>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--text-dampad)]">
                  Ingen inköpslista är upprättad för veckan.
                </p>
                <LinkButton to="/inkopslista" full className="mt-3">
                  Skapa inköpslista
                </LinkButton>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Skafferiet"
            description={`${skafferi.data?.length ?? 0} varor lagerförda`}
          />
          <CardBody className="pt-0">
            {utgar.length > 0 ? (
              <>
                <p className="text-sm">
                  <strong>{utgar.length}</strong> {utgar.length === 1 ? 'vara' : 'varor'} går ut inom
                  en vecka.
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--text-dampad)]">
                  {utgar.slice(0, 3).map((rad) => (
                    <li key={rad.id}>
                      {rad.ingredient_id} - {rad.expires_on}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-[var(--text-dampad)]">
                Inga varor med nära utgångsdatum.
              </p>
            )}
            <LinkButton to="/skafferi" variant="secondary" full className="mt-3">
              Öppna skafferiet
            </LinkButton>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Veckans fynd" description="Kampanjer i din butik" />
          <CardBody className="pt-0">
            <p className="text-sm text-[var(--text-dampad)]">
              Se vilka varor som är nedsatta den här veckan, och låt matsedeln byggas runt dem.
            </p>
            <LinkButton to="/erbjudanden" variant="secondary" full className="mt-3">
              Visa erbjudanden
            </LinkButton>
          </CardBody>
        </Card>
      </div>

      {synk.data ? (
        <p className="mt-6 text-xs text-[var(--text-dampad)]">
          Sortimentet hämtades senast{' '}
          {format(parseISO(synk.data), "d MMMM 'kl.' HH:mm", { locale: sv })}.
        </p>
      ) : null}
    </>
  )
}

function halsning(namn: string | null): string {
  const timme = new Date().getHours()
  const del = timme < 10 ? 'God morgon' : timme < 18 ? 'God dag' : 'God kväll'
  return namn ? `${del}, ${namn}` : del
}
