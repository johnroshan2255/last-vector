/** Pixel-style gear icon (inherits `currentColor`). */
export function Cog({ size = '1em' }: { size?: string }) {
  const teeth = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg className="cog" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      {teeth.map((a, i) => (
        <line key={i} x1={12 + Math.cos(a) * 6.5} y1={12 + Math.sin(a) * 6.5} x2={12 + Math.cos(a) * 10.4} y2={12 + Math.sin(a) * 10.4} stroke="currentColor" strokeWidth="3.4" strokeLinecap="butt" />
      ))}
    </svg>
  );
}
