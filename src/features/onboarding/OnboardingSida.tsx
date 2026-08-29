import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { SelectField, TextField } from '../../components/ui/form.tsx'
import { INGREDIENTS } from '../../domain/ingredients.ts'
import { useAuth } from '../auth/auth-context.ts'
import { useButiker, useProfil, useSparaProfil } from '../../hooks/useProfil.ts'
import { importeraStartrecept } from '../../services/recipes.ts'
import { sparaSkafferipost } from '../../services/pantry.ts'
import { cn } from '../../lib/utils.ts'

const SMAKTAGGAR = [
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

const VANLIGA_ALLERGIER = ['gluten', 'laktos', 'mjölk', 'ägg', 'nötter', 'jordnötter', 'soja', 'fisk', 'skaldjur']

/** Skafferivaror som är rimliga att fråga om i sista steget. */
const SKAFFERIFORSLAG = [
  'salt',
  'socker',
  'vetemjol',
  'rapsolja',
  'ris',
  'pasta',
  'gul_lok',
  'potatis',
  'krossade_tomater',
  'buljongtarning',
]

const STEG = [
  'Hushållet',
  'Vad ni gillar',
  'Vad ni undviker',
  'Budget',
  'Butik',
  'Skafferiet',
] as const

export function OnboardingSida() {
  const navigera = useNavigate()
  const { user } = useAuth()
  const { profil, isLoading } = useProfil()
  const sparaProfil = useSparaProfil()
  const { data: butiker } = useButiker()

  const [steg, setSteg] = useState(0)
  const [vuxna, setVuxna] = useState(2)
  const [barn, setBarn] = useState(0)
  const [maxTid, setMaxTid] = useState(45)
  const [gillar, setGillar] = useState<string[]>(['husmanskost', 'snabbt'])
  const [allergier, setAllergier] = useState<string[]>([])
  const [ogillar, setOgillar] = useState<string[]>([])
  const [budget, setBudget] = useState('')
  const [butik, setButik] = useState('3230')
  const [harHemma, setHarHemma] = useState<string[]>(['salt', 'socker', 'vetemjol', 'rapsolja'])
  const [fel, setFel] = useState<string | null>(null)

  const slutfor = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Ingen inloggad användare.')

      await sparaProfil.mutateAsync({
        adults: vuxna,
        children: barn,
        servings_per_meal: Math.max(1, Math.round(vuxna + barn * 0.5)),
        max_cooking_minutes: maxTid,
        weekly_budget: budget === '' ? null : Number(budget),
        store_number: butik,
        allergies: allergier,
        dislikes: ogillar,
        diets: gillar.includes('vegetariskt') ? ['vegetariskt'] : [],
        onboarded_at: new Date().toISOString(),
      })

      await importeraStartrecept(user.id)

      // Skafferiet fylls med generösa mängder — poängen är att slippa se salt
      // och mjöl på inköpslistan, inte att hålla exakt lager.
      for (const id of harHemma) {
        const ingredient = INGREDIENTS[id]
        if (!ingredient) continue
        await sparaSkafferipost(user.id, id, ingredient.canonicalUnit === 'ml' ? 5 : 500, ingredient.canonicalUnit === 'ml' ? 'dl' : 'g')
      }
    },
    onSuccess: () => navigera('/vecka?generera=1', { replace: true }),
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Något gick fel vid registreringen.'),
  })

  if (isLoading) return <SidLaddning />
  if (profil?.onboarded_at) return <Navigate to="/" replace />

  const sista = steg === STEG.length - 1

  return (
    <main className="mx-auto max-w-lg px-4 py-8 pb-24">
      <header className="mb-6">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-dampad)]">
          Departementet för middagsfrågor
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Välkommen. Några uppgifter behövs.
        </h1>
        <p className="mt-2 text-sm text-[var(--text-dampad)]">
          Sex korta frågor. Allt går att ändra sedan under Inställningar.
        </p>
      </header>

      <ol className="mb-5 flex gap-1.5" aria-label="Framsteg">
        {STEG.map((namn, index) => (
          <li
            key={namn}
            aria-current={index === steg ? 'step' : undefined}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index <= steg ? 'bg-[var(--accent)]' : 'bg-[var(--kant)]',
            )}
          >
            <span className="sr-only">{namn}</span>
          </li>
        ))}
      </ol>

      <Card>
        <CardBody className="pt-4">
          <h2 className="mb-4 text-lg font-semibold">
            {steg + 1}. {STEG[steg]}
          </h2>

          {steg === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-dampad)]">Hur många ska äta?</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Vuxna"
                  type="number"
                  min={0}
                  max={12}
                  value={vuxna}
                  onChange={(event) => setVuxna(Number(event.target.value))}
                />
                <TextField
                  label="Barn"
                  type="number"
                  min={0}
                  max={12}
                  value={barn}
                  onChange={(event) => setBarn(Number(event.target.value))}
                />
              </div>
              <TextField
                label="Längsta tillagningstid en vardag"
                hint="I minuter. Rätter som tar längre tid föreslås inte."
                type="number"
                min={10}
                max={240}
                step={5}
                value={maxTid}
                onChange={(event) => setMaxTid(Number(event.target.value))}
              />
            </div>
          ) : null}

          {steg === 1 ? (
            <Valjare
              beskrivning="Vad lagar ni helst? Välj gärna flera."
              alternativ={SMAKTAGGAR}
              valda={gillar}
              onChange={setGillar}
            />
          ) : null}

          {steg === 2 ? (
            <div className="space-y-6">
              <Valjare
                beskrivning="Allergier. Behandlas som hårda villkor — rätter med dessa föreslås aldrig."
                alternativ={VANLIGA_ALLERGIER}
                valda={allergier}
                onChange={setAllergier}
              />
              <Valjare
                beskrivning="Sådant ni helt enkelt inte tycker om."
                alternativ={['broccoli', 'lax', 'svamp', 'lever', 'kål', 'ärter']}
                valda={ogillar}
                onChange={setOgillar}
              />
              <Notis ton="varning" titel="Om allergier">
                Appen filtrerar recept, men City Gross anger sällan allergener för sina produkter.
                Kontrollera alltid förpackningen. Appen är inget allergiskydd.
              </Notis>
            </div>
          ) : null}

          {steg === 3 ? (
            <TextField
              label="Veckobudget för mat"
              hint="I kronor. Lämna tomt om du inte vill följa någon budget."
              type="number"
              min={0}
              step={50}
              inputMode="numeric"
              placeholder="900"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          ) : null}

          {steg === 4 ? (
            <SelectField
              label="Vilken butik handlar du i?"
              hint="Priser och lagerstatus hämtas för den valda butiken."
              value={butik}
              onChange={(event) => setButik(event.target.value)}
            >
              {(butiker ?? []).map((store) => (
                <option key={store.store_number} value={store.store_number}>
                  {store.name} — {store.city}
                </option>
              ))}
            </SelectField>
          ) : null}

          {steg === 5 ? (
            <div className="space-y-4">
              <Valjare
                beskrivning="Vad har du redan hemma? Kryssa i det som brukar finnas, så slipper du se det på varje inköpslista."
                alternativ={SKAFFERIFORSLAG}
                etikettFor={(id) => INGREDIENTS[id]?.name ?? id}
                valda={harHemma}
                onChange={setHarHemma}
              />
              <p className="text-xs text-[var(--text-dampad)]">
                Det går bra att hoppa över. Skafferiet fylls i efterhand.
              </p>
            </div>
          ) : null}

          {fel ? (
            <Notis ton="fel" className="mt-4">
              {fel}
            </Notis>
          ) : null}

          <div className="mt-6 flex gap-3">
            {steg > 0 ? (
              <Button variant="secondary" onClick={() => setSteg((s) => s - 1)}>
                Tillbaka
              </Button>
            ) : null}
            {sista ? (
              <Button
                full
                size="lg"
                disabled={slutfor.isPending}
                onClick={() => slutfor.mutate()}
              >
                {slutfor.isPending ? 'Registrerar…' : 'Skapa min första veckomeny'}
              </Button>
            ) : (
              <Button full size="lg" onClick={() => setSteg((s) => s + 1)}>
                Nästa
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </main>
  )
}

function Valjare({
  beskrivning,
  alternativ,
  valda,
  onChange,
  etikettFor,
}: {
  beskrivning: string
  alternativ: string[]
  valda: string[]
  onChange: (nasta: string[]) => void
  etikettFor?: (value: string) => string
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm text-[var(--text-dampad)]">{beskrivning}</legend>
      <div className="flex flex-wrap gap-2">
        {alternativ.map((value) => {
          const aktiv = valda.includes(value)
          return (
            <button
              key={value}
              type="button"
              aria-pressed={aktiv}
              onClick={() =>
                onChange(aktiv ? valda.filter((item) => item !== value) : [...valda, value])
              }
              className={cn(
                'min-h-11 rounded-lg border px-3 text-sm transition-colors',
                aktiv
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--kant)] hover:bg-[var(--yta-dampad)]',
              )}
            >
              {etikettFor ? etikettFor(value) : value}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
