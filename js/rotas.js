/* Módulo Rotas: bases de roteiros importadas por período (mês/ano), com visão geral, tabela, mapa com pinos e regiões,
   histórico e comparação lado a lado com um estudo do Planejamento.
   Cada base guarda as linhas (cliente × vendedor × dias × semanas, ou a data da visita) e um resumo por rota
   (vendedor × semana × dia) calculado na importação, que alimenta o histórico sem precisar carregar todas as linhas.
   Usa as funções internas expostas pelo app.js em window.RRM. */
(function () {
'use strict';
const R = window.RRM; if (!R) return;
const { st, $, $$, esc, toast, openModal, closeModal, ICON, nf0, nf1, fkm, fhm, fpct, E, isNum, uid, norm, numBR, parseDias, parseSemanas, hasXY, hbars, vcols, saveFile, xlsxBlob, slug, dstamp, fdh, DIA_C, DIA_L, COR_DIA } = R;

const PARAM_ID = '__parametros';
const DEF = { valorKm: 0, fator: 1.35, vel: 25, jornada: 480, tPadrao: 20 };
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = v => 'R$ ' + nf2.format(v || 0);
const novoFiltro = () => ({ cid: new Set(), rg: new Set(), vend: new Set(), eq: new Set(), sg: new Set(), d: new Set(), w: new Set(), tempo: '', q: '' });
const RS = {
  bases: null, carregando: null, linhas: new Map(), memo: new Map(), poly: new Map(), estudos: new Map(),
  aba: 'geral', base: '', tab: 'vend', abertos: new Set(), aberto: '', f: novoFiltro(),
  cor: 'vend', verLinhas: true, verRegioes: false, verBases: true, hist: { de: '', ate: '', met: 'km' },
  cmp: { a: null, b: null }, nomes: new Map(), ultimo: null, maps: [], job: null, ligado: false
};

/* ---------- Períodos e datas ---------- */
const fmtPer = p => { const m = /^(\d{4})-(\d{2})$/.exec(p || ''); return m ? `${MES[+m[2] - 1]}/${m[1]}` : (p || 'sem período'); };
const fmtPerLongo = p => { const m = /^(\d{4})-(\d{2})$/.exec(p || ''); return m ? `${MES_L[+m[2] - 1]} de ${m[1]}` : (p || 'sem período'); };
const mesAtual = () => new Date().toISOString().slice(0, 7);
const pad2 = n => String(n).padStart(2, '0');
function deSerialExcel(n) { const d = new Date(Math.round((n - 25569) * 864e5)); return isNaN(d) ? '' : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function parseData(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? deSerialExcel(v) : '';
  const s = String(v).trim(); let m;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad2(m[2])}-${pad2(m[1])}`; }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  return '';
}
function parsePeriodo(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') { if (v > 20000 && v < 80000) return deSerialExcel(v).slice(0, 7); if (v > 190001 && v < 210012) return `${Math.floor(v / 100)}-${pad2(v % 100)}`; return ''; }
  const s = norm(v).replace(/de/g, ''), t = String(v).trim(); let m;
  if ((m = /^(\d{4})[-/.]?(\d{1,2})$/.exec(t))) return `${m[1]}-${pad2(m[2])}`;
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(t))) return `${m[2]}-${pad2(m[1])}`;
  const d = parseData(t); if (d) return d.slice(0, 7);
  const i = MES.findIndex(x => s.startsWith(norm(x))); const y = /(\d{4}|\d{2})$/.exec(s);
  if (i >= 0 && y) return `${y[1].length === 2 ? '20' + y[1] : y[1]}-${pad2(i + 1)}`;
  return '';
}

/* ---------- Dados ---------- */
async function iniciar() {
  if (RS.bases) return;
  if (!RS.carregando) RS.carregando = (async () => { const b = new R.BucketStore('rotasbase'); try { await b.load(); } catch (e) { /* segue vazio */ } RS.bases = b; })();
  await RS.carregando;
}
const params = () => ({ ...DEF, ...((RS.bases && RS.bases.get(PARAM_ID)) || {}).p });
const psig = p => [p.fator, p.vel, p.jornada, p.tPadrao].join('|');
const basesList = () => (RS.bases ? [...RS.bases.values()].filter(b => b && b.id && b.id !== PARAM_ID) : []).sort((a, b) => String(b.periodo || '').localeCompare(String(a.periodo || '')) || (b.em || 0) - (a.em || 0));
const nomeVend = v => { if (RS.nomes.has(v)) return RS.nomes.get(v); const c = st.col && st.col.get(v); return c && c.nome ? c.nome : 'Vendedor ' + v; };
const corVend = (v, i) => { const c = st.col && st.col.get(v); return (c && c.cor) || E.PALETA[i % E.PALETA.length]; };
// Posição e dados do cliente: a base de clientes vale primeiro; a planilha completa o que faltar
function info(l) {
  const c = st.cli && st.cli.get(l.s), p = params();
  const lat = c && hasXY(c) ? c.lat : l.lat, lng = c && hasXY(c) ? c.lng : l.lng;
  return { nome: l.nm || (c && c.nome) || l.s, cidade: l.cid || (c && c.cidade) || '', lat, lng, ok: isNum(lat) && isNum(lng), t: isNum(l.t) ? l.t : c && isNum(c.t) ? c.t : p.tPadrao, sg: l.sg || '', rg: l.rg || '', eq: l.eq || '' };
}
async function linhasDe(id) {
  if (RS.linhas.has(id)) return RS.linhas.get(id).map;
  const s = new R.BucketStore('rotasl/' + id + '/b'); await s.load(); RS.linhas.set(id, s); return s.map;
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const fatorMes = b => (b.porData ? 1 : 4 / Math.max(1, b.ciclo || 4));
const semanasCiclo = b => Math.max(1, b.ciclo || 4);

/* Rotas de uma base: vendedor × semana × dia, na ordem informada ou na melhor ordem calculada */
function calcula(b, linhas) {
  const p = params(), sig = psig(p) + '|' + (b.geoV || 0) + '|' + (st.cli ? st.cli.size : 0) + '|' + (st.col ? st.col.size : 0);
  const m0 = RS.memo.get(b.id); if (m0 && m0.sig === sig && m0.n === linhas.size) return m0.routes;
  const routes = new Map();
  for (const l of linhas.values()) for (const w of l.w || []) for (const d of l.d || []) {
    const k = `${l.v}|${w}|${d}`; let r = routes.get(k);
    if (!r) { r = { k, v: l.v, w, d, ls: [], vistos: new Set() }; routes.set(k, r); }
    if (!r.vistos.has(l.s)) { r.vistos.add(l.s); r.ls.push(l); }
  }
  for (const r of routes.values()) {
    delete r.vistos;
    const col = st.col && st.col.get(r.v), base = col && hasXY(col) ? { lat: col.lat, lng: col.lng } : null;
    const pts = r.ls.map(l => ({ l, ...info(l) })).filter(x => x.ok);
    let ord;
    if (pts.length && pts.every(x => isNum(x.l.q))) ord = pts.slice().sort((a, c) => a.l.q - c.l.q);
    else ord = E.sequence(base, pts).map(i => pts[i]);
    const m = E.routeMetrics(base, ord.map(x => ({ lat: x.lat, lng: x.lng, t: x.t })), { fator: p.fator, vel: p.vel, jornada: (col && col.jornada) || p.jornada });
    r.ord = ord; r.base = base; r.semXY = r.ls.length - pts.length;
    r.sig = hashStr(ord.map(x => x.l.s).join(',') + (base ? '@' + base.lat.toFixed(4) + ',' + base.lng.toFixed(4) : ''));
    const g = b.geo && b.geo[r.k];
    if (g && g.sig === r.sig) { const total = g.min + m.tAtend; r.m = { ...m, km: g.km, tDesl: g.min, total, ocup: m.jornada ? total / m.jornada : 0, real: true }; }
    else r.m = m;
  }
  RS.memo.set(b.id, { sig, n: linhas.size, routes });
  return routes;
}
// Resumo guardado na base: uma linha por rota, com as cidades, regiões e segmentos que ela atende
function resumo(b, routes) {
  const dic = { cid: [], rg: [], sg: [] }, ix = { cid: new Map(), rg: new Map(), sg: new Map() };
  const ide = (k, v) => { if (!v) return -1; let i = ix[k].get(v); if (i === undefined) { i = dic[k].length; dic[k].push(v); ix[k].set(v, i); } return i; };
  const rotas = [], eqC = {}, cliV = {};
  for (const r of routes.values()) {
    const cs = new Set(), rs = new Set(), ss = new Set();
    for (const l of r.ls) {
      const x = info(l); [['cid', x.cidade, cs], ['rg', x.rg, rs], ['sg', x.sg, ss]].forEach(([k, v, set]) => { const i = ide(k, v); if (i >= 0) set.add(i); });
      if (x.eq) { const e = eqC[r.v] || (eqC[r.v] = {}); e[x.eq] = (e[x.eq] || 0) + 1; }
      (cliV[r.v] || (cliV[r.v] = new Set())).add(l.s);
    }
    rotas.push([r.v, r.w, r.d, r.m.n, Math.round(r.m.km * 10) / 10, Math.round(r.m.tDesl), Math.round(r.m.tAtend), [...cs], [...rs], [...ss], r.m.jornada, r.m.real ? 1 : 0]);
  }
  const eqV = {}; for (const v in eqC) eqV[v] = Object.entries(eqC[v]).sort((a, c) => c[1] - a[1])[0][0];
  const cv = {}; for (const v in cliV) cv[v] = cliV[v].size;
  return { p: psig(params()), rotas, dic, eqV, cliV: cv };
}
function guardaResumo(b, routes) { const nb = { ...RS.bases.get(b.id), res: resumo(b, routes) }; RS.bases.put(b.id, nb); return nb; }

/* ---------- Filtros ---------- */
const temFiltroCliente = f => f.cid.size || f.rg.size || f.sg.size || f.tempo || f.q.trim();
const faixaTempo = (t, fx) => (fx === 'a' ? t <= 10 : fx === 'b' ? t > 10 && t <= 20 : fx === 'c' ? t > 20 && t <= 30 : fx === 'd' ? t > 30 : true);
function passaCliente(l, x, f) {
  if (f.cid.size && !f.cid.has(x.cidade)) return false;
  if (f.rg.size && !f.rg.has(x.rg)) return false;
  if (f.sg.size && !f.sg.has(x.sg)) return false;
  if (f.tempo && !faixaTempo(x.t, f.tempo)) return false;
  const q = norm(f.q); if (q && !(norm(l.s).includes(q) || norm(x.nome).includes(q))) return false;
  return true;
}
// Registros de rota (formato comum para a base aberta, o histórico e o estudo)
function recsVivos(b, routes, f = RS.f, eqV = {}) {
  const out = [], cf = temFiltroCliente(f);
  for (const r of routes.values()) {
    if (f.vend.size && !f.vend.has(r.v)) continue;
    if (f.d.size && !f.d.has(r.d)) continue;
    if (f.w.size && !f.w.has(r.w)) continue;
    if (f.eq.size && !f.eq.has(eqV[r.v] || '')) continue;
    const cli = []; let algum = false;
    for (const l of r.ls) { const x = info(l); if (!cf || passaCliente(l, x, f)) { cli.push(l.s); algum = true; } }
    if (cf && !algum) continue;
    out.push({ k: r.k, v: r.v, w: r.w, d: r.d, n: r.m.n, km: r.m.km, des: r.m.tDesl, at: r.m.tAtend, jor: r.m.jornada, cli, real: !!r.m.real, r });
  }
  return out;
}
function recsResumo(b, f = RS.f) {
  const res = b.res; if (!res) return [];
  const has = (set, arr, dic) => !set.size || arr.some(i => set.has(dic[i]));
  return res.rotas.filter(x => (!f.vend.size || f.vend.has(x[0])) && (!f.d.size || f.d.has(x[2])) && (!f.w.size || f.w.has(x[1])) && (!f.eq.size || f.eq.has(res.eqV[x[0]] || ''))
    && has(f.cid, x[7], res.dic.cid) && has(f.rg, x[8], res.dic.rg) && has(f.sg, x[9], res.dic.sg))
    .map(x => ({ v: x[0], w: x[1], d: x[2], n: x[3], km: x[4], des: x[5], at: x[6], jor: x[10] || params().jornada, real: !!x[11] }));
}
// Totais no mês. fm converte o ciclo da base em um mês de 4 semanas
function agrega(recs, fm, W, cliV) {
  const o = { rotas: recs.length, km: 0, des: 0, at: 0, n: 0, oc: 0, vend: new Set(), dias: new Set(), cli: new Set(), real: 0 };
  for (const r of recs) { o.km += r.km; o.des += r.des; o.at += r.at; o.n += r.n; o.oc += r.jor ? (r.des + r.at) / r.jor : 0; o.vend.add(r.v); o.dias.add(r.w + '|' + r.d); if (r.cli) r.cli.forEach(s => o.cli.add(s)); if (r.real) o.real++; }
  const p = params(), clientes = recs.some(r => r.cli) ? o.cli.size : [...o.vend].reduce((s, v) => s + ((cliV && cliV[v]) || 0), 0);
  return {
    rotas: recs.length, rotasMes: recs.length * fm, vendedores: o.vend.size, clientes, visitasMes: o.n * fm,
    kmCiclo: o.km, kmMes: o.km * fm, kmSemana: o.km / W, kmDia: recs.length ? o.km / recs.length : 0,
    desMes: o.des * fm, atMes: o.at * fm, horasMes: (o.des + o.at) * fm, horasDia: recs.length ? (o.des + o.at) / recs.length : 0,
    ocup: recs.length ? o.oc / recs.length : 0, custoMes: o.km * fm * p.valorKm, custoSemana: (o.km / W) * p.valorKm, custoDia: recs.length ? (o.km / recs.length) * p.valorKm : 0,
    pctReal: recs.length ? o.real / recs.length : 0
  };
}
function eqDe(b, routes) { const eq = {}; for (const r of routes.values()) for (const l of r.ls) if (l.eq && !eq[r.v]) eq[r.v] = l.eq; return Object.keys(eq).length ? eq : (b.res && b.res.eqV) || {}; }

/* ---------- Importação (chamada pelo assistente de importação do app) ---------- */
function opcoesImport(wz) {
  if (!wz.rt) wz.rt = { nome: String(wz.arquivo || 'Base de roteiros').replace(/\.[^.]+$/, ''), periodo: mesAtual(), subst: true };
  const temPer = wz.map.periodo >= 0 || wz.map.data >= 0;
  return `<div class="fgrid"><label class="field"><span class="lbl">Nome da base</span><input type="text" id="rtNome" value="${esc(wz.rt.nome)}" maxlength="80"></label>
    <label class="field"><span class="lbl">Período${temPer ? ' (para linhas sem Período/Data)' : ''}</span><input type="month" id="rtPer" value="${esc(wz.rt.periodo)}"></label></div>
    <label class="chk"><input type="checkbox" id="rtSubst" ${wz.rt.subst ? 'checked' : ''}> Substituir a base que já existir no mesmo período</label>
    ${wz.map.dia >= 0 || wz.map.data >= 0 ? '' : '<div class="banner">Escolha a coluna de Dia (com Semana) ou de Data da visita: sem uma delas não há como montar as rotas.</div>'}`;
}
function ligaOpcoesImport(wz) {
  const n = $('#rtNome'), p = $('#rtPer'), s = $('#rtSubst');
  if (n) n.oninput = () => { wz.rt.nome = n.value; };
  if (p) p.onchange = () => { wz.rt.periodo = p.value || mesAtual(); };
  if (s) s.onchange = () => { wz.rt.subst = s.checked; };
}
async function importar(wz, cellOf) {
  if (st.ro) { toast('Ambiente em modo somente leitura'); return null; }
  if (!(wz.map.dia >= 0) && !(wz.map.data >= 0)) { toast('Escolha a coluna de Dia ou a de Data da visita'); return null; }
  await iniciar();
  const porPer = new Map(); let semSold = 0, semVend = 0, semDia = 0, semSemana = 0;
  for (const row of wz.rows) {
    const c = cellOf(row);
    const s = String(c('sold') ?? '').trim(), v = String(c('colab') ?? '').trim();
    if (!s) { semSold++; continue; } if (!v) { semVend++; continue; }
    const dt = wz.map.data >= 0 ? parseData(c('data')) : '';
    let per = wz.map.periodo >= 0 ? parsePeriodo(c('periodo')) : ''; if (!per && dt) per = dt.slice(0, 7); if (!per) per = wz.rt.periodo || mesAtual();
    let d, w;
    if (dt) { const D = new Date(dt + 'T12:00:00'); d = [((D.getDay() + 6) % 7) + 1]; w = [Math.min(5, Math.ceil(D.getDate() / 7))]; }
    else { d = parseDias(String(c('dia') ?? '').trim()); w = parseSemanas(c('semana'), 4); if (!w.length) { w = [1, 2, 3, 4]; semSemana++; } }
    if (!d.length) { semDia++; continue; }
    const l = { s, v, d, w };
    if (dt) l.dt = dt;
    for (const [k, campo] of [['eq', 'equipe'], ['rg', 'regiao'], ['sg', 'segmento'], ['cid', 'cidade'], ['nm', 'nome']]) { if (!(wz.map[campo] >= 0)) continue; const x = String(c(campo) ?? '').trim(); if (x) l[k] = x.slice(0, 80); }
    const t = numBR(c('t')); if (isNum(t) && t >= 0 && t < 600) l.t = t;
    const q = numBR(c('seq')); if (isNum(q)) l.q = q;
    const la = numBR(c('lat')), ln = numBR(c('lng')); if (isNum(la) && isNum(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && (la || ln)) { l.lat = la; l.lng = ln; }
    if (!porPer.has(per)) porPer.set(per, []); porPer.get(per).push(l);
  }
  if (!porPer.size) { toast('Nenhuma linha válida: confira as colunas de SOLD, vendedor e dia.'); return null; }
  const lines = [], criadas = []; let total = 0; const semXY = new Set();
  for (const [per, ls] of [...porPer].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (wz.rt.subst) for (const b of basesList().filter(x => x.periodo === per)) await excluiBase(b.id);
    const id = uid('rb'), porData = ls.some(l => l.dt);
    const meta = { id, nome: (porPer.size > 1 ? `${wz.rt.nome || 'Base'} · ${fmtPer(per)}` : wz.rt.nome || 'Base de roteiros').slice(0, 100), periodo: per, arquivo: wz.arquivo || '', usuario: (st.usuario && st.usuario.nome) || '', em: Date.now(), n: ls.length, porData, ciclo: Math.max(1, ...ls.flatMap(l => l.w)), geo: {} };
    const store = new R.BucketStore('rotasl/' + id + '/b');
    ls.forEach((l, i) => store.map.set('l' + i.toString(36).padStart(4, '0'), l));
    store.markAll(); store.sched(); RS.linhas.set(id, store);
    ls.forEach(l => { if (!info(l).ok) semXY.add(l.s); });
    meta.res = resumo(meta, calcula(meta, store.map));
    RS.bases.put(id, meta); criadas.push(meta); total += ls.length;
  }
  const ult = criadas[criadas.length - 1]; RS.base = ult.id; RS.aba = 'geral'; RS.f = novoFiltro();
  lines.push(['info', `${nf0.format(total)} linha(s) em ${criadas.length} base(s): ${criadas.map(b => `<b>${esc(fmtPer(b.periodo))}</b> (${nf0.format(b.n)})`).join(', ')}.`]);
  const ag = agrega(recsResumo(ult, novoFiltro()), fatorMes(ult), semanasCiclo(ult), ult.res.cliV);
  lines.push(['info', `${esc(fmtPer(ult.periodo))}: ${nf0.format(ag.vendedores)} vendedor(es), ${nf0.format(ag.clientes)} cliente(s), ${nf0.format(ag.rotas)} rota(s) no ${ult.porData ? 'mês' : 'ciclo'} e ${fkm(ag.kmMes)} km por mês (estimado).`]);
  if (semXY.size) lines.push(['', `${nf0.format(semXY.size)} cliente(s) sem coordenada (nem na base de clientes, nem na planilha) ficam fora do mapa e do KM: ${[...semXY].slice(0, 8).map(esc).join(', ')}${semXY.size > 8 ? '…' : ''}. Cadastre ou ajuste em Planejamento → Clientes.`]);
  if (semSemana) lines.push(['', `${nf0.format(semSemana)} linha(s) sem semana foram consideradas semanais (1234).`]);
  if (semDia + semVend + semSold) lines.push(['', `${nf0.format(semDia + semVend + semSold)} linha(s) ignoradas: ${[semSold && semSold + ' sem SOLD do cliente', semVend && semVend + ' sem vendedor', semDia && semDia + ' sem dia ou data'].filter(Boolean).join(', ')}.`]);
  if (st.rotasSemTabela) lines.push(['bad', 'O banco ainda não tem as tabelas de Rotas: a base vale só nesta sessão. Rode <b>supabase/migracao_05_rotas.sql</b> no Supabase.']);
  if (!params().valorKm) lines.push(['', 'Informe o valor do KM em Rotas → Parâmetros para ver o custo por dia, semana e mês.']);
  return { lines, reg: { linhas: wz.rows.length, alteracoes: total, novos: criadas.length, ignorados: semDia + semVend + semSold } };
}
async function excluiBase(id) {
  const s = RS.linhas.get(id) || new R.BucketStore('rotasl/' + id + '/b');
  try { if (!RS.linhas.has(id)) await s.load(); await s.destroy(); } catch (e) { /* segue */ }
  RS.linhas.delete(id); RS.memo.delete(id); RS.bases.del(id);
  if (RS.base === id) RS.base = '';
}

/* ---------- Mapas ---------- */
function limpar() { for (const m of RS.maps) { try { m.remove(); } catch (e) { /* ignora */ } } RS.maps = []; }
function criaMapa(el) {
  const m = L.map(el, { zoomControl: true, preferCanvas: true, attributionControl: true, boxZoom: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
  m.attributionControl.setPrefix('');
  let kind = st.baseKind; if (!R.BASES[kind]) kind = R.isDark() ? 'escuro' : 'claro';
  const b = R.BASES[kind]; L.tileLayer(b.url, { attribution: b.att, maxZoom: 19, maxNativeZoom: b.nz || 19 }).addTo(m);
  L.control.scale({ metric: true, imperial: false, position: 'bottomright', maxWidth: 140 }).addTo(m);
  m.createPane('rtLinhas'); m.getPane('rtLinhas').style.zIndex = 390;
  m._rtPts = L.canvas({ padding: 0.4, tolerance: 5 }); m._rtLin = L.canvas({ pane: 'rtLinhas', padding: 0.4 });
  RS.maps.push(m); return m;
}
// Envoltória convexa (cadeia monótona) para desenhar a região de cada grupo
function envoltoria(pts) {
  const p = [...new Map(pts.map(x => [x[0].toFixed(5) + ',' + x[1].toFixed(5), x])).values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lo = [], up = [];
  for (const x of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); }
  for (const x of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop(); up.push(x); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const tipCli = (l, x, extra = '') => `<div class="tip"><b>${esc(x.nome)}</b><br><span class="t2">SOLD ${esc(l.s)} · ${esc(nomeVend(l.v))}${x.cidade ? ' · ' + esc(x.cidade) : ''}</span><br><span class="t2">${(l.d || []).map(d => DIA_C[d]).join('/')} · sem. ${(l.w || []).join(',')}${x.sg ? ' · ' + esc(x.sg) : ''} · ${nf0.format(x.t)} min</span>${extra}</div>`;
// Desenha rotas num mapa. rotas = [{k, v, d, w, ord:[{l, lat, lng}], base}], cor(r) define a cor
function desenhaRotas(m, rotas, cor, opts = {}) {
  const grupos = new Map(), feitos = new Set(), bounds = [], sel = opts.cliOk;
  const numeros = rotas.length <= 12;
  for (const r of rotas) {
    const c = cor(r), lls = [];
    r.ord.forEach((x, i) => {
      lls.push([x.lat, x.lng]); bounds.push([x.lat, x.lng]);
      if (feitos.has(x.l.s)) return; feitos.add(x.l.s);
      if (sel && !sel.has(x.l.s)) return;
      const destaque = opts.destaque && opts.destaque.has(x.l.s);
      const mk = new R.PinMarker([x.lat, x.lng], { renderer: m._rtPts, radius: 6, color: destaque ? '#18211D' : '#FFFFFF', weight: destaque ? 2.6 : 1.4, fillColor: c, fillOpacity: 0.95, label: numeros ? String(i + 1) : '', big: destaque });
      mk.bindTooltip(() => tipCli(x.l, info(x.l), destaque ? `<br><span class="t2"><b>${esc(opts.destaqueTxt || '')}</b></span>` : ''), { direction: 'top', offset: [0, -26] }).addTo(m);
      if (opts.grupo) { const g = opts.grupo(r, x); if (g) { if (!grupos.has(g.k)) grupos.set(g.k, { cor: g.cor, nome: g.nome, pts: [] }); grupos.get(g.k).pts.push([x.lat, x.lng]); } }
    });
    if (opts.linhas !== false && lls.length) {
      const poly = RS.poly.get(r.polyKey || r.k);
      if (poly) L.polyline(poly, { renderer: m._rtLin, color: c, weight: rotas.length > 12 ? 2.5 : 3.5, opacity: 0.85, interactive: false }).addTo(m);
      else {
        L.polyline(lls, { renderer: m._rtLin, color: c, weight: rotas.length > 12 ? 2 : 3, opacity: 0.8, interactive: false }).addTo(m);
        if (r.base) { const o = { renderer: m._rtLin, color: c, weight: 2, opacity: 0.55, dashArray: '4 6', interactive: false }; L.polyline([[r.base.lat, r.base.lng], lls[0]], o).addTo(m); L.polyline([lls[lls.length - 1], [r.base.lat, r.base.lng]], o).addTo(m); }
      }
    }
  }
  if (opts.regioes) for (const g of grupos.values()) {
    const h = envoltoria(g.pts); if (h.length < 3) continue;
    L.polygon(h, { renderer: m._rtLin, color: g.cor, weight: 2, opacity: 0.9, fillColor: g.cor, fillOpacity: 0.12, interactive: true }).bindTooltip(`<div class="tip"><b>${esc(g.nome)}</b><br><span class="t2">${nf0.format(g.pts.length)} cliente(s)</span></div>`, { sticky: true }).addTo(m);
  }
  if (opts.bases !== false) {
    const vistos = new Set();
    for (const r of rotas) {
      if (!r.base || vistos.has(r.v)) continue; vistos.add(r.v); bounds.push([r.base.lat, r.base.lng]);
      L.marker([r.base.lat, r.base.lng], { icon: L.divIcon({ className: '', html: `<div class="basem" style="background:${esc(opts.corBase ? opts.corBase(r) : cor(r))}">${ICON.home}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), keyboard: false })
        .bindTooltip(`<div class="tip"><b>${esc(nomeVend(r.v))}</b><br><span class="t2">Base de saída</span></div>`, { direction: 'top', offset: [0, -10] }).addTo(m);
    }
  }
  return bounds;
}

