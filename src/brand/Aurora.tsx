import { useId } from "react";

/** Resolution-independent light ribbons; motion respects reduced-motion preferences. */
export function Aurora({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={`aurora ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${id}-blue`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#002745" stopOpacity="0" />
            <stop offset=".4" stopColor="#0084ff" />
            <stop offset=".57" stopColor="#59e5ff" />
            <stop offset=".68" stopColor="#153bfa" />
            <stop offset="1" stopColor="#110323" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-purple`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#171148" stopOpacity="0" />
            <stop offset=".4" stopColor="#5313e4" />
            <stop offset=".56" stopColor="#ae75ff" />
            <stop offset=".68" stopColor="#3a16b0" />
            <stop offset="1" stopColor="#040511" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#02040c" stopOpacity="0" />
            <stop offset="1" stopColor="#02040c" />
          </linearGradient>
          <filter
            id={`${id}-glow`}
            x="-30%"
            y="-100%"
            width="160%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        <g className="aurora-drift">
          <path
            d="M-250 -110 C270 0 340 530 940 560 S1390 770 1840 850"
            fill="none"
            stroke={`url(#${id}-blue)`}
            strokeWidth="115"
            opacity=".2"
            filter={`url(#${id}-glow)`}
          />
          <path
            d="M-250 -110 C270 0 340 530 940 560 S1390 770 1840 850"
            fill="none"
            stroke={`url(#${id}-blue)`}
            strokeWidth="2.5"
          />
          <path
            d="M500 -240 C950 -10 1010 190 1210 310 S1620 500 1840 730"
            fill="none"
            stroke={`url(#${id}-purple)`}
            strokeWidth="145"
            opacity=".25"
            filter={`url(#${id}-glow)`}
          />
          <path
            d="M500 -240 C950 -10 1010 190 1210 310 S1620 500 1840 730"
            fill="none"
            stroke={`url(#${id}-purple)`}
            strokeWidth="2"
          />
          <path
            d="M-340 210 C190 370 180 590 690 750 S1060 960 1320 1190"
            fill="none"
            stroke={`url(#${id}-blue)`}
            strokeWidth="110"
            opacity=".3"
            filter={`url(#${id}-glow)`}
          />
          <path
            d="M-340 210 C190 370 180 590 690 750 S1060 960 1320 1190"
            fill="none"
            stroke={`url(#${id}-blue)`}
            strokeWidth="2"
          />
          <path
            d="M-280 580 C100 640 190 790 430 1050"
            fill="none"
            stroke={`url(#${id}-purple)`}
            strokeWidth="95"
            opacity=".3"
            filter={`url(#${id}-glow)`}
          />
          <path
            d="M-280 580 C100 640 190 790 430 1050"
            fill="none"
            stroke={`url(#${id}-purple)`}
            strokeWidth="2"
          />
        </g>
        <rect
          width="1600"
          height="1000"
          fill={`url(#${id}-shade)`}
          opacity=".5"
        />
      </svg>
    </div>
  );
}
