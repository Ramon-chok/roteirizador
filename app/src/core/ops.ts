/* Operações de roteiro: alterar itens, reordenar, otimizar, dividir nos dias, setores e pendências */
import * as E from './engine';
import { clone, fkm } from './util';
import { emit, st } from './store';
import { amb, baseOf, cliPt, dayUnion, itemKeys, P, pushUndo, rebuild, resequence, sdKeys, toastU } from './estudo';
import type { Estudo, Item } from './types';
import { toast } from '../ui/overlay';

export function mutateItems(solds: string[], fn: (it: Item, sold: string) => Item, label: string) {
  if (!st.itens) return;
  pushUndo(label);
  const touched = new Set<string>();
  for (const sold of solds) {
    const it = st.itens.get(sold); if (!it) continue;
    sdKeys(it).forEach(k => touched.add(k));
    const nv = fn(clone(it), sold); st.itens.put(sold, nv);
    sdKeys(nv).forEach(k => touched.add(k));
  }
  if (st.autoResequence) resequence(touched);
  rebuild(); toast(label);
}
const qd = (sold: string, d: number) => (st.itens!.get(sold)!.q || {})[d] ?? 9999;
export function reorderRoute(rk: string, order: string[]) {
  const [s, , dd] = rk.split('|'); const d = +dd;
  pushUndo('Ordem da rota');
  const union = dayUnion(s, d).sort((x, y) => qd(x, d) - qd(y, d));
  const inRoute = new Set(order); const slots: number[] = []; union.forEach((sold, i) => { if (inRoute.has(sold)) slots.push(i); });
  const res = union.slice(); slots.forEach((slot, i) => { res[slot] = order[i]; });
  res.forEach((sold, i) => { const it = clone(st.itens!.get(sold)!); it.q = { ...(it.q || {}), [d]: i + 1 }; st.itens!.put(sold, it); });
  rebuild();
}
export function routeOp(op: 'opt' | 'inv' | 'selall', rk: string) {
  const r = st.routes.get(rk); if (!r) return;
  if (op === 'selall') { st.sel = new Set(r.stops); emit(); return; }
  pushUndo(op === 'opt' ? 'Otimizar sequência' : 'Inverter sentido');
  if (op === 'opt') resequence(new Set([r.s + '|' + r.d]));
  else {
    const union = dayUnion(r.s, r.d).sort((x, y) => qd(x, r.d) - qd(y, r.d)).reverse();
    union.forEach((sold, i) => { const it = clone(st.itens!.get(sold)!); it.q = { ...(it.q || {}), [r.d]: i + 1 }; st.itens!.put(sold, it); });
  }
  const before = r.m.km; rebuild(); const after = (st.routes.get(rk) || r).m.km;
  toastU(op === 'opt' ? `Sequência otimizada: ${fkm(before)} → ${fkm(after)} km` : 'Sentido invertido');
}
export function weeksByFreq(f: number, W: number, load: Record<number, number>) {
  if (W === 1 || f >= 4) return [...Array(W)].map((_, i) => i + 1);
  if (f >= 2) { const pats = W === 4 ? [[1, 3], [2, 4]] : [[1], [2]]; return pats.reduce((b, p) => (p.reduce((s, w) => s + (load[w] || 0), 0) < b.reduce((s, w) => s + (load[w] || 0), 0) ? p : b)); }
  let bw = 1; for (let w = 2; w <= W; w++) if ((load[w] || 0) < (load[bw] || 0)) bw = w; return [bw];
}
export function selOp(op: 'clear' | 'delbase' | 'include' | 'unassign' | 'remove') {
  const sel = [...st.sel];
  const inS = sel.filter(s => st.itens && st.itens.has(s));
  if (op === 'clear') { st.sel.clear(); emit(); return; }
  if (op === 'delbase') {
    const touched = new Set<string>();
    for (const x of sel) { if (st.itens && st.itens.has(x)) { sdKeys(st.itens.get(x)).forEach(k => touched.add(k)); st.itens.del(x); } st.cli!.del(x); }
    if (st.itens) resequence(touched);
    st.sel.clear(); rebuild(); toast(`${sel.length} cliente(s) excluídos da base`); return;
  }
  if (op === 'include') { if (!st.itens) return; pushUndo('Incluir no estudo'); let n = 0; for (const s of sel) if (!st.itens.has(s)) { st.itens.put(s, { s: '', d: [], w: [], q: {} }); n++; } rebuild(); toast(`${n} cliente(s) incluídos no estudo`); return; }
  if (!inS.length) return;
  if (op === 'unassign') mutateItems(inS, () => ({ s: '', d: [], w: [], q: {} }), `${inS.length} cliente(s) tirados do roteiro`);
  else if (op === 'remove') {
    pushUndo('Remover do estudo'); const touched = new Set<string>();
    for (const s of inS) { sdKeys(st.itens!.get(s)).forEach(k => touched.add(k)); st.itens!.del(s); }
    if (st.autoResequence) resequence(touched);
    st.sel.clear(); rebuild(); toast(`${inS.length} cliente(s) removidos do estudo`);
  }
}
/* Dividir os clientes de um setor nos dias de trabalho, sem mexer nos outros setores */
export function distribuirSetor(sid: string, todos: boolean) {
  const solds = [...st.itens!.map].filter(([, it]) => it.s === sid && (todos || !itemKeys(it).length)).map(([s]) => s);
  const pts = solds.map(cliPt).filter(Boolean) as NonNullable<ReturnType<typeof cliPt>>[];
  if (!pts.length) { toast('Nenhum cliente com coordenada para dividir'); return; }
  pushUndo('Dividir nos dias');
  const res = E.autoRoute(pts, baseOf(sid), P(), { seed: 3 }), touched = new Set<string>();
  for (const [sold, v] of res) { const it = clone(st.itens!.get(sold)!); sdKeys(it).forEach(k => touched.add(k)); it.d = v.d; it.w = v.w; it.q = v.q; st.itens!.put(sold, it); sdKeys(it).forEach(k => touched.add(k)); }
  resequence(touched); rebuild();
  toastU(`${res.size} cliente(s) divididos nos dias. Use Roteirizar para calcular pelas ruas`);
}
export function touchAmb(mut: (a: Estudo) => void) { const a = clone(amb()!); a.setores = a.setores || {}; mut(a); a.alterado = Date.now(); st.amb!.put(a.id, a); emit(); }
export function excluirSetor(sid: string) {
  pushUndo('Excluir setor'); touchAmb(a => { delete a.setores[sid]; });
  for (const [s, it] of st.itens!.map) if (it.s === sid) st.itens!.put(s, { s: '', d: [], w: [], q: {} });
  rebuild(); toastU('Setor excluído — clientes ficaram sem setor');
}

