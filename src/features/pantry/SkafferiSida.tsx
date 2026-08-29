import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning, TomtLage } from '../../components/ui/feedback.tsx'
import { SelectField, TextField } from '../../components/ui/form.tsx'
import { INGREDIENTS, getIngredient } from '../../domain/ingredients.ts'
import { SHOPPING_CATEGORY_LABELS, type RecipeUnit, type ShoppingCategory } from '../../domain/types.ts'
import { formatQuantity } from '../../domain/units.ts'
import { useAuth } from '../auth/auth-context.ts'
import { hamtaSkafferi, sparaSkafferipost, taBortSkafferipost, utgarSnart } from '../../services/pantry.ts'

const ENHETER: RecipeUnit[] = ['g', 'kg', 'ml', 'dl', 'l', 'st', 'msk', 'tsk']

export function SkafferiSida() {
  const { user } = useAuth()
  const klient = useQueryClient()

  const [ingrediens, setIngrediens] = useState('')
  const [mangd, setMangd] = useState('')
  const [enhet, setEnhet] = useState<RecipeUnit>('g')
  const [utgangsdatum, setUtgangsdatum] = useState('')
  const [fel, setFel] = useState<string | null>(null)

  const skafferi = useQuery({
    queryKey: ['skafferi', user?.id],
    queryFn: () => hamtaSkafferi(user!.id),
    enabled: Boolean(user?.id),
  })

  const spara = useMutation({
    mutationFn: () =>
      sparaSkafferipost(user!.id, ingrediens, Number(mangd), enhet, {
        expiresOn: utgangsdatum || null,
      }),
    onSuccess: () => {
      setIngrediens('')
      setMangd('')
      setUtgangsdatum('')
      setFel(null)
      void klient.invalidateQueries({ queryKey: ['skafferi'] })
    },
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Posten kunde inte sparas.'),
  })

  const taBort = useMutation({
    mutationFn: (ingredientId: string) => taBortSkafferipost(user!.id, ingredientId),
    onSuccess: () => klient.invalidateQueries({ queryKey: ['skafferi'] }),
  })

  const sorteradeIngredienser = useMemo(
    () => Object.values(INGREDIENTS).sort((a, b) => a.name.localeCompare(b.name, 'sv')),
    [],
  )

  const perKategori = useMemo(() => {
    const karta = new Map<string, typeof rader>()
    const rader = skafferi.data ?? []
    for (const rad of rader) {
      const kategori = getIngredient(rad.ingredient_id)?.category ?? 'ovrigt'
      karta.set(kategori, [...(karta.get(kategori) ?? []), rad])
    }
    return [...karta.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'))
  }, [skafferi.data])

  if (skafferi.isLoading) return <SidLaddning />

  const utgar = utgarSnart(skafferi.data ?? [], 7)

  return (
    <>
      <SidHuvud
        rubrik="Skafferi"
        underrubrik="Det som finns hemma dras av från inköpslistan innan produkterna väljs."
      />

      {utgar.length > 0 ? (
        <Notis ton="varning" titel="Går ut snart" className="mb-4">
          {utgar
            .map((rad) => `${getIngredient(rad.ingredient_id)?.name ?? rad.ingredient_id} (${rad.expires_on})`)
            .join(', ')}
        </Notis>
      ) : null}

      <Card className="mb-5">
        <CardBody className="pt-4">
          <h2 className="mb-3 font-semibold">Lagerför en vara</h2>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (ingrediens && mangd) spara.mutate()
            }}
          >
            <SelectField
              label="Vara"
              value={ingrediens}
              onChange={(event) => {
                const id = event.target.value
                setIngrediens(id)
                const funnen = getIngredient(id)
                if (funnen) setEnhet(funnen.canonicalUnit === 'ml' ? 'dl' : 'g')
              }}
              required
            >
              <option value="">Välj vara…</option>
              {sorteradeIngredienser.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <TextField
                label="Mängd"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={mangd}
                onChange={(event) => setMangd(event.target.value)}
                required
              />
              <SelectField
                label="Enhet"
                value={enhet}
                onChange={(event) => setEnhet(event.target.value as RecipeUnit)}
                className="w-24"
              >
                {ENHETER.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </SelectField>
            </div>

            <TextField
              label="Bäst före"
              hint="Valfritt."
              type="date"
              value={utgangsdatum}
              onChange={(event) => setUtgangsdatum(event.target.value)}
            />

            {/*
              Knappen har en egen rad i stället för att bottenjusteras bredvid
              ett fält. Bottenjustering ser rätt ut tills fältet intill får en
              hjälptext: rutnätsraden växer, och knappen följer med nedåt.
              Precis det hände här, med 22 pixlars glapp som följd.
            */}
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={spara.isPending} className="w-full sm:w-auto sm:px-8">
                {spara.isPending ? 'Sparar…' : 'Lagerför'}
              </Button>
            </div>
          </form>

          {fel ? (
            <Notis ton="fel" className="mt-3">
              {fel}
            </Notis>
          ) : null}
        </CardBody>
      </Card>

      {(skafferi.data ?? []).length === 0 ? (
        <TomtLage
          rubrik="Inget lagerförs för närvarande."
          beskrivning="Lägg in det som brukar finnas hemma, så slipper du se salt och mjöl på varje inköpslista."
        />
      ) : (
        <div className="space-y-4">
          {perKategori.map(([kategori, rader]) => (
            <Card key={kategori}>
              <h2 className="border-b border-[var(--kant)] px-4 py-2.5 text-sm font-semibold">
                {SHOPPING_CATEGORY_LABELS[kategori as ShoppingCategory] ?? 'Övrigt'}
              </h2>
              <ul>
                {rader.map((rad) => {
                  const ingredient = getIngredient(rad.ingredient_id)
                  return (
                    <li
                      key={rad.id}
                      className="flex items-center gap-3 border-t border-[var(--kant)] px-4 py-3 first:border-t-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {ingredient?.name ?? rad.ingredient_id}
                        </span>
                        {rad.expires_on ? (
                          <span className="text-xs text-[var(--text-dampad)]">
                            Bäst före {rad.expires_on}
                          </span>
                        ) : null}
                      </span>
                      <Badge>
                        {ingredient
                          ? formatQuantity(Number(rad.amount), ingredient.canonicalUnit)
                          : `${rad.amount}`}
                      </Badge>
                      <button
                        type="button"
                        aria-label={`Ta bort ${ingredient?.name ?? rad.ingredient_id}`}
                        onClick={() => taBort.mutate(rad.ingredient_id)}
                        className="p-1 text-[var(--text-dampad)] hover:text-[var(--color-lingon)]"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
