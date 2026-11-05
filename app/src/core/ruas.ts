/* Percurso pelas ruas: OSRM (mais rápida), Valhalla (mais curta, sem pedágio, sem terra) e Google (opcional).
   Porta fiel da versão anterior. O progresso do cálculo em lote fica em st.job (a interface mostra o diálogo). */
import * as E from './engine';
import { clone, fkm, isNum, sleep } from './util';
import { CFG } from './config';
import { emit, st } from './store';
import { amb, baseOf, cliPt, dayUnion, P, pushUndo, rebuild, resequence, sumRoutes, toastU } from './estudo';
import type { GeoRota } from './types';
import { toast } from '../ui/overlay';

type Pt = { lat: number; lng: number };
type Leg = { km: number; min: number };
type ErroRota = { code: string; message: string };

export const GMAPS_KEY = CFG.googleMapsKey || '';
export const gReady = () => st.g === 'ready' && !!(window.google && window.google.maps);
export function rotaOpt(a = amb()) { const p = P(a); return { curta: p.criterio !== 'tempo', pedagio: !!p.evitaPedagio, terra: !!p.evitaTerra }; }
export type RotaOpt = ReturnType<typeof rotaOpt>;
export const rotaKey = (o: RotaOpt) => [o.curta ? 'curta' : 'rapida', o.pedagio && 'pedagio', o.terra && 'terra'].filter(Boolean).join('+');
export function rotaTxt(key: string) { const k = key.split('+'); return [k[0] === 'curta' ? 'Mais curta' : 'Mais rápida', k.includes('pedagio') && 'sem pedágio', k.includes('terra') && 'sem terra'].filter(Boolean).join(' · '); }
export function motorRota(o = rotaOpt()) {
  if (P().motor === 'google' && gReady() && !o.curta && !o.terra) return 'google';
  return o.curta || o.pedagio || o.terra ? 'valhalla' : 'osrm';
}
export function rotaAviso(m: { o?: string; toll?: boolean | null; terra?: number | null }) {
  const k = (m.o || '').split('+'), out: string[] = [];
  if (k.includes('pedagio') && m.toll) out.push('passa por pedágio');
  if (k.includes('terra') && (m.terra || 0) >= 0.1) out.push(`${fkm(m.terra || 0)} km de terra`);
  return out.join(' e ');
}