/* ----- Pendências (registros do roteiro que não estão no cadastro). Ignoradas ficam em pend.ign ----- */
type PendCli = { sold: string; [k: string]: unknown }; type PendCol = { codigo: string; [k: string]: unknown };
type Pend = { cli: PendCli[]; col: PendCol[]; ign?: { cli: string[]; col: string[] } };
const pendDe = (a: Estudo) => (a.pend || { cli: [], col: [] }) as unknown as Pend;
function pendIgn(a: Estudo) { const g = pendDe(a).ign || { cli: [], col: [] }; return { cli: new Set(g.cli || []), col: new Set(g.col || []) }; }
export function cleanPend(a: Estudo) {
  const p = pendDe(a), ig = pendIgn(a);
  return { cli: (p.cli || []).filter(x => !st.cli!.has(x.sold) && !ig.cli.has(x.sold)), col: (p.col || []).filter(x => !st.col!.has(x.codigo) && !ig.col.has(x.codigo)) };
}
export function pendIgnoradas(a: Estudo) {
  const p = pendDe(a), ig = pendIgn(a);
  return (p.cli || []).filter(x => !st.cli!.has(x.sold) && ig.cli.has(x.sold)).length + (p.col || []).filter(x => !st.col!.has(x.codigo) && ig.col.has(x.codigo)).length;
}
export function ignorarPend(tipo: 'cli' | 'col' | 'todas', id?: string) {
  const a = amb(); if (!a || st.ro) return; const pc = cleanPend(a);
  const cli = tipo === 'cli' || tipo === 'todas' ? (id ? [id] : pc.cli.map(x => x.sold)) : [];
  const col = tipo === 'col' || tipo === 'todas' ? (id ? [id] : pc.col.map(x => x.codigo)) : [];
  const n = cli.length + col.length; if (!n) return;
  pushUndo(n === 1 ? 'Ignorar pendência' : 'Ignorar pendências');
  touchAmb(x => {
    const pd = (x.pend = { cli: [], col: [], ...(x.pend || {}) }) as unknown as Pend, g = pd.ign || { cli: [], col: [] };
    pd.ign = { cli: [...new Set([...(g.cli || []), ...cli])], col: [...new Set([...(g.col || []), ...col])] };
  });
  toastU(n === 1 ? `Pendência ${id} ignorada` : `${n} pendências ignoradas`);
}
export function reconsiderarPend() {
  const a = amb(); if (!a || st.ro) return; const n = pendIgnoradas(a); if (!n) return;
  pushUndo('Voltar a mostrar pendências');
  touchAmb(x => { const pd = x.pend as unknown as Pend; if (pd) pd.ign = { cli: [], col: [] }; });
  toastU(`${n} pendência(s) voltaram a aparecer`);
}
