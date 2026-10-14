import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Spore-weight line icons (2px strokes on a 24 grid) for the account drawer. */
export const GearIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const PowerIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <path d="M12 2v10" />
  </svg>
);

export const ArrowRightIcon = ({ size = 20, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const ArrowLeftIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

export const ChevronRightIcon = ({ size = 20, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const CaretIcon = ({ size = 16, up = true, ...props }: IconProps & { up?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" {...props}>
    {up ? <path d="M8 3.5 13.5 11h-11z" /> : <path d="M8 12.5 2.5 5h11z" />}
  </svg>
);

export const CopyIcon = ({ size = 12, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/** Filled circle arrows, as Uniswap's Send / Receive tiles use. */
export const ArrowDownCircleIcon = ({ size = 24, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.75 5.5v6.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0l-3.75-3.75a.75.75 0 1 1 1.06-1.06l2.47 2.47V7.5a.75.75 0 0 1 1.5 0z" />
  </svg>
);

export const ArrowUpCircleIcon = ({ size = 24, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-.75 14.5V9.81l-2.47 2.47a.75.75 0 1 1-1.06-1.06l3.75-3.75a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 1 1-1.06 1.06l-2.47-2.47v6.69a.75.75 0 0 1-1.5 0z" />
  </svg>
);

export const SendIcon = ({ size = 24, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M21.4 3.2a1 1 0 0 0-1.08-.22L3.2 9.7a1 1 0 0 0 .05 1.87l6.6 2.4 2.4 6.6a1 1 0 0 0 1.87.05l6.72-17.12a1 1 0 0 0-.22-1.08zm-8.3 14.9-1.6-4.4 4.2-4.2-4.2 4.2-4.4-1.6L19 5z" />
  </svg>
);

export const QrIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14h1v1M14 20h1M17 20h4v1M20 17h1" />
  </svg>
);

export const KeyIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3-3.5 3.5z" />
  </svg>
);

export const FaceIdIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2" />
    <path d="M9 9v1M15 9v1M12 9v4h-1M9 15.5s1 1.5 3 1.5 3-1.5 3-1.5" />
  </svg>
);

export const LockIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const ContrastIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
  </svg>
);

export const SunIcon = ({ size = 20, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ size = 20, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export const SlidersIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </svg>
);

export const BellIcon = ({ size = 24, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const SigmaBadgeIcon = ({ size = 16, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" {...props}>
    <rect width="16" height="16" rx="4" fill="var(--color-accent)" />
    <path d="M5 4.5h6v1.4H7.1L9.6 8l-2.5 2.1H11v1.4H5v-1.2L7.6 8 5 5.7z" fill="#fff" />
  </svg>
);

/** Uniswap's copied state: a filled green circle with a check. */
export const CheckCircleIcon = ({ size = 12, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.7 7.7-5.5 5.5a1 1 0 0 1-1.4 0l-2.5-2.5a1 1 0 1 1 1.4-1.4l1.8 1.8 4.8-4.8a1 1 0 1 1 1.4 1.4z" />
  </svg>
);
