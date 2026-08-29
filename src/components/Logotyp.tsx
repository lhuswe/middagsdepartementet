import { cn } from '../lib/utils.ts'

/**
 * Departementets märke: en tallrik sedd uppifrån med en gaffel över.
 *
 * Samma motiv som flikikonen och hemskärmsikonen, men inlagt som SVG i stället
 * för att laddas som fil. Det ger två saker: färgerna följer temat, och märket
 * finns redan när sidan ritas i stället för efter en extra hämtning.
 *
 * Motivet är också definierat i `scripts/generate-icons.ts`, som genererar
 * PNG-ikonerna. Ändras det ena bör det andra ändras med, annars glider
 * flikikonen och logotypen isär.
 */
export function Logotyp({
  storlek = 32,
  className,
}: {
  storlek?: number
  className?: string
}) {
  return (
    <svg
      width={storlek}
      height={storlek}
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="var(--accent-text)" strokeWidth="4" />
      <rect x="30" y="14" width="4" height="36" fill="var(--accent-text)" />
      <rect x="22" y="14" width="4" height="14" fill="var(--accent-text)" />
      <rect x="38" y="14" width="4" height="14" fill="var(--accent-text)" />
    </svg>
  )
}

/**
 * Märket tillsammans med namnet.
 *
 * `aria-hidden` på själva märket gör att skärmläsare läser namnet en gång, inte
 * två. Rubriknivån lämnas åt anropande sida.
 */
export function Ordmarke({
  storlek = 32,
  className,
}: {
  storlek?: number
  className?: string
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Logotyp storlek={storlek} />
      <span className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-dampad)]">
          Departementet för
        </span>
        <span className="block truncate text-lg font-semibold leading-tight">middagsfrågor</span>
      </span>
    </span>
  )
}
