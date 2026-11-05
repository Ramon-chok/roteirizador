/* Módulo Calendário: calendário anual e mensal com dias úteis, feriados nacionais (fixos e móveis), pontos facultativos
   e eventos que o administrador inclui (reembolso, reunião, pagamento de verba ou outra categoria que ele criar).
   Ao lado de cada semana, a semana do ciclo de roteiro (S1 a S4) e a quinzena (1,3 ou 2,4), contadas a partir de uma
   semana de referência (padrão: a semana de 16/11/2026 é a S1). A Verba Indenizatória usa esta mesma contagem.
   Usa as funções internas expostas pelo app.js em window.RRM. */
(function () {
'use strict';
const R = window.RRM; if (!R) return;
const { st, $, $$, esc, toast, openModal, closeModal, ICON, nf0, uid, DIA_C, DIA_L, COR_SEM } = R;

const MES_L = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const CFG_ID = '__cfg', CATS_ID = '__cats';
const CATS_PADRAO = [
  { id: 'reembolso', nome: 'Reembolso', cor: '#2F6FB3' },
  { id: 'reuniao', nome: 'Reunião', cor: '#8A4FB0' },
  { id: 'pagamento', nome: 'Pagamento de verba', cor: '#3E8E5C' },
  { id: 'feriadolocal', nome: 'Feriado local', cor: '#C23C6E', semRota: true },
  { id: 'outro', nome: 'Outro', cor: '#B0892F' }
];
const CS = { store: null, carregando: null, ano: new Date().getFullYear(), mes: new Date().getMonth(), vista: 'ano', ocultas: new Set(), ligado: false };

/* ---------- Datas (sempre em UTC, como texto AAAA-MM-DD) ---------- */
const pad2 = n => String(n).padStart(2, '0');
const isoDe = d => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const dataDe = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const somaDias = (iso, n) => { const d = dataDe(iso); d.setUTCDate(d.getUTCDate() + n); return isoDe(d); };
const dowDe = iso => ((dataDe(iso).getUTCDay() + 6) % 7) + 1; // 1 = segunda … 7 = domingo
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtData = iso => { const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${y}`; };
const fmtLonga = iso => `${DIA_L[dowDe(iso)].toLowerCase()}, ${+iso.slice(8)} de ${MES_L[+iso.slice(5, 7) - 1].toLowerCase()} de ${iso.slice(0, 4)}`;

/* ---------- Feriados nacionais ---------- */
function pascoa(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad2(mes)}-${pad2(dia)}`;
}
const memoFer = new Map();
// tipo: nacional (sem rota), facultativo (sem rota se a configuração mandar) e informativo (só aparece)
function feriadosAno(y) {
  if (memoFer.has(y)) return memoFer.get(y);
  const p = pascoa(y), m = new Map();
  const add = (iso, nome, tipo = 'nacional') => m.set(iso, { nome, tipo });
  add(`${y}-01-01`, 'Confraternização Universal');
  add(somaDias(p, -48), 'Carnaval', 'facultativo'); add(somaDias(p, -47), 'Carnaval', 'facultativo');
  add(somaDias(p, -46), 'Quarta-feira de Cinzas (até 14h)', 'informativo');
  add(somaDias(p, -2), 'Sexta-feira Santa');
  add(`${y}-04-21`, 'Tiradentes'); add(`${y}-05-01`, 'Dia do Trabalho');
  add(somaDias(p, 60), 'Corpus Christi', 'facultativo');
  add(`${y}-09-07`, 'Independência do Brasil'); add(`${y}-10-12`, 'Nossa Senhora Aparecida');
  add(`${y}-11-02`, 'Finados'); add(`${y}-11-15`, 'Proclamação da República');
  if (y >= 2024) add(`${y}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra');
  add(`${y}-12-24`, 'Véspera de Natal (após 14h)', 'informativo'); add(`${y}-12-25`, 'Natal'); add(`${y}-12-31`, 'Véspera de Ano-Novo (após 14h)', 'informativo');
  memoFer.set(y, m); return m;
}

/* ---------- Dados: configuração, categorias e eventos ---------- */
async function iniciar() {
  if (CS.store) return;
  if (!CS.carregando) CS.carregando = (async () => { const s = new R.BucketStore('calendario'); try { await s.load(); } catch (e) { /* segue vazio */ } CS.store = s; })();
  await CS.carregando;
}
const cfg = () => ({ ancora: '2026-11-16', facultSemRota: true, ...((CS.store && CS.store.get(CFG_ID)) || {}) });
const cats = () => { const c = CS.store && CS.store.get(CATS_ID); return c && Array.isArray(c.lista) && c.lista.length ? c.lista : CATS_PADRAO; };
const catDe = id => cats().find(c => c.id === id) || { id, nome: 'Outro', cor: '#7d8a84' };
const eventos = () => (CS.store ? [...CS.store.values()].filter(e => e && e.tipo === 'evento') : []);
const admin = () => !!(st.usuario && st.usuario.papel === 'admin' && !st.ro);
// Índice data → eventos, expandindo os de vários dias
function indiceEventos() {
  const idx = new Map();
  for (const e of eventos()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data || '')) continue;
    const fim = e.ate && e.ate >= e.data ? e.ate : e.data;
    for (let d = e.data, n = 0; d <= fim && n < 370; d = somaDias(d, 1), n++) { if (!idx.has(d)) idx.set(d, []); idx.get(d).push(e); }
  }
  return idx;
}

/* ---------- Semana do ciclo ----------
   Semanas de segunda a domingo. A semana que contém a data de referência é a S1; daí em diante S2, S3, S4, S1…
   (e para trás também). Com ciclo de W semanas, a conta é a mesma com W no lugar de 4. */
function semana(iso, W = 4) {
  const seg = somaDias(iso, 1 - dowDe(iso)), a = cfg().ancora, ref = somaDias(a, 1 - dowDe(a));
  const n = Math.round((dataDe(seg) - dataDe(ref)) / 6048e5);
  return ((n % W) + W) % W + 1;
}
const quinzena = s4 => (s4 % 2 ? '1,3' : '2,4');

/* Informação de um dia: feriado, eventos, se tem rota e se é dia útil */
function diaInfo(iso, idx = indiceEventos()) {
  const dow = dowDe(iso), fer = feriadosAno(+iso.slice(0, 4)).get(iso) || null, evs = idx.get(iso) || [], c = cfg();
  const semRotaEv = evs.find(e => catDe(e.cat).semRota);
  const semRota = !!(fer && (fer.tipo === 'nacional' || (fer.tipo === 'facultativo' && c.facultSemRota))) || !!semRotaEv;
  const motivo = fer && fer.tipo !== 'informativo' && semRota ? fer.nome : semRotaEv ? semRotaEv.titulo || catDe(semRotaEv.cat).nome : '';
  return { iso, dow, s4: semana(iso, 4), fer, evs, semRota, motivo, util: dow <= 5 && !semRota, fds: dow >= 6 };
}
function diasDoMes(ym) {
  const [y, m] = ym.split('-').map(Number), idx = indiceEventos(), out = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) out.push(diaInfo(`${y}-${pad2(m)}-${pad2(d)}`, idx));
  return out;
}
function resumoMes(ym) {
  const ds = diasDoMes(ym);
  return { uteis: ds.filter(d => d.util).length, sabados: ds.filter(d => d.dow === 6 && !d.semRota).length, semRota: ds.filter(d => d.semRota && !d.fds).length, feriados: ds.filter(d => d.fer && d.fer.tipo !== 'informativo'), eventos: ds.flatMap(d => d.evs.map(e => ({ ...e, dia: d.iso }))) };
}

/* ---------- Desenho de um mês: tabela com S1–S4 à esquerda e 1,3/2,4 à direita ----------
   marca(dia) pode devolver { cls, tip, txt } para destacar dias (a Verba usa isso no extrato). */
function mesHtml(y, m, opts = {}) {
  const ym = `${y}-${pad2(m + 1)}`, ds = diasDoMes(ym), hoje = hojeIso(), semHoje = somaDias(hoje, 1 - dowDe(hoje)), grande = !!opts.grande;
  const primeiro = ds[0], cel = [];
  for (let i = 1; i < primeiro.dow; i++) cel.push(null);
  ds.forEach(d => cel.push(d)); while (cel.length % 7) cel.push(null);
  const linhas = [];
  for (let i = 0; i < cel.length; i += 7) {
    const sem = cel.slice(i, i + 7), ref = sem.find(Boolean), seg = somaDias(ref.iso, 1 - ref.dow), s4 = semana(ref.iso, 4);
    const tds = sem.map(d => {
      if (!d) return '<td class="cd vazio"></td>';
      const vis = d.evs.filter(e => !CS.ocultas.has(e.cat)), ferVis = d.fer && !CS.ocultas.has('__fer' + d.fer.tipo);
      const mk = opts.marca ? opts.marca(d) : null;
      const cls = ['cd', d.fds ? 'fds' : '', d.semRota && !d.fds ? 'semrota' : '', ferVis && d.fer.tipo !== 'informativo' ? 'fer' : '', d.iso === hoje ? 'hoje' : '', mk && mk.cls ? mk.cls : ''].filter(Boolean).join(' ');
      const tip = [fmtLonga(d.iso), `Semana S${d.s4} · quinzena ${quinzena(d.s4)}`, ferVis ? `${d.fer.nome}${d.fer.tipo === 'facultativo' ? ' (ponto facultativo)' : d.fer.tipo === 'informativo' ? '' : ' (feriado)'}` : '', ...vis.map(e => `${catDe(e.cat).nome}: ${e.titulo || ''}`), d.semRota && !d.fds ? 'Sem rota neste dia' : d.util ? 'Dia útil' : '', mk && mk.tip ? mk.tip : ''].filter(Boolean).join('\n');
      const pontos = vis.slice(0, 4).map(e => `<i style="background:${esc(catDe(e.cat).cor)}"></i>`).join('');
      const txt = grande ? `${ferVis ? `<span class="ev fer">${esc(d.fer.nome)}</span>` : ''}${vis.slice(0, 3).map(e => `<span class="ev" style="--c:${esc(catDe(e.cat).cor)}">${esc(e.titulo || catDe(e.cat).nome)}</span>`).join('')}${vis.length > 3 ? `<span class="muted">+${vis.length - 3}</span>` : ''}${mk && mk.txt ? mk.txt : ''}` : '';
      return `<td class="${cls}" data-cdia="${d.iso}" data-tip="${esc(tip)}" tabindex="0"><span class="dn">${+d.iso.slice(8)}</span>${grande ? txt : pontos ? `<span class="dots">${pontos}</span>` : ''}</td>`;
    }).join('');
    linhas.push(`<tr class="${seg === semHoje ? 'atual' : ''}"><td class="cw"><span class="wk" style="--c:${COR_SEM[s4]}">S${s4}</span></td>${tds}<td class="cw"><span class="qz q${s4 % 2 ? 13 : 24}">${quinzena(s4)}</span></td></tr>`);
  }
  const r = resumoMes(ym);
  return `<div class="cal-mes${grande ? ' grande' : ''}"><div class="cal-mh"><b>${MES_L[m]}${opts.comAno ? ' ' + y : ''}</b><span class="muted">${r.uteis} dias úteis${r.sabados ? ` · ${r.sabados} sáb.` : ''}${r.feriados.length ? ` · ${r.feriados.length} feriado${r.feriados.length > 1 ? 's' : ''}` : ''}</span></div>
    <table class="cal"><thead><tr><th class="cw" title="Semana do ciclo de 4 semanas">Sem.</th>${[1, 2, 3, 4, 5, 6, 7].map(d => `<th class="${d >= 6 ? 'fds' : ''}">${grande ? DIA_C[d] : DIA_C[d][0]}</th>`).join('')}<th class="cw" title="Quinzena: semanas 1 e 3 ou 2 e 4">Quinz.</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div>`;
}

/* ---------- Página ---------- */
function legendaHtml() {
  const chipC = (id, cor, nome, extra = '') => `<button type="button" class="cal-leg${CS.ocultas.has(id) ? ' off' : ''}" data-cleg="${esc(id)}" aria-pressed="${!CS.ocultas.has(id)}"><i style="background:${esc(cor)}"></i>${esc(nome)}${extra}</button>`;
  return `<div class="cal-legs">${chipC('__fernacional', 'var(--feriado)', 'Feriado nacional')}${chipC('__ferfacultativo', 'color-mix(in srgb, var(--feriado) 45%, var(--surface))', 'Ponto facultativo')}${cats().map(c => chipC(c.id, c.cor, c.nome, c.semRota ? ' <span class="muted">· sem rota</span>' : '')).join('')}
    <span class="cal-leg fixa"><i class="hojei"></i>Hoje</span><span class="cal-leg fixa"><i class="fdsi"></i>Fim de semana</span></div>`;
}
function listaEventosHtml(ano) {
  const evs = eventos().filter(e => (e.data || '').startsWith(String(ano)) || (e.ate || '').startsWith(String(ano))).sort((a, b) => a.data.localeCompare(b.data));
  const fer = [...feriadosAno(ano)].filter(([, f]) => f.tipo !== 'informativo').sort((a, b) => a[0].localeCompare(b[0]));
  const hoje = hojeIso();
  return `<div class="cgrid">
    <div class="card"><div class="ch"><h2>Eventos de ${ano}</h2>${admin() ? '<button class="btn sm primary" type="button" data-ca="novo">Novo evento</button>' : ''}</div><div class="cb">${evs.length ? `<ul class="cal-lista">${evs.map(e => { const c = catDe(e.cat); return `<li class="${(e.ate || e.data) < hoje ? 'passou' : ''}"><span class="cl-d num">${fmtData(e.data).slice(0, 5)}${e.ate && e.ate !== e.data ? '–' + fmtData(e.ate).slice(0, 5) : ''}</span><span class="cl-c" style="--c:${esc(c.cor)}">${esc(c.nome)}</span><span class="cl-t"><b>${esc(e.titulo || c.nome)}</b>${e.desc ? `<span class="muted"> · ${esc(e.desc)}</span>` : ''}</span>${admin() ? `<span class="cl-a"><button class="btn sm" type="button" data-ca="edita" data-id="${esc(e.id)}">Editar</button></span>` : ''}</li>`; }).join('')}</ul>` : `<p class="muted" style="margin:0">Nenhum evento em ${ano}.${admin() ? ' Clique em um dia do calendário ou em “Novo evento”.' : ''}</p>`}</div></div>
    <div class="card"><div class="ch"><h2>Feriados nacionais de ${ano}</h2><span class="muted" style="font-size:12px">${cfg().facultSemRota ? 'pontos facultativos sem rota' : 'pontos facultativos com rota'}</span></div><div class="cb"><ul class="cal-lista">${fer.map(([iso, f]) => `<li class="${iso < hoje ? 'passou' : ''}"><span class="cl-d num">${fmtData(iso).slice(0, 5)}</span><span class="cl-c" style="--c:var(--feriado)">${f.tipo === 'facultativo' ? 'Facultativo' : 'Feriado'}</span><span class="cl-t">${esc(f.nome)} <span class="muted">· ${DIA_L[dowDe(iso)].toLowerCase()}</span></span></li>`).join('')}</ul></div></div></div>`;
}
let renderSeq = 0;
async function render(el = $('#homeView')) {
  if (!el || st.screen !== 'home' || st.homeSec !== 'cal') return;
  const seq = ++renderSeq; liga(el);
  if (!CS.store) { el.innerHTML = `<div class="page home">${R.migalha('Calendário')}<p class="muted">Carregando…</p></div>`; await iniciar(); if (seq !== renderSeq) return; }
  const keep = el.scrollTop, hoje = hojeIso(), di = diaInfo(hoje), prox = proximos(3), c = cfg();
  const ano = CS.ano, rAno = Array.from({ length: 12 }, (_, m) => resumoMes(`${ano}-${pad2(m + 1)}`));
  const uteisAno = rAno.reduce((s, r) => s + r.uteis, 0);
  const corpo = CS.vista === 'ano'
    ? `<div class="cal-ano">${Array.from({ length: 12 }, (_, m) => mesHtml(ano, m)).join('')}</div>`
    : `<div class="cal-unico">${mesHtml(ano, CS.mes, { grande: true, comAno: true })}</div>`;
  el.innerHTML = `<div class="page home cal-pg">${R.migalha('Calendário')}
    <div class="ph"><div><h1>Calendário</h1><p>Dias úteis, feriados, eventos da empresa e as semanas do ciclo de roteiro (S1 a S4 e quinzenas 1,3 e 2,4).</p></div>
      <div class="row">${admin() ? '<button class="btn" type="button" data-ca="cats">Categorias</button><button class="btn" type="button" data-ca="ciclo">Ciclo e feriados</button><button class="btn primary" type="button" data-ca="novo">Novo evento</button>' : ''}</div></div>
    <div class="cal-hoje card"><div class="cb row">
      <span><b>Hoje</b> · ${esc(fmtLonga(hoje))}</span><span class="wk gr" style="--c:${COR_SEM[di.s4]}">Semana S${di.s4}</span><span class="qz gr q${di.s4 % 2 ? 13 : 24}">Quinzena ${quinzena(di.s4)}</span>
      ${di.motivo ? `<span class="pill bad">${esc(di.motivo)}</span>` : di.util ? '<span class="pill ok">dia útil</span>' : '<span class="pill idle">fim de semana</span>'}
      <span class="sp"></span>${prox.length ? `<span class="muted" style="font-size:12.5px">Próximo: <b>${esc(prox[0].titulo)}</b> em ${fmtData(prox[0].dia)}</span>` : ''}</div></div>
    <div class="cal-bar">
      <div class="row"><button class="btn sm" type="button" data-ca="ant" aria-label="Anterior">‹</button><b class="cal-tit num">${CS.vista === 'ano' ? ano : `${MES_L[CS.mes]} ${ano}`}</b><button class="btn sm" type="button" data-ca="prox" aria-label="Próximo">›</button><button class="btn sm" type="button" data-ca="hoje">Hoje</button></div>
      <div class="seg">${[['ano', 'Ano'], ['mes', 'Mês']].map(([v, t]) => `<button type="button" data-cvista="${v}" aria-pressed="${CS.vista === v}">${t}</button>`).join('')}</div>
      <span class="muted" style="font-size:12.5px">${ano}: ${uteisAno} dias úteis · referência do ciclo: semana de ${fmtData(c.ancora)} = S1</span>
    </div>
    ${legendaHtml()}
    ${corpo}
    ${listaEventosHtml(ano)}
  </div>`;
  el.scrollTop = keep;
}
function proximos(n = 5) {
  const hoje = hojeIso(), out = [];
  for (const e of eventos()) if ((e.ate || e.data) >= hoje) out.push({ ...e, dia: e.data < hoje ? hoje : e.data, titulo: e.titulo || catDe(e.cat).nome });
  const y = +hoje.slice(0, 4);
  for (const yy of [y, y + 1]) for (const [iso, f] of feriadosAno(yy)) if (iso >= hoje && f.tipo !== 'informativo') out.push({ dia: iso, titulo: f.nome, cat: '__fer' });
  return out.sort((a, b) => a.dia.localeCompare(b.dia)).slice(0, n);
}

/* ---------- Formulários ---------- */
function diaForm(iso) {
  const d = diaInfo(iso), adm = admin();
  openModal(`<div class="dh"><div><h2>${esc(fmtLonga(iso))}</h2><div class="muted" style="font-size:12.5px">Semana S${d.s4} · quinzena ${quinzena(d.s4)} · ${d.semRota && !d.fds ? 'sem rota' : d.util ? 'dia útil' : 'fim de semana'}</div></div><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <div class="db">${d.fer ? `<div class="banner ${d.fer.tipo === 'nacional' ? 'bad' : ''}">${esc(d.fer.nome)}${d.fer.tipo === 'facultativo' ? ' · ponto facultativo' : d.fer.tipo === 'informativo' ? '' : ' · feriado nacional'}</div>` : ''}
      ${d.evs.length ? `<ul class="cal-lista">${d.evs.map(e => { const c = catDe(e.cat); return `<li><span class="cl-c" style="--c:${esc(c.cor)}">${esc(c.nome)}</span><span class="cl-t"><b>${esc(e.titulo || c.nome)}</b>${e.desc ? `<br><span class="muted">${esc(e.desc)}</span>` : ''}${e.ate && e.ate !== e.data ? `<br><span class="muted">${fmtData(e.data)} a ${fmtData(e.ate)}</span>` : ''}</span>${adm ? `<span class="cl-a"><button class="btn sm" type="button" data-ca="edita" data-id="${esc(e.id)}">Editar</button></span>` : ''}</li>`; }).join('')}</ul>` : `<p class="muted" style="margin:0">Nenhum evento neste dia.</p>`}</div>
    <div class="df">${adm ? `<button class="btn primary" type="button" data-ca="novo" data-dia="${iso}">Incluir evento neste dia</button>` : ''}<button class="btn" type="button" data-close>Fechar</button></div>`, 'sm');
}
function eventoForm(ev = {}, dia) {
  if (!admin()) return;
  const e = { data: dia || hojeIso(), cat: cats()[0].id, ...ev }, novo = !ev.id;
  openModal(`<div class="dh"><h2>${novo ? 'Novo evento' : 'Editar evento'}</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="calEv"><div class="db"><div class="fgrid">
      <label class="field"><span class="lbl">Categoria</span><select name="cat">${cats().map(c => `<option value="${esc(c.id)}"${c.id === e.cat ? ' selected' : ''}>${esc(c.nome)}${c.semRota ? ' (sem rota)' : ''}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">Título</span><input type="text" name="titulo" maxlength="80" value="${esc(e.titulo || '')}" placeholder="Ex.: Pagamento da verba de novembro" required></label>
      <label class="field"><span class="lbl">Data</span><input type="date" name="data" value="${esc(e.data)}" required></label>
      <label class="field"><span class="lbl">Até (opcional)</span><input type="date" name="ate" value="${esc(e.ate || '')}"><span class="hint">Para eventos de mais de um dia</span></label></div>
      <label class="field"><span class="lbl">Descrição (opcional)</span><textarea name="desc" maxlength="300">${esc(e.desc || '')}</textarea></label>
      <p class="muted" style="margin:0;font-size:12.5px">Categorias marcadas como “sem rota” (ex.: feriado local) tiram o dia do cálculo da Verba Indenizatória.</p></div>
    <div class="df">${novo ? '' : '<button class="btn danger" type="button" id="calDel">Excluir</button>'}<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, 'sm');
  $('#calEv').onsubmit = ev2 => {
    ev2.preventDefault(); const f = new FormData(ev2.target);
    const data = String(f.get('data')), ate = String(f.get('ate') || '');
    if (ate && ate < data) { toast('A data final é antes da inicial'); return; }
    const id = e.id || uid('ev');
    CS.store.put(id, { id, tipo: 'evento', cat: String(f.get('cat')), titulo: String(f.get('titulo')).trim(), data, ate: ate && ate !== data ? ate : '', desc: String(f.get('desc') || '').trim(), usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() });
    R.audita('calendario', `${novo ? 'Incluiu' : 'Alterou'} ${catDe(f.get('cat')).nome}: ${f.get('titulo')} (${fmtData(data)})`);
    closeModal(); CS.ano = +data.slice(0, 4); render(); toast('Evento salvo');
  };
  const del = $('#calDel'); if (del) del.onclick = () => R.armButton(del, () => { CS.store.del(e.id); R.audita('calendario', `Excluiu ${e.titulo || ''} (${fmtData(e.data)})`); closeModal(); render(); toast('Evento excluído'); }, 'Confirmar exclusão');
}
function catsForm() {
  if (!admin()) return;
  let lista = cats().map(c => ({ ...c }));
  const linha = (c, i) => `<div class="cat-row"><input type="color" data-ci="${i}" data-ck="cor" value="${esc(c.cor)}" aria-label="Cor"><input type="text" data-ci="${i}" data-ck="nome" value="${esc(c.nome)}" maxlength="40" aria-label="Nome"><label class="chk"><input type="checkbox" data-ci="${i}" data-ck="semRota"${c.semRota ? ' checked' : ''}> sem rota</label><button class="btn sm ghost" type="button" data-crm="${i}" aria-label="Remover">${ICON.close}</button></div>`;
  const desenha = () => {
    openModal(`<div class="dh"><h2>Categorias de evento</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
      <div class="db"><p class="muted" style="margin:0;font-size:12.5px">Cada categoria tem uma cor no calendário. “Sem rota” tira o dia do cálculo de dias úteis e da verba (use para feriados municipais e estaduais).</p>
        <div class="stack" id="catLista">${lista.map(linha).join('')}</div><div class="row"><button class="btn sm" type="button" id="catAdd">Incluir categoria</button></div></div>
      <div class="df"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="catOk">Salvar</button></div>`, 'sm');
    $('#catLista').oninput = $('#catLista').onchange = ev => { const t = ev.target, i = +t.dataset.ci; if (!lista[i]) return; lista[i][t.dataset.ck] = t.type === 'checkbox' ? t.checked : t.value; };
    $('#catLista').onclick = ev => { const b = ev.target.closest('[data-crm]'); if (!b) return; const i = +b.dataset.crm; if (eventos().some(e => e.cat === lista[i].id)) { toast('Há eventos nesta categoria: mude a categoria deles antes'); return; } lista.splice(i, 1); desenha(); };
    $('#catAdd').onclick = () => { lista.push({ id: uid('c'), nome: 'Nova categoria', cor: R.E.PALETA[lista.length % R.E.PALETA.length] }); desenha(); };
    $('#catOk').onclick = () => { lista = lista.filter(c => String(c.nome).trim()); if (!lista.length) { toast('Mantenha ao menos uma categoria'); return; } CS.store.put(CATS_ID, { id: CATS_ID, tipo: 'cats', lista }); R.audita('calendario', 'Alterou as categorias'); closeModal(); render(); };
  };
  desenha();
}
function cicloForm() {
  if (!admin()) return;
  const c = cfg();
  openModal(`<div class="dh"><h2>Ciclo e feriados</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="calCiclo"><div class="db">
      <label class="field"><span class="lbl">Semana de referência (S1)</span><input type="date" name="ancora" value="${esc(c.ancora)}" required><span class="hint">A semana (segunda a domingo) desta data é a S1; as seguintes são S2, S3, S4 e o ciclo recomeça.</span></label>
      <div class="muted" id="calPrev" style="font-size:12.5px"></div>
      <label class="chk"><input type="checkbox" name="facult"${c.facultSemRota ? ' checked' : ''}> Pontos facultativos (Carnaval e Corpus Christi) são dias sem rota</label>
      <p class="muted" style="margin:0;font-size:12.5px">Feriados estaduais e municipais: inclua como evento da categoria “Feriado local” (ou outra marcada como sem rota).</p></div>
    <div class="df"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, 'sm');
  const f = $('#calCiclo'), prev = () => { const a = f.ancora.value; if (!a) return; const n = Math.round((dataDe(somaDias(hojeIso(), 1 - dowDe(hojeIso()))) - dataDe(somaDias(a, 1 - dowDe(a)))) / 6048e5), s = ((n % 4) + 4) % 4 + 1; $('#calPrev').textContent = `Com esta referência, a semana de hoje é a S${s} (quinzena ${quinzena(s)}).`; };
  f.ancora.oninput = prev; prev();
  f.onsubmit = ev => { ev.preventDefault(); CS.store.put(CFG_ID, { id: CFG_ID, tipo: 'cfg', ancora: f.ancora.value, facultSemRota: f.facult.checked }); R.audita('calendario', `Ciclo: S1 na semana de ${fmtData(f.ancora.value)}`); closeModal(); render(); toast('Ciclo salvo'); };
}

/* ---------- Eventos da página ---------- */
function liga(el) {
  if (CS.ligado) return; CS.ligado = true;
  const ativo = () => st.screen === 'home' && st.homeSec === 'cal';
  el.addEventListener('click', e => {
    if (!ativo()) return;
    const t = e.target.closest('[data-ca],[data-cvista],[data-cleg],[data-cdia]'); if (!t) return;
    const ds = t.dataset;
    if (ds.cdia) { diaForm(ds.cdia); return; }
    if (ds.cvista) { CS.vista = ds.cvista; render(); return; }
    if (ds.cleg) { CS.ocultas.has(ds.cleg) ? CS.ocultas.delete(ds.cleg) : CS.ocultas.add(ds.cleg); render(); return; }
    const a = ds.ca;
    if (a === 'ant' || a === 'prox') { const s = a === 'ant' ? -1 : 1; if (CS.vista === 'ano') CS.ano += s; else { CS.mes += s; if (CS.mes < 0) { CS.mes = 11; CS.ano--; } if (CS.mes > 11) { CS.mes = 0; CS.ano++; } } render(); }
    else if (a === 'hoje') { const d = new Date(); CS.ano = d.getFullYear(); CS.mes = d.getMonth(); render(); }
    else if (a === 'novo') eventoForm({}, ds.dia);
    else if (a === 'edita') eventoForm(CS.store.get(ds.id));
    else if (a === 'cats') catsForm();
    else if (a === 'ciclo') cicloForm();
  });
  el.addEventListener('keydown', e => { if (!ativo() || e.key !== 'Enter') return; const t = e.target.closest('[data-cdia]'); if (t) diaForm(t.dataset.cdia); });
  // Os botões dentro do diálogo (fora da página) também usam data-ca
  $('#modal').addEventListener('click', e => {
    if (!ativo()) return; const t = e.target.closest('[data-ca]'); if (!t) return;
    if (t.dataset.ca === 'novo') eventoForm({}, t.dataset.dia); else if (t.dataset.ca === 'edita') eventoForm(CS.store.get(t.dataset.id));
  });
}

function resumoHub() {
  if (!CS.store) return null;
  const hoje = hojeIso(), s = semana(hoje), p = proximos(1)[0];
  return { semana: `S${s}`, quinzena: quinzena(s), proximo: p ? `${p.titulo} · ${fmtData(p.dia).slice(0, 5)}` : '—', uteis: resumoMes(hoje.slice(0, 7)).uteis };
}

window.CalMod = { iniciar, render, resumoHub, semana, quinzena, diaInfo, diasDoMes, resumoMes, mesHtml, fmtData, fmtLonga, dowDe, hojeIso, cfg, MES_L };
})();
