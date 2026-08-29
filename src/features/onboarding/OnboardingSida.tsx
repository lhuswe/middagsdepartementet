import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { SelectField, TextField } from '../../components/ui/form.tsx'
import { INGREDIENTS } from '../../domain/ingredients.ts'
import { useAuth } from '../auth/auth-context.ts'
import { useHushall, useHushallsmedlemskap, useSparaHushall } from '../../hooks/useHushall.ts'
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

type StegId = 'hushall' | 'gillar' | 'undviker' | 'budget' | 'butik' | 'skafferi'

const NAMN: Record<StegId, string> = {
  hushall: 'Hushållet',
  gillar: 'Vad ni gillar',
  undviker: 'Vad ni undviker',
  budget: 'Budget',
  butik: 'Butik',
  skafferi: 'Skafferiet',
}

/** Den som startar ett nytt hushåll ställer in allt. */
const STEG_NYTT: StegId[] = ['hushall', 'gillar', 'undviker', 'budget', 'butik', 'skafferi']

/**
 * Den som går med i ett befintligt hushåll får bara de personliga frågorna.
 *
 * Butik, budget, portioner och skafferi tillhör hushållet och är redan
 * ifyllda. Att fråga om dem igen hade inneburit att en ny medlem tyst skrev
 * över inställningar som någon annan gjort.
 */
const STEG_MEDLEM: StegId[] = ['gillar', 'undviker']

