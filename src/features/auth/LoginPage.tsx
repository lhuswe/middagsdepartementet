import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'

import { Button } from '../../components/ui/button.tsx'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Notis } from '../../components/ui/feedback.tsx'
import { TextField } from '../../components/ui/form.tsx'
import { appUrl, supabase } from '../../lib/supabase.ts'
import { useAuth } from './auth-context.ts'

type Lage = 'losenord' | 'magisk-lank' | 'aterstall'

const rubriker: Record<Lage, string> = {
  losenord: 'Logga in',
  'magisk-lank': 'Logga in med länk',
  aterstall: 'Återställ lösenord',
}

export function LoginPage() {
  const { session, laddar } = useAuth()
  const [lage, setLage] = useState<Lage>('losenord')
  const [epost, setEpost] = useState('')
  const [losenord, setLosenord] = useState('')
  const [arbetar, setArbetar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [klart, setKlart] = useState<string | null>(null)

  if (!laddar && session) return <Navigate to="/" replace />

  async function skicka(event: FormEvent) {
    event.preventDefault()
    setArbetar(true)
    setFel(null)
    setKlart(null)

    try {
      if (lage === 'losenord') {
        const { error } = await supabase.auth.signInWithPassword({ email: epost, password: losenord })
        if (error) throw error
      } else if (lage === 'magisk-lank') {
        const { error } = await supabase.auth.signInWithOtp({
          email: epost,
          options: { emailRedirectTo: appUrl('/') },
        })
        if (error) throw error
        setKlart('En inloggningslänk är skickad. Kontrollera din e-post.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(epost, {
          redirectTo: appUrl('/installningar'),
        })
        if (error) throw error
        setKlart('Ett återställningsmeddelande är skickat, om adressen finns registrerad.')
      }
    } catch (error) {
      setFel(oversattFel(error))
    } finally {
      setArbetar(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <header className="mb-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--text-dampad)]">
          Departementet för
        </p>
        <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">middagsfrågor</h1>
        <p className="mt-2 text-sm text-[var(--text-dampad)]">
          Samordnad livsmedelsförsörjning för hushållet.
        </p>
      </header>

      <Card>
        <CardBody className="pt-4">
          <h2 className="mb-4 text-base font-semibold">{rubriker[lage]}</h2>

          <form onSubmit={skicka} className="space-y-4">
            <TextField
              label="E-postadress"
              type="email"
              autoComplete="email"
              required
              value={epost}
              onChange={(event) => setEpost(event.target.value)}
            />

            {lage === 'losenord' ? (
              <TextField
                label="Lösenord"
                type="password"
                autoComplete="current-password"
                required
                value={losenord}
                onChange={(event) => setLosenord(event.target.value)}
              />
            ) : null}

            {fel ? <Notis ton="fel">{fel}</Notis> : null}
            {klart ? <Notis ton="positiv">{klart}</Notis> : null}

            <Button type="submit" full size="lg" disabled={arbetar}>
              {arbetar ? 'Behandlar…' : rubriker[lage]}
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            {lage !== 'losenord' ? (
              <button type="button" className="underline" onClick={() => setLage('losenord')}>
                Logga in med lösenord
              </button>
            ) : null}
            {lage !== 'magisk-lank' ? (
              <button type="button" className="underline" onClick={() => setLage('magisk-lank')}>
                Skicka inloggningslänk
              </button>
            ) : null}
            {lage !== 'aterstall' ? (
              <button type="button" className="underline" onClick={() => setLage('aterstall')}>
                Glömt lösenord
              </button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <p className="mt-6 text-center text-xs text-[var(--text-dampad)]">
        Konton skapas av departementet. Har du inget konto? Registrera dig i Supabase-projektets
        Auth-vy, eller be den som satt upp appen om en inbjudan.
      </p>
    </main>
  )
}

/** Supabase svarar på engelska. Användaren gör inte det. */
function oversattFel(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid login credentials/i.test(message)) return 'Fel e-postadress eller lösenord.'
  if (/email not confirmed/i.test(message)) return 'E-postadressen är inte bekräftad än.'
  if (/rate limit|too many/i.test(message)) return 'För många försök. Vänta en stund och prova igen.'
  if (/failed to fetch|network/i.test(message)) return 'Ingen kontakt med servern. Kontrollera din uppkoppling.'
  return `Något gick fel: ${message}`
}
