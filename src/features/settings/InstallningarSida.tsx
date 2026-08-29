import { useState } from 'react'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { SelectField, TextField } from '../../components/ui/form.tsx'
import { useAuth } from '../auth/auth-context.ts'
import { useButiker, useProfil, useSparaProfil } from '../../hooks/useProfil.ts'
import { supabase } from '../../lib/supabase.ts'
import type { ProfileRow } from '../../types/database.ts'
import { cn } from '../../lib/utils.ts'

const ALLERGIER = ['gluten', 'laktos', 'mjölk', 'ägg', 'nötter', 'jordnötter', 'soja', 'fisk', 'skaldjur']
const OGILLAR = ['broccoli', 'lax', 'svamp', 'lever', 'kål', 'ärter', 'oliver', 'koriander']

export function InstallningarSida() {
  const { profil, isLoading } = useProfil()

  if (isLoading || !profil) return <SidLaddning />

  // Formuläret ligger i en egen komponent som får profilen som prop, så att
  // utkastet kan initieras direkt i useState. Att i stället fylla i det från en
  // effekt hade orsakat en extra rendering vid varje laddning, utan att lösa
  // något - profilen är inget externt system som behöver synkroniseras.
  return <InstallningarFormular profil={profil} key={profil.id} />
}

function InstallningarFormular({ profil }: { profil: ProfileRow }) {
  const { user, loggaUt } = useAuth()
  const spara = useSparaProfil()
  const { data: butiker } = useButiker()

  const [utkast, setUtkast] = useState<Record<string, unknown>>(() => ({
    display_name: profil.display_name ?? '',
    adults: profil.adults,
    children: profil.children,
    servings_per_meal: profil.servings_per_meal,
    max_cooking_minutes: profil.max_cooking_minutes ?? 45,
    weekly_budget: profil.weekly_budget ?? '',
    store_number: profil.store_number ?? '',
    allergies: profil.allergies,
    dislikes: profil.dislikes,
    is_member: profil.is_member,
    assume_staples_available: profil.assume_staples_available,
    repetition_avoidance: profil.repetition_avoidance,
  }))
  const [nyttLosenord, setNyttLosenord] = useState('')
  const [losenordsbesked, setLosenordsbesked] = useState<string | null>(null)

  const satt = (nyckel: string, varde: unknown) =>
    setUtkast((tidigare) => ({ ...tidigare, [nyckel]: varde }))

  const vaxla = (nyckel: 'allergies' | 'dislikes', varde: string) => {
    const lista = (utkast[nyckel] as string[]) ?? []
    satt(nyckel, lista.includes(varde) ? lista.filter((item) => item !== varde) : [...lista, varde])
  }

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
            <h2 className="font-semibold">Hushållet</h2>

            <TextField
              label="Namn"
              hint="Används bara i hälsningen på översikten."
              value={String(utkast.display_name ?? '')}
              onChange={(event) => satt('display_name', event.target.value)}
            />

            <div className="grid grid-cols-3 gap-3">
              <TextField
                label="Vuxna"
                type="number"
                min={0}
                value={Number(utkast.adults)}
                onChange={(event) => satt('adults', Number(event.target.value))}
              />
              <TextField
                label="Barn"
                type="number"
                min={0}
                value={Number(utkast.children)}
                onChange={(event) => satt('children', Number(event.target.value))}
              />
              <TextField
                label="Portioner"
                hint="Per måltid."
                type="number"
                min={1}
                value={Number(utkast.servings_per_meal)}
                onChange={(event) => satt('servings_per_meal', Number(event.target.value))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Längsta tillagningstid"
                hint="Minuter."
                type="number"
                min={10}
                step={5}
                value={Number(utkast.max_cooking_minutes)}
                onChange={(event) => satt('max_cooking_minutes', Number(event.target.value))}
              />
              <TextField
                label="Veckobudget"
                hint="Kronor. Lämna tomt för ingen budget."
                type="number"
                min={0}
                step={50}
                value={String(utkast.weekly_budget ?? '')}
                onChange={(event) => satt('weekly_budget', event.target.value)}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-4 pt-4">
            <h2 className="font-semibold">Butik och priser</h2>

            <SelectField
              label="Butik"
              hint="Priser och lagerstatus hämtas för den valda butiken."
              value={String(utkast.store_number)}
              onChange={(event) => satt('store_number', event.target.value)}
              required
            >
              <option value="">Välj butik...</option>
              {(butiker ?? []).map((store) => (
                <option key={store.store_number} value={store.store_number}>
                  {store.name} - {store.city}
                </option>
              ))}
            </SelectField>

            <Kryssrad
              etikett="Jag är medlem i kundklubben"
              hint="Medlemspriser räknas bara in när det här är ikryssat - annars blir uppskattningen för låg."
              vardet={Boolean(utkast.is_member)}
              onChange={(varde) => satt('is_member', varde)}
            />

            <Kryssrad
              etikett="Anta att skafferivaror finns hemma"
              hint="Salt, mjöl, olja och kryddor utelämnas från inköpslistan om du inte anger något annat i skafferiet."
              vardet={Boolean(utkast.assume_staples_available)}
              onChange={(varde) => satt('assume_staples_available', varde)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-4 pt-4">
            <h2 className="font-semibold">Mat</h2>

            <SelectField
              label="Undvik upprepning"
              hint="Hur länge en rätt hålls borta efter att den lagats."
              value={String(utkast.repetition_avoidance)}
              onChange={(event) => satt('repetition_avoidance', event.target.value)}
            >
              <option value="low">Låg - en vecka</option>
              <option value="medium">Medel - tre veckor</option>
              <option value="high">Hög - sex veckor</option>
            </SelectField>

            <MarkeraFalt
              rubrik="Allergier"
              beskrivning="Behandlas som hårda villkor. Rätter med dessa råvaror föreslås aldrig."
              alternativ={ALLERGIER}
              valda={(utkast.allergies as string[]) ?? []}
              onVaxla={(varde) => vaxla('allergies', varde)}
            />

            <MarkeraFalt
              rubrik="Ogillar"
              beskrivning="Rätter där råvaran är obligatorisk väljs bort."
              alternativ={OGILLAR}
              valda={(utkast.dislikes as string[]) ?? []}
              onVaxla={(varde) => vaxla('dislikes', varde)}
            />

            <Notis ton="varning" titel="Om allergier">
              City Gross anger sällan allergener för sina produkter. Appen markerar sådana varor som
              okända och kontrollerar dem aldrig åt dig. Läs alltid förpackningen.
            </Notis>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={spara.isPending}
            onClick={() =>
              spara.mutate({
                display_name: String(utkast.display_name) || null,
                adults: Number(utkast.adults),
                children: Number(utkast.children),
                servings_per_meal: Number(utkast.servings_per_meal),
                max_cooking_minutes: Number(utkast.max_cooking_minutes),
                weekly_budget: utkast.weekly_budget === '' ? null : Number(utkast.weekly_budget),
                store_number: String(utkast.store_number) || null,
                allergies: (utkast.allergies as string[]) ?? [],
                dislikes: (utkast.dislikes as string[]) ?? [],
                is_member: Boolean(utkast.is_member),
                assume_staples_available: Boolean(utkast.assume_staples_available),
                repetition_avoidance: utkast.repetition_avoidance as 'low' | 'medium' | 'high',
              })
            }
          >
            {spara.isPending ? 'Sparar…' : 'Spara inställningar'}
          </Button>
          {spara.isSuccess ? <span className="self-center text-sm">Sparat.</span> : null}
        </div>

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
        className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
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
                'min-h-11 rounded-lg border px-3 text-sm',
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
