/* Símbolo do vórtice (3 arcos + hub laranja). As cores vêm do tema (--vx-*) */
export function Vortex({ size = 30, bg }: { size?: number; bg?: string }) {
  return (
    <svg className="vx" viewBox="9 5 54 54" width={size} height={size} aria-hidden="true" focusable="false" style={bg ? ({ ['--vx-bg' as string]: bg } as React.CSSProperties) : undefined}>
      <g fill="none" strokeLinecap="round" strokeWidth={4.8}>
        <path className="vx-2" d="M32 32a12 12 0 0 1 24 0" />
        <path className="vx-3" d="M32 32a12 12 0 0 1 24 0" transform="rotate(120 32 32)" />
        <path className="vx-1" d="M32 32a12 12 0 0 1 24 0" transform="rotate(240 32 32)" />
      </g>
      <g className="vx-n" strokeWidth={2.3}>
        <circle className="vx-2" cx="56" cy="32" r="3.2" />
        <circle className="vx-3" cx="56" cy="32" r="3.2" transform="rotate(120 32 32)" />
        <circle className="vx-1" cx="56" cy="32" r="3.2" transform="rotate(240 32 32)" />
      </g>
      <circle className="vx-h" cx="32" cy="32" r="5.2" strokeWidth={2.8} />
    </svg>
  );
}
export function Wordmark({ sub }: { sub?: boolean }) {
  return (
    <span className="wm">
      <small>ROUTE</small>
      <b>VORTEX</b>
      {sub ? <em style={{ font: '400 13px/1.3 var(--f-body)', fontStyle: 'normal', color: 'var(--muted)', marginTop: 10 }}>Planejamento · Setorização · Roteirização</em> : null}
    </span>
  );
}
