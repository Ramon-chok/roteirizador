/* Estado central e persistência.
   O estado é um objeto mutável (como na versão anterior) e o React é avisado pelo "bus" a cada mudança.
   Persistência em baldes (BucketStore): localStorage com as mesmas chaves "rt1:" ou tabelas do Supabase de supabase/schema.sql. */
import { useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isNum, sleep } from './util';
import type { Backend, Cliente, Colaborador, Empresa, ErroApp, Estudo, GeoRota, Item, Rota, Usuario } from './types';

/* ----- Aviso de mudança para o React ----- */
let versao = 0;
const ouvintes = new Set<() => void>();
let agendado = false;
export function emit() {
  if (agendado) return; agendado = true;
  queueMicrotask(() => { agendado = false; versao++; ouvintes.forEach(f => f()); });
}
const subscribe = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
export const useVersao = () => useSyncExternalStore(subscribe, () => versao);

/* ----- Backends ----- */
export let MemOnly = false;
export const LocalBackend: Backend = {
  kind: 'local',
  async list(coll) {
    const out: { id: string; data: Record<string, unknown> }[] = [], pre = 'rt1:' + coll + '/';
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pre) && !k.slice(pre.length).includes('/')) out.push({ id: k.slice(pre.length), data: JSON.parse(localStorage.getItem(k) as string) });
      }
    } catch { MemOnly = true; }
    return out;
  },
  async set(coll, id, data) {
    try { localStorage.setItem('rt1:' + coll + '/' + id, JSON.stringify(data)); }
    catch { MemOnly = true; throw { code: 'quota_exceeded', message: 'O armazenamento deste navegador está cheio ou bloqueado.' }; }
  },
  async del(coll, id) { try { localStorage.removeItem('rt1:' + coll + '/' + id); } catch { /* ignora */ } }
};

export const NB = 32;
export function bucketOf(key: string) { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } return 'b' + String((h >>> 0) % NB).padStart(2, '0'); }

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let a = 0; ; a++) {
    try { return await fn(); } catch (e) {
      const c = e && (e as ErroApp).code;
      if ((c === 'unavailable' || c === 'resource_exhausted') && a < 5) { await sleep(400 * 2 ** a + Math.random() * 300); continue; }
      throw e;
    }
  }
}

