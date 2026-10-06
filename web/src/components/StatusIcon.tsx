interface Props {
  hit: boolean | null;
  /** Larger variant for the bool toggle. */
  size?: number;
}

/** Hit → check in a filled circle; miss → soft red dash; not entered → empty ring. */
export function StatusIcon({ hit, size = 22 }: Props) {
  const state = hit === null ? 'none' : hit ? 'hit' : 'miss';
  return (
    <svg
      className={`status-icon status-${state}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.5" />
      {state === 'hit' && (
        <path d="M7 12.5l3.2 3.2L17 9" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {state === 'miss' && <path d="M8 12h8" fill="none" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  );
}
