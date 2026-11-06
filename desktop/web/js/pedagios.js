/* Módulo Pedágios: cadastro das praças de pedágio (local, rodovia, concessionária e tarifa por categoria de veículo),
   mapa próprio com as praças e as rotas de um estudo ou de uma base de Rotas, e relatório de quais rotas passam por
   quais praças, quantas vezes e quanto custam por dia e por mês.
   Uma rota passa por uma praça quando o percurso calculado pelas ruas chega a menos do raio de detecção dela
   (padrão 150 m). Cada entrada nesse raio é uma passagem; praças que cobram em um sentido só cobram metade das
   passagens (arredondando para cima, porque não se sabe qual dos sentidos é o cobrado).
   O Planner usa as mesmas funções (PedMod.blocoRota, PedMod.chip e PedMod.desenha) para mostrar os pedágios na roteirização.
   Usa as funções internas expostas pelo app.js em window.RRM. */
(function () {
'use strict';
const R = window.RRM; if (!R) return;
const { st, $, esc, toast, openModal, closeModal, ICON, nf0, nf1, fkm, isNum, uid, norm, numBR, hasXY, saveFile, xlsxBlob, slug, dstamp, DIA_C, DIA_L } = R;
const Rot = () => window.RotasMod;

const CFG_ID = '__cfg';
const CATS = [['carro', 'Carro', 'Automóvel, caminhonete e furgão (categoria 1)'], ['moto', 'Moto', 'Motocicleta (categoria 9)'], ['util', 'Utilitário', 'Caminhão leve, furgão e ônibus de 2 eixos (categoria 2)']];
const catNome = k => (CATS.find(c => c[0] === k) || CATS[0])[1];
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = v => 'R$ ' + nf2.format(v || 0);
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ICON_PED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M4.5 21V9.5L7 7l2.5 2.5V21"/><path d="M9.5 13H21"/><path d="M13 13l1.6-2M16.5 13l1.6-2"/><path d="M21 11v4"/></svg>';

const PS = {
  store: null, carregando: null, ver: 1, lista: null, listaVer: 0, cache: new Map(), poly: new Map(), fontes: new Map(),
  aba: 'mapa', fonte: '', vend: '', dia: 0, filtro: 'todas', q: '', foco: '', rota: '', marcando: false,
  map: null, vista: null, job: null, ligado: false, ultimo: null
};

/* ---------- Dados ---------- */
async function iniciar() {
  if (PS.store) return;
  if (!PS.carregando) PS.carregando = (async () => { const s = new R.BucketStore('pedagios'); try { await s.load(); } catch (e) { /* segue vazio */ } PS.store = s; PS.ver++; })();
  await PS.carregando;
}
const cfg = () => ({ cat: 'carro', raio: 150, ...((PS.store && PS.store.get(CFG_ID)) || {}) });
function lista() {
  if (!PS.lista || PS.listaVer !== PS.ver) {
    PS.lista = PS.store ? [...PS.store.values()].filter(x => x && x.tipo === 'praca' && isNum(x.lat) && isNum(x.lng)) : [];
    PS.lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }));
    PS.listaVer = PS.ver;
  }
  return PS.lista;
}
const pracaDe = id => PS.store && PS.store.get(id);
function grava(p) { PS.store.put(p.id, p); PS.ver++; PS.cache.clear(); }
function apaga(id) { PS.store.del(id); PS.ver++; PS.cache.clear(); }
function tarifa(p, cat = cfg().cat) { const v = p && p.tarifas ? p.tarifas[cat] : null; return isNum(v) ? v : null; }
const podeEditar = () => !st.ro;
const local = p => [p.rodovia, isNum(p.km) ? 'km ' + nf1.format(p.km) : ''].filter(Boolean).join(' · ');

/* ---------- Geometria: em que praças o percurso passa ---------- */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py; return Math.sqrt(x * x + y * y);
}
// path = [[lat, lng], ...]. Devolve as praças tocadas, na ordem do percurso, com o número de passagens
function passagens(path, pracas, raio) {
  if (!path || path.length < 2 || !pracas.length) return [];
  let s = 90, n = -90, w = 180, e = -180;
  for (const [la, ln] of path) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > e) e = ln; }
  const pad = raio / 80000;
  const cands = pracas.filter(p => p.lat >= s - pad && p.lat <= n + pad && p.lng >= w - pad * 1.4 && p.lng <= e + pad * 1.4);
  if (!cands.length) return [];
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180) * 111320, ky = 110574, L0 = path.length;
  const xs = new Float64Array(L0), ys = new Float64Array(L0);
  for (let i = 0; i < L0; i++) { xs[i] = path[i][1] * kx; ys[i] = path[i][0] * ky; }
  const sai = raio * 2.5, out = [];
  for (const p of cands) {
    const px = p.lng * kx, py = p.lat * ky, comDir = p.sentido === 'unico' && isNum(p.dir);
    let vezes = 0, noSentido = 0, dentro = false, min = Infinity, ini = -1, perto = Infinity, rumo = 0;
    // Ao sair do raio, a passagem conta no sentido cobrado se o rumo do trecho mais próximo da praça bater com ele
    const fecha = () => { if (comDir && difAng(rumo, p.dir) <= 70) noSentido++; dentro = false; };
    for (let i = 1; i < L0; i++) {
      const ax = xs[i - 1], ay = ys[i - 1], bx = xs[i], by = ys[i];
      if ((ax < bx ? ax : bx) - px > sai || px - (ax > bx ? ax : bx) > sai || (ay < by ? ay : by) - py > sai || py - (ay > by ? ay : by) > sai) { if (dentro) fecha(); continue; }
      const d = distSeg(px, py, ax, ay, bx, by);
      if (d < min) min = d;
      if (!dentro && d <= raio) { dentro = true; vezes++; perto = Infinity; if (ini < 0) ini = i; }
      if (dentro && d < perto && (bx !== ax || by !== ay)) { perto = d; rumo = (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360; }
      if (dentro && d > sai) fecha();
    }
    if (dentro) fecha();
    if (vezes) out.push({ p, n: vezes, cobr: comDir ? noSentido : p.sentido === 'unico' ? Math.ceil(vezes / 2) : vezes, dist: min, i: ini });
  }
  return out.sort((a, b) => a.i - b.i);
}
const difAng = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const RUMOS = [[0, 'Norte'], [45, 'Nordeste'], [90, 'Leste'], [135, 'Sudeste'], [180, 'Sul'], [225, 'Sudoeste'], [270, 'Oeste'], [315, 'Noroeste']];
const rumoNome = g => RUMOS.reduce((m, r) => (difAng(g, r[0]) < difAng(g, m[0]) ? r : m), RUMOS[0])[1];
const cobrancaTxt = p => (p.sentido !== 'unico' ? 'Os dois sentidos' : isNum(p.dir) ? `Só no sentido ${rumoNome(p.dir).toLowerCase()} (${Math.round(p.dir)}°)` : 'Um sentido (não informado)');
// Rumo escrito na planilha: graus ou N, NE, L/E, SE, S, SO/SW, O/W, NO/NW e os nomes por extenso
function parseRumo(v) {
  if (isNum(v)) return ((v % 360) + 360) % 360;
  const t = norm(v); if (!t) return null;
  const n = numBR(String(v).replace('°', '')); if (isNum(n)) return ((n % 360) + 360) % 360;
  const M = { n: 0, norte: 0, ne: 45, nordeste: 45, l: 90, e: 90, leste: 90, se: 135, sudeste: 135, s: 180, sul: 180, so: 225, sw: 225, sudoeste: 225, o: 270, w: 270, oeste: 270, no: 315, nw: 315, noroeste: 315 };
  const k = t.replace(/^sentido/, ''); return k in M ? M[k] : null;
}
// Resultado de um percurso: praças, passagens cobradas e valor por dia de rota. chave evita refazer a conta
function analisa(chave, path) {
  if (!PS.store || !path || path.length < 2) return null;
  const c = cfg(), ck = chave ? `${chave}|${PS.ver}|${c.raio}|${c.cat}` : '';
  if (ck && PS.cache.has(ck)) return PS.cache.get(ck);
  let valor = 0, semValor = 0, cobr = 0;
  const todas = passagens(path, lista(), c.raio);
  // livres: praças por onde a rota passa só no sentido que não é cobrado
  const livres = todas.filter(x => !x.cobr).map(x => x.p);
  const itens = todas.filter(x => x.cobr).map(x => {
    const t = tarifa(x.p, c.cat), total = t === null ? 0 : t * x.cobr;
    if (t === null) semValor++; valor += total; cobr += x.cobr;
    return { ...x, tarifa: t, total };
  });
  const res = { itens, livres, valor, semValor, cobr };
  if (ck) { if (PS.cache.size > 4000) PS.cache.clear(); PS.cache.set(ck, res); }
  return res;
}

