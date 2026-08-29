import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { SelectField, TextField } from '../../components/ui/form.tsx'
import { useAuth } from '../auth/auth-context.ts'
import { useHushall, useSparaHushall } from '../../hooks/useHushall.ts'
import { useButiker, useProfil, useSparaProfil } from '../../hooks/useProfil.ts'
import { supabase } from '../../lib/supabase.ts'
import type { HouseholdRow, ProfileRow } from '../../types/database.ts'
import { cn } from '../../lib/utils.ts'

const ALLERGIER = ['gluten', 'laktos', 'mjölk', 'ägg', 'nötter', 'jordnötter', 'soja', 'fisk', 'skaldjur']
const OGILLAR = ['broccoli', 'lax', 'svamp', 'lever', 'kål', 'ärter', 'oliver', 'koriander']

/**
 * Inställningar, uppdelade efter vem de tillhör.
 *
 * Uppdelningen är inte kosmetisk. Hushållets inställningar påverkar alla som
 * äter, medan allergier och smak följer personen. Att blanda ihop dem i ett
 * formulär hade gjort det oklart vad ens egen ändring får för konsekvenser för
 * andra.
 */
export function InstallningarSida() {
  const { profil, isLoading: profilLaddar } = useProfil()
  const { hushall, isLoading: hushallLaddar } = useHushall()

  if (profilLaddar || hushallLaddar || !profil) return <SidLaddning />

  return <Formular profil={profil} hushall={hushall} key={profil.id} />
}

