import { AlertTriangle, Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../../lib/utils.ts'

export function Spinner({ className, label = 'Laddar' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

type Ton = 'neutral' | 'positiv' | 'varning' | 'fel' | 'okand'

const tonKlass: Record<Ton, string> = {
  neutral: 'bg-[var(--yta-dampad)] text-[var(--text-dampad)] border-[var(--kant)]',
  positiv: 'bg-[color-mix(in_oklch,var(--color-tall)_14%,transparent)] text-[var(--color-tall)] border-transparent',
  varning: 'bg-[color-mix(in_oklch,var(--color-senap)_20%,transparent)] text-[var(--text)] border-transparent',
  fel: 'bg-[color-mix(in_oklch,var(--color-lingon)_14%,transparent)] text-[var(--color-lingon)] border-transparent',
  okand: 'bg-[var(--yta-dampad)] text-[var(--text-dampad)] border-dashed border-[var(--kant)]',
}

export function Badge({
  children,
  ton = 'neutral',
  className,
}: {
  children: ReactNode
  ton?: Ton
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
        tonKlass[ton],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Meddelanderuta.
 *
 * Varningar om osäkra priser, saknad produkt eller okänd allergiinformation
 * formuleras alltid rakt. Skämtet i appen får aldrig göra en varning otydlig.
 */
export function Notis({
  ton = 'neutral',
  titel,
  children,
  className,
}: {
  ton?: Ton
  titel?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const Ikon = ton === 'fel' || ton === 'varning' ? AlertTriangle : Info
  return (
    <div
      role={ton === 'fel' ? 'alert' : undefined}
      className={cn('flex gap-2.5 rounded-lg border p-3 text-sm', tonKlass[ton], className)}
    >
      <Ikon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {titel ? <p className="font-medium">{titel}</p> : null}
        {children ? <div className={cn(titel && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  )
}

/**
 * Tomt läge.
 *
 * Här får den torra myndighetstonen finnas - det är ett ställe där användaren
 * har tid att lägga märke till den, och ingenting går sönder om den missas.
 */
export function TomtLage({
  rubrik,
  beskrivning,
  action,
  className,
}: {
  rubrik: string
  beskrivning?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-[var(--kant)] px-6 py-10 text-center',
        className,
      )}
    >
      <p className="font-medium">{rubrik}</p>
      {beskrivning ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-dampad)]">{beskrivning}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

/** Helsidesladdning. */
export function SidLaddning({ text = 'Ärendet bereds.' }: { text?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[var(--text-dampad)]">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <p className="text-sm" role="status">
        {text}
      </p>
    </div>
  )
}
