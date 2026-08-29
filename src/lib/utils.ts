import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Slår ihop klassnamn och låter senare Tailwind-klasser vinna. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Kronor på svenskt vis: 1 234,50 kr. */
export function formatKr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '- kr'
  return `${value.toLocaleString('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr`
}

/** Kronor utan ören, för summor där precisionen ändå är en uppskattning. */
export function formatKrRound(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '- kr'
  return `${Math.round(value).toLocaleString('sv-SE')} kr`
}

/** "45 min" eller "1 h 15 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