/* ---------- Rotas de um estudo ou de uma base de Rotas ---------- */
async function carregaRotas(id) {
  if (!id) return null;
  if (id.startsWith('e:')) {
    const aid = id.slice(2), a = st.amb && st.amb.get(aid); if (!a) return null;
    let routes, geo;
    if (aid === st.cur && st.itens) { routes = st.routes; geo = st.geo ? st.geo.map : new Map(); }
    else {
      const c = PS.fontes.get(id); if (c && c.alt === a.alterado) return c.F;
      const b = new R.BucketStore('itens/' + aid + '/b'), g = new R.BucketStore('geo/' + aid + '/b');
      try { await Promise.all([b.load(), g.load()]); } finally { b.detach(); g.detach(); }
      geo = g.map; routes = R.buildRoutes(a, b.map, geo);
    }
    const rotas = [];
    for (const r of routes.values()) {
      const set = (a.setores || {})[r.s] || {}, col = set.colab && st.col.get(set.colab), g0 = geo.get(r.k), ok = g0 && g0.sig === r.sig;
      rotas.push({ k: r.k, v: set.colab || 's:' + r.s, nome: col ? col.nome : set.nome || 'Setor', setor: set.nome || '', w: r.w, d: r.d, sig: r.sig, n: r.m.n, km: r.m.km,
        base: col && hasXY(col) ? { lat: col.lat, lng: col.lng } : null,
        pts: r.stops.map(s => st.cli.get(s)).filter(x => x && hasXY(x)).map(x => ({ lat: x.lat, lng: x.lng })),
        pg: ok && g0.p ? g0.p : null, toll: !!(ok && g0.toll) });
    }
    const F = { id, nome: a.nome, estudo: true, sid: aid, fm: 4 / Math.max(1, R.P(a).semanas || 4), rotas };
    if (aid !== st.cur) PS.fontes.set(id, { alt: a.alterado, F });
    return F;
  }
  const Rm = Rot(); if (!Rm) return null;
  const F0 = await Rm.carregaFonte(id); if (!F0) return null;
  const b = F0.b, rotas = [];
  for (const r of F0.routes.values()) rotas.push({ k: r.k, v: r.v, nome: Rm.nomeVend(r.v), setor: '', w: r.w, d: r.d, sig: r.sig, n: r.m.n, km: r.m.km, base: r.base, pts: r.ord.map(x => ({ lat: x.lat, lng: x.lng })), pg: null });
  return { id, nome: Rm.nomeFonte(id), estudo: false, fm: b.porData ? 1 : 4 / Math.max(1, b.ciclo || 4), rotas };
}
const chaveDe = (F, r) => `${F.id}|${r.k}|${r.sig}`;
function pathDe(F, r) {
  const k = chaveDe(F, r); if (PS.poly.has(k)) return PS.poly.get(k);
  let p = null;
  if (r.pg) p = R.decodePoly(r.pg);
  else if (!F.estudo && Rot() && Rot().polyDe) p = Rot().polyDe(F.id, r.k) || null;
  if (p) PS.poly.set(k, p);
  return p;
}
// Registros: uma linha por rota com o resultado dos pedágios
function registros(F) {
  return F.rotas.map(r => { const path = pathDe(F, r); return { r, path, res: path ? analisa(chaveDe(F, r), path) : null }; });
}
function filtra(recs) {
  return recs.filter(x => (!PS.vend || x.r.v === PS.vend) && (!PS.dia || x.r.d === PS.dia)
    && (PS.filtro === 'todas' || (PS.filtro === 'com' ? x.res && x.res.itens.length : PS.filtro === 'sem' ? x.res && !x.res.itens.length : !x.path)));
}
function agrega(recs, fm) {
  const o = { rotas: recs.length, comPath: 0, comPed: 0, valorCiclo: 0, cobrCiclo: 0, semValor: new Set(), porPraca: new Map(), porVend: new Map() };
  for (const x of recs) {
    const v = o.porVend.get(x.r.v) || { v: x.r.v, nome: x.r.nome, rotas: 0, comPed: 0, semPath: 0, cobr: 0, valor: 0 }; o.porVend.set(x.r.v, v); v.rotas++;
    if (!x.res) { v.semPath++; continue; }
    o.comPath++;
    if (x.res.itens.length) { o.comPed++; v.comPed++; }
    o.valorCiclo += x.res.valor; o.cobrCiclo += x.res.cobr; v.cobr += x.res.cobr; v.valor += x.res.valor;
    for (const it of x.res.itens) {
      const q = o.porPraca.get(it.p.id) || { p: it.p, rotas: 0, vend: new Set(), cobr: 0, valor: 0 }; o.porPraca.set(it.p.id, q);
      q.rotas++; q.vend.add(x.r.v); q.cobr += it.cobr; q.valor += it.total;
      if (it.tarifa === null) o.semValor.add(it.p.id);
    }
  }
  o.valorMes = o.valorCiclo * fm; o.cobrMes = o.cobrCiclo * fm; o.diaMedio = o.comPath ? o.valorCiclo / o.comPath : 0;
  return o;
}
const rotaNome = r => `${r.nome} · S${r.w} · ${DIA_C[r.d] || ''}`;

