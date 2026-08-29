import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

import { cn } from '../../lib/utils.ts'

/**
 * Knapp.
 *
 * Minsta träffyta är 44 px även i "liten" storlek. Appen används stående i en
 * butiksgång med en kundvagn i vägen — en knapp som kräver precision är en
 * knapp som inte fungerar.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 active:opacity-80',
        secondary:
          'bg-[var(--yta)] text-[var(--text)] border border-[var(--kant)] hover:bg-[var(--yta-dampad)]',
        ghost: 'text-[var(--text)] hover:bg-[var(--yta-dampad)]',
        danger: 'bg-[var(--color-lingon)] text-white hover:opacity-90',
      },
      size: {
        sm: 'min-h-11 px-3 text-sm',
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-13 px-6 text-base',
        icon: 'size-11',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  children?: ReactNode
}

export function Button({ className, variant, size, full, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size, full }), className)} {...props} />
}

export interface LinkButtonProps extends LinkProps, VariantProps<typeof button> {
  children?: ReactNode
}

/**
 * Knapp som navigerar.
 *
 * Finns eftersom en länk inuti en `<button>` är ogiltig HTML och beter sig illa
 * med både skärmläsare och tangentbord. Det som navigerar ska vara en länk.
 */
export function LinkButton({ className, variant, size, full, ...props }: LinkButtonProps) {
  return <Link className={cn(button({ variant, size, full }), className)} {...props} />
}
