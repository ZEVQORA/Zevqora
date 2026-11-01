import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Input } from "@/components/ui/Field";

export function PasswordInput({
  strength = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { strength?: boolean }) {
  const strengthId = useId();
  const fieldName =
    props.name === "confirm" ? "confirmation password" : "password";
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const score =
    value.length === 0
      ? 0
      : Math.min(
          4,
          Number(value.length >= 10) +
            Number(value.length >= 14) +
            Number(/[A-Z]/.test(value) && /[a-z]/.test(value)) +
            Number(/\d|[^\w]/.test(value)),
        );
  return (
    <div className="auth-password-block">
      <div className="auth-input-with-icon">
        <LockKeyhole size={16} />
        <Input
          {...props}
          type={show ? "text" : "password"}
          aria-describedby={
            [props["aria-describedby"], strength ? strengthId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          placeholder={props.placeholder ?? "Enter your password"}
          onChange={(e) => {
            setValue(e.target.value);
            props.onChange?.(e);
          }}
          className="auth-password-input"
        />
        <button
          type="button"
          aria-label={`${show ? "Hide" : "Show"} ${fieldName}`}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {strength && (
        <div className="auth-password-strength">
          <div aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <i
                key={i}
                data-filled={value.length > 0 && i <= Math.max(1, score)}
              />
            ))}
          </div>
          <span id={strengthId}>
            {value.length === 0
              ? "At least 10 characters. Make it yours."
              : value.length < 10
                ? `${10 - value.length} more characters to reach the minimum.`
                : score >= 3
                  ? "Looking good. Keep it unique."
                  : "Minimum length reached."}
          </span>
        </div>
      )}
    </div>
  );
}
