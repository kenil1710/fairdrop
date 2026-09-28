/** The FairDrop mark: a sealed envelope with a check, sand on teal. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#0E2A30" />
      <rect x="92" y="150" width="328" height="224" rx="28" fill="none" stroke="#E9D8B4" strokeWidth="28" />
      <path d="M104 170 L256 292 L408 170" fill="none" stroke="#E9D8B4" strokeWidth="28" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="368" cy="352" r="78" fill="#E9D8B4" stroke="#0E2A30" strokeWidth="18" />
      <path d="M332 352 L358 378 L406 326" fill="none" stroke="#0E2A30" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={32} />
      <span className="display text-lg font-bold tracking-tight text-sand">FairDrop</span>
    </span>
  );
}