/* ---------- Partes da página ---------- */
const kc = (k, v, s, tip) => `<div class="kc"${tip ? ` data-tip="${esc(tip)}"` : ''}><span class="k">${k}</span><span class="v${String(v).startsWith('R$') ? ' rs' : ''}">${v}</span><span class="s">${s}</span></div>`;
const chipB = (attr, v, txt, on) => `<button type="button" data-${attr}="${esc(v)}" aria-pressed="${on}">${txt}</button>`;
const valorTxt = p => { const t = tarifa(p); return t === null ? '<span class="pill warn">sem valor</span>' : `<b class="num">${brl(t)}</b>`; };
function tipPraca(p, q) {
  const c = cfg(), t = tarifa(p, c.cat);
  return `<div class="tip"><b>${esc(p.nome)}</b>${local(p) ? `<br><span class="t2">${esc(local(p))}</span>` : ''}${p.concessionaria ? `<br><span class="t2">${esc(p.concessionaria)}</span>` : ''}
    <br><span class="t2">${catNome(c.cat)}: ${t === null ? 'sem valor cadastrado' : brl(t)}${p.sentido === 'unico' ? ' · ' + esc(cobrancaTxt(p).toLowerCase()) : ''}</span>${q ? `<br><span class="t2"><b>${nf0.format(q.rotas)} rota(s)</b> · ${nf0.format(q.cobr)} cobrança(s) no ciclo</span>` : ''}</div>`;
}
function fonteBar(F) {
  const Rm = Rot(), opts = Rm ? Rm.fonteOpts(PS.fonte) : '';
  const vends = F ? [...new Map(F.rotas.map(r => [r.v, r.nome])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR')) : [];
  const dias = F ? [...new Set(F.rotas.map(r => r.d))].sort((a, b) => a - b) : [];
  return `<div class="card rt-base"><div class="cb row pd-fonte">
    <label class="row"><span class="lbl">Rotas de</span><select data-pfonte aria-label="Estudo ou base de rotas"><option value=""${PS.fonte ? '' : ' selected'}>Nenhuma (só as praças)</option>${opts}</select></label>
    ${F ? `<label class="row"><span class="lbl">Vendedor</span><select data-pvend aria-label="Vendedor"><option value="">Todos</option>${vends.map(([v, n]) => `<option value="${esc(v)}"${v === PS.vend ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="row"><span class="lbl">Dia</span><select data-pdia aria-label="Dia"><option value="0">Todos</option>${dias.map(d => `<option value="${d}"${d === PS.dia ? ' selected' : ''}>${DIA_L[d]}</option>`).join('')}</select></label>
      <div class="seg" role="group" aria-label="Rotas">${[['todas', 'Todas'], ['com', 'Com pedágio'], ['sem', 'Sem pedágio'], ['semtraco', 'Sem traçado']].map(([k, t]) => chipB('pfiltro', k, t, PS.filtro === k)).join('')}</div>` : '<span class="muted" style="font-size:12.5px">Escolha um estudo ou uma base de rotas para ver por onde as rotas passam.</span>'}
  </div></div>`;
}
function kpis(F, ag) {
  const L = lista(), semV = L.filter(p => tarifa(p) === null).length, c = cfg();
  if (!F) return `<div class="kgrid">${kc('Praças cadastradas', nf0.format(L.length), semV ? `${nf0.format(semV)} sem valor` : 'todas com valor')}${kc('Categoria usada', catNome(c.cat), `raio de detecção ${nf0.format(c.raio)} m`)}${kc('Tarifa média', L.length - semV ? brl(L.reduce((s, p) => s + (tarifa(p) || 0), 0) / (L.length - semV)) : '—', `por passagem · ${catNome(c.cat).toLowerCase()}`)}</div>`;
  return `<div class="kgrid">
    ${kc('Rotas com pedágio', `${nf0.format(ag.comPed)} <small>de ${nf0.format(ag.rotas)}</small>`, ag.rotas - ag.comPath ? `${nf0.format(ag.rotas - ag.comPath)} sem traçado pelas ruas` : 'todas com traçado pelas ruas', 'Só as rotas traçadas pelas ruas entram na conta')}
    ${kc('Praças nas rotas', nf0.format(ag.porPraca.size), `de ${nf0.format(L.length)} cadastradas${ag.semValor.size ? ` · <b>${nf0.format(ag.semValor.size)} sem valor</b>` : ''}`)}
    ${kc('Passagens cobradas no mês', nf0.format(Math.round(ag.cobrMes)), `${nf0.format(ag.cobrCiclo)} no ciclo`)}
    ${kc('Pedágio no mês', brl(ag.valorMes), `${brl(ag.diaMedio)} por dia de rota (média)`, `Categoria: ${catNome(c.cat)}\nMês de 4 semanas: valor do ciclo × 4 ÷ semanas do ciclo`)}
  </div>`;
}
function abaMapa(F, recs, ag) {
  const semPath = F ? recs.filter(x => !x.path).length : 0, L = lista();
  const sel = PS.rota && recs.find(x => x.r.k === PS.rota);
  let lado = '';
  if (sel) {
    const r = sel.r, res = sel.res;
    lado = `<section class="stack"><div class="row" style="justify-content:space-between"><span class="lbl">Rota</span><button class="btn sm ghost" type="button" data-pa="rotafecha">← Todas</button></div>
      <div><b>${esc(r.nome)}</b> · Semana ${r.w} · ${DIA_L[r.d]}<div class="muted">${nf0.format(r.n)} visitas · ${fkm(r.km)} km</div></div>
      ${blocoRes(res, F.fm, !sel.path, r.toll)}</section>`;
  } else {
    const praças = F ? [...ag.porPraca.values()].sort((a, b) => b.valor - a.valor || b.cobr - a.cobr) : L.map(p => ({ p }));
    const rotasPed = F ? recs.filter(x => x.res && x.res.itens.length).sort((a, b) => b.res.valor - a.res.valor) : [];
    lado = `<section class="stack"><span class="lbl">${F ? `Praças nas rotas · ${nf0.format(praças.length)}` : `Praças cadastradas · ${nf0.format(L.length)}`}</span>
      <div class="pd-list">${praças.slice(0, 200).map(q => `<button type="button" class="pd-it" data-pfoco="${esc(q.p.id)}"><span class="pd-ic${F ? ' on' : ''}${tarifa(q.p) === null ? ' sv' : ''}">${ICON_PED}</span><span class="nm">${esc(q.p.nome)}<span class="muted">${esc(local(q.p) || q.p.cidade || '')}</span></span><span class="vl">${tarifa(q.p) === null ? '<span class="pill warn">sem valor</span>' : brl(tarifa(q.p))}${q.cobr ? `<span class="muted">${nf0.format(Math.round(q.cobr * F.fm))}×/mês · ${brl(q.valor * F.fm)}</span>` : ''}</span></button>`).join('') || `<p class="muted" style="margin:0">${F ? 'Nenhuma praça cadastrada no caminho destas rotas.' : 'Nenhuma praça cadastrada ainda.'}</p>`}</div></section>
      ${F ? `<section class="stack"><span class="lbl">Rotas com pedágio · ${nf0.format(rotasPed.length)}</span>
        <div class="pd-list">${rotasPed.slice(0, 150).map(x => `<button type="button" class="pd-it" data-prota="${esc(x.r.k)}"><span class="pd-ic on">${ICON_PED}</span><span class="nm">${esc(rotaNome(x.r))}<span class="muted">${x.res.itens.map(i => esc(i.p.nome)).join(' · ')}</span></span><span class="vl"><b class="num">${brl(x.res.valor)}</b><span class="muted">por dia</span></span></button>`).join('') || '<p class="muted" style="margin:0">Nenhuma rota traçada passa por praça cadastrada.</p>'}</div></section>` : ''}`;
  }
  return `<div class="rt-mapbar">
      ${podeEditar() ? `<button class="btn sm${PS.marcando ? ' primary' : ''}" type="button" data-pa="marcar" aria-pressed="${PS.marcando}">${PS.marcando ? 'Clique no mapa para marcar a praça' : 'Marcar praça no mapa'}</button>
      <button class="btn sm" type="button" data-pa="osm" title="Busca as praças de pedágio do OpenStreetMap na área visível do mapa. Os valores são preenchidos por você">Buscar praças nesta área (OpenStreetMap)</button>` : ''}
      <span class="sp"></span>
      ${F && semPath ? (PS.job ? `<span class="muted num" id="pdJob">Traçando pelas ruas: ${PS.job.feitos}/${PS.job.total}</span><button class="btn sm" type="button" data-pa="jobstop">Parar</button>` : `<button class="btn sm" type="button" data-pa="tracar" title="Consulta o servidor de rotas (cerca de 1 por segundo no servidor público). O traçado vale para esta análise; para gravar o KM pelas ruas, use o Planner ou Rotas → Mapa">Traçar pelas ruas (${nf0.format(Math.min(semPath, 200))})</button>`) : ''}
    </div>
    <div class="pd-grid"><div class="rt-mapwrap"><div id="pdMap" class="rt-map${PS.marcando ? ' marcando' : ''}" aria-label="Mapa dos pedágios"></div>
      <div class="rt-legend pd-leg"><div class="li"><span class="pd-ic on">${ICON_PED}</span>Na rota</div><div class="li"><span class="pd-ic">${ICON_PED}</span>Fora das rotas</div><div class="li"><span class="pd-ic sv">${ICON_PED}</span>Sem valor</div>${F ? '<div class="li"><span class="sw ln on"></span>Rota com pedágio</div><div class="li"><span class="sw ln"></span>Rota sem pedágio</div><div class="li"><span class="sw ln tr"></span>Sem traçado</div>' : ''}</div></div>
      <aside class="card pd-side"><div class="cb stack">${lado}</div></aside></div>`;
}
// Bloco com os pedágios de uma rota (no módulo e no Planner)
function blocoRes(res, fm, semPath, tollServidor) {
  if (!PS.store) return '';
  if (!lista().length) return `<div class="pd-bloco"><p class="muted" style="margin:0;font-size:12.5px">Nenhuma praça de pedágio cadastrada.${tollServidor ? ' O servidor de rotas indica pedágio neste percurso.' : ''}</p><div class="row"><button class="btn sm" type="button" data-hub="ped">Cadastrar pedágios</button></div></div>`;
  if (semPath || !res) return `<div class="pd-bloco"><p class="muted" style="margin:0;font-size:12.5px">Trace o percurso pelas ruas para identificar os pedágios desta rota.</p></div>`;
  const livres = res.livres && res.livres.length ? `<p class="muted" style="margin:0;font-size:12px">Passa também por ${res.livres.map(p => esc(p.nome)).join(', ')} no sentido que não é cobrado.</p>` : '';
  if (!res.itens.length) return `<div class="pd-bloco"><div class="row"><span class="pill ok">Sem pedágio</span><span class="muted" style="font-size:12.5px">${res.livres && res.livres.length ? 'Nenhuma praça cobrada no sentido percorrido.' : 'O percurso não passa por praça cadastrada.'}</span></div>${livres}${tollServidor && !(res.livres && res.livres.length) ? '<div class="banner" style="font-size:12.5px">O servidor de rotas indica pedágio neste percurso, mas a praça não está cadastrada. <button type="button" class="linkbtn" data-hub="ped">Cadastrar</button></div>' : ''}</div>`;
  return `<div class="pd-bloco">
    <div class="row" style="justify-content:space-between"><span class="pill warn">${nf0.format(res.itens.length)} pedágio${res.itens.length > 1 ? 's' : ''}</span><span class="pd-tot"><b class="num">${brl(res.valor)}</b> por dia · <b class="num">${brl(res.valor * fm)}</b> no mês</span></div>
    <div class="pd-list">${res.itens.map(it => `<div class="pd-it" title="${esc(local(it.p))}"><span class="pd-ic on${it.tarifa === null ? ' sv' : ''}">${ICON_PED}</span><span class="nm">${esc(it.p.nome)}<span class="muted">${esc(local(it.p) || it.p.concessionaria || '')}${it.p.sentido === 'unico' ? ' · ' + esc(isNum(it.p.dir) ? 'sentido ' + rumoNome(it.p.dir).toLowerCase() : 'um sentido') : ''}</span></span><span class="vl">${it.tarifa === null ? '<span class="pill warn">sem valor</span>' : `<b class="num">${brl(it.total)}</b>`}<span class="muted">${it.cobr}× ${it.tarifa === null ? '' : brl(it.tarifa)}</span></span></div>`).join('')}</div>
    ${livres}${res.semValor ? `<p class="muted" style="margin:0;font-size:12px">${res.semValor} praça(s) sem valor para ${catNome(cfg().cat).toLowerCase()} ficam fora do total.</p>` : ''}
  </div>`;
}
function abaRel(F, recs, ag) {
  if (!F) return '<div class="card"><div class="cb muted">Escolha acima um estudo ou uma base de rotas para ver o relatório de pedágios por vendedor, por praça e por rota.</div></div>';
  const fm = F.fm, vend = [...ag.porVend.values()].sort((a, b) => b.valor - a.valor), pr = [...ag.porPraca.values()].sort((a, b) => b.valor - a.valor);
  const rotas = recs.filter(x => x.res && x.res.itens.length).sort((a, b) => a.r.nome.localeCompare(b.r.nome, 'pt-BR') || a.r.w - b.r.w || a.r.d - b.r.d);
  return `<div class="row" style="justify-content:flex-end"><button class="btn sm" type="button" data-pa="xls">Exportar (.xlsx)</button></div>
    <div class="card"><div class="ch"><h2>Por vendedor</h2><span class="muted" style="font-size:12px">${catNome(cfg().cat)} · mês de 4 semanas</span></div><div class="tblwrap"><table class="t"><thead><tr><th>Vendedor</th><th class="n">Rotas</th><th class="n">Com pedágio</th><th class="n">Sem traçado</th><th class="n">Passagens/mês</th><th class="n">R$/dia (média)</th><th class="n">R$/mês</th></tr></thead><tbody>
      ${vend.map(v => `<tr><td><b>${esc(v.nome)}</b>${String(v.v).startsWith('s:') ? '' : ` <span class="muted">${esc(v.v)}</span>`}</td><td class="n">${nf0.format(v.rotas)}</td><td class="n">${nf0.format(v.comPed)}</td><td class="n">${v.semPath ? `<span class="pill idle">${nf0.format(v.semPath)}</span>` : '0'}</td><td class="n">${nf0.format(Math.round(v.cobr * fm))}</td><td class="n">${brl(v.rotas - v.semPath ? v.valor / (v.rotas - v.semPath) : 0)}</td><td class="n"><b>${brl(v.valor * fm)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sem rotas com estes filtros.</td></tr>'}
      ${vend.length > 1 ? `<tr class="tot"><td>Total</td><td class="n">${nf0.format(ag.rotas)}</td><td class="n">${nf0.format(ag.comPed)}</td><td class="n">${nf0.format(ag.rotas - ag.comPath)}</td><td class="n">${nf0.format(Math.round(ag.cobrMes))}</td><td class="n">${brl(ag.diaMedio)}</td><td class="n">${brl(ag.valorMes)}</td></tr>` : ''}</tbody></table></div></div>
    <div class="card"><div class="ch"><h2>Por praça</h2></div><div class="tblwrap"><table class="t"><thead><tr><th>Praça</th><th>Rodovia</th><th>Concessionária</th><th class="n">Tarifa</th><th class="n">Rotas</th><th class="n">Vendedores</th><th class="n">Passagens/mês</th><th class="n">R$/mês</th></tr></thead><tbody>
      ${pr.map(q => `<tr class="clk" data-pfoco="${esc(q.p.id)}"><td><b>${esc(q.p.nome)}</b></td><td>${esc(local(q.p) || '—')}</td><td>${esc(q.p.concessionaria || '—')}</td><td class="n">${valorTxt(q.p)}</td><td class="n">${nf0.format(q.rotas)}</td><td class="n">${nf0.format(q.vend.size)}</td><td class="n">${nf0.format(Math.round(q.cobr * fm))}</td><td class="n"><b>${brl(q.valor * fm)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhuma praça cadastrada no caminho destas rotas.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="ch"><h2>Rotas com pedágio · ${nf0.format(rotas.length)}</h2></div><div class="tblwrap"><table class="t"><thead><tr><th>Vendedor</th><th>Semana</th><th>Dia</th><th>Praças no percurso</th><th class="n">Passagens</th><th class="n">R$/dia</th><th class="n">R$/mês</th></tr></thead><tbody>
      ${rotas.map(x => `<tr class="clk" data-prota="${esc(x.r.k)}"><td>${esc(x.r.nome)}</td><td>S${x.r.w}</td><td>${DIA_L[x.r.d]}</td><td>${x.res.itens.map(i => esc(i.p.nome) + (i.n > 1 ? ` (${i.cobr}×)` : '')).join(' · ')}</td><td class="n">${nf0.format(x.res.cobr)}</td><td class="n">${brl(x.res.valor)}</td><td class="n"><b>${brl(x.res.valor * fm)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma rota traçada passa por praça cadastrada.</td></tr>'}</tbody></table></div></div>`;
}
function abaPracas() {
  const q = norm(PS.q), L = lista().filter(p => !q || norm([p.nome, p.rodovia, p.concessionaria, p.cidade, p.uf].join(' ')).includes(q)), semV = lista().filter(p => tarifa(p) === null).length;
  const tar = (p, k) => { const v = p.tarifas && p.tarifas[k]; return isNum(v) ? brl(v) : '<span class="muted">—</span>'; };
  return `<div class="row" style="justify-content:space-between"><input type="search" data-pq placeholder="Buscar por nome, rodovia, concessionária ou cidade" value="${esc(PS.q)}" style="min-width:min(380px,100%)" aria-label="Buscar praça">
      <span class="row"><span class="muted" style="font-size:12.5px">${nf0.format(lista().length)} praça(s)${semV ? ` · ${nf0.format(semV)} sem valor de ${catNome(cfg().cat).toLowerCase()}` : ''}</span><button class="btn sm" type="button" data-pa="xlspracas"${lista().length ? '' : ' disabled'}>Exportar (.xlsx)</button></span></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Praça</th><th>Rodovia</th><th>Concessionária</th><th>Cidade</th><th>Cobrança</th>${CATS.map(c => `<th class="n">${c[1]}</th>`).join('')}<th>Origem</th><th></th></tr></thead><tbody>
    ${L.map(p => `<tr><td><b>${esc(p.nome)}</b></td><td>${esc(local(p) || '—')}</td><td>${esc(p.concessionaria || '—')}</td><td>${esc([p.cidade, p.uf].filter(Boolean).join('/') || '—')}</td><td>${esc(cobrancaTxt(p))}</td>${CATS.map(c => `<td class="n">${tar(p, c[0])}</td>`).join('')}<td class="muted" style="font-size:12px">${esc(p.fonte || 'manual')}${p.atualizado ? ' · ' + esc(p.atualizado.split('-').reverse().join('/')) : ''}</td>
      <td><div class="pd-acoes"><button class="btn sm" type="button" data-pfoco="${esc(p.id)}">Mapa</button><button class="btn sm" type="button" data-pa="edita" data-id="${esc(p.id)}"${podeEditar() ? '' : ' disabled'}>Editar</button></div></td></tr>`).join('') || `<tr><td colspan="${8 + CATS.length}" class="muted">${lista().length ? 'Nenhuma praça com esta busca.' : 'Nenhuma praça cadastrada ainda.'}</td></tr>`}</tbody></table></div>`;
}
function vazio() {
  return `<div class="card"><div class="empty"><span class="mod-i xl">${ICON_PED}</span><h3>Nenhuma praça de pedágio cadastrada</h3>
    <p>Cadastre as praças com o local e a tarifa de cada categoria. Elas podem vir de uma planilha (modelo pronto), ser buscadas no OpenStreetMap pela área do mapa (só o local; os valores você completa) ou marcadas uma a uma no mapa.</p>
    <div class="row" style="justify-content:center"><button class="btn" type="button" data-pa="modelo">Baixar modelo</button><button class="btn" type="button" data-pa="importa"${podeEditar() ? '' : ' disabled'}>Importar planilha</button><button class="btn primary" type="button" data-paba="mapa">Abrir o mapa</button></div></div></div>`;
}

/* ---------- Página ---------- */
let renderSeq = 0;
async function render(el = $('#homeView')) {
  if (!el || st.screen !== 'home' || st.homeSec !== 'ped') return;
  const seq = ++renderSeq, keep = el.scrollTop;
  limpaMapa(); liga(el);
  if (!PS.store) { el.innerHTML = `<div class="page home">${R.migalha('Pedágios')}<p class="muted">Carregando as praças de pedágio…</p></div>`; await Promise.all([iniciar(), Rot() ? Rot().iniciar() : null]); if (seq !== renderSeq) return; }
  const c = cfg();
  if (PS.fonte && Rot() && !Rot().fontesLista().some(f => f.id === PS.fonte)) PS.fonte = '';
  const topo = `${R.migalha('Pedágios')}<div class="ph"><div><h1>Pedágios</h1><p>As praças de pedágio, os valores e por onde as rotas passam: escolha um estudo ou uma base de rotas para ver quais rotas pagam pedágio, quanto por dia e no mês.</p></div>
    <div class="row"><button class="btn" type="button" data-pa="param">Parâmetros · ${esc(catNome(c.cat))} · ${nf0.format(c.raio)} m</button><button class="btn" type="button" data-pa="modelo">Modelo (.xlsx)</button><button class="btn" type="button" data-pa="importa"${podeEditar() ? '' : ' disabled'}>Importar praças</button><button class="btn primary" type="button" data-pa="nova"${podeEditar() ? '' : ' disabled'}>Nova praça</button></div></div>
    ${st.pedSemTabela ? '<div class="banner bad">O banco de dados ainda não tem a tabela de Pedágios: o que for cadastrado vale só nesta sessão. Rode <b>supabase/migracao_07_pedagios.sql</b> no Supabase.</div>' : ''}`;
  let F = null;
  if (PS.fonte) {
    if (!PS.ultimo || PS.ultimo.F.id !== PS.fonte) el.innerHTML = `<div class="page home pedagios">${topo}<p class="muted">Carregando as rotas…</p></div>`;
    try { F = await carregaRotas(PS.fonte); } catch (e) { toast('Não foi possível carregar as rotas: ' + (e.message || e.code || e)); }
    if (seq !== renderSeq) return;
    if (F && PS.vend && !F.rotas.some(r => r.v === PS.vend)) PS.vend = '';
  }
  const recs = F ? filtra(registros(F)) : [], ag = F ? agrega(recs, F.fm) : null;
  PS.ultimo = F ? { F, recs, ag } : null;
  if (PS.rota && !recs.some(x => x.r.k === PS.rota)) PS.rota = '';
  const ABAS = [['mapa', 'Mapa'], ['rel', 'Relatório'], ['pracas', `Praças${lista().length ? ' · ' + nf0.format(lista().length) : ''}`]];
  let corpo;
  if (!lista().length && PS.aba !== 'mapa') corpo = vazio();
  else if (PS.aba === 'rel') corpo = kpis(F, ag) + abaRel(F, recs, ag);
  else if (PS.aba === 'pracas') corpo = abaPracas();
  else corpo = kpis(F, ag) + abaMapa(F, recs, ag);
  el.innerHTML = `<div class="page home pedagios">${topo}
    <nav class="rt-abas seg" aria-label="Visões">${ABAS.map(([k, t]) => chipB('paba', k, t, PS.aba === k)).join('')}</nav>
    ${PS.aba === 'pracas' ? '' : fonteBar(F)}${corpo}</div>`;
  el.scrollTop = keep;
  if (PS.aba === 'mapa') montaMapa(F, recs, ag);
}

/* ---------- Mapa do módulo ---------- */
function limpaMapa() { if (PS.map) { try { PS.map.remove(); } catch (e) { /* ignora */ } PS.map = null; } }
const corTok = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
function iconePraca(p, on, foco) {
  const sv = tarifa(p) === null;
  return L.divIcon({ className: '', html: `<div class="pedm${on ? ' on' : ''}${sv ? ' sv' : ''}${foco ? ' foco' : ''}">${ICON_PED}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}
function popupPraca(p, q, fm) {
  const c = cfg();
  return `<div class="pd-pop"><b>${esc(p.nome)}</b>${local(p) ? `<span class="muted">${esc(local(p))}</span>` : ''}${p.concessionaria ? `<span class="muted">${esc(p.concessionaria)}</span>` : ''}
    <div class="mgrid">${CATS.map(k => `<span>${k[1]}</span><span class="v">${tarifa(p, k[0]) === null ? '—' : brl(tarifa(p, k[0]))}</span>`).join('')}</div><span class="muted">Cobrança: ${esc(cobrancaTxt(p))}</span>
    ${q ? `<span><b>${nf0.format(q.rotas)}</b> rota(s) · ${nf0.format(Math.round(q.cobr * fm))} passagem(ns) no mês · <b>${brl(q.valor * fm)}</b>/mês (${catNome(c.cat).toLowerCase()})</span>` : PS.ultimo ? '<span class="muted">Nenhuma das rotas filtradas passa aqui.</span>' : ''}
    ${podeEditar() ? `<div class="row"><button class="btn sm" type="button" data-pa="edita" data-id="${esc(p.id)}">Editar</button></div>` : ''}</div>`;
}
function montaMapa(F, recs, ag) {
  const el = $('#pdMap'); if (!el) return;
  const m = L.map(el, { zoomControl: true, preferCanvas: true, attributionControl: true, boxZoom: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
  m.attributionControl.setPrefix('');
  let kind = st.baseKind; if (!R.BASES[kind]) kind = R.isDark() ? 'escuro' : 'claro';
  const B = R.BASES[kind]; L.tileLayer(B.url, { attribution: B.att, maxZoom: 19, maxNativeZoom: B.nz || 19 }).addTo(m);
  L.control.scale({ metric: true, imperial: false, position: 'bottomright', maxWidth: 140 }).addTo(m);
  m.createPane('pdLinhas'); m.getPane('pdLinhas').style.zIndex = 390;
  const rLin = L.canvas({ pane: 'pdLinhas', padding: 0.4, tolerance: 6 });
  PS.map = m;
  const corCom = corTok('--route', '#F97316'), corSem = corTok('--accent', '#22D3EE'), corTr = corTok('--muted', '#8a94a6');
  const bounds = [], sel = PS.rota;
  if (F) {
    const lim = recs.length > 600 ? recs.slice(0, 600) : recs;
    for (const x of lim) {
      const com = x.res && x.res.itens.length, foco = sel === x.r.k, apagada = sel && !foco;
      const ll = x.path || [...(x.r.base ? [x.r.base] : []), ...x.r.pts, ...(x.r.base ? [x.r.base] : [])].map(p => [p.lat, p.lng]);
      if (ll.length < 2) continue;
      if (!sel || foco) ll.forEach(p => bounds.push(p));
      const o = { renderer: rLin, color: !x.path ? corTr : com ? corCom : corSem, weight: foco ? 5.5 : com ? 3.5 : 2.5, opacity: apagada ? 0.18 : x.path ? 0.85 : 0.5, dashArray: x.path ? null : '4 6' };
      L.polyline(ll, o).bindTooltip(`<div class="tip"><b>${esc(rotaNome(x.r))}</b><br><span class="t2">${!x.res ? 'sem traçado pelas ruas' : com ? `${x.res.itens.length} pedágio(s) · ${brl(x.res.valor)} por dia` : 'sem pedágio'}</span></div>`, { sticky: true })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); PS.rota = x.r.k; PS.vista = null; render(); }).addTo(m);
    }
  }
  const fm = F ? F.fm : 1, focoP = PS.foco && pracaDe(PS.foco);
  const xSel = sel ? recs.find(y => y.r.k === sel) : null, naSel = new Set(xSel && xSel.res ? xSel.res.itens.map(i => i.p.id) : []);
  for (const p of lista()) {
    const q = ag && ag.porPraca.get(p.id), on = sel ? naSel.has(p.id) : !!q;
    const mk = L.marker([p.lat, p.lng], { icon: iconePraca(p, on, focoP && focoP.id === p.id), keyboard: false, zIndexOffset: on ? 500 : 0, opacity: sel && !on ? 0.45 : 1 })
      .bindTooltip(tipPraca(p, q), { direction: 'top', offset: [0, -12] }).bindPopup(popupPraca(p, q, fm), { maxWidth: 280 }).addTo(m);
    if (!F) bounds.push([p.lat, p.lng]);
    if (focoP && focoP.id === p.id) setTimeout(() => { try { mk.openPopup(); } catch (e) { /* ignora */ } }, 60);
  }
  if (focoP) m.setView([focoP.lat, focoP.lng], 14);
  else if (PS.vista && PS.vista.fonte === PS.fonte && PS.vista.rota === PS.rota) m.setView(PS.vista.c, PS.vista.z);
  else if (bounds.length) m.fitBounds(L.latLngBounds(bounds).pad(0.06), { maxZoom: 14 });
  else m.setView([-23.55, -46.63], 9);
  PS.foco = '';
  m.on('moveend', () => { PS.vista = { c: m.getCenter(), z: m.getZoom(), fonte: PS.fonte, rota: PS.rota }; });
  // O Leaflet não deixa o clique sair do popup: o botão Editar é ligado aqui
  m.on('popupopen', ev => { const b = ev.popup.getElement() && ev.popup.getElement().querySelector('[data-pa="edita"]'); if (b) b.onclick = () => pracaForm(pracaDe(b.dataset.id)); });
  m.on('click', ev => { if (!PS.marcando) return; PS.marcando = false; pracaForm({ lat: +ev.latlng.lat.toFixed(6), lng: +ev.latlng.lng.toFixed(6) }); });
}

/* ---------- Cadastro ---------- */
function pracaForm(p0 = {}) {
  if (!podeEditar()) return;
  const p = { sentido: 'ambos', tarifas: {}, ...p0 }, novo = !p.id;
  const num = v => (isNum(v) ? String(v).replace('.', ',') : '');
  openModal(`<div class="dh"><h2>${novo ? 'Nova praça de pedágio' : 'Editar praça de pedágio'}</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="pdForm"><div class="db"><div class="fgrid">
      <label class="field" style="grid-column:1/-1"><span class="lbl">Nome da praça</span><input type="text" name="nome" maxlength="90" required value="${esc(p.nome || '')}" placeholder="Ex.: Praça de Itatiba"></label>
      <label class="field"><span class="lbl">Rodovia</span><input type="text" name="rodovia" maxlength="40" value="${esc(p.rodovia || '')}" placeholder="SP-065"></label>
      <label class="field"><span class="lbl">KM</span><input type="text" name="km" inputmode="decimal" value="${esc(num(p.km))}" placeholder="74,5"></label>
      <label class="field"><span class="lbl">Concessionária</span><input type="text" name="conc" maxlength="60" value="${esc(p.concessionaria || '')}"></label>
      <label class="field"><span class="lbl">Cidade</span><input type="text" name="cidade" maxlength="60" value="${esc(p.cidade || '')}"></label>
      <label class="field"><span class="lbl">UF</span><input type="text" name="uf" maxlength="2" value="${esc(p.uf || '')}" style="text-transform:uppercase"></label>
      <label class="field"><span class="lbl">Latitude</span><input type="text" name="lat" inputmode="decimal" required value="${esc(num(p.lat))}" placeholder="-23,0123"><span class="hint">Cole “-23.01, -46.84” para preencher as duas</span></label>
      <label class="field"><span class="lbl">Longitude</span><input type="text" name="lng" inputmode="decimal" required value="${esc(num(p.lng))}" placeholder="-46,8456"></label>
      <label class="field"><span class="lbl">Cobrança</span><select name="sentido"><option value="ambos"${p.sentido !== 'unico' ? ' selected' : ''}>Nos dois sentidos</option><option value="unico"${p.sentido === 'unico' ? ' selected' : ''}>Em um sentido só</option></select></label>
      <label class="field"><span class="lbl">Sentido cobrado</span><select name="dir"${p.sentido === 'unico' ? '' : ' disabled'}><option value="">Não sei (metade das passagens)</option>${RUMOS.map(r => `<option value="${r[0]}"${isNum(p.dir) && Math.round(p.dir) === r[0] ? ' selected' : ''}>${r[1]}</option>`).join('')}${isNum(p.dir) && !RUMOS.some(r => r[0] === Math.round(p.dir)) ? `<option value="${p.dir}" selected>${rumoNome(p.dir)} · ${Math.round(p.dir)}°</option>` : ''}</select><span class="hint">Rumo de quem paga, ex.: Sul = indo para o sul</span></label>
    </div>
    <div class="stack"><span class="lbl">Tarifa por passagem (R$)</span><div class="fgrid">
      ${CATS.map(c => `<label class="field"><span class="lbl">${c[1]}</span><input type="text" name="t_${c[0]}" inputmode="decimal" value="${esc(num(p.tarifas[c[0]]))}" placeholder="0,00"><span class="hint">${esc(c[2])}</span></label>`).join('')}
      <label class="field"><span class="lbl">Valores válidos desde</span><input type="date" name="atualizado" value="${esc(p.atualizado || '')}"></label>
    </div></div>
    <label class="field"><span class="lbl">Observação (opcional)</span><textarea name="obs" maxlength="300">${esc(p.obs || '')}</textarea></label>
    ${p.fonte === 'OpenStreetMap' ? '<p class="muted" style="margin:0;font-size:12.5px">Local vindo do OpenStreetMap. Confira o nome e preencha as tarifas pela tabela da concessionária ou da agência reguladora (ANTT ou a estadual).</p>' : ''}
    </div>
    <div class="df">${novo ? '' : '<button class="btn danger" type="button" id="pdDel">Excluir</button>'}<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`);
  const f = $('#pdForm');
  f.sentido.addEventListener('change', () => { f.dir.disabled = f.sentido.value !== 'unico'; });
  f.lat.addEventListener('input', () => { const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(f.lat.value); if (m && f.lat.value.includes(' ')) { f.lat.value = m[1].replace('.', ','); f.lng.value = m[2].replace('.', ','); } });
  f.onsubmit = ev => {
    ev.preventDefault();
    const lat = numBR(f.lat.value), lng = numBR(f.lng.value);
    if (!isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('Latitude e longitude inválidas'); return; }
    const tarifas = {}; for (const c of CATS) { const v = numBR(f['t_' + c[0]].value); if (isNum(v) && v >= 0) tarifas[c[0]] = Math.round(v * 100) / 100; }
    const km = numBR(f.km.value), id = p.id || uid('pd');
    grava({ ...p, id, tipo: 'praca', nome: f.nome.value.trim(), rodovia: f.rodovia.value.trim().toUpperCase(), km: isNum(km) ? km : null, concessionaria: f.conc.value.trim(), cidade: f.cidade.value.trim(), uf: f.uf.value.trim().toUpperCase(), lat, lng, sentido: f.sentido.value, dir: f.sentido.value === 'unico' && f.dir.value !== '' ? +f.dir.value : null, tarifas, atualizado: f.atualizado.value || '', obs: f.obs.value.trim(), fonte: p.fonte || 'manual', usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() });
    R.audita('pedagios', `${novo ? 'Incluiu' : 'Alterou'} a praça ${f.nome.value.trim()}`);
    closeModal(); PS.foco = id; render(); toast('Praça salva');
  };
  const del = $('#pdDel'); if (del) del.onclick = () => R.armButton(del, () => { apaga(p.id); R.audita('pedagios', `Excluiu a praça ${p.nome || ''}`); closeModal(); render(); toast('Praça excluída'); }, 'Confirmar exclusão');
}
function paramForm() {
  const c = cfg();
  openModal(`<div class="dh"><h2>Parâmetros dos pedágios</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="pdParam"><div class="db stack">
      <label class="field"><span class="lbl">Categoria do veículo usada nos cálculos</span><select name="cat">${CATS.map(k => `<option value="${k[0]}"${k[0] === c.cat ? ' selected' : ''}>${k[1]} · ${esc(k[2])}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Raio de detecção (metros)</span><input type="number" name="raio" min="40" max="600" step="10" value="${c.raio}"><span class="hint">Distância máxima entre o percurso e a praça para contar a passagem. Em rodovias de pista dupla, 150 m cobre os dois sentidos; aumente se alguma praça não for encontrada.</span></label>
      <p class="muted" style="margin:0;font-size:12.5px">Valem para o ambiente todo, no módulo Pedágios e na roteirização do Planner.</p>
    </div><div class="df"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit"${podeEditar() ? '' : ' disabled'}>Salvar</button></div></form>`, 'sm');
  $('#pdParam').onsubmit = ev => {
    ev.preventDefault(); const f = ev.target, raio = Math.max(40, Math.min(600, Math.round(+f.raio.value || 150)));
    PS.store.put(CFG_ID, { id: CFG_ID, tipo: 'cfg', cat: f.cat.value, raio }); PS.ver++; PS.cache.clear();
    R.audita('pedagios', `Parâmetros: ${catNome(f.cat.value)}, raio de ${raio} m`); closeModal(); render(); toast('Parâmetros salvos');
  };
}

/* ---------- OpenStreetMap: praças da área visível ---------- */
async function buscaOsm() {
  const m = PS.map; if (!m) { toast('Abra o mapa primeiro'); return; }
  const b = m.getBounds(), s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
  if (n - s > 4 || e - w > 4) { toast('Área grande demais: aproxime o mapa (até cerca de 400 km de lado)', 5000); return; }
  toast('Buscando praças no OpenStreetMap…', 20000);
  const q = `[out:json][timeout:40];nwr["barrier"="toll_booth"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});out center tags;`;
  let j = null, erro = '';
  // O servidor principal fica sobrecarregado às vezes: tenta o espelho antes de desistir
  for (const url of OVERPASS) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) throw new Error(r.status === 429 || r.status >= 500 ? 'servidor ocupado, tente de novo em 1 minuto' : 'HTTP ' + r.status);
      j = await r.json(); break;
    } catch (err) { erro = err.name === 'AbortError' ? 'o servidor demorou demais para responder' : err.message || String(err); }
  }
  if (!j) { toast('Não foi possível consultar o OpenStreetMap: ' + erro, 6500); return; }
  // Uma praça costuma ter um ponto por cabine ou por sentido: junta os pontos a menos de 300 m que cobram no mesmo rumo
  const pts = (j.elements || []).map(x => ({ lat: isNum(x.lat) ? x.lat : x.center && x.center.lat, lng: isNum(x.lon) ? x.lon : x.center && x.center.lon, t: x.tags || {}, id: x.type + '/' + x.id, dir: rumoOsm(x.tags && x.tags.direction), uni: !!(x.tags && x.tags.direction) })).filter(x => isNum(x.lat) && isNum(x.lng));
  const grupos = [];
  for (const x of pts) {
    const g = grupos.find(g0 => dist(g0, x) < 300 && (g0.dir === null) === (x.dir === null) && (x.dir === null || difAng(g0.dir, x.dir) <= 45));
    if (g) { g.n++; g.lat += (x.lat - g.lat) / g.n; g.lng += (x.lng - g.lng) / g.n; g.ids.push(x.id); if (!g.t.charge && x.t.charge) g.t = x.t; }
    else grupos.push({ lat: x.lat, lng: x.lng, n: 1, t: x.t, ids: [x.id], dir: x.dir, uni: x.uni });
  }
  const L0 = lista(); let novas = 0, ja = 0, comValor = 0;
  for (const g of grupos) {
    if (L0.some(p => (p.osm && g.ids.includes(p.osm)) || (dist(p, g) < 300 && (g.dir === null || !isNum(p.dir) || difAng(p.dir, g.dir) <= 45)))) { ja++; continue; }
    const t = g.t, tar = tarifasOsm(t.charge), id = uid('pd');
    const nome = String(t.name || t['name:pt'] || t.note || '').replace(/\s*[-–]\s*\d+\s*$/, '').trim() || 'Praça de pedágio';
    if (Object.keys(tar).length) comValor++;
    grava({ id, tipo: 'praca', nome, rodovia: String(t.ref || '').toUpperCase(), km: null, concessionaria: t.operator || '', cidade: '', uf: '', lat: +g.lat.toFixed(6), lng: +g.lng.toFixed(6), sentido: g.uni ? 'unico' : 'ambos', dir: g.dir, tarifas: tar, atualizado: /^\d{4}-\d{2}-\d{2}$/.test(t.check_date || '') ? t.check_date : '', obs: Object.keys(tar).length ? 'Tarifas do OpenStreetMap: confira na tabela da concessionária.' : '', fonte: 'OpenStreetMap', osm: g.ids[0], usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() });
    novas++;
  }
  if (novas) R.audita('pedagios', `Incluiu ${novas} praça(s) do OpenStreetMap`);
  toast(novas ? `${novas} praça(s) incluídas${ja ? ` · ${ja} já cadastrada(s)` : ''}. ${comValor === novas ? 'Os valores vieram do OpenStreetMap: confira em Praças.' : `${novas - comValor} sem valor: preencha em Praças.`}` : grupos.length ? `As ${grupos.length} praça(s) desta área já estão cadastradas` : 'Nenhuma praça de pedágio no OpenStreetMap nesta área', 6500);
  if (novas) render();
}
// No OpenStreetMap, "direction" em graus é para onde a cabine está virada (de frente para quem chega):
// o rumo de quem paga é o oposto. Ex.: "Pedágio Perus (sentido Sul)" tem direction=298, e quem paga vai a 118° (sudeste, para a capital).
// "forward"/"backward" dizem que a cobrança é num sentido só, mas sem o rumo: fica como sentido não informado.
function rumoOsm(v) { const g = parseFloat(v); return isFinite(g) && /^\s*-?\d/.test(String(v)) ? (((g + 180) % 360) + 360) % 360 : null; }
// "4.20BRL/motorcar;0.00BRL/motorcycle;4.20BRL/hgv/axle": utilitário de 2 eixos paga 2 × o valor por eixo
function tarifasOsm(ch) {
  const out = {}, re = /(\d+(?:[.,]\d+)?)\s*BRL\s*\/\s*(motorcar|car|motorcycle|hgv|goods)(\s*\/\s*axle)?/gi; let m;
  while ((m = re.exec(String(ch || '')))) {
    const v = numBR(m[1]), k = m[2].toLowerCase(); if (!isNum(v)) continue;
    if (k === 'motorcar' || k === 'car') out.carro = v; else if (k === 'motorcycle') out.moto = v; else out.util = Math.round(v * (m[3] ? 2 : 1) * 100) / 100;
  }
  if (!Object.keys(out).length) { const u = /(\d+(?:[.,]\d{2}))\s*BRL/i.exec(String(ch || '')); if (u) out.carro = numBR(u[1]); }
  return out;
}
function dist(a, b) { const kx = Math.cos(a.lat * Math.PI / 180) * 111320, dx = (a.lng - b.lng) * kx, dy = (a.lat - b.lat) * 110574; return Math.sqrt(dx * dx + dy * dy); }

/* ---------- Traçado pelas ruas (só para esta análise) ---------- */
async function tracar() {
  const U = PS.ultimo; if (!U || PS.job) return;
  const F = U.F, alvo = U.recs.filter(x => !x.path && x.r.pts.length).slice(0, 200); if (!alvo.length) return;
  PS.job = { feitos: 0, total: alvo.length, parar: false }; render();
  const memo = new Map(); let falhas = 0, erro = '';
  for (const x of alvo) {
    if (PS.job.parar) break;
    const r = x.r, nodes = r.base ? [r.base, ...r.pts, r.base] : r.pts;
    if (nodes.length >= 2) {
      try {
        let p = memo.get(r.sig);
        if (!p) { const g = await R.roadRoute(nodes.map(n => ({ lat: n.lat, lng: n.lng }))); p = g.poly ? R.decodePoly(g.poly) : null; if (p) memo.set(r.sig, p); }
        if (p) PS.poly.set(chaveDe(F, r), p);
      } catch (e) { falhas++; erro = (e && e.message) || 'erro'; if (falhas >= 3) break; }
    }
    PS.job.feitos++; const i = $('#pdJob'); if (i) i.textContent = `Traçando pelas ruas: ${PS.job.feitos}/${PS.job.total}`;
  }
  PS.job = null; toast(falhas >= 3 ? `Traçado interrompido: ${erro}` : 'Percursos traçados', 4500); render();
}

/* ---------- Planilhas ---------- */
async function importar(wz, cellOf) {
  await iniciar();
  if (!podeEditar()) { toast('Sem permissão de edição'); return null; }
  let novos = 0, atual = 0, ign = 0;
  const L0 = lista();
  for (const row of wz.rows) {
    const c = cellOf(row); let lat = numBR(c('lat')), lng = numBR(c('lng')); const nome = String(c('nome') ?? '').trim();
    if (!nome || !isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { ign++; continue; }
    const tarifas = {}; for (const k of CATS) { const v = numBR(c('t_' + k[0])); if (isNum(v) && v >= 0) tarifas[k[0]] = Math.round(v * 100) / 100; }
    const sent = norm(c('sentido')), km = numBR(c('km')), dir = parseRumo(c('dir'));
    const ex = wz.update !== false && L0.find(p => (norm(p.nome) === norm(nome) && dist(p, { lat, lng }) < 2000) || dist(p, { lat, lng }) < 60);
    const base = ex || { id: uid('pd'), tipo: 'praca', fonte: 'planilha' };
    grava({ ...base, nome, rodovia: String(c('rodovia') ?? '').trim().toUpperCase() || base.rodovia || '', km: isNum(km) ? km : base.km ?? null, concessionaria: String(c('conc') ?? '').trim() || base.concessionaria || '', cidade: String(c('cidade') ?? '').trim() || base.cidade || '', uf: String(c('uf') ?? '').trim().toUpperCase() || base.uf || '', lat, lng,
      sentido: dir !== null || /um|unico|unidirec|so/.test(sent) ? 'unico' : sent ? 'ambos' : base.sentido || 'ambos', dir: dir !== null ? dir : sent && !/um|unico|unidirec|so/.test(sent) ? null : base.dir ?? null, tarifas: { ...(base.tarifas || {}), ...tarifas }, atualizado: dataIso(c('atualizado')) || base.atualizado || '', obs: String(c('obs') ?? '').trim() || base.obs || '', usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() });
    if (ex) atual++; else novos++;
  }
  const lines = [['info', `${nf0.format(novos)} praça(s) incluídas e ${nf0.format(atual)} atualizada(s).`]];
  if (ign) lines.push(['', `${nf0.format(ign)} linha(s) ignoradas por falta de nome ou de latitude/longitude válidas.`]);
  if (st.pedSemTabela) lines.push(['bad', 'O banco ainda não tem a tabela de Pedágios: as praças valem só nesta sessão. Rode <b>supabase/migracao_07_pedagios.sql</b>.']);
  R.audita('pedagios', `Importou ${novos + atual} praça(s) de ${wz.arquivo || 'planilha'}`);
  PS.aba = 'pracas';
  return { lines, reg: { linhas: wz.rows.length, alteracoes: novos + atual, novos, atualizados: atual, ignorados: ign } };
}
function dataIso(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const t = String(v ?? '').trim(); let m;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t))) return `${+m[3] < 100 ? 2000 + +m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = /^\d{4}-\d{2}-\d{2}/.exec(t))) return m[0];
  return '';
}
function opcoesImport(wz) { return `<label class="chk"><input type="checkbox" id="pdUpd" ${wz.update !== false ? 'checked' : ''}> Atualizar as praças que já existem (mesmo nome perto do mesmo local)</label>`; }
function ligaOpcoesImport(wz) { const u = $('#pdUpd'); if (u) u.onchange = () => { wz.update = u.checked; }; }
function linhasPracas() {
  return lista().map(p => ({ Praca: p.nome, Rodovia: p.rodovia || '', KM: isNum(p.km) ? p.km : '', Concessionaria: p.concessionaria || '', Cidade: p.cidade || '', UF: p.uf || '', Latitude: p.lat, Longitude: p.lng, Cobranca: p.sentido === 'unico' ? 'Um sentido' : 'Os dois sentidos', 'Sentido cobrado': p.sentido === 'unico' && isNum(p.dir) ? rumoNome(p.dir) + ' (' + Math.round(p.dir) + '°)' : '', ...Object.fromEntries(CATS.map(c => ['Tarifa ' + c[1], tarifa(p, c[0]) ?? ''])), 'Valores desde': p.atualizado || '', Origem: p.fonte || 'manual', Observacao: p.obs || '' }));
}
function exportaRel() {
  const U = PS.ultimo; if (!U || !window.XLSX) return;
  const { F, recs, ag } = U, fm = F.fm, c = cfg();
  const vend = [...ag.porVend.values()].map(v => ({ Vendedor: v.nome, Codigo: String(v.v).startsWith('s:') ? '' : v.v, Rotas: v.rotas, 'Com pedagio': v.comPed, 'Sem tracado': v.semPath, 'Passagens/mes': Math.round(v.cobr * fm), 'R$/mes': +(v.valor * fm).toFixed(2) }));
  const pr = [...ag.porPraca.values()].map(q => ({ Praca: q.p.nome, Rodovia: local(q.p), Concessionaria: q.p.concessionaria || '', ['Tarifa ' + catNome(c.cat)]: tarifa(q.p) ?? '', Rotas: q.rotas, Vendedores: q.vend.size, 'Passagens/mes': Math.round(q.cobr * fm), 'R$/mes': +(q.valor * fm).toFixed(2) }));
  const rotas = recs.map(x => ({ Vendedor: x.r.nome, Semana: x.r.w, Dia: DIA_L[x.r.d], KM: +(x.r.km || 0).toFixed(1), 'Tracado pelas ruas': x.path ? 'sim' : 'não', Pedagios: x.res ? x.res.itens.map(i => i.p.nome + (i.cobr > 1 ? ` (${i.cobr}x)` : '')).join('; ') : '', Passagens: x.res ? x.res.cobr : '', 'R$/dia': x.res ? +x.res.valor.toFixed(2) : '', 'R$/mes': x.res ? +(x.res.valor * fm).toFixed(2) : '' }));
  saveFile(`pedagios_${slug(F.nome)}_${dstamp()}.xlsx`, xlsxBlob([['Vendedores', vend], ['Pracas', pr], ['Rotas', rotas], ['Cadastro', linhasPracas()]]));
  R.audita('exportacao', 'Pedágios ' + F.nome);
}

/* ---------- Eventos ---------- */
function liga(el) {
  if (PS.ligado) return; PS.ligado = true;
  const ativo = () => st.screen === 'home' && st.homeSec === 'ped';
  el.addEventListener('click', e => {
    if (!ativo()) return;
    const t = e.target.closest('[data-pa],[data-paba],[data-pfiltro],[data-pfoco],[data-prota]'); if (!t) return;
    const ds = t.dataset;
    if (ds.paba) { PS.aba = ds.paba; if (ds.paba !== 'mapa') PS.marcando = false; render(); return; }
    if (ds.pfiltro) { PS.filtro = ds.pfiltro; PS.vista = null; render(); return; }
    if (ds.pfoco) { const outra = PS.aba !== 'mapa'; PS.foco = ds.pfoco; PS.aba = 'mapa'; render().then(() => { if (outra) { const m = $('#pdMap'); if (m) m.scrollIntoView({ block: 'center' }); } }); return; }
    if (ds.prota) { const outra = PS.aba !== 'mapa'; PS.rota = ds.prota; PS.vista = null; PS.aba = 'mapa'; render().then(() => { if (outra) { const m = $('#pdMap'); if (m) m.scrollIntoView({ block: 'center' }); } }); return; }
    const a = ds.pa;
    if (a === 'nova') pracaForm();
    else if (a === 'edita') pracaForm(pracaDe(ds.id));
    else if (a === 'param') paramForm();
    else if (a === 'modelo') R.downloadModelo('pedagios');
    else if (a === 'importa') R.openImport('pedagios');
    else if (a === 'marcar') { PS.marcando = !PS.marcando; const m = $('#pdMap'); if (m) m.classList.toggle('marcando', PS.marcando); t.classList.toggle('primary', PS.marcando); t.setAttribute('aria-pressed', String(PS.marcando)); t.textContent = PS.marcando ? 'Clique no mapa para marcar a praça' : 'Marcar praça no mapa'; }
    else if (a === 'osm') buscaOsm();
    else if (a === 'tracar') tracar();
    else if (a === 'jobstop' && PS.job) PS.job.parar = true;
    else if (a === 'rotafecha') { PS.rota = ''; PS.vista = null; render(); }
    else if (a === 'xls') exportaRel();
    else if (a === 'xlspracas' && window.XLSX) { saveFile(`pracas_pedagio_${dstamp()}.xlsx`, xlsxBlob([['Pracas', linhasPracas()]])); R.audita('exportacao', 'Praças de pedágio'); }
  });
  el.addEventListener('change', e => {
    if (!ativo()) return; const t = e.target;
    if (t.matches('[data-pfonte]')) { PS.fonte = t.value; PS.vend = ''; PS.dia = 0; PS.rota = ''; PS.vista = null; render(); }
    else if (t.matches('[data-pvend]')) { PS.vend = t.value; PS.rota = ''; PS.vista = null; render(); }
    else if (t.matches('[data-pdia]')) { PS.dia = +t.value; PS.rota = ''; PS.vista = null; render(); }
  });
  let tq;
  el.addEventListener('input', e => { if (!ativo() || !e.target.matches('[data-pq]')) return; PS.q = e.target.value; clearTimeout(tq); tq = setTimeout(() => { const pos = e.target.selectionStart; render().then(() => { const n = $('[data-pq]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* ignora */ } } }); }, 250); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && PS.marcando && ativo()) { PS.marcando = false; render(); } });
}

/* ---------- Planner: pedágios da rota aberta, nas linhas da lista e no mapa ---------- */
function blocoRota(chave, path, m, fm) {
  if (!PS.store) return '';
  const res = path ? analisa(chave, path) : null;
  return `<div class="stack pd-rota"><span class="lbl">Pedágios</span>${blocoRes(res, fm, !path, !!(m && m.toll))}</div>`;
}
function chip(chave, path) {
  if (!PS.store || !path || !lista().length) return '';
  const res = analisa(chave, path); if (!res) return '';
  return res.itens.length ? `<span class="pd-chip" title="${esc(res.itens.map(i => i.p.nome + (i.tarifa === null ? ' (sem valor)' : '')).join(' · '))}">${ICON_PED}${res.itens.length} · ${brl(res.valor)}${res.semValor ? ' + ?' : ''}</span>` : '<span class="pd-chip ok" title="Sem pedágio no percurso">sem pedágio</span>';
}
// Desenha no mapa do Planner as praças das rotas visíveis (destacadas) e, se todas = true, as demais (apagadas)
function desenha(layer, rotas, todas) {
  if (!PS.store || !lista().length) return;
  const na = new Map();
  for (const x of rotas) { if (!x.path) continue; const res = analisa(x.chave, x.path); if (res) for (const it of res.itens) { const q = na.get(it.p.id) || { cobr: 0, rotas: 0 }; q.cobr += it.cobr; q.rotas++; na.set(it.p.id, q); } }
  for (const p of lista()) {
    const q = na.get(p.id); if (!q && !todas) continue;
    L.marker([p.lat, p.lng], { icon: iconePraca(p, !!q), keyboard: false, zIndexOffset: q ? 400 : -100, opacity: q ? 1 : 0.6 })
      .bindTooltip(tipPraca(p, q), { direction: 'top', offset: [0, -12] }).addTo(layer);
  }
}
function resumoHub() {
  if (!PS.store) return null;
  const L0 = lista(), com = L0.filter(p => tarifa(p) !== null);
  return { n: L0.length, semValor: L0.length - com.length, media: com.length ? brl(com.reduce((s, p) => s + tarifa(p), 0) / com.length) : '—', cat: catNome(cfg().cat) };
}

window.PedMod = { iniciar, render, limpar: limpaMapa, resumoHub, opcoesImport, ligaOpcoesImport, importar, analisa, blocoRota, chip, desenha, icone: ICON_PED, lista };
})();
