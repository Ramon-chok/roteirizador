/* Camada de sobreposição: avisos (toasts), diálogos e confirmação. Chamáveis de qualquer lugar (inclusive da lógica). */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { I } from './icons';

type Acao = { label: string; run: () => void };
interface Toast { id: number; msg: string; acao?: Acao }
interface Dlg { id: number; node: (fechar: () => void) => ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; fixo?: boolean }

let seq = 0;
let toasts: Toast[] = [];
let dlgs: Dlg[] = [];
let snap = { toasts, dlgs };
const ouv = new Set<() => void>();
const avisa = () => { snap = { toasts, dlgs }; ouv.forEach(f => f()); };
const sub = (f: () => void) => { ouv.add(f); return () => { ouv.delete(f); }; };

export function toast(msg: string, ms = 2600, acao?: Acao) {
  const t = { id: ++seq, msg, acao };
  toasts = [...toasts.slice(-2), t]; avisa();
  setTimeout(() => { toasts = toasts.filter(x => x !== t); avisa(); }, ms);
}
/* Abre um diálogo. node recebe a função de fechar. Devolve a função de fechar. */
export function openDialog(node: (fechar: () => void) => ReactNode, size: Dlg['size'] = 'md', fixo = false) {
  const d: Dlg = { id: ++seq, node, size, fixo };
  dlgs = [...dlgs, d]; avisa();
  return () => { dlgs = dlgs.filter(x => x !== d); avisa(); };
}
export function closeAllDialogs() { dlgs = []; avisa(); }
export function confirmar(opts: { titulo: string; texto?: ReactNode; ok?: string; perigo?: boolean }): Promise<boolean> {
  return new Promise(res => {
    openDialog(fechar => (
      <>
        <DlgHead titulo={opts.titulo} fechar={() => { fechar(); res(false); }} />
        {opts.texto ? <div className="dlg-b"><div className="muted">{opts.texto}</div></div> : null}
        <div className="dlg-f">
          <button className="btn" type="button" onClick={() => { fechar(); res(false); }}>Cancelar</button>
          <button className={'btn ' + (opts.perigo ? 'solid-danger' : 'primary')} type="button" autoFocus onClick={() => { fechar(); res(true); }}>{opts.ok || 'Confirmar'}</button>
        </div>
      </>
    ), 'sm');
  });
}

export function DlgHead({ titulo, sub, fechar, extra }: { titulo: ReactNode; sub?: ReactNode; fechar?: () => void; extra?: ReactNode }) {
  return (
    <div className="dlg-h">
      <div className="grow"><h2>{titulo}</h2>{sub ? <p>{sub}</p> : null}</div>
      {extra}
      {fechar ? <button className="iconbtn" type="button" aria-label="Fechar" onClick={fechar}><I.x /></button> : null}
    </div>
  );
}

function Dialogo({ d, topo }: { d: Dlg; topo: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const fechar = () => { dlgs = dlgs.filter(x => x !== d); avisa(); };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const f = el.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, .dlg-b button, .dlg-f button');
    setTimeout(() => f && f.focus(), 20);
  }, []);
  useEffect(() => {
    if (!topo || d.fixo) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });
  return (
    <div className="dlg-back" onMouseDown={e => { if (e.target === e.currentTarget && !d.fixo) fechar(); }}>
      <div ref={ref} className={'dlg ' + (d.size || '')} role="dialog" aria-modal="true">{d.node(fechar)}</div>
    </div>
  );
}

export function OverlayRoot() {
  const s = useSyncExternalStore(sub, () => snap);
  return (
    <>
      {s.dlgs.map((d, i) => <Dialogo key={d.id} d={d} topo={i === s.dlgs.length - 1} />)}
      <div className="toasts" role="status" aria-live="polite">
        {s.toasts.map(t => (
          <div className="toast" key={t.id}>
            <span>{t.msg}</span>
            {t.acao ? <button type="button" onClick={() => { t.acao!.run(); toasts = toasts.filter(x => x !== t); avisa(); }}>{t.acao.label}</button> : null}
          </div>
        ))}
      </div>
    </>
  );
}
