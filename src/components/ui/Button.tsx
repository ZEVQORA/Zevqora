import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex items-center justify-center gap-2 text-button font-medium whitespace-nowrap select-none ' +
  'transition-[color,background-color,border-color,box-shadow,transform] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] ' +
  'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const variants: Record<Variant, string> = {
  primary:
    'bg-cta text-cta-fg hover:bg-cta-hover active:bg-cta-active ' +
    'shadow-[0_1px_2px_rgb(15_17_21/0.10),0_6px_16px_-8px_rgb(47_111_220/0.55),inset_0_1px_0_rgb(255_255_255/0.16)] ' +
    'hover:shadow-[0_1px_2px_rgb(15_17_21/0.12),0_10px_24px_-10px_rgb(47_111_220/0.60),inset_0_1px_0_rgb(255_255_255/0.18)] ' +
    'active:translate-y-px',
  secondary: 'bg-surface text-ink border border-line-control hover:bg-canvas active:bg-line/40 shadow-[0_1px_2px_rgb(15_17_21/0.05)] active:translate-y-px active:shadow-none',
  ghost: 'text-muted hover:text-ink hover:bg-ink/5 active:bg-ink/8',
  danger: 'bg-rejected-bg text-rejected border border-rejected/30 hover:bg-rejected hover:text-white',
  inverse: 'bg-ink text-cloud hover:bg-ink/90 active:bg-ink/80',
};

const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 rounded-sm text-caption',
  sm: 'h-8 px-3 rounded-sm text-caption',
  md: 'h-10 px-4 rounded-md',
  lg: 'h-12 px-6 rounded-md text-body',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, CommonProps & ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = 'primary', size = 'md', className, children, loading, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', className, children, to, ...props }: CommonProps & Omit<LinkProps, 'className'>) {
  return (
    <Link to={to} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </Link>
  );
}

export function ButtonAnchor({ variant = 'primary', size = 'md', className, children, href, ...props }: CommonProps & { href: string; target?: string; rel?: string }) {
  return (
    <a href={href} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </a>
  );
}
