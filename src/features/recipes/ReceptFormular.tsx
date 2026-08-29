import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../../components/ui/form.tsx'
import { INGREDIENTS } from '../../domain/ingredients.ts'
import type { RecipeUnit } from '../../domain/types.ts'
import { useReceptredigering } from '../../hooks/useRecept.ts'
import { hamtaRecept1, type Receptutkast } from '../../services/recipes.ts'

const ENHETER: RecipeUnit[] = ['g', 'kg', 'ml', 'dl', 'l', 'st', 'msk', 'tsk', 'krm']

const TAGGAR = [
  'husmanskost',
  'snabbt',
  'billigt',
  'barnvänligt',
  'vegetariskt',
  'fisk',
  'one-pot',
  'matlådor',
  'frysvänligt',
  'klassiker',
]

type Ingrediensrad = Receptutkast['ingredients'][number]

const TOMT: Receptutkast = {
  name: '',
  description: '',
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 20,
  instructions: [''],
  tags: [],
  ingredients: [],
}

/**
 * Skapa eller ändra ett recept.
 *
 * Ändringen gäller bara det egna hushållet. Det behöver ingen särskild
 * hantering: varje hushåll har egna receptrader, även för startrecepten, och
 * RLS släpper bara igenom de egna.
 */
export function ReceptFormular() {
  const { receptId } = useParams()
  const navigera = useNavigate()
  const { skapa, spara } = useReceptredigering()
  const redigerar = Boolean(receptId)

  const query = useQuery({
    queryKey: ['recept-detalj', receptId],
    queryFn: () => hamtaRecept1(receptId!),
    enabled: redigerar,
  })

  const [utkast, setUtkast] = useState<Receptutkast | null>(null)
  const [fel, setFel] = useState<string | null>(null)

  // Fyll formuläret när receptet kommit fram, men skriv aldrig över det
  // användaren hunnit ändra.
  const start = useMemo<Receptutkast | null>(() => {
    if (!redigerar) return TOMT
    if (!query.data) return null
    const recept = query.data
    return {
      name: recept.name,
      description: recept.description,
      servings: recept.servings,
      prepMinutes: recept.prepMinutes,
      cookMinutes: recept.cookMinutes,
      instructions: recept.instructions.length > 0 ? recept.instructions : [''],
      tags: recept.tags,
      ingredients: recept.ingredients.map((item) => ({
        ingredientId: item.ingredientId,
        quantity: item.quantity.value,
        unit: item.quantity.unit,
        optional: item.optional,
        note: item.note ?? null,
      })),
    }
  }, [redigerar, query.data])

  const varde = utkast ?? start
  const sorterade = useMemo(
    () => Object.values(INGREDIENTS).sort((a, b) => a.name.localeCompare(b.name, 'sv')),
    [],
  )

  if (redigerar && query.isLoading) return <SidLaddning />
  if (redigerar && !query.data) {
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
  if (!varde) return <SidLaddning />

  const andra = (delar: Partial<Receptutkast>) => setUtkast({ ...varde, ...delar })

  function skickaIn() {
    if (!varde) return

    if (varde.name.trim().length === 0) {
      setFel('Receptet behöver ett namn.')
      return
    }
    if (varde.ingredients.length === 0) {
      setFel('Ett recept utan ingredienser går inte att handla för. Lägg till minst en.')
      return
    }
    if (varde.ingredients.some((rad) => !(rad.quantity > 0))) {
      setFel('Varje ingrediens behöver en mängd större än noll.')
      return
    }

    setFel(null)
    const klart = { onError: (error: unknown) => setFel(felText(error)) }

    if (receptId) {
      spara.mutate(
        { recipeId: receptId, utkast: varde },
        { ...klart, onSuccess: () => navigera(`/recept/${receptId}`, { replace: true }) },
      )
    } else {
      skapa.mutate(varde, {
        ...klart,
        onSuccess: (nyttId) => navigera(`/recept/${nyttId}`, { replace: true }),
      })
    }
  }

  const sparar = skapa.isPending || spara.isPending

  return (
    <>
      <Link
        to={receptId ? `/recept/${receptId}` : '/recept'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-dampad)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {receptId ? 'Tillbaka till receptet' : 'Alla recept'}
      </Link>

      <SidHuvud
        rubrik={redigerar ? 'Ändra recept' : 'Nytt recept'}
        underrubrik="Ändringen gäller bara ditt hushåll."
      />

      {fel ? (
        <Notis ton="fel" className="mb-4">
          {fel}
        </Notis>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4 pt-4">
            <TextField
              label="Namn"
              placeholder="Köttbullar med potatismos"
              value={varde.name}
              onChange={(event) => andra({ name: event.target.value })}
            />
            <TextAreaField
              label="Beskrivning"
              hint="En eller två meningar om rätten."
              value={varde.description}
              onChange={(event) => andra({ description: event.target.value })}
            />
            <div className="grid grid-cols-3 gap-3">
              <TextField
                label="Portioner"
                type="number"
                min={1}
                max={24}
                value={varde.servings}
                onChange={(event) => andra({ servings: Number(event.target.value) })}
              />
              <TextField
                label="Förberedelse"
                hint="minuter"
                type="number"
                min={0}
                max={480}
                value={varde.prepMinutes}
                onChange={(event) => andra({ prepMinutes: Number(event.target.value) })}
              />
              <TextField
                label="Tillagning"
                hint="minuter"
                type="number"
                min={0}
                max={480}
                value={varde.cookMinutes}
                onChange={(event) => andra({ cookMinutes: Number(event.target.value) })}
              />
            </div>

            <fieldset>
              <legend className="mb-2 block text-sm font-medium">Taggar</legend>
              <div className="flex flex-wrap gap-2">
                {TAGGAR.map((tag) => {
                  const aktiv = varde.tags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={aktiv}
                      onClick={() =>
                        andra({
                          tags: aktiv
                            ? varde.tags.filter((item) => item !== tag)
                            : [...varde.tags, tag],
                        })
                      }
                      className={
                        aktiv
                          ? 'min-h-11 rounded-lg border border-transparent bg-[var(--accent)] px-3 text-sm text-[var(--accent-text)]'
                          : 'min-h-11 rounded-lg border border-[var(--kant)] px-3 text-sm hover:bg-[var(--yta-dampad)]'
                      }
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          </CardBody>
        </Card>

        <Card>
          <h2 className="border-b border-[var(--kant)] px-4 py-2.5 font-semibold">Ingredienser</h2>
          <CardBody className="space-y-3 pt-3">
            <p className="text-sm text-[var(--text-dampad)]">
              Ingredienserna väljs ur departementets katalog. Det är den som kopplar receptet
              till verkliga varor i butiken.
            </p>

            {varde.ingredients.length === 0 ? (
              <p className="text-sm text-[var(--text-dampad)]">Inga ingredienser tillagda än.</p>
            ) : (
              <ul className="space-y-2">
                {varde.ingredients.map((rad, index) => (
                  <li key={index} className="flex flex-wrap items-end gap-2">
                    <SelectField
                      label={`Ingrediens ${index + 1}`}
                      doldEtikett={index > 0}
                      className="min-w-0"
                      value={rad.ingredientId}
                      onChange={(event) =>
                        andra({
                          ingredients: byt(varde.ingredients, index, {
                            ingredientId: event.target.value,
                          }),
                        })
                      }
                    >
                      {sorterade.map((ingrediens) => (
                        <option key={ingrediens.id} value={ingrediens.id}>
                          {ingrediens.name}
                        </option>
                      ))}
                    </SelectField>

                    <TextField
                      label={`Mängd för ingrediens ${index + 1}`}
                      doldEtikett={index > 0}
                      type="number"
                      min={0}
                      step="any"
                      className="w-24"
                      value={rad.quantity}
                      onChange={(event) =>
                        andra({
                          ingredients: byt(varde.ingredients, index, {
                            quantity: Number(event.target.value),
                          }),
                        })
                      }
                    />

                    <SelectField
                      label={`Enhet för ingrediens ${index + 1}`}
                      doldEtikett={index > 0}
                      className="w-24"
                      value={rad.unit}
                      onChange={(event) =>
                        andra({
                          ingredients: byt(varde.ingredients, index, {
                            unit: event.target.value as RecipeUnit,
                          }),
                        })
                      }
                    >
                      {ENHETER.map((enhet) => (
                        <option key={enhet} value={enhet}>
                          {enhet}
                        </option>
                      ))}
                    </SelectField>

                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ta bort ${INGREDIENTS[rad.ingredientId]?.name ?? 'ingrediensen'}`}
                      onClick={() =>
                        andra({
                          ingredients: varde.ingredients.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="secondary"
              onClick={() =>
                andra({
                  ingredients: [
                    ...varde.ingredients,
                    {
                      ingredientId: sorterade[0]!.id,
                      quantity: 1,
                      unit: sorterade[0]!.canonicalUnit as RecipeUnit,
                      optional: false,
                    } satisfies Ingrediensrad,
                  ],
                })
              }
            >
              <Plus className="size-4" aria-hidden />
              Lägg till ingrediens
            </Button>
          </CardBody>
        </Card>

        <Card>
          <h2 className="border-b border-[var(--kant)] px-4 py-2.5 font-semibold">Gör så här</h2>
          <CardBody className="space-y-3 pt-3">
            {varde.instructions.map((steg, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--yta-dampad)] text-xs font-medium">
                  {index + 1}
                </span>
                <TextAreaField
                  label={`Steg ${index + 1}`}
                  doldEtikett
                  className="min-h-16"
                  value={steg}
                  onChange={(event) =>
                    andra({
                      instructions: varde.instructions.map((v, i) =>
                        i === index ? event.target.value : v,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-1"
                  aria-label={`Ta bort steg ${index + 1}`}
                  disabled={varde.instructions.length === 1}
                  onClick={() =>
                    andra({ instructions: varde.instructions.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="secondary"
              onClick={() => andra({ instructions: [...varde.instructions, ''] })}
            >
              <Plus className="size-4" aria-hidden />
              Lägg till steg
            </Button>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button size="lg" disabled={sparar} onClick={skickaIn}>
            {sparar ? 'Sparar…' : redigerar ? 'Spara ändringarna' : 'Skapa receptet'}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => navigera(receptId ? `/recept/${receptId}` : '/recept')}
          >
            Avbryt
          </Button>
        </div>
      </div>
    </>
  )
}

function byt(
  rader: Ingrediensrad[],
  index: number,
  delar: Partial<Ingrediensrad>,
): Ingrediensrad[] {
  return rader.map((rad, i) => (i === index ? { ...rad, ...delar } : rad))
}

function felText(error: unknown): string {
  return error instanceof Error ? error.message : 'Receptet kunde inte sparas.'
}