export function OnboardingSida() {
  const navigera = useNavigate()
  const { user } = useAuth()
  const { profil, isLoading } = useProfil()
  const { hushall, saknarHushall, isLoading: hushallLaddar } = useHushall()
  const sparaProfil = useSparaProfil()
  const sparaHushall = useSparaHushall()
  const { skapa, gaMed } = useHushallsmedlemskap()
  const { data: butiker } = useButiker()

  const [lage, setLage] = useState<'val' | 'skapa' | 'gamed'>('val')
  const [kod, setKod] = useState('')
  const [steg, setSteg] = useState(0)
  const [hushallsnamn, setHushallsnamn] = useState('')
  const [vuxna, setVuxna] = useState(2)
  const [barn, setBarn] = useState(0)
  const [maxTid, setMaxTid] = useState(45)
  const [gillar, setGillar] = useState<string[]>(['husmanskost', 'snabbt'])
  const [allergier, setAllergier] = useState<string[]>([])
  const [ogillar, setOgillar] = useState<string[]>([])
  const [budget, setBudget] = useState('')
  const [butik, setButik] = useState('')
  const [harHemma, setHarHemma] = useState<string[]>(['salt', 'socker', 'vetemjol', 'rapsolja'])
  const [fel, setFel] = useState<string | null>(null)

  const arMedlem = hushall !== null

  const slutfor = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Ingen inloggad användare.')

      // Snapshot: att skapa hushållet nollställer cachen längre ned, och då
      // hinner `arMedlem` bli sant innan mutationen är klar.
      const gickMedIBefintligt = arMedlem

      // Allergier och smak är personliga, även när maten är gemensam. De sparas
      // i båda fallen.
      const personligt = {
        allergies: allergier,
        dislikes: ogillar,
        diets: gillar.includes('vegetariskt') ? ['vegetariskt'] : [],
        onboarded_at: new Date().toISOString(),
      }

      if (gickMedIBefintligt) {
        await sparaProfil.mutateAsync(personligt)
        return 'medlem' as const
      }

      // Hushållet först: allt annat hänger på att det finns.
      const hushallId = await skapa.mutateAsync(hushallsnamn)

      await sparaHushall.mutateAsync({
        id: hushallId,
        andringar: {
          name: hushallsnamn.trim() || 'Hushållet',
          adults: vuxna,
          children: barn,
          servings_per_meal: Math.max(1, Math.round(vuxna + barn * 0.5)),
          max_cooking_minutes: maxTid,
          weekly_budget: budget === '' ? null : Number(budget),
          store_number: butik,
        },
      })

      await sparaProfil.mutateAsync(personligt)
      await importeraStartrecept(hushallId, user.id)

      // Skafferiet fylls med generösa mängder. Poängen är att slippa se salt
      // och mjöl på inköpslistan, inte att hålla exakt lager.
      for (const id of harHemma) {
        const ingredient = INGREDIENTS[id]
        if (!ingredient) continue
        await sparaSkafferipost(
          hushallId,
          id,
          ingredient.canonicalUnit === 'ml' ? 5 : 500,
          ingredient.canonicalUnit === 'ml' ? 'dl' : 'g',
        )
      }

      return 'nytt' as const
    },
    // En ny medlem ska inte generera om hushållets matsedel. Den finns redan.
    onSuccess: (typ) => navigera(typ === 'medlem' ? '/' : '/vecka?generera=1', { replace: true }),
    onError: (error: unknown) =>
      setFel(error instanceof Error ? error.message : 'Något gick fel vid registreringen.'),
  })

  if (isLoading || hushallLaddar) return <SidLaddning />
  if (profil?.onboarded_at && !saknarHushall) return <Navigate to="/" replace />

  if (!arMedlem && lage !== 'skapa') {
    return (
      <Ram
        rubrik="Välkommen. En fråga först."
        ingress="Delar du mat med någon som redan använder appen, eller börjar du på egen hand?"
      >
        {lage === 'val' ? (
          <Card>
            <CardBody className="space-y-3 pt-4">
              <Button full size="lg" onClick={() => setLage('skapa')}>
                Jag startar ett nytt hushåll
              </Button>
              <Button full size="lg" variant="secondary" onClick={() => setLage('gamed')}>
                Jag har en inbjudningskod
              </Button>
              <p className="pt-1 text-sm text-[var(--text-dampad)]">
                Ett hushåll delar matsedel, inköpslista, skafferi och recept. Allergier anger var
                och en för sig.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="space-y-4 pt-4">
              <TextField
                label="Inbjudningskod"
                hint="Skapas av någon som redan är med, under Hushåll."
                value={kod}
                onChange={(event) => setKod(event.target.value)}
              />
              {gaMed.error ? (
                <Notis ton="fel">
                  {gaMed.error instanceof Error ? gaMed.error.message : 'Koden gick inte att lösa in.'}
                </Notis>
              ) : null}
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setLage('val')}>
                  Tillbaka
                </Button>
                <Button
                  full
                  size="lg"
                  disabled={gaMed.isPending || kod.trim().length < 8}
                  onClick={() => gaMed.mutate(kod)}
                >
                  {gaMed.isPending ? 'Går med…' : 'Gå med'}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </Ram>
    )
  }

  const steglista = arMedlem ? STEG_MEDLEM : STEG_NYTT
  const aktivt = steglista[steg] ?? steglista[0]!
  const sista = steg === steglista.length - 1

  return (
    <Ram
      rubrik={arMedlem ? `Du är med i ${hushall.name}.` : 'Välkommen. Några uppgifter behövs.'}
      ingress={
        arMedlem
          ? 'Två frågor om dig. Hushållets inställningar är redan gjorda.'
          : 'Sex korta frågor. Allt går att ändra sedan under Inställningar.'
      }
    >
      <ol className="mb-5 flex gap-1.5" aria-label="Framsteg">
        {steglista.map((id, index) => (
          <li
            key={id}
            aria-current={index === steg ? 'step' : undefined}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index <= steg ? 'bg-[var(--accent)]' : 'bg-[var(--kant)]',
            )}
          >
            <span className="sr-only">{NAMN[id]}</span>
          </li>
        ))}
      </ol>

      <Card>
        <CardBody className="pt-4">
          <h2 className="mb-4 text-lg font-semibold">
            {steg + 1}. {NAMN[aktivt]}
          </h2>

          {aktivt === 'hushall' ? (
            <div className="space-y-4">
              <TextField
                label="Vad ska hushållet heta?"
                hint="Visas för alla som går med. Går att ändra sedan."
                placeholder="Familjen Hovland"
                value={hushallsnamn}
                onChange={(event) => setHushallsnamn(event.target.value)}
              />
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

          {aktivt === 'gillar' ? (
            <Valjare
              beskrivning="Vad lagar ni helst? Välj gärna flera."
              alternativ={SMAKTAGGAR}
              valda={gillar}
              onChange={setGillar}
            />
          ) : null}

          {aktivt === 'undviker' ? (
            <div className="space-y-6">
              <Valjare
                beskrivning="Allergier. Behandlas som hårda villkor - rätter med dessa föreslås aldrig."
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
              {arMedlem ? (
                <p className="text-sm text-[var(--text-dampad)]">
                  Dina allergier läggs till hushållets. Matsedeln undviker allt som någon medlem
                  är allergisk mot, och de andra kan se vad du angett.
                </p>
              ) : null}
            </div>
          ) : null}

          {aktivt === 'budget' ? (
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

          {aktivt === 'butik' ? (
            <SelectField
              label="Vilken butik handlar du i?"
              hint="Priser och lagerstatus hämtas för den valda butiken. Går att ändra sedan."
              value={butik}
              onChange={(event) => setButik(event.target.value)}
              required
            >
              <option value="">Välj butik...</option>
              {(butiker ?? []).map((store) => (
                <option key={store.store_number} value={store.store_number}>
                  {store.name} - {store.city}
                </option>
              ))}
            </SelectField>
          ) : null}

          {aktivt === 'skafferi' ? (
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
                {slutfor.isPending
                  ? 'Registrerar…'
                  : arMedlem
                    ? 'Klart'
                    : 'Skapa min första veckomeny'}
              </Button>
            ) : (
              <Button full size="lg" onClick={() => setSteg((s) => s + 1)}>
                Nästa
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </Ram>
  )
}

function Ram({
  rubrik,
  ingress,
  children,
}: {
  rubrik: string
  ingress: string
  children: ReactNode
}) {
  return (
    <main className="mx-auto max-w-lg px-4 py-8 pb-24">
      <header className="mb-6">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-dampad)]">
          Departementet för middagsfrågor
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{rubrik}</h1>
        <p className="mt-2 text-sm text-[var(--text-dampad)]">{ingress}</p>
      </header>
      {children}
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
