import { addWeeks, format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Clock, RefreshCw, Shuffle, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import type { PlannedMeal } from '../../domain/aggregate.ts'
import { bytUtMaltid, planeraVecka, type PlanOptions } from '../../domain/planner.ts'
import type { Recipe } from '../../domain/types.ts'
import { useHushall, useHushallsallergier } from '../../hooks/useHushall.ts'
import { useProfil } from '../../hooks/useProfil.ts'
import { useLagningshistorik, useRecept } from '../../hooks/useRecept.ts'
import { useSattMaltid, useSparaVecka, useVeckoplan } from '../../hooks/useVeckoplan.ts'
import { VECKODAGAR, veckansDagar, veckostart } from '../../services/mealPlans.ts'
import { cn, formatMinutes } from '../../lib/utils.ts'

export function VeckaSida() {
  const navigera = useNavigate()
  const [sokparametrar, sattSokparametrar] = useSearchParams()
  const [weekStart, setWeekStart] = useState(veckostart())

  const { profil, isLoading: profilLaddar } = useProfil()
  const { hushall, portioner } = useHushall()
  const { data: hushallsallergier } = useHushallsallergier()
  const { data: recept, isLoading: receptLaddar } = useRecept()
  const { data: historik } = useLagningshistorik()
  const { data: plan, isLoading: planLaddar } = useVeckoplan(weekStart)

  const sparaVecka = useSparaVecka(weekStart)
  const sattMaltid = useSattMaltid(weekStart)

  const [utkast, setUtkast] = useState<PlannedMeal[] | null>(null)
  const [fro, setFro] = useState(() => Math.floor(Math.random() * 100_000))

  const receptPerId = useMemo(
    () => new Map((recept ?? []).map((item) => [item.id, item])),
    [recept],
  )

  /** Måltider som faktiskt visas: utkastet om det finns, annars det sparade. */
  const maltider = useMemo<PlannedMeal[]>(() => {
    if (utkast) return utkast
    return (plan?.poster ?? [])
      .filter((post) => post.meal_type === 'dinner' && post.recipe_id)
      .flatMap<PlannedMeal>((post) => {
        const recipe = receptPerId.get(post.recipe_id!)
        if (!recipe) return []
        return [{ recipe, servings: post.servings, slotId: `${post.served_on}/dinner` }]
      })
  }, [utkast, plan, receptPerId])

  const planOptions = useMemo<PlanOptions>(
    () => ({
      days: 7,
      startDate: parseISO(weekStart),
      servings: portioner,
      seed: fro,
      ...(hushall?.max_cooking_minutes ? { maxMinutes: hushall.max_cooking_minutes } : {}),
      // Allergier tas för hela hushållet, inte bara för den inloggade: en rätt
      // som är olämplig för en medlem är olämplig för måltiden. Ogillar är
      // personligt och viktas mjukare.
      avoidIngredientIds: [...(profil?.dislikes ?? []), ...(hushallsallergier ?? [])],
      repetitionAvoidance: hushall?.repetition_avoidance ?? 'medium',
      recentlyCooked: (historik ?? []).map((post) => ({
        recipeId: post.recipeId,
        daysAgo: post.daysAgo,
      })),
    }),
    [weekStart, portioner, fro, profil, hushall, hushallsallergier, historik],
  )

  function generera() {
    if (!recept || recept.length === 0) return
    const resultat = planeraVecka(recept, planOptions)
    setUtkast(resultat.meals)
  }

  // Onboarding skickar hit med ?generera=1 för att skapa den första matsedeln.
  useEffect(() => {
    if (sokparametrar.get('generera') !== '1') return
    if (!recept || recept.length === 0) return
    setUtkast(planeraVecka(recept, planOptions).meals)
    sattSokparametrar({}, { replace: true })
    // planOptions ändras vid varje omrendering av profildata; vi vill bara köra
    // den här effekten en gång när recepten finns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recept])

  if (profilLaddar || receptLaddar || planLaddar) return <SidLaddning />

  const veckanDagar = veckansDagar(weekStart)
  const totalTid = maltider.reduce(
    (summa, meal) => summa + meal.recipe.prepMinutes + meal.recipe.cookMinutes,
    0,
  )

  return (
    <>
      <SidHuvud
        rubrik="Min vecka"
        underrubrik={
          <span className="capitalize">
            {format(parseISO(weekStart), "'vecka' w, yyyy", { locale: sv })}
          </span>
        }
        action={
          <div className="flex gap-1">
            <Button
              variant="secondary"
              size="icon"
              aria-label="Föregående vecka"
              onClick={() => {
                setUtkast(null)
                setWeekStart(veckostart(addWeeks(parseISO(weekStart), -1)))
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Nästa vecka"
              onClick={() => {
                setUtkast(null)
                setWeekStart(veckostart(addWeeks(parseISO(weekStart), 1)))
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {recept && recept.length === 0 ? (
        <Notis ton="varning" titel="Inga recept registrerade">
          Receptsamlingen är tom. Gå till Recept och importera startrecepten.
        </Notis>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setFro(Math.floor(Math.random() * 100_000))
            generera()
          }}
        >
          <RefreshCw className="size-4" aria-hidden />
          {maltider.length > 0 ? 'Generera ny matsedel' : 'Generera matsedel'}
        </Button>

        {utkast ? (
          <>
            <Button
              variant="secondary"
              disabled={sparaVecka.isPending}
              onClick={() =>
                sparaVecka.mutate(utkast, {
                  onSuccess: () => setUtkast(null),
                })
              }
            >
              {sparaVecka.isPending ? 'Sparar…' : 'Spara matsedeln'}
            </Button>
            <Button variant="ghost" onClick={() => setUtkast(null)}>
              Ångra
            </Button>
          </>
        ) : null}

        {maltider.length > 0 && !utkast ? (
          <Button variant="secondary" onClick={() => navigera('/inkopslista?generera=1')}>
            Skapa inköpslista
          </Button>
        ) : null}
      </div>

      {utkast ? (
        <Notis ton="varning" className="mb-4">
          Matsedeln är ett förslag och inte sparad än.
        </Notis>
      ) : null}

      {maltider.length === 0 ? (
        <TomtLage
          rubrik="Ingen matsedel är registrerad för innevarande vecka."
          beskrivning="Generera ett förslag utifrån hushållets inställningar, eller lägg till rätter en och en."
        />
      ) : (
        <div className="space-y-3">
          {veckanDagar.map((dag, index) => {
            const datum = format(dag, 'yyyy-MM-dd')
            const slotId = `${datum}/dinner`
            const meal = maltider.find((item) => item.slotId === slotId)

            return (
              <Dagskort
                key={datum}
                dagnamn={VECKODAGAR[index]!}
                datum={dag}
                meal={meal}
                onSlumpa={() => {
                  if (!recept) return
                  setUtkast(bytUtMaltid(maltider, slotId, recept, { ...planOptions, seed: Date.now() }))
                }}
                onTaBort={() => {
                  if (utkast) {
                    setUtkast(utkast.filter((item) => item.slotId !== slotId))
                  } else {
                    sattMaltid.mutate({ servedOn: datum, recipeId: null, servings: portioner })
                  }
                }}
                onOppna={(recipe) => navigera(`/recept/${recipe.id}`)}
              />
            )
          })}
        </div>
      )}

      {maltider.length > 0 ? (
        <Card className="mt-5">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 text-sm">
            <span>
              <span className="text-[var(--text-dampad)]">Måltider: </span>
              <strong>{maltider.length}</strong>
            </span>
            <span>
              <span className="text-[var(--text-dampad)]">Portioner per måltid: </span>
              <strong>{portioner}</strong>
            </span>
            <span>
              <span className="text-[var(--text-dampad)]">Sammanlagd tillagningstid: </span>
              <strong>{formatMinutes(totalTid)}</strong>
            </span>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

function Dagskort({
  dagnamn,
  datum,
  meal,
  onSlumpa,
  onTaBort,
  onOppna,
}: {
  dagnamn: string
  datum: Date
  meal: PlannedMeal | undefined
  onSlumpa: () => void
  onTaBort: () => void
  onOppna: (recipe: Recipe) => void
}) {
  const idag = format(new Date(), 'yyyy-MM-dd') === format(datum, 'yyyy-MM-dd')

  return (
    <Card className={cn(idag && 'ring-1 ring-[var(--accent)]')}>
      <div className="flex items-stretch">
        <div className="flex w-24 shrink-0 flex-col justify-center border-r border-[var(--kant)] px-3 py-3">
          <p className="text-sm font-medium">{dagnamn}</p>
          <p className="text-xs text-[var(--text-dampad)]">{format(datum, 'd MMM', { locale: sv })}</p>
          {idag ? (
            <Badge ton="positiv" className="mt-1 w-fit">
              i dag
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 px-3 py-3">
          {meal ? (
            <>
              <button
                type="button"
                onClick={() => onOppna(meal.recipe)}
                className="block w-full text-left"
              >
                <p className="font-medium leading-snug">{meal.recipe.name}</p>
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-dampad)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden />
                  {formatMinutes(meal.recipe.prepMinutes + meal.recipe.cookMinutes)}
                </span>
                <span>{meal.servings} portioner</span>
                {meal.recipe.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            </>
          ) : (
            <p className="py-1 text-sm text-[var(--text-dampad)]">Ingen måltid planerad.</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 pr-2">
          <Button variant="ghost" size="icon" aria-label={`Slumpa ny rätt för ${dagnamn}`} onClick={onSlumpa}>
            <Shuffle className="size-4" />
          </Button>
          {meal ? (
            <Button variant="ghost" size="icon" aria-label={`Ta bort ${dagnamn}`} onClick={onTaBort}>
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