/* ----- Supabase: cada item dos baldes vira uma linha das tabelas. Só o que mudou é enviado. ----- */
const SB_PAGINA = 1000, SB_LOTE = 500, SB_LOTE_APAGAR = 200;
type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const nulo = (v: unknown) => (v === undefined || v === '' ? null : v);
const coordOk = (v: unknown, lim: number) => (isNum(v) && Math.abs(v) <= lim ? v : null);
const numOk = (v: unknown) => (isNum(v) ? v : null);
const emISO = (ms?: number) => (ms ? new Date(ms).toISOString() : new Date().toISOString());
export const deISO = (t?: string | null) => (t ? Date.parse(t) : Date.now());
const semVazios = <T extends Linha>(o: T): T => { for (const k in o) if (o[k] === null || o[k] === undefined) delete o[k]; return o; };
const SB_MAPA: Record<string, { tab: string; pk: string[]; linha: (k: string, x: Linha) => Linha; item: (r: Linha) => [string, unknown] }> = {
  clientes: {
    tab: 'clientes', pk: ['sold'],
    linha: (k, c) => ({ sold: k, nome: nulo(c.nome), endereco: nulo(c.endereco), bairro: nulo(c.bairro), cidade: nulo(c.cidade), uf: nulo(c.uf), cep: nulo(c.cep), lat: coordOk(c.lat, 90), lng: coordOk(c.lng, 180), visitas_mes: numOk(c.f) ?? 4, atendimento_min: numOk(c.t), geo_origem: nulo(c.geo), geo_nivel: nulo(c.geoNivel), geo_pendencia: c.geoPend || null, exemplo: !!c.exemplo }),
    item: r => [r.sold, { ...semVazios({ sold: r.sold, nome: r.nome, endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep: r.cep, f: r.visitas_mes, t: r.atendimento_min, geo: r.geo_origem, geoNivel: r.geo_nivel, geoPend: r.geo_pendencia, exemplo: r.exemplo || null }), lat: r.lat, lng: r.lng }]
  },
  importacoes: {
    tab: 'importacoes', pk: ['id'],
    linha: (k, x) => ({ id: k, tipo: x.tipo || 'roteiro', arquivo: nulo(x.arquivo), estudo_id: nulo(x.estudo), estudo_nome: nulo(x.estudoNome), usuario: nulo(x.usuario), usuario_login: nulo(x.login), importado_em: emISO(x.em), linhas: x.linhas || 0, alteracoes: x.alteracoes || 0, novos: x.novos || 0, atualizados: x.atualizados || 0, ignorados: x.ignorados || 0, pendencias: x.pend || 0, resumo: x.resumo || [], mensagem: nulo(x.msg) }),
    item: r => [r.id, semVazios({ id: r.id, tipo: r.tipo, arquivo: r.arquivo, estudo: r.estudo_id, estudoNome: r.estudo_nome, usuario: r.usuario, login: r.usuario_login, em: deISO(r.importado_em), linhas: r.linhas, alteracoes: r.alteracoes, novos: r.novos, atualizados: r.atualizados, ignorados: r.ignorados, pend: r.pendencias, resumo: r.resumo || [], msg: r.mensagem })]
  },
  calendario: { tab: 'calendario', pk: ['id'], linha: (k, x) => ({ id: k, data: /^\d{4}-\d{2}-\d{2}$/.test(x.data || '') ? x.data : null, dados: x }), item: r => [r.id, r.dados || {}] },
  verba: { tab: 'verba', pk: ['id'], linha: (k, x) => ({ id: k, tipo: x.tipo || 'outro', mes: nulo(x.mes), vendedor: nulo(x.vend), dados: x }), item: r => [r.id, r.dados || {}] },
  rotasbase: { tab: 'rotas_bases', pk: ['id'], linha: (k, x) => ({ id: k, nome: x.nome || k, periodo: nulo(x.periodo), dados: x }), item: r => [r.id, r.dados || {}] },
  colaboradores: {
    tab: 'colaboradores', pk: ['codigo'],
    linha: (k, c) => ({ codigo: k, nome: c.nome || k, funcao: nulo(c.funcao), endereco: nulo(c.endereco), bairro: nulo(c.bairro), cidade: nulo(c.cidade), uf: nulo(c.uf), cep: nulo(c.cep), lat: coordOk(c.lat, 90), lng: coordOk(c.lng, 180), jornada_min: numOk(c.jornada), cor: nulo(c.cor), geo_origem: nulo(c.geo), geo_nivel: nulo(c.geoNivel), geo_pendencia: c.geoPend || null, exemplo: !!c.exemplo }),
    item: r => [r.codigo, { ...semVazios({ codigo: r.codigo, nome: r.nome, funcao: r.funcao, endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep: r.cep, jornada: r.jornada_min, cor: r.cor, geo: r.geo_origem, geoNivel: r.geo_nivel, geoPend: r.geo_pendencia, exemplo: r.exemplo || null }), lat: r.lat, lng: r.lng }]
  }
};
export function SupabaseBackend(sb: SupabaseClient, emp: string, antesDosFilhos?: () => Promise<void>): Backend {
  const enviados = new Map<string, Map<string, string>>(), setores = new Map<string, Set<string>>();
  const cache = (c: string) => { if (!enviados.has(c)) enviados.set(c, new Map()); return enviados.get(c)!; };
  const erro = (e: ErroApp & { code?: string }): ErroApp => {
    const msg = (e && e.message) || 'erro no banco de dados';
    if (/fetch|network|timeout/i.test(msg) || (e && +(e.status || 0) >= 500)) return { code: 'unavailable', message: 'sem conexão com o banco de dados' };
    if (e && e.code === '42501') return { code: 'sem_permissao', message: 'sem permissão neste ambiente' };
    return { code: (e && e.code) || 'erro', message: msg };
  };
  const pede = async (p: PromiseLike<{ data: unknown; error: unknown }>) => { const { data, error } = await p; if (error) throw erro(error as ErroApp); return data as Linha[]; };
  const tudo = async (tab: string, ordem: string[], filtro?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Linha[] = [];
    for (let de = 0; ; de += SB_PAGINA) {
      let q = sb.from(tab).select('*').eq('empresa_id', emp); if (filtro) q = filtro(q);
      for (const o of ordem) q = q.order(o);
      const lote = await pede(q.range(de, de + SB_PAGINA - 1));
      out.push(...lote); if (lote.length < SB_PAGINA) return out;
    }
  };
  const emLotes = async <T>(linhas: T[], tam: number, fn: (l: T[]) => Promise<unknown>) => { for (let i = 0; i < linhas.length; i += tam) await fn(linhas.slice(i, i + tam)); };
  const grava = (tab: string, linhas: Linha[], conflito: string) => emLotes(linhas, SB_LOTE, l => pede(sb.from(tab).upsert(l, { onConflict: conflito })));
  const metaDe = (r: Linha, sets: Linha[]) => {
    const setoresObj: Record<string, unknown> = {}; for (const x of sets) setoresObj[x.id] = { nome: x.nome, cor: x.cor, colab: x.colaborador_codigo || '' };
    return semVazios({ id: r.id, nome: r.nome, desc: r.descricao ?? '', criado: deISO(r.criado_em), alterado: deISO(r.atualizado_em), setores: setoresObj, pend: r.pendencias || { cli: [], col: [] }, exemplo: r.exemplo || null,
      params: { semanas: r.semanas, dias: r.dias, vel: +r.velocidade_kmh, fator: +r.fator_rota, jornada: +r.jornada_min, tPadrao: +r.atendimento_min, criterio: r.criterio, motor: r.motor, evitaPedagio: r.evita_pedagio, evitaTerra: r.evita_terra } } as Linha);
  };
  const estudoLinha = (m: Linha) => { const p = m.params || {}; return { empresa_id: emp, id: m.id, nome: m.nome || 'Estudo', descricao: nulo(m.desc), semanas: p.semanas || 4, dias: (p.dias || [1, 2, 3, 4, 5]).filter((d: number) => d >= 1 && d <= 7), velocidade_kmh: p.vel || 25, fator_rota: p.fator || 1.35, jornada_min: p.jornada || 480, atendimento_min: p.tPadrao ?? 20, criterio: p.criterio === 'distancia' ? 'distancia' : 'tempo', evita_pedagio: !!p.evitaPedagio, evita_terra: !!p.evitaTerra, motor: p.motor === 'google' ? 'google' : 'osrm', pendencias: m.pend || { cli: [], col: [] }, exemplo: !!m.exemplo, criado_em: emISO(m.criado), atualizado_em: emISO(m.alterado) }; };
  const lerAmb = async () => {
    const es = await tudo('estudos', ['id']), ss = await tudo('setores', ['estudo_id', 'id']);
    const items: Record<string, unknown> = {}; setores.clear();
    for (const r of es) { const sets = ss.filter(x => x.estudo_id === r.id); items[r.id] = metaDe(r, sets); setores.set(r.id, new Set(sets.map(x => x.id))); }
    return items;
  };
  const gravaAmb = async (novos: [string, Linha][], sumidos: string[], antes: Map<string, string>) => {
    if (novos.length) await grava('estudos', novos.map(([, m]) => estudoLinha(m)), 'empresa_id,id');
    for (const [id, m] of novos) {
      const sets = m.setores || {}, ids = Object.keys(sets);
      if (ids.length) await grava('setores', ids.map(x => ({ empresa_id: emp, estudo_id: id, id: x, nome: sets[x].nome || 'Setor', cor: sets[x].cor || '#7d8a84', colaborador_codigo: nulo(sets[x].colab) })), 'empresa_id,estudo_id,id');
      const velho = antes.get(id); const fora = velho ? Object.keys(JSON.parse(velho).setores || {}).filter(x => !sets[x]) : [];
      if (fora.length) await pede(sb.from('setores').delete().eq('empresa_id', emp).eq('estudo_id', id).in('id', fora));
      setores.set(id, new Set(ids));
    }
    if (sumidos.length) await pede(sb.from('estudos').delete().eq('empresa_id', emp).in('id', sumidos));
  };
  const semTabela = (e: ErroApp) => !!e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message || ''));
  const opcional = (c: string) => (c === 'importacoes' ? 'impSemTabela' : c === 'rotasbase' || c.startsWith('rotasl/') ? 'rotasSemTabela' : c === 'calendario' || c === 'verba' ? 'verbaSemTabela' : '');
  const ler0 = async (coll: string): Promise<Record<string, unknown>> => {
    if (coll === 'ambientes') return lerAmb();
    const items: Record<string, unknown> = {}; const m = SB_MAPA[coll];
    if (m) { for (const r of await tudo(m.tab, m.pk)) { const [k, v] = m.item(r); items[k] = v; } return items; }
    const [, estudo] = coll.split('/');
    if (coll.startsWith('rotasl/')) { for (const r of await tudo('rotas_linhas', ['chave'], q => q.eq('base_id', estudo))) items[r.chave] = r.dados || {}; return items; }
    if (coll.startsWith('itens/')) { for (const r of await tudo('estudo_clientes', ['sold'], q => q.eq('estudo_id', estudo))) items[r.sold] = { s: r.setor_id || '', d: r.dias || [], w: r.semanas || [], q: r.sequencia || {} }; return items; }
    for (const r of await tudo('rotas_calculadas', ['setor_id', 'semana', 'dia'], q => q.eq('estudo_id', estudo))) items[`${r.setor_id}|${r.semana}|${r.dia}`] = semVazios({ sig: r.assinatura, km: +r.km, kmIda: +r.km_ida, kmEntre: +r.km_entre, kmVolta: +r.km_volta, min: +r.minutos, p: r.polilinha, src: r.fonte, o: r.formato, toll: r.tem_pedagio || null, terra: r.km_terra === null ? null : +r.km_terra, em: deISO(r.calculado_em) });
    return items;
  };
  const escreve0 = async (coll: string, novos: [string, Linha][], sumidos: string[], antes: Map<string, string>) => {
    if (coll === 'ambientes') return gravaAmb(novos, sumidos, antes);
    const m = SB_MAPA[coll];
    if (m) {
      if (novos.length) await grava(m.tab, novos.map(([k, v]) => ({ empresa_id: emp, ...m.linha(k, v) })), `empresa_id,${m.pk[0]}`);
      await emLotes(sumidos, SB_LOTE_APAGAR, l => pede(sb.from(m.tab).delete().eq('empresa_id', emp).in(m.pk[0], l)));
      return;
    }
    const [, estudo] = coll.split('/');
    if (coll.startsWith('rotasl/')) {
      if (novos.length) await grava('rotas_linhas', novos.map(([k, x]) => ({ empresa_id: emp, base_id: estudo, chave: k, sold: String(x.s ?? ''), vendedor: nulo(x.v), dados: x })), 'empresa_id,base_id,chave');
      await emLotes(sumidos, SB_LOTE_APAGAR, l => pede(sb.from('rotas_linhas').delete().eq('empresa_id', emp).eq('base_id', estudo).in('chave', l)));
      return;
    }
    if (antesDosFilhos) await antesDosFilhos();
    const conhecidos = setores.get(estudo) || new Set();
    if (coll.startsWith('itens/')) {
      if (novos.length) await grava('estudo_clientes', novos.map(([k, it]) => ({ empresa_id: emp, estudo_id: estudo, sold: k, setor_id: conhecidos.has(it.s) ? it.s : null, dias: (it.d || []).filter((d: number) => d >= 1 && d <= 7), semanas: it.w || [], sequencia: it.q || {} })), 'empresa_id,estudo_id,sold');
      await emLotes(sumidos, SB_LOTE_APAGAR, l => pede(sb.from('estudo_clientes').delete().eq('empresa_id', emp).eq('estudo_id', estudo).in('sold', l)));
      return;
    }
    const linhas: Linha[] = [];
    for (const [k, g] of novos) { const [sid, w, d] = k.split('|'); if (conhecidos.has(sid)) linhas.push({ empresa_id: emp, estudo_id: estudo, setor_id: sid, semana: +w, dia: +d, assinatura: g.sig, km: g.km, km_ida: g.kmIda || 0, km_entre: g.kmEntre || 0, km_volta: g.kmVolta || 0, minutos: g.min || 0, polilinha: nulo(g.p), fonte: g.src || 'osrm', formato: g.o || 'rapida', tem_pedagio: !!g.toll, km_terra: numOk(g.terra), calculado_em: emISO(g.em) }); }
    if (linhas.length) await grava('rotas_calculadas', linhas, 'empresa_id,estudo_id,setor_id,semana,dia');
    for (const k of sumidos) { const [sid, w, d] = k.split('|'); await pede(sb.from('rotas_calculadas').delete().eq('empresa_id', emp).eq('estudo_id', estudo).eq('setor_id', sid).eq('semana', +w).eq('dia', +d)); }
  };
  const ler = async (coll: string) => { try { return await ler0(coll); } catch (e) { const f = opcional(coll); if (f && semTabela(e as ErroApp)) { (st as unknown as Record<string, boolean>)[f] = true; return {}; } throw e; } };
  const escreve = async (coll: string, novos: [string, Linha][], sumidos: string[], antes: Map<string, string>) => { try { return await escreve0(coll, novos, sumidos, antes); } catch (e) { const f = opcional(coll); if (f && semTabela(e as ErroApp)) { (st as unknown as Record<string, boolean>)[f] = true; return; } throw e; } };
  const be: Backend = {
    kind: 'cloud',
    async list(coll) {
      const items = await ler(coll), c = cache(coll); c.clear();
      for (const k in items) c.set(k, JSON.stringify(items[k]));
      return Object.keys(items).length ? [{ id: 'todos', data: { items } }] : [];
    },
    async set(coll, balde, data) {
      const c = cache(coll), items = ((data as { items?: Record<string, Linha> }) && (data as { items?: Record<string, Linha> }).items) || {}, novos: [string, Linha][] = [], sumidos: string[] = [];
      for (const k in items) { if (c.get(k) !== JSON.stringify(items[k])) novos.push([k, items[k]]); }
      for (const k of c.keys()) if (bucketOf(k) === balde && !(k in items)) sumidos.push(k);
      if (!novos.length && !sumidos.length) return;
      await escreve(coll, novos, sumidos, c);
      for (const [k, v] of novos) c.set(k, JSON.stringify(v));
      for (const k of sumidos) c.delete(k);
    },
    async del(coll, balde) { await be.set(coll, balde, { items: {} }); }
  };
  return be;
}