/* ----- Polilinha ----- */
export function decodePoly(str: string, prec = 1e5): [number, number][] {
  let i = 0, lat = 0, lng = 0; const out: [number, number][] = [];
  while (i < str.length) {
    let b, sh = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lat += (r & 1) ? ~(r >> 1) : (r >> 1);
    sh = 0; r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lng += (r & 1) ? ~(r >> 1) : (r >> 1);
    out.push([lat / prec, lng / prec]);
  }
  return out;
}
export function encodePoly(path: [number, number][], prec = 1e5) {
  let pa = 0, pb = 0, s = '';
  const enc = (v: number) => { v = v < 0 ? ~(v << 1) : (v << 1); let o = ''; while (v >= 32) { o += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
  for (const [la, ln] of path) { const a = Math.round(la * prec), b = Math.round(ln * prec); s += enc(a - pa) + enc(b - pb); pa = a; pb = b; }
  return s;
}
export function pathOf(k: string, sig: string) {
  const g = st.geo && st.geo.get(k); if (!g || g.sig !== sig || !g.p) return null;
  let c = st.pathCache.get(k); if (!c || c.sig !== sig) { c = { sig, path: decodePoly(g.p) }; st.pathCache.set(k, c); }
  return c.path;
}

/* ----- Servidores ----- */
export const VH_DEF = (CFG.valhallaUrl || 'https://valhalla1.openstreetmap.de').replace(/\/+$/, '');
const VH_PUBLICO = VH_DEF.includes('openstreetmap.de');
const VH_ROTA = 10, VH_BLOCO = 10, VH_MATRIZ_MAX = 60;
const VH_TERRA = new Set(['compacted', 'dirt', 'gravel', 'path', 'impassable']);
const vhLoc = (p: Pt) => ({ lat: +p.lat, lon: +p.lng });
const vhCusto = (o: RotaOpt) => ({ costing: 'auto', units: 'kilometers', costing_options: { auto: { ...(o.curta ? { shortest: true } : {}), ...(o.pedagio ? { exclude_tolls: true } : {}), ...(o.terra ? { exclude_unpaved: true, use_tracks: 0 } : {}) } } });
export const OSRM_DEF = (CFG.osrmUrl || 'https://router.project-osrm.org').replace(/\/+$/, '');
export function osrmUrl() { try { return (localStorage.getItem('rt1:osrm') || OSRM_DEF).replace(/\/+$/, ''); } catch { return OSRM_DEF; } }
export function setOsrmUrl(v: string) { try { if (!v || v.replace(/\/+$/, '') === OSRM_DEF) localStorage.removeItem('rt1:osrm'); else localStorage.setItem('rt1:osrm', v); } catch { /* ignora */ } }
let lastReq = 0;
async function throttle(publico = osrmUrl() === OSRM_DEF) { const w = (publico ? 1050 : 120) - (Date.now() - lastReq); if (w > 0) await sleep(w); lastReq = Date.now(); }
const coordStr = (nodes: Pt[]) => nodes.map(p => (+p.lng).toFixed(6) + ',' + (+p.lat).toFixed(6)).join(';');
const semRede = (): ErroRota => ({ code: 'net', message: 'sem conexão com o servidor de rotas' });

async function vhPost(path: string, body: unknown) {
  await throttle(VH_PUBLICO);
  let r: Response;
  try { r = await fetch(VH_DEF + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw semRede(); }
  if (r.status === 429) throw { code: 'rate', message: 'muitas consultas seguidas ao servidor de rotas; aguarde um minuto' };
  let j; try { j = await r.json(); } catch { throw { code: 'bad', message: 'resposta inválida do servidor de rotas (' + r.status + ')' }; }
  if (!r.ok) throw { code: j.error_code === 442 ? 'nopath' : 'vh', message: j.error_code === 442 ? 'não há caminho de carro entre dois pontos da rota' : (j.error || 'erro ' + r.status) };
  return j;
}
/* Trecho de até VH_ROTA pontos. Sem caminho com as restrições, divide até achar o par sem saída e só nele abre mão delas */
async function vhTrecho(nodes: Pt[], o: RotaOpt): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { return (await vhPost('/route', { locations: nodes.map(vhLoc), directions_type: 'none', ...vhCusto(o) })).trip.legs; }
  catch (e) {
    if ((e as ErroRota).code !== 'nopath') throw e;
    if (nodes.length > 2) { const mid = nodes.length >> 1; return [...await vhTrecho(nodes.slice(0, mid + 1), o), ...await vhTrecho(nodes.slice(mid), o)]; }
    if (o.terra) return vhTrecho(nodes, { ...o, terra: false });
    if (o.pedagio) return vhTrecho(nodes, { ...o, pedagio: false });
    throw e;
  }
}
async function vhKmTerra(path: [number, number][], o: RotaOpt): Promise<number | null> {
  try {
    const j = await vhPost('/trace_attributes', { encoded_polyline: encodePoly(path, 1e6), shape_match: 'walk_or_snap', filters: { attributes: ['edge.surface', 'edge.length'], action: 'include' }, ...vhCusto(o) });
    return j.edges.reduce((s: number, e: { surface: string; length?: number }) => s + (VH_TERRA.has(e.surface) ? e.length || 0 : 0), 0);
  } catch (e) { if (['net', 'rate'].includes((e as ErroRota).code)) throw e; return null; }
}
const upd = () => emit();
async function vhRoute(nodes: Pt[], o: RotaOpt) {
  const job = st.job;
  const legs: any[] = [], path: [number, number][] = []; let terra: number | null | undefined = o.terra ? 0 : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  const n = Math.ceil((nodes.length - 1) / (VH_ROTA - 1));
  if (job) { job.total += n - 1 + (o.terra ? n : 0); upd(); }
  for (let i = 0, parte = 0; i < nodes.length - 1; i += VH_ROTA - 1, parte++) {
    if (job && job.cancel) throw { code: 'cancel', message: 'cancelado' };
    const seg = await vhTrecho(nodes.slice(i, i + VH_ROTA), o);
    const p = seg.flatMap(l => decodePoly(l.shape, 1e6));
    legs.push(...seg); path.push(...p);
    if (job && parte < n - 1) { job.done++; upd(); }
    if (o.terra) { const t = await vhKmTerra(p, o); terra = t === null || terra === null || terra === undefined ? null : terra + t; if (job) { job.done++; upd(); } }
  }
  return { legs: legs.map(l => ({ km: l.summary.length, min: l.summary.time / 60 })) as Leg[], poly: encodePoly(path), src: 'valhalla', toll: legs.some(l => l.summary.has_toll), terra: terra === null ? undefined : terra };
}
async function vhMatriz(nodes: Pt[], o: RotaOpt) {
  const job = st.job;
  const n = nodes.length, D = nodes.map(() => new Array(n).fill(1e9)), T = nodes.map(() => new Array(n).fill(1e9)), blocos: [number, number][] = [];
  for (let i = 0; i < n; i += VH_BLOCO) for (let j = 0; j < n; j += VH_BLOCO) blocos.push([i, j]);
  if (job) { job.total += blocos.length - 1; upd(); }
  for (const [i, j] of blocos) {
    if (job && job.cancel) return null;
    const r = await vhPost('/sources_to_targets', { sources: nodes.slice(i, i + VH_BLOCO).map(vhLoc), targets: nodes.slice(j, j + VH_BLOCO).map(vhLoc), ...vhCusto(o) });
    r.sources_to_targets.forEach((row: { distance: number | null; time: number | null }[], a: number) => row.forEach((c, b) => { if (c.distance !== null) D[i + a][j + b] = c.distance; if (c.time !== null) T[i + a][j + b] = c.time; }));
    if (job && blocos.length > 1) { job.done++; upd(); }
  }
  if (job && blocos.length > 1) job.done--;
  return { D, T };
}
async function osrmGet(path: string) {
  let r: Response;
  try { r = await fetch(osrmUrl() + path); } catch { throw semRede(); }
  if (r.status === 429) throw { code: 'rate', message: 'muitas consultas seguidas ao servidor de rotas; aguarde um minuto' };
  let j; try { j = await r.json(); } catch { throw { code: 'bad', message: 'resposta inválida do servidor de rotas (' + r.status + ')' }; }
  if (j.code !== 'Ok') throw { code: j.code || 'erro', message: j.message || j.code || 'erro' };
  return j;
}
export async function probeRoads() {
  st.road = 'testing'; st.vh = 'testing'; emit();
  const vh = fetch(VH_DEF + '/status').then(r => { st.vh = r.ok ? 'ok' : 'fail'; }).catch(() => { st.vh = 'fail'; });
  try { await throttle(); await osrmGet('/route/v1/driving/-46.6349,-23.5891;-46.6627,-23.6009?overview=false'); st.road = 'ok'; }
  catch (e) { st.road = 'fail'; st.roadMsg = (e as ErroRota).message; }
  await vh; emit();
}
export const roadOk = () => { const m = motorRota(); return m === 'google' || (m === 'valhalla' ? st.vh === 'ok' : st.road === 'ok'); };
export const roadUnavailable = () => toast(`Servidor de rotas indisponível: ${st.roadMsg || 'sem conexão'}`, 6000);

/* ----- Google (opcional, com chave) ----- */
async function googleLegs(nodes: Pt[], optimize: boolean, semPedagio: boolean) {
  const g = window.google;
  const ds = new g.maps.DirectionsService(); const legs: any[] = [], path: [number, number][] = []; let order: number[] | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < nodes.length - 1; i += 26) {
    const seg = nodes.slice(i, i + 27); if (seg.length < 2) break;
    const res = await ds.route({ origin: seg[0], destination: seg[seg.length - 1], waypoints: seg.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })), travelMode: g.maps.TravelMode.DRIVING, optimizeWaypoints: !!optimize, avoidTolls: !!semPedagio, region: 'br' });
    const rt = res.routes[0]; legs.push(...rt.legs); rt.overview_path.forEach((pt: { lat(): number; lng(): number }) => path.push([pt.lat(), pt.lng()]));
    if (optimize) order = rt.waypoint_order;
  }
  return { legs, path, order };
}
export function loadGoogle(): Promise<void> {
  return new Promise((res, rej) => {
    if (window.google && window.google.maps && window.google.maps.Map) { res(); return; }
    if (!GMAPS_KEY) { rej(new Error('nenhuma chave do Google configurada em js/config.js')); return; }
    let done = false; const fin = (fn: (v?: unknown) => void, v?: unknown) => { if (!done) { done = true; fn(v); } };
    const w = window as unknown as Record<string, unknown>;
    w.__rtGmapsReady = () => fin(res as () => void);
    w.gm_authFailure = () => { st.g = 'fail'; st.gMsg = 'a chave foi recusada pelo Google'; emit(); };
    const sc = document.createElement('script');
    sc.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GMAPS_KEY) + '&callback=__rtGmapsReady&language=pt-BR&region=BR';
    sc.async = true; sc.onerror = () => fin(rej, new Error('o script do Google não carregou (sem internet ou bloqueado)'));
    document.head.append(sc);
    setTimeout(() => fin(rej, new Error('o Google Maps demorou demais para responder')), 15000);
  });
}
export function startGoogle() {
  if (st.g !== 'idle') return; st.g = 'loading'; emit();
  loadGoogle().then(() => { st.g = 'ready'; emit(); toast('Google Maps conectado'); }).catch(e => { st.g = 'fail'; st.gMsg = e.message; emit(); });
}