/* ---------- Partes da página ---------- */
const kc = (k, v, s, tip) => `<div class="kc"${tip ? ` data-tip="${esc(tip)}"` : ''}><span class="k">${k}</span><span class="v${String(v).startsWith('R$') ? ' rs' : ''}">${v}</span><span class="s">${s}</span></div>`;
const chip = (attr, v, txt, on) => `<button type="button" data-${attr}="${esc(v)}" aria-pressed="${on}">${txt}</button>`;
function dropdown(k, rotulo, valores) {
  const sel = RS.f[k], n = sel.size, aberto = RS.aberto === k;
  return `<details class="fdd" data-rdd="${k}"${aberto ? ' open' : ''}><summary>${rotulo}${n ? ` <b class="num">${n}</b>` : ''}</summary><div class="fdd-b">
    ${valores.length > 8 ? `<input type="search" data-rddq="${k}" placeholder="Buscar" aria-label="Buscar ${esc(rotulo)}">` : ''}
    <div class="fdd-l">${valores.map(([v, txt, qtd]) => `<label class="chk" data-nm="${esc(norm(txt))}"><input type="checkbox" data-rf="${k}" value="${esc(v)}"${sel.has(v) ? ' checked' : ''}><span>${esc(txt)}</span>${qtd !== undefined ? `<span class="muted num">${nf0.format(qtd)}</span>` : ''}</label>`).join('') || '<span class="muted">Nada para filtrar</span>'}</div>
    ${n ? `<button type="button" class="btn sm ghost" data-ra="fclr" data-k="${k}">Limpar</button>` : ''}</div></details>`;
}
function valoresFiltro(b, routes) {
  const cnt = { cid: new Map(), rg: new Map(), sg: new Map(), vend: new Map(), eq: new Map() }, eqV = eqDe(b, routes);
  const add = (k, v, s) => { if (!v) return; if (!cnt[k].has(v)) cnt[k].set(v, new Set()); cnt[k].get(v).add(s); };
  for (const r of routes.values()) for (const l of r.ls) { const x = info(l); add('cid', x.cidade, l.s); add('rg', x.rg, l.s); add('sg', x.sg, l.s); add('vend', r.v, l.s); add('eq', eqV[r.v], l.s); }
  const lista = (k, nome) => [...cnt[k]].map(([v, s]) => [v, nome ? nome(v) : v, s.size]).sort((a, c) => String(a[1]).localeCompare(String(c[1]), 'pt-BR', { numeric: true }));
  const dias = [...new Set([...routes.values()].map(r => r.d))].sort((a, c) => a - c), sem = [...new Set([...routes.values()].map(r => r.w))].sort((a, c) => a - c);
  return { cid: lista('cid'), rg: lista('rg'), sg: lista('sg'), vend: lista('vend', v => `${nomeVend(v)} · ${v}`), eq: lista('eq'), dias, sem };
}
function filtrosHtml(vf) {
  const f = RS.f, any = f.cid.size || f.rg.size || f.vend.size || f.eq.size || f.sg.size || f.d.size || f.w.size || f.tempo || f.q;
  return `<div class="rt-filtros" role="group" aria-label="Filtros">
    ${dropdown('vend', 'Vendedor', vf.vend)}${vf.eq.length ? dropdown('eq', 'Equipe', vf.eq) : ''}${dropdown('cid', 'Cidade', vf.cid)}${vf.rg.length ? dropdown('rg', 'Região', vf.rg) : ''}${vf.sg.length ? dropdown('sg', 'Segmento', vf.sg) : ''}
    <div class="seg" aria-label="Dia">${vf.dias.map(d => chip('rd', d, DIA_C[d], f.d.has(d))).join('')}</div>
    <div class="seg" aria-label="Semana">${vf.sem.map(w => chip('rw', w, 'S' + w, f.w.has(w))).join('')}</div>
    <select data-rft aria-label="Tempo de atendimento"><option value="">Atendimento: todos</option>${[['a', 'até 10 min'], ['b', '11 a 20 min'], ['c', '21 a 30 min'], ['d', 'mais de 30 min']].map(([v, t]) => `<option value="${v}"${f.tempo === v ? ' selected' : ''}>Atendimento ${t}</option>`).join('')}</select>
    <input type="search" data-rfq placeholder="Cliente ou SOLD" value="${esc(f.q)}" aria-label="Buscar cliente">
    ${any ? '<button type="button" class="btn sm ghost" data-ra="flimpa">Limpar filtros</button>' : ''}</div>`;
}
function kpisHtml(a, b) {
  const p = params(), $$k = p.valorKm > 0;
  return `<div class="kgrid">
    ${kc('Clientes', nf0.format(a.clientes), `${nf0.format(a.vendedores)} vendedor(es)`)}
    ${kc('Visitas no mês', nf0.format(a.visitasMes), `${nf1.format(a.rotasMes)} dias de rota`)}
    ${kc('KM no mês', fkm(a.kmMes), a.pctReal ? `${fpct(a.pctReal)} das rotas pelas ruas` : 'estimado (linha reta × fator)', 'KM do mês = KM do ciclo × 4 semanas ÷ semanas do ciclo')}
    ${kc('KM por semana', fkm(a.kmSemana), `${semanasCiclo(b)} semana(s) no ${b.porData ? 'mês' : 'ciclo'}`)}
    ${kc('KM por dia', fkm(a.kmDia), 'média por rota (vendedor × dia)')}
    ${kc('Horas por dia', fhm(a.horasDia), `ocupação média ${fpct(a.ocup)}`)}
    ${$$k ? kc('Custo de KM no mês', brl(a.custoMes), `${brl(a.custoSemana)}/sem · ${brl(a.custoDia)}/dia`, `${brl(p.valorKm)} por km\nPor semana: ${brl(a.custoSemana)}\nPor dia (média por rota): ${brl(a.custoDia)}`) : kc('Valor do KM', '—', '<button type="button" class="linkbtn" data-ra="param">definir em Parâmetros</button>')}
  </div>`;
}
function porVendedor(recs, fm, W) {
  const g = new Map(); for (const r of recs) { if (!g.has(r.v)) g.set(r.v, []); g.get(r.v).push(r); }
  return [...g].map(([v, rs]) => ({ v, rs, a: agrega(rs, fm, W) })).sort((x, y) => y.a.kmMes - x.a.kmMes);
}

