import { motion, useReducedMotion } from "motion/react";

function Digit({ value }: { value: string }) {
  const reduced = useReducedMotion();
  return (
    <span className="price-digit-window">
      <motion.span
        className="price-digit-strip"
        initial={false}
        animate={{ y: `${-Number(value) * 10}%` }}
        transition={
          reduced
            ? { duration: 0 }
            : { type: "spring", stiffness: 110, damping: 21, mass: 0.75 }
        }
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </motion.span>
    </span>
  );
}

export function RollingPrice({ value }: { value: number }) {
  const [integer, decimal] = value.toFixed(2).split(".");
  return (
    <strong
      className="rolling-price"
      aria-label={`$${value.toFixed(2)}`}
      data-price={value.toFixed(2)}
    >
      <span className="price-currency" aria-hidden>
        $
      </span>
      <span className="price-integer" aria-hidden>
        {Array.from(integer).map((digit, index) => (
          <Digit key={integer.length - index} value={digit} />
        ))}
      </span>
      <span className="price-decimal" aria-hidden>
        .<Digit value={decimal[0]} />
        <Digit value={decimal[1]} />
      </span>
    </strong>
  );
}
