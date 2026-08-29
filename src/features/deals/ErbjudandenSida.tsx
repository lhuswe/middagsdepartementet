import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { SaknarButik } from '../../components/SaknarButik.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { INGREDIENTS } from '../../domain/ingredients.ts'
import { matchIngredient } from '../../domain/matching.ts'
import type { Product } from '../../domain/types.ts'
import { useHushall } from '../../hooks/useHushall.ts'
import { hamtaErbjudanden } from '../../services/catalog.ts'
import { formatKr } from '../../lib/utils.ts'

export function ErbjudandenSida() {
  const navigera = useNavigate()
  const { butik } = useHushall()
  const [valda, setValda] = useState<string[]>([])

  const erbjudanden = useQuery({
    queryKey: ['erbjudanden', butik],
    queryFn: () => hamtaErbjudanden(butik!),
    enabled: Boolean(butik),
    staleTime: 30 * 60_000,
  })

  /**
   * Kopplar kampanjvaror till ingredienser vi faktiskt har recept för.
   *
   * Ett erbjudande på hundmat är inget matsedeln kan byggas runt. Matchningen
   * återanvänds från domänen, så samma spärrar gäller här som i inköpslistan.
   */
  const relevanta = useMemo(() => {
    const produkter = erbjudanden.data ?? []
    if (produkter.length === 0) return []

    const träffar: { ingredientId: string; namn: string; produkt: Product }[] = []
    for (const ingredient of Object.values(INGREDIENTS)) {
      const resultat = matchIngredient(ingredient, produkter)
      if (resultat.confidence === 'probable' || resultat.confidence === 'confirmed') {
        if (resultat.best) {
          träffar.push({
            ingredientId: ingredient.id,
            namn: ingredient.name,
            produkt: resultat.best,
          })
        }
      }
    }
    return träffar
  }, [erbjudanden.data])

  if (!butik) {
    return (
      <>
        <SidHuvud rubrik="Veckans fynd" />
        <SaknarButik vad="Kampanjer" />
      </>
    )
  }

  if (erbjudanden.isLoading) return <SidLaddning />

  const produkter = erbjudanden.data ?? []

  return (
    <>
      <SidHuvud
        rubrik="Veckans fynd"
        underrubrik="Nedsatta varor i din butik, enligt senaste hämtningen."
      />

      {produkter.length === 0 ? (
        <TomtLage
          rubrik="Inga kampanjer är registrerade."
          beskrivning="Antingen saknas synkad sortimentsdata, eller så pågår inga erbjudanden just nu."
        />
      ) : (
        <>
          {relevanta.length > 0 ? (
            <Card className="mb-5">
              <div className="px-4 py-4">
                <h2 className="font-semibold">Bygg veckan runt erbjudandena</h2>
                <p className="mt-1 text-sm text-[var(--text-dampad)]">
                  Välj råvaror som är nedsatta, så viktar planeraren matsedeln mot dem.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {relevanta.slice(0, 12).map((rad) => {
                    const aktiv = valda.includes(rad.ingredientId)
                    return (
                      <button
                        key={rad.ingredientId}
                        type="button"
                        aria-pressed={aktiv}
                        onClick={() =>
                          setValda((tidigare) =>
                            aktiv
                              ? tidigare.filter((id) => id !== rad.ingredientId)
                              : [...tidigare, rad.ingredientId],
                          )
                        }
                        className={
                          aktiv
                            ? 'min-h-11 rounded-lg border border-transparent bg-[var(--accent)] px-3 text-sm text-[var(--accent-text)]'
                            : 'min-h-11 rounded-lg border border-[var(--kant)] px-3 text-sm hover:bg-[var(--yta-dampad)]'
                        }
                      >
                        {rad.namn}
                      </button>
                    )
                  })}
                </div>
                <Button
                  className="mt-4"
                  disabled={valda.length === 0}
                  onClick={() => navigera(`/vecka?generera=1&favorer=${valda.join(',')}`)}
                >
                  Bygg matsedel runt {valda.length || 'valda'} råvaror
                </Button>
              </div>
            </Card>
          ) : (
            <Notis ton="neutral" className="mb-5">
              Inga av veckans kampanjer matchar de råvaror receptsamlingen använder.
            </Notis>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {produkter.map((produkt) => (
              <li key={produkt.gtin}>
                <ErbjudandeKort produkt={produkt} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function ErbjudandeKort({ produkt }: { produkt: Product }) {
  const kampanj = produkt.promotions[0]
  const till = kampanj?.to ? parseISO(kampanj.to) : null

  return (
    <Card className="h-full">
      <div className="flex gap-3 p-3">
        {produkt.imageUrl ? (
          <img
            src={`${produkt.imageUrl}?w=120`}
            alt=""
            loading="lazy"
            className="size-16 shrink-0 rounded object-contain"
          />
        ) : (
          <span className="size-16 shrink-0 rounded bg-[var(--yta-dampad)]" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{produkt.name}</p>
          <p className="truncate text-sm text-[var(--text-dampad)]">{produkt.subtitle}</p>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            {kampanj?.price ? (
              <>
                <span className="text-lg font-semibold text-[var(--color-lingon)]">
                  {formatKr(kampanj.price)}
                </span>
                <span className="text-sm text-[var(--text-dampad)] line-through">
                  {formatKr(produkt.price)}
                </span>
              </>
            ) : (
              <span className="text-lg font-semibold">{formatKr(produkt.price)}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {kampanj?.effectType === 'ItemsTotal' ? (
              <Badge ton="varning">
                {kampanj.minQuantity} för {formatKr(kampanj.value)}
              </Badge>
            ) : null}
            {kampanj?.membersOnly ? <Badge ton="okand">Medlemspris</Badge> : null}
            {produkt.inStock === false ? <Badge ton="fel">Slut i butiken</Badge> : null}
            {till ? (
              <Badge>t.o.m. {format(till, 'd MMM', { locale: sv })}</Badge>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}
