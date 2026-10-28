// Rulebook Trader mark: three rising candlesticks on a ruled line. Same artwork as src/app/icon.svg,
// drawn in theme colors so it follows dark mode.
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <g fill="var(--panel)" stroke="var(--panel)" strokeWidth="1.5" strokeLinecap="round">
        <line x1="9" y1="15" x2="9" y2="24" />
        <rect x="7" y="17" width="4" height="5" rx="0.75" stroke="none" />
        <line x1="16" y1="10" x2="16" y2="21" />
        <rect x="14" y="12" width="4" height="6.5" rx="0.75" stroke="none" />
        <line x1="23" y1="5.5" x2="23" y2="16" />
        <rect x="21" y="7.5" width="4" height="6" rx="0.75" stroke="none" />
        <line x1="6.5" y1="26.5" x2="25.5" y2="26.5" opacity="0.6" />
      </g>
    </svg>
  );
}
