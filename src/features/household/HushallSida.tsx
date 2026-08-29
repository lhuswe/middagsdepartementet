import { Check, Copy, LogOut, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useState } from 'react'

import { SidHuvud } from '../../components/Layout.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Badge, Notis, SidLaddning } from '../../components/ui/feedback.tsx'
import { TextField } from '../../components/ui/form.tsx'
import { useAuth } from '../auth/auth-context.ts'
import {
  useHushall,
  useHushallsallergier,
  useHushallsmedlemskap,
  useInbjudningar,
  useMedlemmar,
} from '../../hooks/useHushall.ts'

/**
 * Hushållet: vilka som delar mat, och hur man bjuder in fler.
 *
 * Sidan visar också medlemmarnas allergier. Det är avsiktligt: matsedeln utgår
 * från allas allergier, och då ska det synas vems de är i stället för att bara
 * tyst påverka vad som föreslås.
 */
export function HushallSida() {
  const { user } = useAuth()
  const { hushall, saknarHushall, isLoading } = useHushall()

  if (isLoading) return <SidLaddning />
  if (saknarHushall || !hushall) return <UtanHushall />

  return (
    <>
      <SidHuvud
        rubrik={hushall.name}
        underrubrik="Alla i hushållet delar matsedel, inköpslista, skafferi och recept."
      />
      <div className="space-y-4">
        <Medlemslista />
        <Inbjudningar hushallId={hushall.id} userId={user?.id ?? ''} />
        <Lamna />
      </div>
    </>
  )
}

