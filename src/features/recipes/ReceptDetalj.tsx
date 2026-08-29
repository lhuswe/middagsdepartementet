import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, Clock, Pencil, TriangleAlert, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button, LinkButton } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { scaleRecipe } from '../../domain/aggregate.ts'
import { getIngredient } from '../../domain/ingredients.ts'
import { useHushall } from '../../hooks/useHushall.ts'
import { useMarkeraLagad, useReceptredigering } from '../../hooks/useRecept.ts'
import { hamtaRecept1, planeradeMaltiderFor } from '../../services/recipes.ts'
import { formatMinutes } from '../../lib/utils.ts'

export function ReceptDetalj() {
  const { receptId } = useParams()
  const navigera = useNavigate()
  const { portioner } = useHushall()
  const markeraLagad = useMarkeraLagad()
  const { taBort } = useReceptredigering()
  const [portionerVal, setPortionerVal] = useState<number | null>(null)
  const [bekraftar, setBekraftar] = useState(false)

  // Hämtas först när användaren öppnat bekräftelsen: varningen ska kunna säga
  // hur många planerade dagar som töms, inte bara att något kan hända.
  const planerade = useQuery({
    queryKey: ['planerade-maltider', receptId],
    queryFn: () => planeradeMaltiderFor(receptId!),
    enabled: bekraftar && Boolean(receptId),
  })

  const query = useQuery({
    queryKey: ['recept-detalj', receptId],
    queryFn: () => hamtaRecept1(receptId!),
    enabled: Boolean(receptId),
  })

  if (query.isLoading) return <SidLaddning />

  const recept = query.data
  if (!recept) {
    return (
      <TomtLage
        rubrik="Receptet finns inte i registret."
        action={
          <Link to="/recept" className="underline">
            Tillbaka till recepten
          </Link>
        }
      />
    )
  }

  const visadePortioner = portionerVal ?? portioner
  const skalade = scaleRecipe(recept, visadePortioner)
  const skalfaktor = visadePortioner / recept.servings

  return (
    <>
      <Link to="/recept" className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-dampad)]">
        <ArrowLeft className="size-4" aria-hidden />
        Alla recept
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{recept.name}</h1>
          <p className="mt-1 text-[var(--text-dampad)]">{recept.description}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <LinkButton to={`/recept/${recept.id}/andra`} variant="secondary" size="sm">
            <Pencil className="size-4" aria-hidden />
            Ändra
          </LinkButton>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ta bort receptet"
            onClick={() => setBekraftar(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {bekraftar ? (
        <Notis ton="fel" className="mt-4" titel="Ta bort receptet?">
          {planerade.data
            ? `Receptet ligger på ${planerade.data} planerad${planerade.data === 1 ? ' dag' : 'e dagar'}, som blir tomma.`
            : 'Receptet försvinner ur samlingen.'}{' '}
          Det går inte att ångra.
          <span className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={taBort.isPending}
              onClick={() =>
                taBort.mutate(recept.id, { onSuccess: () => navigera('/recept', { replace: true }) })
              }
            >
              <TriangleAlert className="size-4" aria-hidden />
              {taBort.isPending ? 'Tar bort…' : 'Ja, ta bort'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBekraftar(false)}>
              Avbryt
            </Button>
          </span>
        </Notis>
      ) : null}

      {taBort.error ? (
        <Notis ton="fel" className="mt-4">
          {taBort.error instanceof Error ? taBort.error.message : 'Receptet kunde inte tas bort.'}
        </Notis>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--text-dampad)]">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden />
          {formatMinutes(recept.prepMinutes + recept.cookMinutes)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4" aria-hidden />
          grundrecept {recept.servings} portioner
        </span>
        {recept.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
        <Card className="h-fit">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--kant)] px-4 py-3">
            <h2 className="font-semibold">Ingredienser</h2>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Färre portioner"
                disabled={visadePortioner <= 1}
                onClick={() => setPortionerVal(visadePortioner - 1)}
              >
                −
              </Button>
              <span className="w-14 text-center text-sm tabular-nums">
                {visadePortioner} port.
              </span>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Fler portioner"
                onClick={() => setPortionerVal(visadePortioner + 1)}
              >
                +
              </Button>
            </div>
          </div>

          <ul className="divide-y divide-[var(--kant)]">
            {skalade.map((item, index) => {
              const ingredient = getIngredient(item.ingredientId)
              return (
                <li key={`${item.ingredientId}-${index}`} className="flex gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 tabular-nums text-[var(--text-dampad)]">
                    {formatMangd(item.quantity.value)} {item.quantity.unit}
                  </span>
                  <span className="min-w-0 flex-1">
                    {ingredient?.name ?? item.ingredientId}
                    {item.optional ? (
                      <span className="text-[var(--text-dampad)]"> (valfritt)</span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>

          {skalfaktor !== 1 ? (
            <div className="px-4 pb-4 pt-3">
              <Notis ton="neutral">
                Mängderna är skalade från {recept.servings} till {visadePortioner} portioner.
              </Notis>
            </div>
          ) : null}
        </Card>

        <div>
          <Card>
            <CardBody className="pt-4">
              <h2 className="mb-3 font-semibold">Gör så här</h2>
              <ol className="space-y-3">
                {recept.instructions.map((steg, index) => (
                  <li key={steg} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--yta-dampad)] text-xs font-medium">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{steg}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Button
            className="mt-4"
            variant="secondary"
            disabled={markeraLagad.isPending || markeraLagad.isSuccess}
            onClick={() =>
              markeraLagad.mutate({ recipeId: recept.id, servings: visadePortioner })
            }
          >
            <Check className="size-4" aria-hidden />
            {markeraLagad.isSuccess ? 'Noterat' : 'Jag lagade detta'}
          </Button>
          <p className="mt-2 text-xs text-[var(--text-dampad)]">
            Noteringen används för att undvika att samma rätt föreslås igen för snart.
          </p>
        </div>
      </div>
    </>
  )
}

/** Skalade mängder blir sällan runda tal. Visa högst en decimal. */
function formatMangd(value: number): string {
  return value.toLocaleString('sv-SE', { maximumFractionDigits: 1 })
}