/* ----- Situação da gravação (indicador "Salvo") ----- */
export const Save = {
  stores: new Set<BucketStore<unknown>>(), err: null as ErroApp | null,
  pendente() { for (const s of this.stores) if (s.dirty.size || s.busy || s.t) return true; return false; },
  update() { emit(); },
  retry() { this.err = null; for (const s of this.stores) { s.markAll(); s.flush(); } emit(); }
};

export class BucketStore<T> {
  coll: string; map = new Map<string, T>(); dirty = new Set<string>(); t: ReturnType<typeof setTimeout> | null = null; busy = false; again = false;
  constructor(coll: string) { this.coll = coll; Save.stores.add(this as BucketStore<unknown>); }
  async load() { this.map.clear(); const docs = await withRetry(() => st.backend!.list(this.coll)); for (const d of docs) { const it = (d.data && d.data.items) || {}; for (const k in it) this.map.set(k, it[k] as T); } emit(); }
  get(k: string) { return this.map.get(k); }
  has(k: string) { return this.map.has(k); }
  values() { return this.map.values(); }
  keys() { return this.map.keys(); }
  entries() { return this.map.entries(); }
  get size() { return this.map.size; }
  put(k: string, v: T) { if (st.ro) return; this.map.set(k, v); this.dirty.add(bucketOf(k)); this.sched(); }
  del(k: string) { if (st.ro) return; if (this.map.delete(k)) { this.dirty.add(bucketOf(k)); this.sched(); } }
  replaceAll(m: Map<string, T>) { for (const k of this.map.keys()) this.dirty.add(bucketOf(k)); this.map = m; for (const k of m.keys()) this.dirty.add(bucketOf(k)); this.sched(); }
  markAll() { for (let i = 0; i < NB; i++) this.dirty.add('b' + String(i).padStart(2, '0')); }
  sched() { if (this.t) clearTimeout(this.t); this.t = setTimeout(() => { this.t = null; this.flush(); }, 650); emit(); }
  async flush() {
    if (st.ro) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; emit();
    let bs: string[] = [];
    try {
      while (this.dirty.size) {
        bs = [...this.dirty]; this.dirty.clear();
        const groups = new Map<string, Record<string, T>>(bs.map(b => [b, {}]));
        for (const [k, v] of this.map) { const g = groups.get(bucketOf(k)); if (g) g[k] = v; }
        for (const [b, items] of groups) {
          if (Object.keys(items).length) await withRetry(() => st.backend!.set(this.coll, b, { items }));
          else await withRetry(() => st.backend!.del(this.coll, b));
          bs = bs.filter(x => x !== b);
        }
      }
      Save.err = null;
    } catch (e) {
      bs.forEach(b => this.dirty.add(b));
      Save.err = (e as ErroApp) || { message: 'erro' };
      if (e && (e as ErroApp).code === 'invalid_argument') { st.ro = true; Save.err = { message: 'sem permissão de edição' }; }
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; if (this.dirty.size && !Save.err) this.flush(); }
      emit();
    }
  }
  async destroy() { this.map.clear(); this.dirty.clear(); for (let i = 0; i < NB; i++) { try { await withRetry(() => st.backend!.del(this.coll, 'b' + String(i).padStart(2, '0'))); } catch { /* ignora */ } } Save.stores.delete(this as BucketStore<unknown>); }
  detach() { Save.stores.delete(this as BucketStore<unknown>); }
}