function abaGeral(b, recs) {
  const fm = fatorMes(b), W = semanasCiclo(b), pv = porVendedor(recs, fm, W);
  const top = pv.slice(0, 14).map((x, i) => ({ label: nomeVend(x.v), cor: corVend(x.v, i), v: x.a.kmMes, fmt: fkm(x.a.kmMes) + ' km', tip: `${nomeVend(x.v)} (${x.v})\n${fkm(x.a.kmMes)} km/mês · ${fkm(x.a.kmDia)} km/dia\n${nf0.format(x.a.clientes)} clientes · ${nf1.format(x.a.rotasMes)} dias de rota${params().valorKm ? '\n' + brl(x.a.custoMes) + ' no mês' : ''}` }));
  const dias = [...new Set(recs.map(r => r.d))].sort((x, y) => x - y);
  const porDia = dias.map(d => { const a = agrega(recs.filter(r => r.d === d), fm, W); return { label: DIA_C[d], v: a.visitasMes, cor: COR_DIA[d], tip: `${DIA_L[d]}\n${nf0.format(a.visitasMes)} visitas/mês · ${fkm(a.kmMes)} km/mês` }; });
  const kmDia = dias.map(d => { const a = agrega(recs.filter(r => r.d === d), fm, W); return { label: DIA_C[d], v: a.kmDia, cor: COR_DIA[d], tip: `${DIA_L[d]}\n${fkm(a.kmDia)} km por rota em média` }; });
  const cid = new Map(); for (const r of recs) for (const s of r.cli || []) { const l = r.r && r.r.ls.find(x => x.s === s); const c = l ? info(l).cidade || 'Sem cidade' : 'Sem cidade'; if (!cid.has(c)) cid.set(c, new Set()); cid.get(c).add(s); }
  const cidRows = [...cid].map(([c, s]) => ({ label: c, v: s.size, fmt: nf0.format(s.size), tip: `${c}\n${nf0.format(s.size)} clientes` })).sort((x, y) => y.v - x.v).slice(0, 10);
  const OCC = [['Com folga', '< 50%', 'var(--muted)'], ['Adequada', '50–90%', 'var(--ok)'], ['No limite', '90–100%', 'var(--warn)'], ['Excede', '> 100%', 'var(--bad)']], occ = [0, 0, 0, 0];
  for (const r of recs) { const o = r.jor ? (r.des + r.at) / r.jor : 0; occ[o > 1 ? 3 : o >= 0.9 ? 2 : o < 0.5 ? 0 : 1]++; }
  const card = (t, sub, body) => `<div class="card"><div class="ch"><h2>${t}</h2><span class="muted" style="font-size:12px">${sub}</span></div><div class="cb">${body}</div></div>`;
  const nada = '<p class="muted" style="margin:0">Sem rotas com estes filtros.</p>';
  return `<div class="cgrid">
    ${card('KM no mês por vendedor', 'clique para filtrar', top.length ? hbars(top.map(x => ({ ...x, enter: undefined }))).replace(/class="hb"/g, 'class="hb rt-hb"') : nada)}
    ${card('Clientes por cidade', `${nf0.format(cid.size)} cidade(s)`, cidRows.length ? hbars(cidRows) : nada)}
    ${card('Visitas no mês por dia da semana', 'soma das semanas', porDia.length ? vcols(porDia) : nada)}
    ${card('KM por rota em cada dia', 'média', kmDia.length ? vcols(kmDia.map(x => ({ ...x, v: Math.round(x.v) }))) : nada)}
    ${card('Ocupação da jornada', `${nf0.format(recs.length)} rota(s)`, recs.length ? vcols(OCC.map(([n, rr, cor], i) => ({ label: n, sub: rr, v: occ[i], cor, tip: `${n} (${rr} da jornada)\n${occ[i]} rota(s)` }))) : nada)}
  </div>`;
}
function abaTabela(b, recs, routes) {
  const fm = fatorMes(b), W = semanasCiclo(b), p = params(), $$k = p.valorKm > 0, eqV = eqDe(b, routes);
  if (RS.tab === 'cli') return tabelaClientes(b, recs);
  const pv = porVendedor(recs, fm, W), tot = agrega(recs, fm, W);
  const linha = (x, i) => {
    const a = x.a, ab = RS.abertos.has(x.v);
    const sub = ab ? [...new Set(x.rs.map(r => r.d))].sort((m, n) => m - n).map(d => { const rs = x.rs.filter(r => r.d === d), s = agrega(rs, fm, W); return `<tr class="sub2"><td></td><td>${DIA_L[d]}</td><td></td><td class="n">${nf0.format(s.clientes)}</td><td class="n">${nf0.format(s.visitasMes)}</td><td class="n">${nf1.format(s.rotasMes)}</td><td class="n">${fkm(s.kmMes)}</td><td class="n">${fkm(s.kmSemana)}</td><td class="n">${fkm(s.kmDia)}</td><td class="n">${fhm(s.horasDia)}</td><td>${R.ocPill(s.ocup)}</td>${$$k ? `<td class="n">${brl(s.custoDia)}</td><td class="n">${brl(s.custoSemana)}</td><td class="n">${brl(s.custoMes)}</td>` : ''}</tr>`; }).join('') : '';
    return `<tr class="clk" data-ra="vabre" data-v="${esc(x.v)}"><td><span class="sw" style="background:${esc(corVend(x.v, i))}"></span></td><td><b>${esc(nomeVend(x.v))}</b> <span class="muted">${esc(x.v)}</span> <span class="muted" aria-hidden="true">${ab ? '▾' : '▸'}</span></td><td>${esc(eqV[x.v] || '—')}</td><td class="n">${nf0.format(a.clientes)}</td><td class="n">${nf0.format(a.visitasMes)}</td><td class="n">${nf1.format(a.rotasMes)}</td><td class="n">${fkm(a.kmMes)}</td><td class="n">${fkm(a.kmSemana)}</td><td class="n">${fkm(a.kmDia)}</td><td class="n">${fhm(a.horasDia)}</td><td>${R.ocPill(a.ocup)}</td>${$$k ? `<td class="n">${brl(a.custoDia)}</td><td class="n">${brl(a.custoSemana)}</td><td class="n">${brl(a.custoMes)}</td>` : ''}</tr>${sub}`;
  };
  return `<div class="row" style="justify-content:space-between"><div class="seg">${chip('rtab', 'vend', 'Por vendedor', true)}${chip('rtab', 'cli', 'Por cliente', false)}</div><span class="row"><span class="muted" style="font-size:12px">Clique em um vendedor para ver os dias</span><button class="btn sm" type="button" data-ra="xls">Exportar (.xlsx)</button></span></div>
    <div class="tblwrap"><table class="t"><thead><tr><th></th><th>Vendedor</th><th>Equipe</th><th class="n">Clientes</th><th class="n">Visitas/mês</th><th class="n">Dias de rota/mês</th><th class="n">KM/mês</th><th class="n">KM/semana</th><th class="n">KM/dia</th><th class="n">Horas/dia</th><th>Ocupação</th>${$$k ? '<th class="n">R$/dia</th><th class="n">R$/semana</th><th class="n">R$/mês</th>' : ''}</tr></thead>
    <tbody>${pv.map(linha).join('') || `<tr><td colspan="14" class="muted">Sem rotas com estes filtros.</td></tr>`}
    ${pv.length > 1 ? `<tr class="tot"><td></td><td>Total</td><td></td><td class="n">${nf0.format(tot.clientes)}</td><td class="n">${nf0.format(tot.visitasMes)}</td><td class="n">${nf1.format(tot.rotasMes)}</td><td class="n">${fkm(tot.kmMes)}</td><td class="n">${fkm(tot.kmSemana)}</td><td class="n">${fkm(tot.kmDia)}</td><td class="n">${fhm(tot.horasDia)}</td><td>${R.ocPill(tot.ocup)}</td>${$$k ? `<td class="n">${brl(tot.custoDia)}</td><td class="n">${brl(tot.custoSemana)}</td><td class="n">${brl(tot.custoMes)}</td>` : ''}</tr>` : ''}</tbody></table></div>`;
}
function clientesDe(recs) {
  const m = new Map();
  for (const rec of recs) for (const s of rec.cli || []) {
    const l = rec.r.ls.find(x => x.s === s); if (!l) continue;
    let o = m.get(s + '|' + rec.v); if (!o) { o = { l, x: info(l), v: rec.v, d: new Set(), w: new Set(), pos: [] }; m.set(s + '|' + rec.v, o); }
    o.d.add(rec.d); o.w.add(rec.w); const i = rec.r.ord.findIndex(z => z.l.s === s); if (i >= 0) o.pos.push(i + 1);
  }
  return [...m.values()].sort((a, b) => String(a.x.nome).localeCompare(String(b.x.nome), 'pt-BR'));
}
function tabelaClientes(b, recs) {
  const cs = clientesDe(recs), max = 600;
  return `<div class="row" style="justify-content:space-between"><div class="seg">${chip('rtab', 'vend', 'Por vendedor', false)}${chip('rtab', 'cli', 'Por cliente', true)}</div><span class="row"><span class="muted" style="font-size:12px">${nf0.format(cs.length)} cliente(s)${cs.length > max ? ` · mostrando ${max}` : ''}</span><button class="btn sm" type="button" data-ra="xls">Exportar (.xlsx)</button></span></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>SOLD</th><th>Cliente</th><th>Vendedor</th><th>Cidade</th><th>Região</th><th>Segmento</th><th>Dias</th><th>Semanas</th><th class="n">Atend. (min)</th><th>Posição</th></tr></thead><tbody>
    ${cs.slice(0, max).map(o => `<tr><td class="mono">${esc(o.l.s)}</td><td class="wrap">${esc(o.x.nome)}</td><td>${esc(nomeVend(o.v))}</td><td>${esc(o.x.cidade || '—')}</td><td>${esc(o.x.rg || '—')}</td><td>${esc(o.x.sg || '—')}</td><td>${[...o.d].sort().map(d => DIA_C[d]).join('/')}</td><td>${[...o.w].sort().join(',')}</td><td class="n">${nf0.format(o.x.t)}</td><td>${o.x.ok ? '<span class="pill ok">no mapa</span>' : '<span class="pill warn">sem coordenada</span>'}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">Nenhum cliente com estes filtros.</td></tr>'}
    </tbody></table></div>`;
}
function abaMapa(b, recs) {
  const vis = recs.length, semRua = recs.filter(r => !r.real).length;
  return `<div class="rt-mapbar">
      <span class="lbl">Cor</span><div class="seg">${[['vend', 'Vendedor'], ['dia', 'Dia'], ['sem', 'Semana'], ['cid', 'Cidade'], ['sg', 'Segmento']].map(([v, t]) => chip('rcor', v, t, RS.cor === v)).join('')}</div>
      <label class="chk"><input type="checkbox" data-ropt="verLinhas"${RS.verLinhas ? ' checked' : ''}> Linhas das rotas</label>
      <label class="chk"><input type="checkbox" data-ropt="verRegioes"${RS.verRegioes ? ' checked' : ''}> Regiões</label>
      <label class="chk"><input type="checkbox" data-ropt="verBases"${RS.verBases ? ' checked' : ''}> Bases</label>
      <span class="sp"></span>
      ${b.estudo ? '<span class="muted" style="font-size:12.5px">O KM pelas ruas do estudo é calculado no Planner</span>' : RS.job ? `<span class="muted num">Calculando pelas ruas: ${RS.job.feitos}/${RS.job.total}</span><button class="btn sm" type="button" data-ra="jobstop">Parar</button>` : `<button class="btn sm" type="button" data-ra="ruas"${semRua && !st.ro ? '' : ' disabled'} title="Consulta o servidor de rotas (cerca de 1 por segundo no servidor público)">Calcular KM pelas ruas (${nf0.format(Math.min(semRua, 300))})</button>`}
    </div>
    <div class="rt-mapwrap"><div id="rtMap" class="rt-map" aria-label="Mapa das rotas"></div><div class="rt-legend" id="rtLeg"></div><div class="rt-mapinfo">${nf0.format(vis)} rota(s)${vis > 12 ? ' · filtre até 12 rotas para ver os números das visitas' : ''}</div></div>`;
}
function corPor(modo, lista) {
  const cores = new Map(), pal = E.PALETA;
  return {
    de(r, l) {
      if (modo === 'dia') return COR_DIA[r.d] || '#7d8a84';
      if (modo === 'sem') return ['', '#2F6FB3', '#C2512B', '#3E8E5C', '#8A4FB0', '#B0892F'][r.w] || '#7d8a84';
      let k = r.v; if (modo === 'cid' || modo === 'sg') { const x = l ? info(l) : null; k = x ? (modo === 'cid' ? x.cidade : x.sg) || '—' : '—'; }
      if (!cores.has(k)) cores.set(k, modo === 'vend' ? corVend(k, lista.indexOf(k) >= 0 ? lista.indexOf(k) : cores.size) : pal[cores.size % pal.length]);
      return cores.get(k);
    },
    legenda() {
      if (modo === 'dia') return [...new Set(lista.map(Number))].map(d => [COR_DIA[d], DIA_L[d]]);
      if (modo === 'sem') return [];
      return [...cores].slice(0, 16).map(([k, c]) => [c, modo === 'vend' ? nomeVend(k) : k]);
    }
  };
}
function montaMapa(b, recs) {
  const el = $('#rtMap'); if (!el) return;
  const m = criaMapa(el), vendL = [...new Set(recs.map(r => r.v))];
  const cp = corPor(RS.cor, RS.cor === 'dia' ? [...new Set(recs.map(r => r.d))].sort() : vendL);
  const rotas = recs.map(rec => ({ ...rec.r, polyKey: b.id + '|' + rec.k }));
  const cliOk = temFiltroCliente(RS.f) ? new Set(recs.flatMap(r => r.cli)) : null;
  // Com cor por cidade ou segmento, cada pino tem a sua cor; a linha da rota fica na cor do vendedor
  const porCliente = RS.cor === 'cid' || RS.cor === 'sg';
  const bounds = [];
  if (porCliente) {
    const cv = corPor('vend', vendL);
    bounds.push(...desenhaRotas(m, rotas, r => cv.de(r), { linhas: RS.verLinhas, bases: RS.verBases, cliOk: new Set(), regioes: false }));
    const vistos = new Set();
    for (const r of rotas) for (const x of r.ord) {
      if (vistos.has(x.l.s) || (cliOk && !cliOk.has(x.l.s))) continue; vistos.add(x.l.s);
      new R.PinMarker([x.lat, x.lng], { renderer: m._rtPts, radius: 6, color: '#FFFFFF', weight: 1.4, fillColor: cp.de(r, x.l), fillOpacity: 0.95 }).bindTooltip(() => tipCli(x.l, info(x.l)), { direction: 'top', offset: [0, -26] }).addTo(m);
    }
    if (RS.verRegioes) { const g = new Map(); for (const r of rotas) for (const x of r.ord) { const k = RS.cor === 'cid' ? info(x.l).cidade || '—' : info(x.l).sg || '—'; if (!g.has(k)) g.set(k, []); g.get(k).push([x.lat, x.lng]); }
      for (const [k, pts] of g) { const h = envoltoria(pts); if (h.length >= 3) { const c = cp.de({ v: '' }, { s: '', ...(RS.cor === 'cid' ? { cid: k } : { sg: k }) }); L.polygon(h, { renderer: m._rtLin, color: c, weight: 2, fillColor: c, fillOpacity: 0.12 }).bindTooltip(`<div class="tip"><b>${esc(k)}</b><br><span class="t2">${nf0.format(pts.length)} visita(s)</span></div>`, { sticky: true }).addTo(m); } } }
  } else {
    bounds.push(...desenhaRotas(m, rotas, r => cp.de(r), { linhas: RS.verLinhas, bases: RS.verBases, cliOk, regioes: RS.verRegioes, grupo: (r) => ({ k: RS.cor === 'vend' ? r.v : RS.cor + r.d + r.w, cor: cp.de(r), nome: RS.cor === 'vend' ? nomeVend(r.v) : RS.cor === 'dia' ? DIA_L[r.d] : 'Semana ' + r.w }) }));
  }
  if (bounds.length) m.fitBounds(L.latLngBounds(bounds).pad(0.06), { maxZoom: 15 }); else m.setView([-23.55, -46.63], 10);
  const leg = $('#rtLeg'); const rows = cp.legenda(); if (leg) { leg.hidden = !rows.length; leg.innerHTML = rows.map(([c, t]) => `<div class="li"><span class="sw" style="background:${esc(c)}"></span>${esc(t)}</div>`).join(''); }
}
async function calculaRuas(b, recs) {
  const alvo = recs.filter(r => !r.real && r.r.ord.length).slice(0, 300); if (!alvo.length) return;
  RS.job = { feitos: 0, total: alvo.length, parar: false }; render();
  const geo = { ...(RS.bases.get(b.id).geo || {}) }; let falhas = 0, erro = '';
  for (const rec of alvo) {
    if (RS.job.parar) break;
    const r = rec.r, nodes = r.base ? [r.base, ...r.ord, r.base] : r.ord;
    if (nodes.length >= 2) {
      try {
        const g = await R.roadRoute(nodes.map(x => ({ lat: x.lat, lng: x.lng })));
        const real = R.realFromLegs(g.legs, !!r.base); geo[r.k] = { sig: r.sig, km: Math.round(real.km * 10) / 10, min: Math.round(real.min) };
        if (g.poly) RS.poly.set(b.id + '|' + r.k, R.decodePoly(g.poly));
      } catch (e) { falhas++; erro = (e && e.message) || 'erro'; if (falhas >= 3) break; }
    }
    RS.job.feitos++; if (RS.job.feitos % 10 === 0) { const i = $('.rt-mapbar .num'); if (i) i.textContent = `Calculando pelas ruas: ${RS.job.feitos}/${RS.job.total}`; }
  }
  RS.job = null;
  const nb = { ...RS.bases.get(b.id), geo, geoV: (b.geoV || 0) + 1 }; RS.bases.put(b.id, nb);
  const routes = calcula(nb, await linhasDe(b.id)); guardaResumo(nb, routes);
  toast(falhas >= 3 ? `Cálculo interrompido: ${erro}` : 'KM pelas ruas calculado', 5000); render();
}

/* ---------- Histórico ---------- */
function abaHist(cur) {
  const p = params(), lista = basesList().slice().reverse().filter(b => (!RS.hist.de || b.periodo >= RS.hist.de) && (!RS.hist.ate || b.periodo <= RS.hist.ate));
  const pers = basesList().map(b => b.periodo).filter(Boolean).sort();
  const linhas = lista.map(b => ({ b, a: agrega(recsResumo(b), fatorMes(b), semanasCiclo(b), b.res && b.res.cliV) }));
  const velhas = basesList().filter(b => b.res && b.res.p !== psig(p)).length;
  const met = RS.hist.met, MET = { km: ['KM no mês', a => a.kmMes, fkm], custo: ['Custo no mês', a => a.custoMes, brl], vis: ['Visitas no mês', a => a.visitasMes, v => nf0.format(v)], cli: ['Clientes', a => a.clientes, v => nf0.format(v)], horas: ['Horas no mês', a => a.horasMes, fhm] };
  const [mNome, mVal, mFmt] = MET[met] || MET.km;
  const cols = linhas.map(({ b, a }) => ({ label: fmtPer(b.periodo).replace('/20', '/'), v: Math.round(mVal(a)), cor: b.id === cur.id ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--line))', tip: `${fmtPerLongo(b.periodo)} · ${b.nome}\n${mNome}: ${mFmt(mVal(a))}\n${nf0.format(a.vendedores)} vendedores · ${nf0.format(a.clientes)} clientes` }));
  let ant = null;
  const tab = linhas.map(({ b, a }) => { const dk = ant ? a.kmMes - ant.kmMes : null; ant = a; return `<tr class="clk${b.id === cur.id ? ' on' : ''}" data-ra="abrebase" data-id="${esc(b.id)}"><td><b>${esc(fmtPer(b.periodo))}</b></td><td class="wrap">${esc(b.nome)}</td><td class="n">${nf0.format(a.vendedores)}</td><td class="n">${nf0.format(a.clientes)}</td><td class="n">${nf0.format(a.visitasMes)}</td><td class="n">${nf1.format(a.rotasMes)}</td><td class="n">${fkm(a.kmMes)}</td><td class="n">${dk === null ? '—' : `<span class="${dk > 0 ? 'up' : dk < 0 ? 'down' : ''}">${dk > 0 ? '+' : ''}${fkm(dk)}</span>`}</td><td class="n">${fkm(a.kmDia)}</td><td class="n">${fhm(a.horasMes)}</td>${p.valorKm ? `<td class="n">${brl(a.custoMes)}</td>` : ''}</tr>`; }).join('');
  // Matriz vendedor × período (KM no mês), com o fundo mais forte quanto maior o KM
  const vends = [...new Set(linhas.flatMap(({ b }) => recsResumo(b).map(r => r.v)))];
  const mat = vends.map(v => ({ v, vals: linhas.map(({ b }) => { const rs = recsResumo(b).filter(r => r.v === v); return rs.length ? agrega(rs, fatorMes(b), semanasCiclo(b)).kmMes : null; }) })).sort((x, y) => (y.vals[y.vals.length - 1] || 0) - (x.vals[x.vals.length - 1] || 0)).slice(0, 40);
  const mx = Math.max(1, ...mat.flatMap(x => x.vals.filter(isNum)));
  return `<div class="row" style="justify-content:space-between">
      <div class="row"><label class="row"><span class="lbl">De</span><select data-rh="de"><option value="">início</option>${pers.map(x => `<option value="${x}"${RS.hist.de === x ? ' selected' : ''}>${fmtPer(x)}</option>`).join('')}</select></label>
        <label class="row"><span class="lbl">Até</span><select data-rh="ate"><option value="">hoje</option>${pers.map(x => `<option value="${x}"${RS.hist.ate === x ? ' selected' : ''}>${fmtPer(x)}</option>`).join('')}</select></label></div>
      <div class="seg">${Object.entries(MET).filter(([k]) => k !== 'custo' || p.valorKm).map(([k, [n]]) => chip('rhm', k, n, met === k)).join('')}</div></div>
    ${velhas ? `<div class="banner">${velhas} base(s) foram resumidas com parâmetros antigos (fator, velocidade, jornada ou atendimento). <button class="btn sm" type="button" data-ra="recalc">Recalcular todas</button></div>` : ''}
    <p class="muted" style="margin:0;font-size:12.5px">No histórico valem os filtros de vendedor, equipe, cidade, região, segmento, dia e semana, pela rota. Atendimento e busca por cliente valem só na base aberta.</p>
    <div class="card"><div class="ch"><h2>${mNome} por período</h2><span class="muted" style="font-size:12px">${linhas.length} período(s) · o destacado é a base aberta</span></div><div class="cb">${cols.length ? vcols(cols) : '<p class="muted" style="margin:0">Nenhuma base no intervalo.</p>'}</div></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Período</th><th>Base</th><th class="n">Vendedores</th><th class="n">Clientes</th><th class="n">Visitas/mês</th><th class="n">Dias de rota</th><th class="n">KM/mês</th><th class="n">Δ KM</th><th class="n">KM/dia</th><th class="n">Horas/mês</th>${p.valorKm ? '<th class="n">R$/mês</th>' : ''}</tr></thead><tbody>${tab}</tbody></table></div>
    ${mat.length && linhas.length > 1 ? `<div class="card"><div class="ch"><h2>KM no mês por vendedor e período</h2><span class="muted" style="font-size:12px">fundo mais forte = mais KM</span></div><div class="tblwrap" style="border:0;border-radius:0"><table class="t heat"><thead><tr><th>Vendedor</th>${linhas.map(({ b }) => `<th class="n">${fmtPer(b.periodo)}</th>`).join('')}</tr></thead><tbody>
      ${mat.map(x => `<tr><td><b>${esc(nomeVend(x.v))}</b> <span class="muted">${esc(x.v)}</span></td>${x.vals.map((v, i) => v === null ? '<td class="n muted">—</td>' : `<td class="n" style="background:color-mix(in srgb, var(--accent) ${Math.round(8 + 50 * v / mx)}%, transparent)" data-tip="${esc(`${nomeVend(x.v)} · ${fmtPerLongo(linhas[i].b.periodo)}\n${fkm(v)} km no mês`)}">${fkm(v)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></div>` : ''}`;
}
async function recalcTodas() {
  const l = basesList(); let i = 0;
  for (const b of l) { i++; toast(`Recalculando ${i} de ${l.length}…`, 4000); try { guardaResumo(b, calcula(b, await linhasDe(b.id))); } catch (e) { /* segue */ } }
  toast('Histórico recalculado'); render();
}

/* ---------- Fontes: bases de rotas e estudos do Planejamento ----------
   Um estudo vira o mesmo formato de rotas de uma base (vendedor × semana × dia), então as visões, a comparação
   e a Verba Indenizatória funcionam igual para os dois. Id de estudo = 'e:' + id do estudo. */
const ehEstudo = id => String(id || '').startsWith('e:');
function fontesLista() {
  const bs = basesList().map(b => ({ id: b.id, nome: `${fmtPer(b.periodo)} · ${b.nome}`, tipo: 'base', periodo: b.periodo }));
  const es = [...(st.amb ? st.amb.values() : [])].sort((x, y) => (y.alterado || 0) - (x.alterado || 0)).map(a => ({ id: 'e:' + a.id, nome: a.nome, tipo: 'estudo' }));
  return bs.concat(es);
}
function fonteOpts(sel) {
  const l = fontesLista(), g = (t, nome) => { const x = l.filter(f => f.tipo === t); return x.length ? `<optgroup label="${nome}">${x.map(f => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${esc(f.nome)}</option>`).join('')}</optgroup>` : ''; };
  return g('base', 'Bases de rotas') + g('estudo', 'Estudos do Planejamento');
}
const nomeFonte = id => { const f = fontesLista().find(x => x.id === id); return f ? f.nome : '—'; };
async function estudoDados(id) {
  const a = st.amb.get(id); if (!a) return null;
  const c = RS.estudos.get(id); if (c && c.alt === a.alterado && !(id === st.cur && c.routes !== st.routes)) return c;
  let items, routes;
  if (id === st.cur && st.itens) { items = st.itens.map; routes = st.routes; }
  else { const b = new R.BucketStore('itens/' + id + '/b'), g = new R.BucketStore('geo/' + id + '/b'); try { await Promise.all([b.load(), g.load()]); } finally { b.detach(); g.detach(); } items = b.map; routes = R.buildRoutes(a, items, g.map); }
  const d = { alt: a.alterado, a, items, routes }; RS.estudos.set(id, d); return d;
}
function rotasDeEstudo(d) {
  if (d.rotasRt) return d.rotasRt;
  const out = new Map(), a = d.a;
  for (const r of d.routes.values()) {
    const set = (a.setores || {})[r.s] || {}, v = set.colab || 's:' + r.s;
    if (!set.colab) RS.nomes.set(v, set.nome || 'Setor');
    const col = set.colab && st.col.get(set.colab), base = col && hasXY(col) ? { lat: col.lat, lng: col.lng } : null;
    const ls = r.stops.map(s => ({ s, v, d: [r.d], w: [r.w] }));
    out.set(r.k, { k: r.k, v, w: r.w, d: r.d, ls, ord: ls.map(l => ({ l, ...info(l) })).filter(x => x.ok), base, m: r.m, sig: r.sig });
  }
  d.rotasRt = out; return out;
}
// { b, routes } de qualquer fonte. b de estudo é um resumo com o ciclo do estudo
async function carregaFonte(id) {
  await iniciar();
  if (ehEstudo(id)) {
    const d = await estudoDados(id.slice(2)); if (!d) return null;
    const b = { id, sid: d.a.id, nome: d.a.nome, estudo: true, periodo: '', porData: false, ciclo: R.P(d.a).semanas || 4, n: d.items.size, geo: {}, em: d.a.alterado || d.a.criado };
    return { b, routes: rotasDeEstudo(d) };
  }
  const b = RS.bases && RS.bases.get(id); if (!b || id === PARAM_ID) return null;
  return { b, routes: calcula(b, await linhasDe(id)) };
}
const recsTodos = (b, routes) => recsVivos(b, routes, novoFiltro(), {});
const vendDe = F => [...new Set([...F.routes.values()].map(r => r.v))].map(v => [v, `${nomeVend(v)}${String(v).startsWith('s:') ? '' : ' · ' + v}`]).sort((x, y) => x[1].localeCompare(y[1], 'pt-BR', { numeric: true }));
// A fonte tem rotas deste vendedor? (sem carregar as linhas)
function fonteTem(id, v) {
  if (ehEstudo(id)) { const a = st.amb.get(id.slice(2)); return !!a && Object.values(a.setores || {}).some(s => s.colab === v); }
  const b = RS.bases.get(id); return !!(b && b.res && b.res.rotas.some(x => x[0] === v));
}

/* ---------- Comparação: duas fontes lado a lado (base × estudo, estudo × estudo, base × base) ---------- */
function abaCmp() { return '<div id="rtCmp" class="stack"><p class="muted">Carregando as rotas…</p></div>'; }
async function montaCmp() {
  const c = RS.cmp, fl = fontesLista();
  if (!c.a || !fl.some(f => f.id === c.a.src)) c.a = { src: RS.base, quem: '' };
  const FA = await carregaFonte(c.a.src); if (!FA) return;
  const vA = vendDe(FA);
  if (!c.a.quem || (c.a.quem !== '__todos' && !vA.some(([v]) => v === c.a.quem))) c.a.quem = RS.f.vend.size === 1 && vA.some(([v]) => RS.f.vend.has(v)) ? [...RS.f.vend][0] : (vA[0] || ['__todos'])[0];
  if (!c.b || !fl.some(f => f.id === c.b.src)) {
    const outras = fl.filter(f => f.id !== c.a.src);
    const pref = outras.find(f => f.tipo !== (ehEstudo(c.a.src) ? 'x' : 'base') && fonteTem(f.id, c.a.quem)) || outras.find(f => fonteTem(f.id, c.a.quem)) || outras[0] || fl[0];
    c.b = { src: pref ? pref.id : c.a.src, quem: '' };
  }
  const FB = await carregaFonte(c.b.src); if (!FB || !$('#rtCmp')) return;
  const vB = vendDe(FB);
  if (!c.b.quem || (c.b.quem !== '__todos' && !vB.some(([v]) => v === c.b.quem))) c.b.quem = vB.some(([v]) => v === c.a.quem) ? c.a.quem : '__todos';
  const lado = (k, F, vs, s) => `<div class="cmpl"><div class="cmph"><i class="sw" style="background:var(--cmp-${k})"></i><b>Lado ${k.toUpperCase()}</b></div>
    <label class="field"><span class="lbl">Rota, base ou estudo</span><select data-rc="${k}.src">${fonteOpts(s.src)}</select></label>
    <label class="field"><span class="lbl">Vendedor ou setor</span><select data-rc="${k}.quem">${vs.map(([v, t]) => `<option value="${esc(v)}"${v === s.quem ? ' selected' : ''}>${esc(t)}</option>`).join('')}<option value="__todos"${s.quem === '__todos' ? ' selected' : ''}>Todos</option></select></label></div>`;
  const recDe = (F, quem) => recsVivos(F.b, F.routes, { ...novoFiltro(), vend: quem === '__todos' ? new Set() : new Set([quem]) }, eqDe(F.b, F.routes));
  const ra = recDe(FA, c.a.quem), rb = recDe(FB, c.b.quem);
  const A = agrega(ra, fatorMes(FA.b), semanasCiclo(FA.b)), B = agrega(rb, fatorMes(FB.b), semanasCiclo(FB.b)), p = params();
  const nomeA = `${nomeFonte(c.a.src)} · ${c.a.quem === '__todos' ? 'todos' : nomeVend(c.a.quem)}`, nomeB = `${nomeFonte(c.b.src)} · ${c.b.quem === '__todos' ? 'todos' : nomeVend(c.b.quem)}`;
  const met = [
    ['Clientes', A.clientes, B.clientes, v => nf0.format(v), 0], ['Visitas no mês', A.visitasMes, B.visitasMes, v => nf0.format(v), 0], ['Dias de rota no mês', A.rotasMes, B.rotasMes, v => nf1.format(v), 1],
    ['KM no mês', A.kmMes, B.kmMes, fkm, 1], ['KM por semana', A.kmSemana, B.kmSemana, fkm, 1], ['KM por dia (média)', A.kmDia, B.kmDia, fkm, 1],
    ['Deslocamento no mês', A.desMes, B.desMes, fhm, 1], ['Atendimento no mês', A.atMes, B.atMes, fhm, 0], ['Horas no mês', A.horasMes, B.horasMes, fhm, 1], ['Horas por dia', A.horasDia, B.horasDia, fhm, 1], ['Ocupação média', A.ocup, B.ocup, fpct, 0]
  ];
  if (p.valorKm) met.push(['Custo no mês', A.custoMes, B.custoMes, brl, 1], ['Custo por dia', A.custoDia, B.custoDia, brl, 1]);
  // Para KM, tempo e custo, menos é melhor: a diferença negativa (B gasta menos) aparece como economia
  const dif = (x, y, f, menor) => {
    const dd = y - x, txt = f(Math.abs(dd)), zero = txt === f(0), pc = x ? Math.round(dd / x * 100) : 0;
    const cls = zero ? '' : menor ? (dd < 0 ? 'down' : 'up') : '', sinal = zero ? '' : dd > 0 ? '+' : '−';
    return `<td class="n"><span class="${cls}">${sinal}${txt}</span></td><td class="n"><span class="${cls}">${x ? (pc > 0 ? '+' : pc < 0 ? '−' : '') + nf0.format(Math.abs(pc)) + '%' : '—'}</span></td>`;
  };
  const tabela = `<div class="tblwrap flat"><table class="t"><thead><tr><th>Indicador</th><th class="n"><i class="sw" style="background:var(--cmp-a)"></i> A</th><th class="n"><i class="sw" style="background:var(--cmp-b)"></i> B</th><th class="n">Diferença</th><th class="n">Δ %</th></tr></thead><tbody>
    ${met.map(([n, x, y, fm, menor]) => `<tr><td>${n}</td><td class="n">${fm(x)}</td><td class="n">${fm(y)}</td>${dif(x, y, fm, menor)}</tr>`).join('')}</tbody></table></div>`;
  const barras = `<div class="cmpbars">${met.filter(m => m[4] || m[0] === 'Clientes').map(([n, x, y, fm]) => { const mx = Math.max(x, y) || 1; return `<div class="cb2"><span class="cn">${n}</span><div class="cr" data-tip="${esc(`${n}\nA: ${fm(x)}\nB: ${fm(y)}`)}"><span class="ct"><i style="width:${Math.max(x ? 2 : 0, x / mx * 100)}%;background:var(--cmp-a)"></i></span><span class="cv num">${fm(x)}</span><span class="ct"><i style="width:${Math.max(y ? 2 : 0, y / mx * 100)}%;background:var(--cmp-b)"></i></span><span class="cv num">${fm(y)}</span></div></div>`; }).join('')}</div>`;
  const dias = [...new Set([...ra, ...rb].map(r => r.d))].sort((x, y) => x - y);
  const porDia = `<div class="tblwrap flat"><table class="t"><thead><tr><th>Dia</th><th class="n">A · clientes</th><th class="n">A · KM/rota</th><th class="n">B · clientes</th><th class="n">B · KM/rota</th><th class="n">Δ KM/rota</th></tr></thead><tbody>
    ${dias.map(dd => { const x = agrega(ra.filter(r => r.d === dd), fatorMes(FA.b), semanasCiclo(FA.b)), y = agrega(rb.filter(r => r.d === dd), fatorMes(FB.b), semanasCiclo(FB.b)), df = y.kmDia - x.kmDia, zero = fkm(Math.abs(df)) === fkm(0); return `<tr><td>${DIA_L[dd]}</td><td class="n">${nf0.format(x.clientes)}</td><td class="n">${fkm(x.kmDia)}</td><td class="n">${nf0.format(y.clientes)}</td><td class="n">${fkm(y.kmDia)}</td><td class="n"><span class="${zero ? '' : df < 0 ? 'down' : 'up'}">${zero ? '' : df > 0 ? '+' : '−'}${fkm(Math.abs(df))}</span></td></tr>`; }).join('')}</tbody></table></div>`;
  const sa = new Set(ra.flatMap(r => r.cli)), sb = new Set(rb.flatMap(r => r.cli));
  const soA = [...sa].filter(s => !sb.has(s)), soB = [...sb].filter(s => !sa.has(s)), ambos = [...sa].filter(s => sb.has(s)).length;
  const nomeCli = s => { const cc = st.cli.get(s); return cc && cc.nome ? cc.nome : s; };
  const listaCli = l => l.length ? `<ul class="cmpcli">${l.slice(0, 40).map(s => `<li><span class="mono">${esc(s)}</span> ${esc(nomeCli(s))}</li>`).join('')}${l.length > 40 ? `<li class="muted">e mais ${l.length - 40}</li>` : ''}</ul>` : '<p class="muted" style="margin:0">Nenhum.</p>';
  $('#rtCmp').innerHTML = `<div class="card"><div class="cb rt-cmpctl">${lado('a', FA, vA, c.a)}<button class="btn sm" type="button" data-ra="cmptroca" title="Trocar os lados">⇄</button>${lado('b', FB, vB, c.b)}</div></div>
    <div class="cmpmaps"><div class="cmpm"><div class="cmph"><i class="sw" style="background:var(--cmp-a)"></i><b>A</b><span class="muted">${esc(nomeA)}</span></div><div id="rtMapA" class="rt-map sm"></div></div>
      <div class="cmpm"><div class="cmph"><i class="sw" style="background:var(--cmp-b)"></i><b>B</b><span class="muted">${esc(nomeB)}</span></div><div id="rtMapB" class="rt-map sm"></div></div></div>
    <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12.5px">Pinos coloridos pelo dia de visita. Contorno escuro = cliente que só existe daquele lado. Os mapas se movem juntos.</span><span class="legend-row">${dias.map(dd => `<span class="li"><i class="sw" style="background:${COR_DIA[dd]}"></i>${DIA_C[dd]}</span>`).join('')}</span></div>
    <div class="cgrid"><div class="card"><div class="ch"><h2>Diferença</h2><span class="muted" style="font-size:12px">B − A · verde = B gasta menos</span></div><div class="cb" style="padding:0">${tabela}</div></div>
      <div class="card"><div class="ch"><h2>Lado a lado</h2><span class="legend-row"><span class="li"><i class="sw" style="background:var(--cmp-a)"></i>A</span><span class="li"><i class="sw" style="background:var(--cmp-b)"></i>B</span></span></div><div class="cb">${barras}</div></div></div>
    <div class="card"><div class="ch"><h2>Por dia da semana</h2></div><div class="cb" style="padding:0">${porDia}</div></div>
    <div class="card"><div class="ch"><h2>Clientes</h2><span class="muted" style="font-size:12px">${nf0.format(ambos)} nos dois · ${nf0.format(soA.length)} só em A · ${nf0.format(soB.length)} só em B</span></div><div class="cb cgrid"><div><div class="lbl">Só em A</div>${listaCli(soA)}</div><div><div class="lbl">Só em B</div>${listaCli(soB)}</div></div></div>`;
  const mA = criaMapa($('#rtMapA')), mB = criaMapa($('#rtMapB'));
  const corD = r => COR_DIA[r.d] || '#7d8a84';
  const bA = desenhaRotas(mA, ra.map(x => ({ ...x.r, polyKey: FA.b.id + '|' + x.k })), corD, { destaque: new Set(soA), destaqueTxt: 'Só em A', corBase: () => '#3B4742' });
  const bB = desenhaRotas(mB, rb.map(x => ({ ...x.r, polyKey: FB.b.id + '|' + x.k })), corD, { destaque: new Set(soB), destaqueTxt: 'Só em B', corBase: () => '#3B4742' });
  const all = bA.concat(bB);
  if (all.length) { const bb = L.latLngBounds(all).pad(0.06); mA.fitBounds(bb, { maxZoom: 15 }); mB.fitBounds(bb, { maxZoom: 15 }); } else { mA.setView([-23.55, -46.63], 10); mB.setView([-23.55, -46.63], 10); }
  let movendo = false; const sync = (de, para) => de.on('move', () => { if (movendo) return; movendo = true; para.setView(de.getCenter(), de.getZoom(), { animate: false }); movendo = false; });
  sync(mA, mB); sync(mB, mA);
}
/* ---------- Parâmetros ---------- */
function paramForm() {
  const p = params();
  const campo = (k, rot, hint, step) => `<label class="field"><span class="lbl">${rot}</span><input type="number" name="${k}" value="${esc(p[k])}" step="${step}" min="0"><span class="hint">${hint}</span></label>`;
  openModal(`<div class="dh"><h2>Parâmetros de Rotas</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="rtPar"><div class="db"><div class="fgrid">
      ${campo('valorKm', 'Valor do KM (R$)', 'Custo ou reembolso por km rodado', '0.01')}${campo('fator', 'Fator de rota', 'Linha reta × fator = KM estimado pelas ruas', '0.01')}
      ${campo('vel', 'Velocidade média (km/h)', 'Para o tempo de deslocamento', '1')}${campo('jornada', 'Jornada (min)', 'Quando o colaborador não tiver a própria', '1')}
      ${campo('tPadrao', 'Atendimento padrão (min)', 'Quando a planilha e a base não informarem', '1')}</div>
      <p class="muted" style="margin:0;font-size:12.5px">Valem para todas as bases deste ambiente. Mudar fator, velocidade, jornada ou atendimento pede um recálculo do histórico.</p></div>
    <div class="df"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit"${st.ro ? ' disabled' : ''}>Salvar</button></div></form>`, 'sm');
  $('#rtPar').onsubmit = ev => {
    ev.preventDefault(); const f = new FormData(ev.target), n = {};
    for (const k of Object.keys(DEF)) { const v = numBR(f.get(k)); if (!isNum(v) || v < 0 || (k !== 'valorKm' && k !== 'tPadrao' && v === 0)) { toast('Valor inválido: ' + k); return; } n[k] = v; }
    RS.bases.put(PARAM_ID, { id: PARAM_ID, nome: 'Parâmetros de Rotas', p: n }); RS.memo.clear(); closeModal(); render(); toast('Parâmetros salvos');
  };
}

/* ---------- Página ---------- */
let renderSeq = 0;
async function render(el = $('#homeView')) {
  if (!el || st.screen !== 'home' || st.homeSec !== 'rotas') return;
  const seq = ++renderSeq, keep = el.scrollTop;
  limpar(); liga(el);
  if (!RS.bases) { el.innerHTML = `<div class="page home">${R.migalha('Rotas')}<p class="muted">Carregando as bases de rotas…</p></div>`; await iniciar(); if (seq !== renderSeq) return; }
  const lista = basesList(), fl = fontesLista(), p = params();
  if (!fl.some(f => f.id === RS.base)) RS.base = (lista[0] && lista[0].id) || (fl[0] && fl[0].id) || '';
  const topo = `${R.migalha('Rotas')}<div class="ph"><div><h1>Rotas</h1><p>As rotas em uso mês a mês e os estudos do Planejamento: KM, tempo e custo por vendedor, mapa com pinos e regiões, histórico e comparação.</p></div>
    <div class="row"><button class="btn" type="button" data-ra="param">Parâmetros${p.valorKm ? ` · ${brl(p.valorKm)}/km` : ''}</button><button class="btn" type="button" data-ra="modelo">Modelo (.xlsx)</button><button class="btn primary" type="button" data-ra="importa"${st.ro ? ' disabled' : ''}>Importar base</button></div></div>
    ${st.rotasSemTabela ? '<div class="banner bad">O banco de dados ainda não tem as tabelas de Rotas: o que for importado vale só nesta sessão. Rode <b>supabase/migracao_05_rotas.sql</b> no Supabase.</div>' : ''}`;
  if (!RS.base) {
    el.innerHTML = `<div class="page home">${topo}<div class="card"><div class="empty"><span class="mod-i xl">${R.ICON_MOD.rotas}</span><h3>Nenhuma base de roteiros ainda</h3>
      <p>Baixe o modelo, preencha com o roteiro em uso (cliente, vendedor, dia e semana, ou a data de cada visita) e importe. Uma planilha com vários meses gera o histórico de uma vez. Os estudos do Planejamento também aparecem aqui.</p>
      <div class="row" style="justify-content:center"><button class="btn" type="button" data-ra="modelo">Baixar modelo</button><button class="btn primary" type="button" data-ra="importa"${st.ro ? ' disabled' : ''}>Importar base</button></div></div></div></div>`;
    return;
  }
  if (!ehEstudo(RS.base) && !RS.linhas.has(RS.base) || ehEstudo(RS.base) && !RS.estudos.has(RS.base.slice(2))) el.innerHTML = `<div class="page home">${topo}<p class="muted">Carregando ${esc(nomeFonte(RS.base))}…</p></div>`;
  let F; try { F = await carregaFonte(RS.base); } catch (e) { toast('Não foi possível carregar: ' + (e.message || e.code || e)); return; }
  if (seq !== renderSeq || !F) return;
  const { b, routes } = F; RS.ultimo = F;
  if (!b.estudo && (!b.res || b.res.p !== psig(p))) guardaResumo(b, routes);
  const eqV = eqDe(b, routes), recs = recsVivos(b, routes, RS.f, eqV), ag = agrega(recs, fatorMes(b), semanasCiclo(b)), vf = valoresFiltro(b, routes);
  if (b.estudo && RS.aba === 'hist') RS.aba = 'geral';
  const ABAS = [['geral', 'Visão geral'], ['tabela', 'Tabela'], ['mapa', 'Mapa'], ...(b.estudo ? [] : [['hist', `Histórico${lista.length > 1 ? ' · ' + lista.length : ''}`]]), ['cmp', 'Comparar']];
  const info2 = b.estudo
    ? `Estudo do Planejamento · ${nf0.format(b.n)} cliente(s) · ciclo de ${semanasCiclo(b)} semana(s) · alterado em ${fdh(b.em)}`
    : `${nf0.format(b.n)} linha(s)${b.arquivo ? ' · ' + esc(b.arquivo) : ''} · importada em ${fdh(b.em)}${b.usuario ? ' por ' + esc(b.usuario) : ''}${b.porData ? ' · por data de visita' : ` · ciclo de ${semanasCiclo(b)} semana(s)`}`;
  const barra = `<div class="card rt-base"><div class="cb row">
      <label class="row"><span class="lbl">Ver</span><select data-rbase aria-label="Base de rotas ou estudo">${fonteOpts(b.id)}</select></label>
      <span class="muted" style="font-size:12.5px">${info2}</span>
      <span class="sp"></span>${b.estudo ? `<button class="btn sm" type="button" data-enter="${esc(b.sid)}">Abrir no Planner</button>` : `<button class="btn sm danger" type="button" data-ra="delbase"${st.ro ? ' disabled' : ''}>Excluir base</button>`}</div></div>`;
  let corpo = '';
  if (RS.aba === 'geral') corpo = kpisHtml(ag, b) + abaGeral(b, recs);
  else if (RS.aba === 'tabela') corpo = kpisHtml(ag, b) + abaTabela(b, recs, routes);
  else if (RS.aba === 'mapa') corpo = abaMapa(b, recs);
  else if (RS.aba === 'hist') corpo = abaHist(b);
  else corpo = abaCmp();
  el.innerHTML = `<div class="page home rotas">${topo}${barra}
    <nav class="rt-abas seg" aria-label="Visões">${ABAS.map(([k, t]) => chip('raba', k, t, RS.aba === k)).join('')}</nav>
    ${RS.aba === 'cmp' ? '' : filtrosHtml(vf)}
    ${corpo}</div>`;
  el.scrollTop = keep;
  if (RS.aba === 'mapa') montaMapa(b, recs);
  if (RS.aba === 'cmp') montaCmp().catch(e => { const x = $('#rtCmp'); if (x) x.innerHTML = `<div class="banner bad">Não foi possível carregar a comparação: ${esc(e.message || e.code || e)}</div>`; });
}
async function exportaXls() {
  const F = RS.ultimo; if (!F || !window.XLSX) return;
  const { b, routes } = F, eqV = eqDe(b, routes), recs = recsVivos(b, routes, RS.f, eqV), fm = fatorMes(b), W = semanasCiclo(b), p = params();
  const vend = porVendedor(recs, fm, W).map(x => ({ Vendedor: nomeVend(x.v), Codigo: x.v, Equipe: eqV[x.v] || '', Clientes: x.a.clientes, 'Visitas/mes': Math.round(x.a.visitasMes), 'Dias de rota/mes': +x.a.rotasMes.toFixed(1), 'KM/mes': +x.a.kmMes.toFixed(1), 'KM/semana': +x.a.kmSemana.toFixed(1), 'KM/dia': +x.a.kmDia.toFixed(1), 'Horas/dia': +(x.a.horasDia / 60).toFixed(2), Ocupacao: +(x.a.ocup * 100).toFixed(0), 'R$/dia': +x.a.custoDia.toFixed(2), 'R$/semana': +x.a.custoSemana.toFixed(2), 'R$/mes': +x.a.custoMes.toFixed(2) }));
  const rotas = recs.map(r => ({ Vendedor: nomeVend(r.v), Codigo: r.v, Semana: r.w, Dia: DIA_L[r.d], Visitas: r.n, KM: +r.km.toFixed(1), 'Deslocamento (min)': Math.round(r.des), 'Atendimento (min)': Math.round(r.at), 'Pelas ruas': r.real ? 'sim' : 'não', 'R$': +(r.km * p.valorKm).toFixed(2) }));
  const cli = clientesDe(recs).map(o => ({ SOLD: o.l.s, Cliente: o.x.nome, Vendedor: o.v, Cidade: o.x.cidade, Regiao: o.x.rg, Segmento: o.x.sg, Dias: [...o.d].sort().map(d => DIA_C[d]).join('/'), Semanas: [...o.w].sort().join(','), 'Atendimento (min)': o.x.t }));
  const nome = b.estudo ? b.nome : fmtPer(b.periodo);
  saveFile(`rotas_${slug(nome)}_${dstamp()}.xlsx`, xlsxBlob([['Vendedores', vend], ['Rotas', rotas], ['Clientes', cli]]));
  R.audita('exportacao', 'Rotas ' + nome);
}
/* ---------- Eventos (ligados uma vez na área da página inicial) ---------- */
function liga(el) {
  if (RS.ligado) return; RS.ligado = true;
  const ativo = () => st.screen === 'home' && st.homeSec === 'rotas';
  el.addEventListener('click', async e => {
    if (!ativo()) return;
    const t = e.target.closest('[data-ra],[data-raba],[data-rd],[data-rw],[data-rtab],[data-rcor],[data-rhm]'); if (!t) return;
    const ds = t.dataset, f = RS.f;
    if (ds.raba) { RS.aba = ds.raba; RS.aberto = ''; render(); return; }
    if (ds.rd) { const v = +ds.rd; f.d.has(v) ? f.d.delete(v) : f.d.add(v); render(); return; }
    if (ds.rw) { const v = +ds.rw; f.w.has(v) ? f.w.delete(v) : f.w.add(v); render(); return; }
    if (ds.rtab) { RS.tab = ds.rtab; render(); return; }
    if (ds.rcor) { RS.cor = ds.rcor; render(); return; }
    if (ds.rhm) { RS.hist.met = ds.rhm; render(); return; }
    const a = ds.ra, F = RS.ultimo && RS.ultimo.b.id === RS.base ? RS.ultimo : null, b = F && F.b;
    if (a === 'cmptroca') { const x = RS.cmp.a; RS.cmp.a = RS.cmp.b; RS.cmp.b = x; render(); return; }
    if (a === 'importa') R.openImport('rotas');
    else if (a === 'modelo') R.downloadModelo('rotas');
    else if (a === 'param') paramForm();
    else if (a === 'flimpa') { RS.f = novoFiltro(); render(); }
    else if (a === 'fclr') { f[ds.k].clear(); RS.aberto = ''; render(); }
    else if (a === 'vabre') { RS.abertos.has(ds.v) ? RS.abertos.delete(ds.v) : RS.abertos.add(ds.v); render(); }
    else if (a === 'abrebase') { RS.base = ds.id; RS.aba = 'geral'; render(); }
    else if (a === 'xls') exportaXls();
    else if (a === 'recalc') recalcTodas();
    else if (a === 'jobstop') { if (RS.job) RS.job.parar = true; }
    else if (a === 'ruas' && b) { if (b.estudo) { toast('Para calcular um estudo pelas ruas, use o Planner'); return; } calculaRuas(b, recsVivos(b, F.routes, RS.f, eqDe(b, F.routes))); }
    else if (a === 'delbase' && b && !b.estudo) R.armButton(t, async () => { const nome = `${fmtPer(b.periodo)} · ${b.nome}`; await excluiBase(b.id); R.audita('exclusao', 'Base de rotas ' + nome); toast('Base excluída'); render(); }, 'Confirmar exclusão');
  });
  // Clique numa barra do gráfico de vendedores filtra o vendedor
  el.addEventListener('click', e => {
    if (!ativo()) return; const hb = e.target.closest('.rt-hb'); if (!hb) return;
    const F = RS.ultimo; if (!F) return; const nome = hb.querySelector('.hl span:last-child'); if (!nome) return;
    const v = [...new Set([...F.routes.values()].map(r => r.v))].find(x => nomeVend(x) === nome.textContent);
    if (v) { RS.f.vend = new Set([v]); render(); }
  });
  el.addEventListener('change', e => {
    if (!ativo()) return; const t = e.target, ds = t.dataset;
    if (ds.rf) { const s = RS.f[ds.rf]; t.checked ? s.add(t.value) : s.delete(t.value); RS.aberto = ds.rf; render(); }
    else if (ds.rbase !== undefined) { RS.base = t.value; RS.abertos.clear(); RS.f = novoFiltro(); render(); }
    else if (ds.rft !== undefined) { RS.f.tempo = t.value; render(); }
    else if (ds.ropt) { RS[ds.ropt] = t.checked; render(); }
    else if (ds.rh) { RS.hist[ds.rh] = t.value; render(); }
    else if (ds.rc) { const [lado, campo] = ds.rc.split('.'); RS.cmp[lado] = { ...(RS.cmp[lado] || {}), [campo]: t.value }; if (campo === 'src') RS.cmp[lado].quem = ''; render(); }
  });
  let qT;
  el.addEventListener('input', e => {
    if (!ativo()) return; const t = e.target;
    if (t.dataset.rfq !== undefined) { clearTimeout(qT); qT = setTimeout(() => { RS.f.q = t.value; render().then(() => { const n = $('[data-rfq]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 300); }
    else if (t.dataset.rddq) { const q = norm(t.value); t.closest('.fdd').querySelectorAll('.fdd-l label').forEach(x => { x.hidden = !!q && !x.dataset.nm.includes(q); }); }
  });
  el.addEventListener('toggle', e => { if (!ativo()) return; const d = e.target; if (!d.dataset || !d.dataset.rdd) return; if (d.open) { RS.aberto = d.dataset.rdd; $$('.fdd[open]', el).forEach(x => { if (x !== d) x.open = false; }); } else if (RS.aberto === d.dataset.rdd) RS.aberto = ''; }, true);
  document.addEventListener('pointerdown', e => { if (!ativo() || !RS.aberto || e.target.closest('.fdd')) return; const d = $(`.fdd[data-rdd="${RS.aberto}"]`); if (d) d.open = false; RS.aberto = ''; });
}

function resumoHub() {
  if (!RS.bases) return null;
  const l = basesList(), b = l[0];
  if (!b) return { bases: 0, ultimo: '', km: '—' };
  const a = agrega(recsResumo(b, novoFiltro()), fatorMes(b), semanasCiclo(b), b.res && b.res.cliV);
  return { bases: l.length, ultimo: fmtPer(b.periodo), km: fkm(a.kmMes) };
}

// Usado pela Verba Indenizatória: as mesmas fontes, rotas e nomes
window.RotasMod = { polyDe: (id, k) => RS.poly.get(id + '|' + k), iniciar, render, limpar, resumoHub, opcoesImport, ligaOpcoesImport, importar, fontesLista, fonteOpts, nomeFonte, carregaFonte, recsTodos, nomeVend, semanasCiclo, fmtPer, fmtPerLongo, ehEstudo };
})();