function Formular({ profil, hushall }: { profil: ProfileRow; hushall: HouseholdRow | null }) {
  const { user, loggaUt } = useAuth()
  const sparaProfil = useSparaProfil()
  const sparaHushall = useSparaHushall()
  const { data: butiker } = useButiker()

  const [namn, setNamn] = useState(profil.display_name ?? '')
  const [allergier, setAllergier] = useState<string[]>(profil.allergies)
  const [ogillar, setOgillar] = useState<string[]>(profil.dislikes)

  const [h, setH] = useState(() => ({
    name: hushall?.name ?? 'Hushållet',
    store_number: hushall?.store_number ?? '',
    adults: hushall?.adults ?? 2,
    children: hushall?.children ?? 0,
    servings_per_meal: hushall?.servings_per_meal ?? 2,
    max_cooking_minutes: hushall?.max_cooking_minutes ?? 45,
    weekly_budget: String(hushall?.weekly_budget ?? ''),
    is_member: hushall?.is_member ?? false,
    assume_staples_available: hushall?.assume_staples_available ?? true,
    repetition_avoidance: hushall?.repetition_avoidance ?? 'medium',
  }))

  const [nyttLosenord, setNyttLosenord] = useState('')
  const [losenordsbesked, setLosenordsbesked] = useState<string | null>(null)

  const sattH = (nyckel: string, varde: unknown) => setH((f) => ({ ...f, [nyckel]: varde }))

  const vaxla = (lista: string[], satt: (n: string[]) => void, varde: string) =>
    satt(lista.includes(varde) ? lista.filter((item) => item !== varde) : [...lista, varde])

  async function bytLosenord() {
    setLosenordsbesked(null)
    const { error } = await supabase.auth.updateUser({ password: nyttLosenord })
    setLosenordsbesked(error ? `Kunde inte ändra lösenord: ${error.message}` : 'Lösenordet är ändrat.')
    if (!error) setNyttLosenord('')
  }

  return (
    <>
      <SidHuvud rubrik="Inställningar" underrubrik={user?.email ?? undefined} />

      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4 pt-4">
            <div>
              <h2 className="font-semibold">Mitt</h2>
              <p className="text-sm text-[var(--text-dampad)]">
                Gäller bara dig, även när maten är gemensam.
              </p>
            </div>

            <TextField
              label="Namn"
              hint="Visas i hushållet och i hälsningen på översikten."
              value={namn}
              onChange={(event) => setNamn(event.target.value)}
            />

            <MarkeraFalt
              rubrik="Mina allergier"
              beskrivning="Hårda villkor. Matsedeln utgår från allas allergier i hushållet, så din markering påverkar vad alla får föreslaget."
              alternativ={ALLERGIER}
              valda={allergier}
              onVaxla={(v) => vaxla(allergier, setAllergier, v)}
            />

            <MarkeraFalt
              rubrik="Sådant jag inte tycker om"
              beskrivning="Viktas mjukare än allergier och utesluter inte en rätt för hela hushållet."
              alternativ={OGILLAR}
              valda={ogillar}
              onVaxla={(v) => vaxla(ogillar, setOgillar, v)}
            />

            <Notis ton="varning" titel="Om allergier">
              City Gross anger sällan allergener för sina produkter. Appen markerar sådana varor
              som okända och kontrollerar dem aldrig åt dig. Läs alltid förpackningen.
            </Notis>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={sparaProfil.isPending}
                onClick={() =>
                  sparaProfil.mutate({
                    display_name: namn.trim() || null,
                    allergies: allergier,
                    dislikes: ogillar,
                  })
                }
              >
                {sparaProfil.isPending ? 'Sparar…' : 'Spara mina inställningar'}
              </Button>
              {sparaProfil.isSuccess ? <span className="text-sm">Sparat.</span> : null}
            </div>
          </CardBody>
        </Card>

        {hushall ? (
          <Card>
            <CardBody className="space-y-4 pt-4">
              <div>
                <h2 className="font-semibold">Hushållet</h2>
                <p className="text-sm text-[var(--text-dampad)]">
                  Gäller alla som äter. Medlemmar och inbjudningar finns under{' '}
                  <Link to="/hushall" className="underline">
                    Hushåll
                  </Link>
                  .
                </p>
              </div>

              <TextField
                label="Hushållets namn"
                value={h.name}
                onChange={(event) => sattH('name', event.target.value)}
              />

              <div className="grid grid-cols-3 gap-3">
                <TextField
                  label="Vuxna"
                  type="number"
                  min={0}
                  value={h.adults}
                  onChange={(event) => sattH('adults', Number(event.target.value))}
                />
                <TextField
                  label="Barn"
                  type="number"
                  min={0}
                  value={h.children}
                  onChange={(event) => sattH('children', Number(event.target.value))}
                />
                <TextField
                  label="Portioner"
                  hint="Per måltid."
                  type="number"
                  min={1}
                  value={h.servings_per_meal}
                  onChange={(event) => sattH('servings_per_meal', Number(event.target.value))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Längsta tillagningstid"
                  hint="Minuter."
                  type="number"
                  min={10}
                  step={5}
                  value={h.max_cooking_minutes}
                  onChange={(event) => sattH('max_cooking_minutes', Number(event.target.value))}
                />
                <TextField
                  label="Veckobudget"
                  hint="Kronor. Lämna tomt för ingen budget."
                  type="number"
                  min={0}
                  step={50}
                  value={h.weekly_budget}
                  onChange={(event) => sattH('weekly_budget', event.target.value)}
                />
              </div>

              <SelectField
                label="Butik"
                hint="Priser och lagerstatus hämtas för den valda butiken."
                value={h.store_number}
                onChange={(event) => sattH('store_number', event.target.value)}
                required
              >
                <option value="">Välj butik...</option>
                {(butiker ?? []).map((store) => (
                  <option key={store.store_number} value={store.store_number}>
                    {store.name}, {store.city}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Undvik upprepning"
                hint="Hur länge en rätt hålls borta efter att den lagats."
                value={h.repetition_avoidance}
                onChange={(event) => sattH('repetition_avoidance', event.target.value)}
              >
                <option value="low">Låg, en vecka</option>
                <option value="medium">Medel, tre veckor</option>
                <option value="high">Hög, sex veckor</option>
              </SelectField>

              <Kryssrad
                etikett="Vi är medlemmar i kundklubben"
                hint="Medlemspriser räknas bara in när det här är ikryssat, annars blir uppskattningen för låg."
                vardet={h.is_member}
                onChange={(v) => sattH('is_member', v)}
              />

              <Kryssrad
                etikett="Anta att skafferivaror finns hemma"
                hint="Salt, mjöl, olja och kryddor utelämnas från inköpslistan om inget annat anges i skafferiet."
                vardet={h.assume_staples_available}
                onChange={(v) => sattH('assume_staples_available', v)}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={sparaHushall.isPending}
                  onClick={() =>
                    sparaHushall.mutate({
                      id: hushall.id,
                      andringar: {
                        name: h.name.trim() || 'Hushållet',
                        store_number: h.store_number || null,
                        adults: h.adults,
                        children: h.children,
                        servings_per_meal: h.servings_per_meal,
                        max_cooking_minutes: h.max_cooking_minutes,
                        weekly_budget: h.weekly_budget === '' ? null : Number(h.weekly_budget),
                        is_member: h.is_member,
                        assume_staples_available: h.assume_staples_available,
                        repetition_avoidance:
                          h.repetition_avoidance as HouseholdRow['repetition_avoidance'],
                      },
                    })
                  }
                >
                  {sparaHushall.isPending ? 'Sparar…' : 'Spara hushållets inställningar'}
                </Button>
                {sparaHushall.isSuccess ? <span className="text-sm">Sparat.</span> : null}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardBody className="space-y-3 pt-4">
            <h2 className="font-semibold">Konto</h2>
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                label="Nytt lösenord"
                type="password"
                autoComplete="new-password"
                value={nyttLosenord}
                onChange={(event) => setNyttLosenord(event.target.value)}
                className="min-w-52"
              />
              <Button variant="secondary" disabled={nyttLosenord.length < 8} onClick={bytLosenord}>
                Byt lösenord
              </Button>
            </div>
            {losenordsbesked ? <Notis ton="neutral">{losenordsbesked}</Notis> : null}
            <Button variant="secondary" onClick={() => void loggaUt()}>
              Logga ut
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function Kryssrad({
  etikett,
  hint,
  vardet,
  onChange,
}: {
  etikett: string
  hint?: string
  vardet: boolean
  onChange: (varde: boolean) => void
}) {
  return (
    <label className="flex gap-3">
      <input
        type="checkbox"
        checked={vardet}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{etikett}</span>
        {hint ? <span className="block text-xs text-[var(--text-dampad)]">{hint}</span> : null}
      </span>
    </label>
  )
}

function MarkeraFalt({
  rubrik,
  beskrivning,
  alternativ,
  valda,
  onVaxla,
}: {
  rubrik: string
  beskrivning: string
  alternativ: string[]
  valda: string[]
  onVaxla: (varde: string) => void
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{rubrik}</legend>
      <p className="mb-2 text-xs text-[var(--text-dampad)]">{beskrivning}</p>
      <div className="flex flex-wrap gap-2">
        {alternativ.map((varde) => {
          const aktiv = valda.includes(varde)
          return (
            <button
              key={varde}
              type="button"
              aria-pressed={aktiv}
              onClick={() => onVaxla(varde)}
              className={cn(
                'min-h-11 cursor-pointer rounded-lg border px-3 text-sm transition-colors',
                aktiv
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--kant)] hover:bg-[var(--yta-dampad)]',
              )}
            >
              {varde}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