/* ----- Estado da aplicação ----- */
export type Tela = 'login' | 'home' | 'planner';
export type HubSec = 'hub' | 'planejamento' | 'rotas' | 'verba' | 'calendario' | 'config';
export type PlannerView = 'mapa' | 'roteiros' | 'estudos' | 'clientes' | 'colaboradores' | 'importar' | 'config';

export const st = {
  /* acesso */
  base: LocalBackend as Backend, backend: null as Backend | null, sb: null as SupabaseClient | null, sbFalhou: false,
  empresa: null as Empresa | null, usuario: null as Usuario | null, ro: false, mfaAtivo: false,
  politica: { exige2fa: false, inatividadeMin: 30 }, polSemColuna: false, audSemTabela: false, consSemTabela: false,
  impSemTabela: false, rotasSemTabela: false, verbaSemTabela: false,
  /* dados */
  cli: null as BucketStore<Cliente> | null, col: null as BucketStore<Colaborador> | null, amb: null as BucketStore<Estudo> | null,
  imp: null as BucketStore<Record<string, unknown>> | null,
  itens: null as BucketStore<Item> | null, geo: null as BucketStore<GeoRota> | null, cur: null as string | null, lastAmb: undefined as string | undefined,
  routes: new Map<string, Rota>(), carregando: true,
  /* navegação */
  tela: 'login' as Tela, homeSec: 'hub' as HubSec, view: 'mapa' as PlannerView, homeFocus: null as string | null, homeSetor: '',
  /* mapa */
  colorBy: 'setor', colorAntes: null as string | null, baseKind: 'auto', pinos: true,
  hidden: new Set<string>(), hiddenSet: new Set<string>(), qf: { w: [] as number[], d: [] as number[] }, visao: 'base' as 'base' | 'setores' | 'rotas',
  arv: new Map<string, boolean>(), baseF: { cidades: new Set<string>(), soldes: new Set<string>(), q: '', cq: '' }, baseCor: 'cidade',
  showLines: true, showBases: true, showSeq: true, showOut: true, showUnassigned: true, verSemSetor: true, showSea: true,
  sel: new Set<string>(), tool: 'select' as 'select' | 'rect' | 'lasso' | 'pan' | 'ruler', soloSetor: '' as string,
  panelL: true, panelR: false,
  undo: [] as Foto[], redo: [] as Foto[], autoResequence: true,
  /* rotas pelas ruas */
  g: 'idle' as 'idle' | 'loading' | 'ready' | 'fail', gMsg: '', road: 'idle', vh: 'idle', roadMsg: '', autoRoad: true, bgBusy: false,
  roadFail: new Set<string>(), pathCache: new Map<string, { sig: string; path: [number, number][] }>(),
  job: null as Job | null,
  /* páginas */
  pg: {
    clientes: { q: '', page: 0, cidade: '', semCoord: false, noEstudo: '', chk: new Set<string>() },
    colaboradores: { q: '', chk: new Set<string>() },
    roteiros: { mode: 'grade', setor: '', chk: new Set<string>() },
    imp: { tipo: '', n: 15 }
  }
};
export interface Foto { label: string; em: number; id: number; amb: string | null; itens: Map<string, Item>; geo: Map<string, GeoRota> | null; meta: Estudo }
export interface Job { cancel: boolean; done: number; total: number; err: ErroApp | null; memo: Map<string, GeoRota>; label: string }
export type State = typeof st;
