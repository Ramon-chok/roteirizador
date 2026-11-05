/* Regras do estudo aberto: parâmetros, setores, rotas derivadas (setor × semana × dia), desfazer e refazer */
import * as E from './engine';
import { clone, DIA_L, isNum } from './util';
import { BucketStore, emit, st, type Foto } from './store';
import type { Estudo, GeoRota, Item, Params, Rota } from './types';
import { toast } from '../ui/overlay';

export const DEF_P: Params = { semanas: 4, dias: [1, 2, 3, 4, 5], vel: 25, fator: 1.35, jornada: 480, tPadrao: 20, criterio: 'tempo' };

export const amb = (): Estudo | null => (st.cur && st.amb ? st.amb.get(st.cur) || null : null);
export const P = (a: Estudo | null = amb()): Params => ({ ...DEF_P, ...((a && a.params) || {}) });
export const setorOf = (id: string, a: Estudo | null = amb()) => (a && a.setores ? a.setores[id] || null : null);
export function colabOfSetor(id: string, a: Estudo | null = amb()) { const s = setorOf(id, a); return s && s.colab && st.col ? st.col.get(s.colab) || null : null; }
export function baseOf(id: string, a: Estudo | null = amb()) { const c = colabOfSetor(id, a); return c && isNum(c.lat) && isNum(c.lng) ? { lat: c.lat, lng: c.lng } : null; }
export function cliPt(sold: string) {
  const c = st.cli && st.cli.get(sold); if (!c || !isNum(c.lat) || !isNum(c.lng)) return null;
  return { sold, lat: c.lat, lng: c.lng, t: isNum(c.t) ? c.t : P().tPadrao, f: c.f || 4 };
}
export function sortedSetores(a: Estudo | null = amb()) {
  if (!a) return [] as [string, Estudo['setores'][string]][];
  return Object.entries(a.setores || {}).sort((x, y) => String(x[1].nome).localeCompare(String(y[1].nome), 'pt-BR', { numeric: true }));
}
export function itemKeys(it: Item | undefined, a: Estudo | null = amb()) {
  if (!it || !it.s || !setorOf(it.s, a)) return [] as string[];
  const W = P(a).semanas, out: string[] = [];
  for (const w of it.w || []) if (w <= W) for (const d of it.d || []) out.push(`${it.s}|${w}|${d}`);
  return out;
}
export function routeSig(stops: string[], b: { lat: number; lng: number } | null) {
  const s = stops.join(',') + '|' + (b ? b.lat.toFixed(5) + ',' + b.lng.toFixed(5) : '-');
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + stops.length;
}

