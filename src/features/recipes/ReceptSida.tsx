import { useMutation } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, Heart, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { useAuth } from '../auth/auth-context.ts'
import { useHushall } from '../../hooks/useHushall.ts'
import { useFavoritrecept, useRecept } from '../../hooks/useRecept.ts'
import { importeraStartrecept } from '../../services/recipes.ts'
import { cn, formatMinutes } from '../../lib/utils.ts'

/** Filter som motsvarar hur man faktiskt letar efter en vardagsmiddag. */
const FILTER: { id: string; etikett: string; test: (tags: string[], minuter: number) => boolean }[] = [
  { id: 'under30', etikett: 'Under 30 min', test: (_, minuter) => minuter <= 30 },
  { id: 'under45', etikett: 'Under 45 min', test: (_, minuter) => minuter <= 45 },
  { id: 'billigt', etikett: 'Billigt', test: (tags) => tags.includes('billigt') },
  { id: 'husmanskost', etikett: 'Husmanskost', test: (tags) => tags.includes('husmanskost') },
  { id: 'vegetariskt', etikett: 'Vegetariskt', test: (tags) => tags.includes('vegetariskt') },
  { id: 'fisk', etikett: 'Fisk', test: (tags) => tags.includes('fisk') },
  { id: 'frysvanligt', etikett: 'Frysvänligt', test: (tags) => tags.includes('frysvänligt') },
  { id: 'matlador', etikett: 'Matlådor', test: (tags) => tags.includes('matlådor') },
  { id: 'barnvanligt', etikett: 'Barnvänligt', test: (tags) => tags.includes('barnvänligt') },
  { id: 'onepot', etikett: 'One-pot', test: (tags) => tags.includes('one-pot') },
  { id: 'faingredienser', etikett: 'Få ingredienser', test: (tags) => tags.includes('få ingredienser') },
]

export function ReceptSida() {
  const { user } = useAuth()
  const { hushallId } = useHushall()
  const klient = useQueryClient()
  const { data: recept, isLoading } = useRecept()
  const { favoriter, vaxla } = useFavoritrecept()

  const [fraga, setFraga] = useState('')
  const [aktivaFilter, setAktivaFilter] = useState<string[]>([])
  const [baraFavoriter, setBaraFavoriter] = useState(false)

  const importera = useMutation({
    mutationFn: () => importeraStartrecept(hushallId!, user!.id),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['recept'] }),
  })

  const traffar = useMemo(() => {
    const sok = fraga.trim().toLowerCase()
    return (recept ?? []).filter((item) => {
      const minuter = item.prepMinutes + item.cookMinutes
      if (sok && !item.name.toLowerCase().includes(sok) && !item.description.toLowerCase().includes(sok)) {
        return false
      }
      if (baraFavoriter && !favoriter.has(item.id)) return false
      return aktivaFilter.every((id) => {
        const filter = FILTER.find((entry) => entry.id === id)
        return filter ? filter.test(item.tags, minuter) : true
      })
    })
  }, [recept, fraga, aktivaFilter, baraFavoriter, favoriter])

  if (isLoading) return <SidLaddning />

  return (
    <>
      <SidHuvud
        rubrik="Recept"
        underrubrik={`${recept?.length ?? 0} rätter i samlingen`}
      />

      {recept && recept.length === 0 ? (
        <TomtLage
          rubrik="Receptsamlingen är tom."
          beskrivning="Departementet tillhandahåller ett trettiotal vardagsrätter att utgå från."
          action={
            <Button disabled={importera.isPending} onClick={() => importera.mutate()}>
              {importera.isPending ? 'Registrerar…' : 'Hämta startrecepten'}
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-dampad)]"
                aria-hidden
              />
              <input
                value={fraga}
                onChange={(event) => setFraga(event.target.value)}
                placeholder="Sök bland recepten"
                aria-label="Sök bland recepten"
                className="min-h-11 w-full rounded-lg border border-[var(--kant)] bg-[var(--yta)] pl-9 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <FilterKnapp
              aktiv={baraFavoriter}
              onClick={() => setBaraFavoriter((v) => !v)}
              etikett="Favoriter"
            />
            {FILTER.map((filter) => (
              <FilterKnapp
                key={filter.id}
                aktiv={aktivaFilter.includes(filter.id)}
                etikett={filter.etikett}
                onClick={() =>
                  setAktivaFilter((tidigare) =>
                    tidigare.includes(filter.id)
                      ? tidigare.filter((id) => id !== filter.id)
                      : [...tidigare, filter.id],
                  )
                }
              />
            ))}
          </div>

          {traffar.length === 0 ? (
            <Notis ton="neutral">Inga recept matchar de valda villkoren.</Notis>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {traffar.map((item) => {
                const favorit = favoriter.has(item.id)
                return (
                  <li key={item.id}>
                    <Card className="h-full">
                      <div className="flex h-full flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/recept/${item.id}`} className="min-w-0 font-medium leading-snug">
                            {item.name}
                          </Link>
                          <button
                            type="button"
                            aria-label={favorit ? 'Ta bort favoritmarkering' : 'Markera som favorit'}
                            aria-pressed={favorit}
                            onClick={() => vaxla.mutate({ recipeId: item.id, favorit: !favorit })}
                            className="shrink-0 p-1"
                          >
                            <Heart
                              className={cn(
                                'size-5',
                                favorit
                                  ? 'fill-[var(--color-lingon)] text-[var(--color-lingon)]'
                                  : 'text-[var(--text-dampad)]',
                              )}
                            />
                          </button>
                        </div>

                        <p className="mt-1 flex-1 text-sm text-[var(--text-dampad)]">
                          {item.description}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 text-[var(--text-dampad)]">
                            <Clock className="size-3.5" aria-hidden />
                            {formatMinutes(item.prepMinutes + item.cookMinutes)}
                          </span>
                          {item.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function FilterKnapp({
  aktiv,
  etikett,
  onClick,
}: {
  aktiv: boolean
  etikett: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={aktiv}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-lg border px-3 text-sm transition-colors',
        aktiv
          ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
          : 'border-[var(--kant)] hover:bg-[var(--yta-dampad)]',
      )}
    >
      {etikett}
    </button>
  )
}
