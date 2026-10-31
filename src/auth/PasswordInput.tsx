import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/Field';

/** Password field with a show/hide toggle (the sign-in page's control, shared by sign-up and reset). */
export function PasswordInput({ label = 'password', className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={['pr-12', className].filter(Boolean).join(' ')} />
      <button type="button" aria-label={`${show ? 'Hide' : 'Show'} ${label}`} aria-pressed={show} onClick={() => setShow((v) => !v)} className="absolute right-0.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm text-subtle hover:text-ink">
        {show ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
      </button>
    </div>
  );
}
