import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

import { cn } from '../../lib/utils.ts'

const fieldBase =
  'w-full min-h-11 rounded-lg border border-[var(--kant)] bg-[var(--yta)] px-3 text-sm ' +
  'text-[var(--text)] placeholder:text-[var(--text-dampad)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

/**
 * Fält med etikett. Etiketten är alltid kopplad till kontrollen via id -
 * placeholder som enda ledtext är otillgängligt och försvinner när man skriver.
 */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[var(--text-dampad)]">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-[var(--color-lingon)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function TextField({ label, hint, error, className, id, ...props }: TextFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fieldId}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cn(fieldBase, className)}
        {...props}
      />
    </Field>
  )
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}

export function SelectField({ label, hint, className, id, children, ...props }: SelectFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <Field label={label} hint={hint} htmlFor={fieldId}>
      <select id={fieldId} className={cn(fieldBase, 'pr-8', className)} {...props}>
        {children}
      </select>
    </Field>
  )
}

/**
 * Kryssruta i handlingsläget.
 *
 * Medvetet stor. Det här är kontrollen man trycker på trettio gånger med en
 * hand medan den andra håller i vagnen, och den enda i appen som får ta plats.
 */
export function BigCheckbox({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  id?: string
}) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <input
      id={fieldId}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className="size-7 shrink-0 cursor-pointer rounded-md accent-[var(--accent)]"
    />
  )
}