/** För den som ännu inte hör till något hushåll, eller nyss lämnat sitt. */
function UtanHushall() {
  const { skapa, gaMed } = useHushallsmedlemskap()
  const [namn, setNamn] = useState('')
  const [kod, setKod] = useState('')

  const fel = skapa.error ?? gaMed.error

  return (
    <>
      <SidHuvud rubrik="Hushåll" />

      {fel ? (
        <Notis ton="fel" className="mb-4">
          {fel instanceof Error ? fel.message : 'Något gick fel.'}
        </Notis>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody className="space-y-3 pt-4">
            <h2 className="font-semibold">Skapa ett hushåll</h2>
            <p className="text-sm text-[var(--text-dampad)]">
              Börja på egen hand och bjud in fler när du vill.
            </p>
            <TextField
              label="Namn"
              placeholder="Familjen"
              value={namn}
              onChange={(event) => setNamn(event.target.value)}
            />
            <Button full disabled={skapa.isPending} onClick={() => skapa.mutate(namn)}>
              {skapa.isPending ? 'Skapar…' : 'Skapa hushåll'}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3 pt-4">
            <h2 className="font-semibold">Gå med i ett hushåll</h2>
            <p className="text-sm text-[var(--text-dampad)]">
              Med en inbjudningskod från någon som redan är med.
            </p>
            <TextField
              label="Inbjudningskod"
              value={kod}
              onChange={(event) => setKod(event.target.value)}
            />
            <Button
              full
              variant="secondary"
              disabled={gaMed.isPending || kod.trim().length < 8}
              onClick={() => gaMed.mutate(kod)}
            >
              {gaMed.isPending ? 'Går med…' : 'Gå med'}
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function Medlemslista() {
  const { user } = useAuth()
  const { data: medlemmar, isLoading } = useMedlemmar()
  const { data: allergier } = useHushallsallergier()

  if (isLoading) return null

  return (
    <Card>
      <h2 className="border-b border-[var(--kant)] px-4 py-2.5 font-semibold">
        Medlemmar ({medlemmar?.length ?? 0})
      </h2>
      <ul>
        {(medlemmar ?? []).map((medlem) => (
          <li
            key={medlem.userId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--kant)] px-4 py-3 first:border-t-0"
          >
            <span className="font-medium">
              {medlem.namn ?? 'Namnlös'}
              {medlem.userId === user?.id ? (
                <span className="text-[var(--text-dampad)]"> (du)</span>
              ) : null}
            </span>
            {medlem.roll === 'owner' ? <Badge>ägare</Badge> : null}
            <span className="text-xs text-[var(--text-dampad)]">
              med sedan {format(parseISO(medlem.medSedan), 'd MMM yyyy', { locale: sv })}
            </span>
            {medlem.allergier.length > 0 ? (
              <span className="w-full text-xs text-[var(--text-dampad)]">
                Allergier: {medlem.allergier.join(', ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <CardBody className="pt-3">
        {allergier && allergier.length > 0 ? (
          <Notis ton="varning" titel="Hushållets allergier">
            Matsedeln undviker {allergier.join(', ')}, eftersom en rätt som är olämplig för en
            medlem är olämplig för måltiden. Appen kontrollerar aldrig produkternas innehåll åt
            dig.
          </Notis>
        ) : (
          <p className="text-sm text-[var(--text-dampad)]">
            Ingen har registrerat några allergier. Var och en anger sina egna under Inställningar.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function Inbjudningar({ hushallId, userId }: { hushallId: string; userId: string }) {
  const { data: inbjudningar, skapa, aterkalla } = useInbjudningar()
  const [kopierad, setKopierad] = useState<string | null>(null)

  async function kopiera(kod: string) {
    try {
      await navigator.clipboard.writeText(kod)
      setKopierad(kod)
      window.setTimeout(() => setKopierad(null), 2000)
    } catch {
      // Urklipp kan vara blockerat. Koden syns ändå på skärmen.
    }
  }

  return (
    <Card>
      <h2 className="border-b border-[var(--kant)] px-4 py-2.5 font-semibold">Bjud in</h2>
      <CardBody className="space-y-3 pt-3">
        <p className="text-sm text-[var(--text-dampad)]">
          Skapa en kod och ge den till den du vill bjuda in. Koden gäller i sju dagar och kan bara
          användas en gång.
        </p>

        {(inbjudningar ?? []).length === 0 ? (
          <p className="text-sm text-[var(--text-dampad)]">Inga aktiva inbjudningar.</p>
        ) : (
          <ul className="space-y-2">
            {(inbjudningar ?? []).map((inbjudan) => (
              <li
                key={inbjudan.code}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--kant)] px-3 py-2"
              >
                <code className="font-mono text-sm break-all">{inbjudan.code}</code>
                <span className="text-xs text-[var(--text-dampad)]">
                  gäller t.o.m.{' '}
                  {format(parseISO(inbjudan.expires_at), 'd MMM', { locale: sv })}
                </span>
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Kopiera koden"
                    onClick={() => void kopiera(inbjudan.code)}
                  >
                    {kopierad === inbjudan.code ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Återkalla inbjudan"
                    onClick={() => aterkalla.mutate(inbjudan.code)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="secondary"
          disabled={skapa.isPending}
          onClick={() => skapa.mutate({ id: hushallId, userId })}
        >
          <Plus className="size-4" aria-hidden />
          {skapa.isPending ? 'Skapar…' : 'Skapa inbjudningskod'}
        </Button>
      </CardBody>
    </Card>
  )
}

function Lamna() {
  const { lamna } = useHushallsmedlemskap()
  const [bekraftar, setBekraftar] = useState(false)

  return (
    <Card>
      <CardBody className="space-y-3 pt-4">
        <h2 className="font-semibold">Lämna hushållet</h2>

        {bekraftar ? (
          <>
            <Notis ton="fel" titel="Läs det här först">
              Recept, matsedel, skafferi och inköpslistor tillhör hushållet och följer inte med
              dig. De blir kvar hos de andra medlemmarna. Lämnar du som ensam medlem blir de
              oåtkomliga.
            </Notis>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={lamna.isPending} onClick={() => lamna.mutate()}>
                <TriangleAlert className="size-4" aria-hidden />
                {lamna.isPending ? 'Lämnar…' : 'Ja, lämna hushållet'}
              </Button>
              <Button variant="ghost" onClick={() => setBekraftar(false)}>
                Avbryt
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-dampad)]">
              Du kan lämna hushållet och skapa ett eget, eller gå med i ett annat.
            </p>
            <Button variant="secondary" onClick={() => setBekraftar(true)}>
              <LogOut className="size-4" aria-hidden />
              Lämna hushållet
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  )
}