export function buildRoutes(a: Estudo | null, items: Map<string, Item> | null | undefined, geo: Map<string, GeoRota> | null | undefined) {
  const routes = new Map<string, Rota>(); if (!a || !items) return routes;
  const p = P(a);
  for (const [sold, it] of items) {
    for (const k of itemKeys(it, a)) {
      let r = routes.get(k);
      if (!r) { const [s, w, d] = k.split('|'); r = { k, s, w: +w, d: +d, stops: [], m: null as unknown as Rota['m'], missing: 0, sig: '', stale: false }; routes.set(k, r); }
      r.stops.push(sold);
    }
  }
  for (const r of routes.values()) {
    const qv = (s: string) => { const q = items.get(s)!.q; const v = q && q[r.d]; return isNum(v) ? v : 9999; };
    r.stops.sort((x, y) => qv(x) - qv(y));
    const pts = r.stops.map(cliPt).filter(Boolean) as NonNullable<ReturnType<typeof cliPt>>[];
    const col = colabOfSetor(r.s, a);
    r.m = E.routeMetrics(baseOf(r.s, a), pts, { ...p, jornada: (col && col.jornada) || p.jornada });
    r.missing = r.stops.length - pts.length;
    r.sig = routeSig(r.stops, baseOf(r.s, a));
    const real = geo && geo.get(r.k);
    r.stale = !!(real && real.sig !== r.sig);
    if (real && real.sig === r.sig) {
      const tDesl = real.min, total = tDesl + r.m.tAtend;
      r.m = { ...r.m, kmIda: real.kmIda, kmEntre: real.kmEntre, kmVolta: real.kmVolta, km: real.km, tDesl, total, ocup: r.m.jornada ? total / r.m.jornada : 0, real: true, src: real.src || 'osrm', o: real.o || 'rapida', toll: real.toll, terra: real.terra };
    }
  }
  return routes;
}
export function rebuild() { st.routes = buildRoutes(amb(), st.itens && st.itens.map, st.geo && st.geo.map); emit(); }
export function routeLabel(r: Rota) { const s = setorOf(r.s); return `${s ? s.nome : '?'} · S${r.w} · ${DIA_L[r.d]}`; }
export function sortedRoutes(list: Rota[]) {
  const so = new Map(sortedSetores().map(([id], i) => [id, i]));
  return list.sort((a, b) => (so.get(a.s) ?? 999) - (so.get(b.s) ?? 999) || a.w - b.w || a.d - b.d);
}
export function sumRoutes(list: Rota[]) {
  const o = { n: 0, km: 0, tDesl: 0, tAtend: 0, total: 0, oc: 0, ocMed: 0 };
  for (const r of list) { o.n += r.m.n; o.km += r.m.km; o.tDesl += r.m.tDesl; o.tAtend += r.m.tAtend; o.total += r.m.total; o.oc += r.m.ocup; }
  o.ocMed = list.length ? o.oc / list.length : 0; return o;
}
export const routeVisible = (k: string) => { const s = k.split('|')[0]; return !st.hiddenSet.has(s) && !st.hidden.has(k); };
export function itemVisible(it: Item) {
  if (!it.s || !setorOf(it.s)) return false;
  if (st.hiddenSet.has(it.s)) return false;
  const ks = itemKeys(it);
  if (!ks.length) return st.showUnassigned;
  return ks.some(k => !st.hidden.has(k));
}
export function dayUnion(s: string, d: number) { const out: string[] = []; if (!st.itens) return out; for (const [sold, it] of st.itens.map) if (it.s === s && (it.d || []).includes(d)) out.push(sold); return out; }
/* sd: Set de "setor|dia" — sequência em linha reta */
export function resequence(sd: Set<string>) {
  if (!st.itens) return;
  for (const k of sd) {
    const [s, dd] = k.split('|'); const d = +dd; if (!setorOf(s)) continue;
    const sold = dayUnion(s, d).filter(x => cliPt(x));
    const order = E.sequence(baseOf(s), sold.map(x => cliPt(x)!));
    order.forEach((idx, pos) => { const it = clone(st.itens!.get(sold[idx])!); it.q = { ...(it.q || {}), [d]: pos + 1 }; st.itens!.put(sold[idx], it); });
  }
}
export const sdKeys = (it: Item | undefined) => (it && it.s ? (it.d || []).map(d => it.s + '|' + d) : []);

