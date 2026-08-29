import {
  CalendarDays,
  ChefHat,
  LayoutDashboard,
  Menu,
  Package,
  ShoppingCart,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { cn } from '../lib/utils.ts'
import { useAuth } from '../features/auth/auth-context.ts'

interface NavPost {
  till: string
  etikett: string
  Ikon: typeof LayoutDashboard
}

/**
 * Navigationen är rakt och praktiskt formulerad. Skämtet i appen bor i namnet
 * och i tomma lägen — inte här, där man ska hitta snabbt.
 */
const HUVUDNAV: NavPost[] = [
  { till: '/', etikett: 'Översikt', Ikon: LayoutDashboard },
  { till: '/vecka', etikett: 'Min vecka', Ikon: CalendarDays },
  { till: '/inkopslista', etikett: 'Inköpslista', Ikon: ShoppingCart },
  { till: '/recept', etikett: 'Recept', Ikon: ChefHat },
  { till: '/skafferi', etikett: 'Skafferi', Ikon: Package },
]

const OVRIGNAV: { till: string; etikett: string }[] = [
  { till: '/erbjudanden', etikett: 'Veckans fynd' },
  { till: '/historik', etikett: 'Historik' },
  { till: '/installningar', etikett: 'Inställningar' },
]

export function Layout({ visaAdmin }: { visaAdmin: boolean }) {
  const [menyOppen, setMenyOppen] = useState(false)
  const { loggaUt } = useAuth()

  const ovriga = visaAdmin
    ? [...OVRIGNAV, { till: '/admin', etikett: 'Diagnostik och tillsyn' }]
    : OVRIGNAV

  return (
    <div className="min-h-dvh">
      <a href="#innehall" className="hoppa-lank">
        Hoppa till innehållet
      </a>

      <header className="sticky top-0 z-20 border-b border-[var(--kant)] bg-[var(--yta)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-dampad)]">
              Departementet för
            </p>
            <p className="truncate text-lg font-semibold leading-tight">middagsfrågor</p>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Huvudnavigering">
            {HUVUDNAV.map(({ till, etikett }) => (
              <SkrivbordsLank key={till} till={till}>
                {etikett}
              </SkrivbordsLank>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setMenyOppen((open) => !open)}
            aria-expanded={menyOppen}
            aria-label={menyOppen ? 'Stäng meny' : 'Öppna meny'}
            className="flex size-11 items-center justify-center rounded-lg hover:bg-[var(--yta-dampad)]"
          >
            {menyOppen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {menyOppen ? (
          <div className="border-t border-[var(--kant)] bg-[var(--yta)]">
            <div className="mx-auto max-w-4xl px-4 py-2">
              <nav aria-label="Övriga sidor" className="grid gap-1">
                <div className="grid gap-1 md:hidden">
                  {HUVUDNAV.map(({ till, etikett }) => (
                    <MenyLank key={till} till={till} onClick={() => setMenyOppen(false)}>
                      {etikett}
                    </MenyLank>
                  ))}
                  <hr className="my-1 border-[var(--kant)]" />
                </div>
                {ovriga.map(({ till, etikett }) => (
                  <MenyLank key={till} till={till} onClick={() => setMenyOppen(false)}>
                    {etikett}
                  </MenyLank>
                ))}
                <hr className="my-1 border-[var(--kant)]" />
                <button
                  type="button"
                  onClick={() => {
                    setMenyOppen(false)
                    void loggaUt()
                  }}
                  className="flex min-h-11 items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--yta-dampad)]"
                >
                  Logga ut
                </button>
              </nav>
            </div>
          </div>
        ) : null}
      </header>

      <main id="innehall" className="mx-auto max-w-4xl px-4 pt-5 pb-24 md:pb-10">
        <Outlet />
      </main>

      {/* Fast navigering längst ned på mobil — tummen når hit. */}
      <nav
        aria-label="Snabbnavigering"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--kant)] bg-[var(--yta)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto flex max-w-4xl">
          {HUVUDNAV.map(({ till, etikett, Ikon }) => (
            <li key={till} className="flex-1">
              <NavLink
                to={till}
                end={till === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                    isActive ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-dampad)]',
                  )
                }
              >
                <Ikon className="size-5" aria-hidden />
                <span>{etikett}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function SkrivbordsLank({ till, children }: { till: string; children: ReactNode }) {
  return (
    <NavLink
      to={till}
      end={till === '/'}
      className={({ isActive }) =>
        cn(
          'rounded-lg px-3 py-2 text-sm',
          isActive
            ? 'bg-[var(--yta-dampad)] font-medium text-[var(--text)]'
            : 'text-[var(--text-dampad)] hover:bg-[var(--yta-dampad)]',
        )
      }
    >
      {children}
    </NavLink>
  )
}

function MenyLank({
  till,
  children,
  onClick,
}: {
  till: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <NavLink
      to={till}
      end={till === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center rounded-lg px-3 text-sm',
          isActive ? 'bg-[var(--yta-dampad)] font-medium' : 'hover:bg-[var(--yta-dampad)]',
        )
      }
    >
      {children}
    </NavLink>
  )
}

/** Sidrubrik med valfri åtgärd till höger. */
export function SidHuvud({
  rubrik,
  underrubrik,
  action,
}: {
  rubrik: string
  underrubrik?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{rubrik}</h1>
        {underrubrik ? (
          <p className="mt-1 text-sm text-[var(--text-dampad)]">{underrubrik}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