/* ----- Cálculo ----- */
export async function roadRoute(nodes: Pt[]): Promise<{ legs: Leg[]; poly: string; src: string; toll?: boolean; terra?: number }> {
  const o = rotaOpt(), m = motorRota(o);
  if (m === 'valhalla') return vhRoute(nodes, o);
  if (m === 'google') { const g = await googleLegs(nodes, false, o.pedagio); return { legs: g.legs.map(l => ({ km: l.distance.value / 1000, min: l.duration.value / 60 })), poly: encodePoly(g.path), src: 'google' }; }
  await throttle();
  const j = await osrmGet(`/route/v1/driving/${coordStr(nodes)}?overview=full&geometries=polyline&steps=false`);
  const rt = j.routes[0];
  return { legs: rt.legs.map((l: { distance: number; duration: number }) => ({ km: l.distance / 1000, min: l.duration / 60 })), poly: rt.geometry, src: 'osrm' };
}
async function roadMatrix(nodes: Pt[]) {
  await throttle();
  const j = await osrmGet(`/table/v1/driving/${coordStr(nodes)}?annotations=distance,duration`);
  const fix = (M: (number | null)[][]) => M.map(row => row.map(v => (v === null || !isNum(v) ? 1e9 : v)));
  return { D: fix(j.distances || j.durations), T: fix(j.durations) };
}
export function realFromLegs(legs: Leg[], hasBase: boolean) {
  const km = legs.map(l => l.km), mn = legs.map(l => l.min);
  const tot = km.reduce((a, b) => a + b, 0);
  const kmIda = hasBase ? km[0] : 0, kmVolta = hasBase && km.length > 1 ? km[km.length - 1] : 0;
  return { km: tot, kmIda, kmVolta, kmEntre: tot - kmIda - kmVolta, min: mn.reduce((a, b) => a + b, 0), em: Date.now() };
}
async function traceRoute(k: string) {
  const r = st.routes.get(k); if (!r) return false;
  const pts = r.stops.map(cliPt).filter(Boolean) as Pt[]; const b = baseOf(r.s);
  const nodes = b ? [b, ...pts, b] : pts; if (nodes.length < 2) return false;
  const memo = st.job && st.job.memo, feito = memo && memo.get(r.sig);
  if (feito) { st.geo!.put(k, feito); return true; }
  const g = await roadRoute(nodes);
  const rec: GeoRota = { sig: r.sig, ...realFromLegs(g.legs, !!b), p: g.poly, src: g.src, o: rotaKey(rotaOpt()), ...(g.toll ? { toll: true } : {}), ...(g.terra !== undefined ? { terra: g.terra } : {}) };
  st.geo!.put(k, rec); if (memo) memo.set(r.sig, rec);
  return true;
}
async function optimizeDayByRoad(s: string, d: number) {
  const union = dayUnion(s, d).filter(x => cliPt(x)); if (union.length < 2) return false;
  const b = baseOf(s); const pts = union.map(x => cliPt(x)!) as Pt[];
  const nodes = b ? [b, ...pts] : pts;
  const o = rotaOpt();
  let order: number[] | null = null, M: { D: number[][]; T: number[][] } | null = null;
  if (motorRota(o) === 'valhalla' && nodes.length <= VH_MATRIZ_MAX) { M = await vhMatriz(nodes, o); if (!M) return false; }
  else if (st.road === 'ok' && nodes.length <= 100) M = await roadMatrix(nodes);
  if (M) { const t = E.sequenceMatrix(o.curta ? M.D : M.T, !!b); order = b ? t.slice(1).map(i => i - 1) : t; }
  else if (gReady() && b && pts.length <= 25) order = (await googleLegs([b, ...pts, b], true, o.pedagio)).order;
  if (!order) { resequence(new Set([s + '|' + d])); return false; }
  order.forEach((idx, pos) => { const it = clone(st.itens!.get(union[idx])!); it.q = { ...(it.q || {}), [d]: pos + 1 }; st.itens!.put(union[idx], it); });
  return true;
}
/* Cálculo em lote: optimize = também reordena cada dia pelas ruas */
export async function roadJob(keys: string[], optimize: boolean, label: string) {
  if (!roadOk()) { roadUnavailable(); return; }
  if (st.job) { toast('Já existe um cálculo em andamento'); return; }
  keys = keys.filter(k => st.routes.has(k)); if (!keys.length) { toast('Nenhuma rota para calcular'); return; }
  if (optimize) pushUndo(label);
  const job = st.job = { cancel: false, done: 0, total: 0, err: null, memo: new Map(), label }; st.showLines = true;
  const days = optimize ? [...new Set(keys.map(k => { const r = st.routes.get(k)!; return r.s + '|' + r.d; }))] : [];
  const trace = new Set(keys);
  if (optimize) for (const r of st.routes.values()) if (days.includes(r.s + '|' + r.d)) trace.add(r.k);
  job.total = days.length + trace.size; emit();
  const kmAntes = sumRoutes([...trace].map(k => st.routes.get(k)!).filter(Boolean)).km;
  try {
    for (const sd of days) { if (job.cancel) break; const [sid, d] = sd.split('|'); await optimizeDayByRoad(sid, +d); job.done++; upd(); }
    rebuild();
    for (const k of trace) {
      if (job.cancel) break;
      try { await traceRoute(k); } catch (e) { const c = (e as ErroRota).code; if (c === 'cancel') break; job.err = e as ErroRota; if (['net', 'rate', 'bad'].includes(c)) break; }
      job.done++; upd();
    }
  } catch (e) { job.err = e as ErroRota; }
  st.job = null;
  rebuild();
  const kmDepois = sumRoutes([...trace].map(k => st.routes.get(k)!).filter(Boolean)).km;
  const semAlt = [...trace].filter(k => { const r = st.routes.get(k); return r && rotaAviso(r.m); }).length;
  const msg = job.err ? `Cálculo interrompido: ${job.err.message || job.err.code}` : job.cancel ? 'Cálculo cancelado — o que já foi calculado ficou salvo' : `${label}: ${trace.size} rota(s) · ${fkm(kmAntes)} km estimados → ${fkm(kmDepois)} km pelas ruas${semAlt ? ` · ${semAlt} sem alternativa ao pedágio ou à terra` : ''}`;
  (optimize ? toastU : (m: string, ms?: number) => toast(m, ms))(msg, 7000);
}
export const jobRestante = () => { const j = st.job; if (!j) return 0; return Math.ceil((j.total - j.done) * (osrmUrl() === OSRM_DEF || motorRota() === 'valhalla' ? 1.1 : 0.3)); };

/* Recalcula sozinho, em segundo plano, as rotas que mudaram (até 12 por vez) */
let autoT: ReturnType<typeof setTimeout> | undefined;
export function autoRoadSync() {
  clearTimeout(autoT);
  autoT = setTimeout(async () => {
    if (!st.autoRoad || !roadOk() || st.job || st.bgBusy || !st.geo) return;
    const stale = [...st.routes.values()].filter(r => r.stale && !st.roadFail.has(r.k + r.sig)).map(r => r.k).slice(0, 12);
    if (!stale.length) return;
    st.bgBusy = true;
    try { for (const k of stale) { const r = st.routes.get(k); try { await traceRoute(k); } catch (e) { st.roadFail.add(k + (r && r.sig)); if (['net', 'rate'].includes((e as ErroRota).code)) break; } } }
    finally { st.bgBusy = false; rebuild(); }
  }, 900);
}