/* ----- Desfazer, refazer e histórico (por estudo, enquanto a janela estiver aberta) ----- */
const HIST_MAX = 30; let histSeq = 0;
const fotoEstudo = () => ({ amb: st.cur, itens: new Map(st.itens!.map), geo: st.geo ? new Map(st.geo.map) : null, meta: clone(amb()!) });
export function pushUndo(label: string) {
  if (!st.itens) return;
  st.undo.push({ label, em: Date.now(), id: ++histSeq, ...fotoEstudo() });
  const doEstudo = st.undo.filter(u => u.amb === st.cur);
  if (doEstudo.length > HIST_MAX) st.undo.splice(st.undo.indexOf(doEstudo[0]), 1);
  st.redo = st.redo.filter(u => u.amb !== st.cur);
  emit();
}
export const histDoEstudo = (pilha: Foto[]) => pilha.filter(u => u.amb === st.cur);
const ultimoDoEstudo = (pilha: Foto[]) => { for (let i = pilha.length - 1; i >= 0; i--) if (pilha[i].amb === st.cur) return i; return -1; };
function restauraFoto(u: Foto) { st.itens!.replaceAll(new Map(u.itens)); if (st.geo && u.geo) st.geo.replaceAll(new Map(u.geo)); st.amb!.put(u.meta.id, clone(u.meta)); }
function podeVoltar() {
  if (!st.itens) { toast('Abra um estudo para desfazer'); return false; }
  if (st.ro) { toast('Estudo em modo somente leitura'); return false; }
  if (st.job) { toast('Aguarde o cálculo pelas ruas terminar, ou cancele, antes de desfazer'); return false; }
  return true;
}
export function doUndo(silencioso = false): Foto | null {
  if (!podeVoltar()) return null;
  const i = ultimoDoEstudo(st.undo); if (i < 0) { if (!silencioso) toast('Nada para desfazer neste estudo'); return null; }
  const u = st.undo.splice(i, 1)[0];
  st.redo.push({ label: u.label, em: u.em, id: u.id, ...fotoEstudo() });
  restauraFoto(u);
  if (!silencioso) { rebuild(); toast('Desfeito: ' + u.label, 6000, { label: 'Refazer', run: doRedo }); }
  return u;
}
export function doRedo() {
  if (!podeVoltar()) return;
  const i = ultimoDoEstudo(st.redo); if (i < 0) { toast('Nada para refazer'); return; }
  const r = st.redo.splice(i, 1)[0];
  st.undo.push({ label: r.label, em: r.em, id: r.id, ...fotoEstudo() });
  restauraFoto(r); rebuild(); toast('Refeito: ' + r.label, 6000, { label: 'Desfazer', run: () => doUndo() });
}
export function voltarPara(id: number) {
  const lista = histDoEstudo(st.undo), alvo = lista.find(u => u.id === id); if (!alvo || !podeVoltar()) return;
  let n = 0; for (;;) { const u = doUndo(true); if (!u) break; n++; if (u === alvo) break; }
  rebuild();
  toast(`Estudo voltou para antes de “${alvo.label}”${n > 1 ? ` (${n} alterações desfeitas)` : ''}`, 7000, { label: 'Refazer', run: doRedo });
}
export const toastU = (msg: string, ms = 7000) => toast(msg, ms, { label: 'Desfazer', run: () => doUndo() });

/* ----- Abrir estudo ----- */
const uiKey = () => 'rt1:' + st.empresa!.id + '_ui';
export function loadUI() {
  try { const v = JSON.parse(localStorage.getItem(uiKey()) || '{}'); Object.assign(st, { colorBy: v.colorBy || 'setor', baseKind: v.baseKind || 'auto', pinos: v.pinos !== false }); if (v.view) st.view = v.view; st.lastAmb = v.amb; } catch { /* ignora */ }
}
export function saveUI() {
  try { localStorage.setItem(uiKey(), JSON.stringify({ colorBy: st.colorAntes || st.colorBy, baseKind: st.baseKind, view: st.view, amb: st.cur, pinos: st.pinos })); } catch { /* ignora */ }
}
export async function openAmb(id: string | null) {
  if (st.itens) { await st.itens.flush(); st.itens.detach(); }
  if (st.geo) { await st.geo.flush(); st.geo.detach(); }
  st.pathCache.clear(); st.roadFail.clear();
  st.cur = id || null; saveUI();
  st.sel.clear(); st.hidden.clear(); st.hiddenSet.clear(); st.qf = { w: [], d: [] }; st.verSemSetor = true; st.visao = st.cur ? 'setores' : 'base'; st.showLines = false; st.arv.clear(); st.soloSetor = '';
  if (st.colorAntes) { st.colorBy = st.colorAntes; st.colorAntes = null; }
  if (st.cur) { st.itens = new BucketStore<Item>('itens/' + st.cur + '/b'); st.geo = new BucketStore<GeoRota>('geo/' + st.cur + '/b'); await Promise.all([st.itens.load(), st.geo.load()]); }
  else { st.itens = null; st.geo = null; }
  rebuild();
}
/* Marca o estudo como alterado agora */
export function tocaEstudo(a: Estudo | null = amb()) { if (a && st.amb) st.amb.put(a.id, { ...a, alterado: Date.now() }); }
