import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-technical text-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-technical text-rejected">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  'w-full rounded-md border bg-surface text-body text-ink transition-control placeholder:text-subtle ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 disabled:bg-sunken';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-10 px-3', invalid ? 'border-rejected' : 'border-line-control', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'min-h-[96px] px-3 py-2', invalid ? 'border-rejected' : 'border-line-control', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-10 appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236a7280%27 stroke-width=%272.2%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-[length:12px_12px] bg-[position:right_0.75rem_center] bg-no-repeat pl-3 pr-9 border-line-control', className)} {...props}>
      {children}
    </select>
  );
});

export function Checkbox({ id, label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode; description?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded-xs border-line-control accent-[#2f6fdc]" {...props} />
      <span>
        <span className="text-caption text-ink">{label}</span>
        {description && <span className="text-technical mt-0.5 block text-subtle">{description}</span>}
      </span>
    </label>
  );
}

export function Toggle({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-control disabled:opacity-50', checked ? 'border-cta bg-cta' : 'border-line-control bg-sunken')}
    >
      <span className={cn('absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgb(15_17_21/0.25)] transition-transform duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]', checked ? 'translate-x-5' : 'translate-x-0')} />
    </button>
  );
}
