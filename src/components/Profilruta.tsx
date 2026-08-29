import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { useAuth } from '../features/auth/auth-context.ts'
import { cn } from '../lib/utils.ts'

/**
 * Profilruta med namn och avatar, som fäller ut de sidor som inte ryms i
 * huvudnavigeringen.
 *
 * Ersätter hamburgersymbolen. Skillnaden är inte bara utseende: en meny som
 * bara visar ett streck säger ingenting om vem som är inloggad, vilket är
 * precis vad man vill veta innan man loggar ut eller ändrar inställningar.
 */
export function Profilruta({
  namn,
  epost,
  lankar,
}: {
  namn: string | null
  epost: string | null
  lankar: { till: string; etikett: string }[]
}) {
  const { loggaUt } = useAuth()
  const [oppen, setOppen] = useState(false)
  const behallare = useRef<HTMLDivElement>(null)

  const visningsnamn = namn?.trim() || epost?.split('@')[0] || 'Inloggad'

  useEffect(() => {
    if (!oppen) return

    const vidKlick = (handelse: MouseEvent) => {
      if (!behallare.current?.contains(handelse.target as Node)) setOppen(false)
    }
    const vidTangent = (handelse: KeyboardEvent) => {
      if (handelse.key === 'Escape') setOppen(false)
    }

    document.addEventListener('mousedown', vidKlick)
    document.addEventListener('keydown', vidTangent)
    return () => {
      document.removeEventListener('mousedown', vidKlick)
      document.removeEventListener('keydown', vidTangent)
    }
  }, [oppen])

  return (
    <div ref={behallare} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOppen((v) => !v)}
        aria-expanded={oppen}
        aria-haspopup="menu"
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--kant)] px-2 py-1',
          'transition-colors hover:bg-[var(--yta-dampad)]',
          oppen && 'bg-[var(--yta-dampad)]',
        )}
      >
        <Avatar namn={visningsnamn} />
        <span className="hidden max-w-32 truncate text-sm font-medium sm:block">
          {visningsnamn}
        </span>
        <ChevronDown
          className={cn('size-4 text-[var(--text-dampad)] transition-transform', oppen && 'rotate-180')}
          aria-hidden
        />
      </button>

      {oppen ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--kant)]',
            'bg-[var(--yta)] shadow-lg',
          )}
        >
          <div className="border-b border-[var(--kant)] px-3 py-2.5">
            <p className="truncate text-sm font-medium">{visningsnamn}</p>
            {epost ? (
              <p className="truncate text-xs text-[var(--text-dampad)]">{epost}</p>
            ) : null}
          </div>

          <nav className="p-1">
            {lankar.map(({ till, etikett }) => (
              <NavLink
                key={till}
                to={till}
                role="menuitem"
                onClick={() => setOppen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center rounded-lg px-2.5 text-sm',
                    isActive ? 'bg-[var(--yta-dampad)] font-medium' : 'hover:bg-[var(--yta-dampad)]',
                  )
                }
              >
                {etikett}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-[var(--kant)] p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOppen(false)
                void loggaUt()
              }}
              className="flex min-h-11 w-full cursor-pointer items-center rounded-lg px-2.5 text-left text-sm hover:bg-[var(--yta-dampad)]"
            >
              Logga ut
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Avatar av initialer.
 *
 * Ingen bild lagras. Initialer räcker för att skilja personer åt i ett hushåll,
 * och slipper både uppladdning, lagring och en till sak som kan gå sönder.
 */
function Avatar({ namn }: { namn: string }) {
  const initialer = namn
    .split(/\s+/)
    .slice(0, 2)
    .map((del) => del.charAt(0).toLocaleUpperCase('sv'))
    .join('')

  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-text)]"
    >
      {initialer || '?'}
    </span>
  )
}
