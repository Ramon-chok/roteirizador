/* Utilitários e formatação (iguais aos da versão anterior) */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const uid = (p = 'a') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const clone = <T>(o: T): T => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export const DIA_C = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const DIA_L = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const COR_DIA = ['', '#2F6FB3', '#C2512B', '#3E8E5C', '#8A4FB0', '#B0892F', '#1F8A8A', '#C23C6E'];
export const COR_SEM = ['', '#2F6FB3', '#C2512B', '#3E8E5C', '#8A4FB0'];

const nf1f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0f = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf2f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const nf0 = (v: number) => nf0f.format(v || 0);
export const nf1 = (v: number) => nf1f.format(v || 0);
export const nf2 = (v: number) => nf2f.format(v || 0);
export const fbrl = (v: number) => brl.format(v || 0);
export const fkm = (v: number) => nf1f.format(v || 0);
export const fhm = (min: number) => { const m = Math.round(min || 0); return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
export const fpct = (v: number) => nf0f.format((v || 0) * 100) + '%';
export const fdate = (ts?: number | null) => (ts ? new Date(ts).toLocaleDateString('pt-BR') : '—');
export const fdh = (ts: number) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fhora = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const freqTxt = (f?: number) => ({ 1: 'Mensal', 2: 'Quinzenal', 4: 'Semanal', 8: '2x semana', 12: '3x semana' } as Record<number, string>)[f || 0] || (f ? f + 'x/mês' : '—');
export type Tom = 'ok' | 'warn' | 'bad' | 'idle' | 'info';
export const ocTom = (o: number): Tom => (o > 1 ? 'bad' : o >= 0.9 ? 'warn' : o < 0.5 ? 'idle' : 'ok');

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const normTxt = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const normLogin = (v: unknown) => String(v || '').trim().toLowerCase();
export const slug = (s: string) => norm(s).slice(0, 40) || 'estudo';
export const dstamp = () => new Date().toISOString().slice(0, 10);
export function numBR(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN; if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s/g, ''); if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
  const n = parseFloat(s); return Number.isFinite(n) ? n : NaN;
}
export const hasXY = (o: unknown): o is { lat: number; lng: number } => !!o && isNum((o as { lat?: unknown }).lat) && isNum((o as { lng?: unknown }).lng);
/* Dias no padrão brasileiro: 1 domingo, 2 segunda … 7 sábado (internamente 1 = segunda … 7 = domingo). Texto também vale */
export function parseDias(v: unknown): number[] {
  const s = norm(v); if (!s) return [];
  const map: [string, number][] = [['segunda', 1], ['seg', 1], ['terca', 2], ['ter', 2], ['quarta', 3], ['qua', 3], ['quinta', 4], ['qui', 4], ['sexta', 5], ['sex', 5], ['sabado', 6], ['sab', 6], ['domingo', 7], ['dom', 7]];
  const out = new Set<number>();
  String(v).split(/[\/,;.+\s-]+/).forEach(part => {
    const p = norm(part); if (!p || p === 'e') return;
    if (/^\d/.test(p)) { (p.match(/\d/g) || []).forEach(x => { const n = +x; if (n >= 2 && n <= 7) out.add(n - 1); else if (n === 1) out.add(7); }); return; }
    const m = map.find(([k]) => p.startsWith(k)); if (m) out.add(m[1]);
  });
  return [...out].sort((a, b) => a - b);
}
/* Semanas do ciclo: cada algarismo é uma semana ("1,3", "1234" ou Todas) */
export function parseSemanas(v: unknown, W: number): number[] {
  const s = String(v ?? '').trim(); if (!s) return [];
  if (/^(todas?|todos?|\*|t|semanal)$/i.test(s)) return [...Array(W)].map((_, i) => i + 1);
  const out = new Set<number>(); (s.match(/\d/g) || []).forEach(x => { const n = +x; if (n >= 1 && n <= 4) out.add(n); });
  return [...out].sort((a, b) => a - b);
}
export function iniciais(n: string) { const w = String(n || '').trim().split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase(); }
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function saveFile(nome: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
