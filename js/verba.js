/* Módulo Verba Indenizatória.
   Racional por KM = preço médio do combustível ÷ KM por litro + cesta de serviço (pedágio e manutenção, por KM).
   Verba de uma rota no mês = KM daquele dia de rota × racional × dias do mês em que aquela rota acontece.
   Os dias vêm do Calendário: o dia da semana da rota, nas semanas do ciclo dela (S1 a S4, ou 1,3 e 2,4),
   tirando feriados e dias marcados como sem rota. Ex.: 50 km × R$ 0,90 numa segunda das semanas 2 e 4 = 2 dias → R$ 90,00.
   As rotas podem vir de uma base de Rotas ou de um estudo do Planejamento. Reembolsos somam e descontos subtraem.
   Usa window.RRM (app.js), window.RotasMod (rotas.js) e window.CalMod (calendario.js). */
(function () {
'use strict';
const R = window.RRM, Rot = window.RotasMod, Cal = window.CalMod; if (!R || !Rot || !Cal) return;
const { st, $, $$, esc, toast, openModal, closeModal, ICON, nf0, nf1, fkm, isNum, uid, numBR, hbars, vcols, saveFile, xlsxBlob, slug, dstamp, fdh, DIA_C, DIA_L, COR_SEM } = R;

const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const brl = v => (v < 0 ? '−' : '') + 'R$ ' + nf2.format(Math.abs(v || 0));
const brl4 = v => 'R$ ' + nf4.format(v || 0);
const cent = v => Math.round((v || 0) * 100) / 100;
const mesAtual = () => new Date().toISOString().slice(0, 7);
const pad2 = n => String(n).padStart(2, '0');
const fmtMes = ym => Rot.fmtPer(ym);
const ANEXO_MAX = 4;
const VS = { store: null, carregando: null, aba: 'calc', mes: mesAtual(), fonte: '', rac: '', vend: '', ext: '', lf: { vend: '', todos: false }, cmp: { a: { fonte: '', rac: '' }, b: { fonte: '', rac: '' } }, ligado: false };

/* ---------- Dados ---------- */
async function iniciar() {
  if (VS.store) return;
  if (!VS.carregando) VS.carregando = (async () => { const s = new R.BucketStore('verba'); try { await s.load(); } catch (e) { /* segue vazio */ } VS.store = s; })();
  await VS.carregando;
}
const todos = t => (VS.store ? [...VS.store.values()].filter(x => x && x.tipo === t) : []);
const racionais = () => todos('racional').sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
const lancs = () => todos('lanc');
const apuracoes = () => todos('apuracao').sort((a, b) => b.mes.localeCompare(a.mes) || (b.em || 0) - (a.em || 0));
const valorRac = r => (r && r.kmL > 0 ? r.preco / r.kmL : 0) + ((r && r.cesta) || 0);
const formulaRac = r => `${brl4(r.preco)} ÷ ${nf1.format(r.kmL)} km/L + ${brl4(r.cesta)} = <b>${brl4(valorRac(r))} por km</b>`;
const admin = () => !!(st.usuario && st.usuario.papel === 'admin' && !st.ro);
const vendedoresConhecidos = extra => { const m = new Map(); for (const c of st.col.values()) m.set(c.codigo, c.nome || c.codigo); for (const [v, n] of extra || []) if (!m.has(v)) m.set(v, n); return [...m].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR', { numeric: true })); };

// Para bases importadas por data: o dia exato da rota (semana do mês × dia da semana)
function dataPorSemana(ym, w, d) {
  const [y, m] = ym.split('-').map(Number), fim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let dia = (w - 1) * 7 + 1; dia <= Math.min(w * 7, fim); dia++) { const iso = `${ym}-${pad2(dia)}`; if (Cal.dowDe(iso) === d) return iso; }
  return '';
}
/* Cálculo de um mês para uma fonte e um racional */
async function calcular(fonteId, ym, racId) {
  await iniciar(); await Cal.iniciar();
  const rac = VS.store.get(racId); if (!rac) return null;
  const F = await Rot.carregaFonte(fonteId); if (!F) return null;
  const { b, routes } = F, recs = Rot.recsTodos(b, routes), vk = valorRac(rac), dias = Cal.diasDoMes(ym), W = Rot.semanasCiclo(b);
  const porV = new Map(), get = (v, nome) => { if (!porV.has(v)) porV.set(v, { v, nome: nome || Rot.nomeVend(v), km: 0, verba: 0, dias: new Set(), itens: [], perdidos: [], rotas: new Map(), reemb: 0, desc: 0, lancs: [] }); return porV.get(v); };
  for (const rec of recs) {
    const o = get(rec.v); const rk = rec.w + '|' + rec.d; if (!o.rotas.has(rk)) o.rotas.set(rk, { w: rec.w, d: rec.d, km: 0, n: 0, vezes: 0 }); const rr = o.rotas.get(rk); rr.km += rec.km; rr.n += rec.n;
    const ok = [], perd = [];
    if (b.porData) { if (b.periodo === ym) { const iso = dataPorSemana(ym, rec.w, rec.d); if (iso) ok.push(Cal.diaInfo(iso)); } }
    else for (const x of dias) if (x.dow === rec.d && Cal.semana(x.iso, W) === rec.w) (x.semRota ? perd : ok).push(x);
    rr.vezes = ok.length;
    for (const x of ok) { o.itens.push({ iso: x.iso, d: rec.d, w: rec.w, km: rec.km, n: rec.n, valor: rec.km * vk, real: rec.real }); o.km += rec.km; o.verba += rec.km * vk; o.dias.add(x.iso); }
    for (const x of perd) o.perdidos.push({ iso: x.iso, motivo: x.motivo, km: rec.km });
  }
  for (const l of lancs().filter(l => l.mes === ym)) { const o = get(l.vend, l.vendNome); if (l.natureza === 'reembolso') o.reemb += +l.valor || 0; else o.desc += +l.valor || 0; o.lancs.push(l); }
  const linhas = [...porV.values()].map(o => { o.itens.sort((a, c) => a.iso.localeCompare(c.iso)); o.verba = cent(o.verba); return { ...o, diasN: o.dias.size, liq: cent(o.verba + o.reemb - o.desc) }; })
    .sort((a, c) => String(a.nome).localeCompare(String(c.nome), 'pt-BR', { numeric: true }));
  const tot = linhas.reduce((t, o) => ({ km: t.km + o.km, verba: t.verba + o.verba, reemb: t.reemb + o.reemb, desc: t.desc + o.desc, liq: t.liq + o.liq, dias: t.dias + o.diasN, perd: t.perd + o.perdidos.length }), { km: 0, verba: 0, reemb: 0, desc: 0, liq: 0, dias: 0, perd: 0 });
  return { b, ym, rac, vk, dias, linhas, tot, res: Cal.resumoMes(ym), foraDoMes: b.porData && b.periodo !== ym };
}
const filtraVend = (c, v) => (v ? { ...c, linhas: c.linhas.filter(o => o.v === v), tot: c.linhas.filter(o => o.v === v).reduce((t, o) => ({ km: t.km + o.km, verba: t.verba + o.verba, reemb: t.reemb + o.reemb, desc: t.desc + o.desc, liq: t.liq + o.liq, dias: t.dias + o.diasN, perd: t.perd + o.perdidos.length }), { km: 0, verba: 0, reemb: 0, desc: 0, liq: 0, dias: 0, perd: 0 }) } : c);

/* ---------- Escolhas padrão ---------- */
function padroes() {
  const fl = Rot.fontesLista();
  if (!fl.some(f => f.id === VS.fonte)) { const daquele = fl.find(f => f.tipo === 'base' && f.periodo === VS.mes); VS.fonte = (daquele || fl.find(f => f.tipo === 'base') || fl[0] || {}).id || ''; }
  const rs = racionais(); if (!rs.some(r => r.id === VS.rac)) VS.rac = (rs.find(r => !r.desde || r.desde <= VS.mes) || rs[0] || {}).id || '';
  for (const k of ['a', 'b']) { const s = VS.cmp[k]; if (!fl.some(f => f.id === s.fonte)) s.fonte = VS.fonte; if (!rs.some(r => r.id === s.rac)) s.rac = k === 'b' && rs[1] ? rs[1].id : VS.rac; }
}

/* ---------- Partes comuns ---------- */
const kc = (k, v, s, cls = '') => `<div class="kc ${cls}"><span class="k">${k}</span><span class="v${String(v).includes('R$') ? ' rs' : ''}">${v}</span><span class="s">${s}</span></div>`;
const racOpts = sel => racionais().map(r => `<option value="${esc(r.id)}"${r.id === sel ? ' selected' : ''}>${esc(r.nome)} · ${brl4(valorRac(r))}/km</option>`).join('');
function controles(c, extra = '', semFormula) {
  return `<div class="card"><div class="cb vb-ctl">
    <label class="field"><span class="lbl">Mês</span><input type="month" data-vf="mes" value="${esc(VS.mes)}"></label>
    <label class="field"><span class="lbl">Rotas de</span><select data-vf="fonte">${Rot.fonteOpts(VS.fonte)}</select></label>
    <label class="field"><span class="lbl">Racional</span><select data-vf="rac">${racOpts(VS.rac)}</select></label>
    ${extra}</div>${c && c.rac && !semFormula ? `<div class="vb-form">Racional: ${formulaRac(c.rac)} · ${esc(c.rac.nome)}</div>` : ''}</div>`;
}
function vazio() {
  const semFonte = !Rot.fontesLista().length, semRac = !racionais().length;
  if (!semFonte && !semRac) return '';
  return `<div class="card"><div class="empty"><span class="mod-i xl">${R.ICON_MOD.verba}</span><h3>${semRac ? 'Cadastre um racional de verba' : 'Falta uma rota para calcular'}</h3>
    <p>${semRac ? 'O racional é o preço médio do combustível dividido pelo KM por litro, mais a cesta de serviço (pedágio e manutenção). Ex.: R$ 6,20 ÷ 10 km/L + R$ 0,28 = R$ 0,90 por km.' : 'Importe uma base em Rotas ou monte um estudo no Planejamento: a verba é calculada sobre os KM das rotas.'}</p>
    <div class="row" style="justify-content:center">${semRac ? `<button class="btn primary" type="button" data-va="racnovo"${admin() ? '' : ' disabled'}>Novo racional</button>` : '<button class="btn primary" type="button" data-hub="rotas">Abrir Rotas</button>'}</div></div></div>`;
}
const diasMesTxt = r => `seg a sex${r.sabados ? ` · +${r.sabados} sábados` : ''}`;

/* ---------- Cálculo ---------- */
function abaCalc(c) {
  const v = VS.vend, cc = filtraVend(c, v), t = cc.tot;
  const vends = c.linhas.map(o => [o.v, o.nome]);
  const ctl = controles(c, `<label class="field"><span class="lbl">Vendedor</span><select data-vf="vend"><option value="">Todos</option>${vends.map(([x, n]) => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`);
  const perdas = cc.linhas.flatMap(o => o.perdidos), motivos = [...new Set(perdas.map(p => `${Cal.fmtData(p.iso).slice(0, 5)} ${p.motivo}`))];
  const linha = o => `<tr><td><b>${esc(o.nome)}</b> <span class="muted">${esc(String(o.v).startsWith('s:') ? '' : o.v)}</span></td><td class="n">${nf0.format(o.rotas.size)}</td><td class="n">${nf0.format(o.diasN)}</td><td class="n">${fkm(o.km)}</td><td class="n">${brl(o.verba)}</td><td class="n">${o.reemb ? brl(o.reemb) : '—'}</td><td class="n">${o.desc ? '−' + brl(o.desc) : '—'}</td><td class="n"><b>${brl(o.liq)}</b></td><td class="n"><button class="btn sm" type="button" data-va="extrato" data-v="${esc(o.v)}">Extrato</button></td></tr>`;
  return `${ctl}
    ${c.foraDoMes ? `<div class="banner">Esta base é de ${esc(fmtMes(c.b.periodo))}, por data de visita: ela não tem rotas em ${esc(fmtMes(c.ym))}. Escolha o mês ${esc(fmtMes(c.b.periodo))} ou outra fonte.</div>` : ''}
    <div class="kgrid">
      ${kc('KM no mês', fkm(t.km), `${nf0.format(cc.linhas.length)} vendedor(es)`)}
      ${kc('Dias úteis do mês', nf0.format(c.res.uteis), diasMesTxt(c.res))}
      ${kc('Dias calculados', nf0.format(t.dias), 'soma dos vendedores')}
      ${kc('Verba', brl(t.verba), `${brl4(c.vk)} por km`)}
      ${kc('Reembolsos', brl(t.reemb), 'somam ao valor')}
      ${kc('Descontos', t.desc ? '−' + brl(t.desc) : brl(0), 'subtraem do valor')}
      ${kc('Total a pagar', brl(t.liq), fmtMes(c.ym), 'tot')}</div>
    ${perdas.length ? `<div class="banner info">Feriados e dias sem rota tiraram ${nf0.format(perdas.length)} dia(s) de rota do cálculo (${fkm(perdas.reduce((s, p) => s + p.km, 0))} km): ${esc(motivos.slice(0, 6).join(' · '))}${motivos.length > 6 ? '…' : ''}.</div>` : ''}
    <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:12.5px">Verba = KM do dia de rota × racional × dias daquela rota no mês (semanas do ciclo do Calendário).</span>
      <span class="row"><button class="btn sm" type="button" data-va="xls">Exportar (.xlsx)</button><button class="btn sm primary" type="button" data-va="salvar"${admin() ? '' : ' disabled'}>Salvar no histórico</button></span></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Vendedor</th><th class="n">Rotas por ciclo</th><th class="n">Dias calculados</th><th class="n">KM no mês</th><th class="n">Verba</th><th class="n">Reembolso</th><th class="n">Desconto</th><th class="n">Total</th><th></th></tr></thead>
      <tbody>${cc.linhas.map(linha).join('') || '<tr><td colspan="9" class="muted">Nenhuma rota nesta fonte.</td></tr>'}
      ${cc.linhas.length > 1 ? `<tr class="tot"><td>Total</td><td></td><td class="n">${nf0.format(t.dias)}</td><td class="n">${fkm(t.km)}</td><td class="n">${brl(t.verba)}</td><td class="n">${brl(t.reemb)}</td><td class="n">${t.desc ? '−' + brl(t.desc) : '—'}</td><td class="n">${brl(t.liq)}</td><td></td></tr>` : ''}</tbody></table></div>`;
}

/* ---------- Extrato de um vendedor ---------- */
function abaExtrato(c) {
  if (!c.linhas.some(o => o.v === VS.ext)) VS.ext = (c.linhas[0] || {}).v || '';
  const o = c.linhas.find(x => x.v === VS.ext);
  const ctl = controles(c, `<label class="field"><span class="lbl">Vendedor</span><select data-vf="ext">${''}${c.linhas.map(x => `<option value="${esc(x.v)}"${x.v === VS.ext ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>`, true);
  if (!o) return ctl + '<div class="card"><div class="cb muted">Nenhum vendedor nesta fonte.</div></div>';
  const [y, m] = c.ym.split('-').map(Number), porDia = new Map(), perd = new Map();
  for (const it of o.itens) { if (!porDia.has(it.iso)) porDia.set(it.iso, []); porDia.get(it.iso).push(it); }
  for (const p of o.perdidos) perd.set(p.iso, p);
  const cal = Cal.mesHtml(y, m - 1, { grande: true, comAno: true, marca: d => { const its = porDia.get(d.iso); if (its) { const km = its.reduce((s, i) => s + i.km, 0); return { cls: 'rota', tip: `Rota: ${fkm(km)} km · ${brl(km * c.vk)}`, txt: `<span class="ev km">${fkm(km)}</span>` }; } const p = perd.get(d.iso); return p ? { cls: 'perdido', tip: `Rota não calculada: ${p.motivo}`, txt: '<span class="ev perd">sem rota</span>' } : null; } });
  const linhas = [...porDia].map(([iso, its]) => { const km = its.reduce((s, i) => s + i.km, 0), s4 = Cal.semana(iso); return [iso, `<tr><td class="num">${Cal.fmtData(iso)}</td><td>${DIA_L[Cal.dowDe(iso)]}</td><td><span class="wk" style="--c:${COR_SEM[s4]}">S${s4}</span> <span class="qz q${s4 % 2 ? 13 : 24}">${Cal.quinzena(s4)}</span></td><td class="n">${nf0.format(its.reduce((s, i) => s + i.n, 0))}</td><td class="n">${fkm(km)}</td><td class="n">${brl(km * c.vk)}</td></tr>`]; });
  const perdL = [...perd.values()].map(p => [p.iso, `<tr class="perd"><td class="num">${Cal.fmtData(p.iso)}</td><td>${DIA_L[Cal.dowDe(p.iso)]}</td><td colspan="2">${esc(p.motivo)}</td><td class="n muted">${fkm(p.km)}</td><td class="n muted">fora</td></tr>`]);
  const lancL = o.lancs.map(l => `<tr><td>${l.natureza === 'reembolso' ? '<span class="pill ok">Reembolso</span>' : '<span class="pill bad">Desconto</span>'}</td><td class="wrap">${esc(l.motivo || '')}${l.ref ? `<div class="muted" style="font-size:12px">${esc(l.ref)}</div>` : ''}</td><td>${l.data ? Cal.fmtData(l.data) : '—'}</td><td>${anexosHtml(l)}</td><td class="n">${l.natureza === 'reembolso' ? '' : '−'}${brl(l.valor)}</td></tr>`).join('');
  return `${ctl}
    <div class="extrato" id="vbExtrato">
      <div class="ext-h"><div><span class="lbl">Extrato de KM e verba indenizatória</span><h2>${esc(o.nome)} <span class="muted">${esc(String(o.v).startsWith('s:') ? '' : o.v)}</span></h2><span class="muted">${esc(Rot.fmtPerLongo(c.ym))} · rotas de ${esc(Rot.nomeFonte(c.b.id))}</span></div>
        <div class="row no-print"><button class="btn sm" type="button" data-va="xlsext">Exportar (.xlsx)</button><button class="btn sm" type="button" data-va="imprimir">Imprimir</button></div></div>
      <div class="kgrid">
        ${kc('KM no mês', fkm(o.km), `${nf0.format(o.rotas.size)} rota(s) no ciclo`)}
        ${kc('Dias úteis do mês', nf0.format(c.res.uteis), diasMesTxt(c.res))}
        ${kc('Dias calculados', nf0.format(o.diasN), o.perdidos.length ? `${o.perdidos.length} sem rota (feriado)` : 'dias com rota')}
        ${kc('Verba', brl(o.verba), `${brl4(c.vk)} por km`)}
        ${kc('Reembolso', brl(o.reemb), `${o.lancs.filter(l => l.natureza === 'reembolso').length} lançamento(s)`)}
        ${kc('Desconto', o.desc ? '−' + brl(o.desc) : brl(0), `${o.lancs.filter(l => l.natureza !== 'reembolso').length} lançamento(s)`)}
        ${kc('Total a pagar', brl(o.liq), 'verba + reemb. − desc.', 'tot')}</div>
      <div class="vb-form">Racional: ${formulaRac(c.rac)} · ${esc(c.rac.nome)}</div>
      <div class="ext-g"><div>${cal}<div class="legend-row" style="margin-top:6px"><span class="li"><i class="sw" style="background:var(--accent)"></i>Dia com rota</span><span class="li"><i class="sw" style="background:var(--feriado)"></i>Feriado / sem rota</span></div></div>
        <div class="stack"><div class="tblwrap"><table class="t"><thead><tr><th>Data</th><th>Dia</th><th>Semana</th><th class="n">Visitas</th><th class="n">KM</th><th class="n">Verba</th></tr></thead><tbody>
          ${[...linhas, ...perdL].sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]).join('') || '<tr><td colspan="6" class="muted">Nenhum dia de rota neste mês.</td></tr>'}
          <tr class="tot"><td colspan="3">Total · ${nf0.format(o.diasN)} dia(s)</td><td></td><td class="n">${fkm(o.km)}</td><td class="n">${brl(o.verba)}</td></tr></tbody></table></div>
          <div class="tblwrap"><table class="t"><thead><tr><th>Lançamento</th><th>Motivo</th><th>Data</th><th>Anexos</th><th class="n">Valor</th></tr></thead><tbody>${lancL || '<tr><td colspan="5" class="muted">Nenhum reembolso ou desconto neste mês.</td></tr>'}</tbody></table></div></div></div>
    </div>`;
}

/* ---------- Reembolsos e descontos ---------- */
const anexosHtml = l => (l.anexos || []).length ? `<span class="thumbs">${l.anexos.map((a, i) => `<button type="button" class="thumb" data-va="anexo" data-id="${esc(l.id)}" data-i="${i}" title="${esc(a.nome || 'Imagem')}"><img src="${esc(a.url)}" alt="${esc(a.nome || 'Anexo')}"></button>`).join('')}</span>` : '<span class="muted">—</span>';
function abaLanc(natureza) {
  const nome = natureza === 'reembolso' ? 'Reembolsos' : 'Descontos', lf = VS.lf;
  const lista = lancs().filter(l => l.natureza === natureza && (lf.todos || l.mes === VS.mes) && (!lf.vend || l.vend === lf.vend)).sort((a, b) => b.mes.localeCompare(a.mes) || (b.data || '').localeCompare(a.data || '') || (b.em || 0) - (a.em || 0));
  const total = lista.reduce((s, l) => s + (+l.valor || 0), 0), vends = vendedoresConhecidos(lancs().map(l => [l.vend, l.vendNome || l.vend]));
  return `<div class="card"><div class="cb vb-ctl">
      <label class="field"><span class="lbl">Mês</span><input type="month" data-vf="mes" value="${esc(VS.mes)}"${lf.todos ? ' disabled' : ''}></label>
      <label class="chk" style="align-self:center"><input type="checkbox" data-vl="todos"${lf.todos ? ' checked' : ''}> Todos os meses</label>
      <label class="field"><span class="lbl">Vendedor</span><select data-vl="vend"><option value="">Todos</option>${vends.map(([v, n]) => `<option value="${esc(v)}"${v === lf.vend ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <span class="sp"></span><span class="row"><button class="btn sm" type="button" data-va="lmodelo">Modelo (.xlsx)</button><button class="btn sm" type="button" data-va="limport" data-nat="${natureza}"${admin() ? '' : ' disabled'}>Importar planilha</button><button class="btn sm primary" type="button" data-va="lnovo" data-nat="${natureza}"${admin() ? '' : ' disabled'}>Incluir ${natureza}</button></span></div></div>
    <div class="kgrid k4">${kc(`Total de ${nome.toLowerCase()}`, (natureza === 'desconto' && total ? '−' : '') + brl(total), lf.todos ? 'todos os meses' : fmtMes(VS.mes))}${kc('Lançamentos', nf0.format(lista.length), `${nf0.format(new Set(lista.map(l => l.vend)).size)} vendedor(es)`)}${kc('Com anexo', nf0.format(lista.filter(l => (l.anexos || []).length).length), 'imagens de comprovante ou evidência')}</div>
    ${natureza === 'desconto' ? '<p class="muted" style="margin:0;font-size:12.5px">Registre o motivo de cada desconto e anexe as imagens que o justificam (comprovante, foto, print da rota). A referência pode indicar a rota ou o dia (ex.: “segunda S2 · 10/11”).</p>' : ''}
    <div class="tblwrap"><table class="t"><thead><tr><th>Mês</th><th>Data</th><th>Vendedor</th><th>Motivo</th><th>Referência</th><th>Anexos</th><th class="n">Valor</th><th></th></tr></thead><tbody>
      ${lista.map(l => `<tr><td>${esc(fmtMes(l.mes))}</td><td>${l.data ? Cal.fmtData(l.data) : '—'}</td><td><b>${esc(l.vendNome || Rot.nomeVend(l.vend))}</b> <span class="muted">${esc(l.vend)}</span></td><td class="wrap">${esc(l.motivo || '—')}</td><td class="wrap muted">${esc(l.ref || '')}</td><td>${anexosHtml(l)}</td><td class="n">${natureza === 'desconto' ? '−' : ''}${brl(l.valor)}</td><td class="n">${admin() ? `<button class="btn sm" type="button" data-va="ledita" data-id="${esc(l.id)}">Editar</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="8" class="muted">Nenhum ${natureza} ${lf.todos ? '' : 'em ' + fmtMes(VS.mes)}.</td></tr>`}
    </tbody></table></div>`;
}
// Imagem reduzida (lado maior até 1280 px, JPEG), para caber no banco sem perder a leitura
function comprime(file, max = 1280, q = 0.72) {
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) { rej(new Error('Envie imagens (JPG, PNG ou WEBP)')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Não foi possível ler a imagem')); };
    img.src = url;
  });
}
function lancForm(l0 = {}, natureza) {
  if (!admin()) return;
  const l = { natureza: natureza || l0.natureza || 'reembolso', mes: VS.mes, anexos: [], ...l0 }, novo = !l0.id;
  let anexos = (l.anexos || []).slice();
  const vends = vendedoresConhecidos(Rot.fontesLista().length ? [] : []);
  const MOT = l.natureza === 'reembolso' ? ['Pedágio', 'Estacionamento', 'Combustível extra', 'Manutenção', 'Alimentação', 'Outro'] : ['KM não realizado', 'Rota não cumprida', 'Uso pessoal do veículo', 'Multa de trânsito', 'Adiantamento', 'Outro'];
  const desenhaAnexos = () => { const b = $('#lfAnexos'); if (b) b.innerHTML = anexos.map((a, i) => `<span class="thumb"><img src="${esc(a.url)}" alt="${esc(a.nome)}"><button type="button" class="thumb-x" data-ax="${i}" aria-label="Remover anexo">${ICON.close}</button></span>`).join('') || '<span class="muted">Nenhum anexo</span>'; };
  openModal(`<div class="dh"><h2>${novo ? 'Incluir' : 'Editar'} ${l.natureza}</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="lfForm"><div class="db"><div class="fgrid">
      <label class="field"><span class="lbl">Tipo</span><select name="natureza"><option value="reembolso"${l.natureza === 'reembolso' ? ' selected' : ''}>Reembolso (soma)</option><option value="desconto"${l.natureza === 'desconto' ? ' selected' : ''}>Desconto (subtrai)</option></select></label>
      <label class="field"><span class="lbl">Vendedor</span><input type="text" name="vend" list="lfVends" value="${esc(l.vend || '')}" placeholder="Código do vendedor" required><datalist id="lfVends">${vends.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</datalist></label>
      <label class="field"><span class="lbl">Mês da verba</span><input type="month" name="mes" value="${esc(l.mes)}" required></label>
      <label class="field"><span class="lbl">Data (opcional)</span><input type="date" name="data" value="${esc(l.data || '')}"></label>
      <label class="field"><span class="lbl">Valor (R$)</span><input type="text" name="valor" inputmode="decimal" value="${l.valor !== undefined ? esc(nf2.format(l.valor)) : ''}" required></label>
      <label class="field"><span class="lbl">Motivo</span><input type="text" name="motivo" list="lfMot" maxlength="120" value="${esc(l.motivo || '')}" required><datalist id="lfMot">${MOT.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label></div>
      <label class="field"><span class="lbl">Referência (opcional)</span><input type="text" name="ref" maxlength="160" value="${esc(l.ref || '')}" placeholder="Rota, dia ou documento. Ex.: segunda S2 · 10/11 · NF 1234"></label>
      <label class="field"><span class="lbl">Observação (opcional)</span><textarea name="obs" maxlength="400">${esc(l.obs || '')}</textarea></label>
      <div class="field"><span class="lbl">Imagens (até ${ANEXO_MAX})</span><div class="thumbs lg" id="lfAnexos"></div><input type="file" id="lfArq" accept="image/*" multiple><span class="hint">Comprovantes ou evidências. As imagens são reduzidas antes de salvar. Evite fotos de documentos pessoais que não sejam necessários.</span></div></div>
    <div class="df">${novo ? '' : '<button class="btn danger" type="button" id="lfDel">Excluir</button>'}<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`);
  desenhaAnexos();
  $('#lfAnexos').onclick = e => { const b = e.target.closest('[data-ax]'); if (!b) return; anexos.splice(+b.dataset.ax, 1); desenhaAnexos(); };
  $('#lfArq').onchange = async e => {
    for (const f of [...e.target.files]) { if (anexos.length >= ANEXO_MAX) { toast(`No máximo ${ANEXO_MAX} imagens`); break; } try { anexos.push({ nome: f.name.slice(0, 80), url: await comprime(f) }); } catch (err) { toast(err.message); } }
    e.target.value = ''; desenhaAnexos();
  };
  $('#lfForm').onsubmit = ev => {
    ev.preventDefault(); const f = new FormData(ev.target), valor = numBR(f.get('valor'));
    if (!isNum(valor) || valor <= 0) { toast('Valor inválido'); return; }
    const vend = String(f.get('vend')).trim(), id = l.id || uid('vl');
    const rec = { id, tipo: 'lanc', natureza: String(f.get('natureza')), vend, vendNome: Rot.nomeVend(vend), mes: String(f.get('mes')), data: String(f.get('data') || ''), valor: cent(valor), motivo: String(f.get('motivo')).trim(), ref: String(f.get('ref') || '').trim(), obs: String(f.get('obs') || '').trim(), anexos, usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() };
    VS.store.put(id, rec); R.audita('verba', `${novo ? 'Incluiu' : 'Alterou'} ${rec.natureza} de ${brl(rec.valor)} para ${vend} (${fmtMes(rec.mes)})`);
    closeModal(); VS.mes = rec.mes; render(); toast(`${rec.natureza === 'reembolso' ? 'Reembolso' : 'Desconto'} salvo`);
  };
  const del = $('#lfDel'); if (del) del.onclick = () => R.armButton(del, () => { VS.store.del(l.id); R.audita('verba', `Excluiu ${l.natureza} de ${brl(l.valor)} de ${l.vend} (${fmtMes(l.mes)})`); closeModal(); render(); toast('Lançamento excluído'); }, 'Confirmar exclusão');
}
function verAnexo(id, i) {
  const l = VS.store.get(id), a = l && (l.anexos || [])[i]; if (!a) return;
  openModal(`<div class="dh"><h2>${esc(a.nome || 'Anexo')}</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div><div class="db"><img class="anexo-full" src="${esc(a.url)}" alt="${esc(a.nome || 'Anexo')}"><p class="muted" style="margin:0">${esc(l.natureza === 'reembolso' ? 'Reembolso' : 'Desconto')} · ${esc(l.vendNome || l.vend)} · ${esc(fmtMes(l.mes))} · ${brl(l.valor)} · ${esc(l.motivo || '')}</p></div>`, 'lg');
}

/* ---------- Histórico de apurações ---------- */
function salvarApuracao(c, btn) {
  if (!admin()) return;
  const ja = apuracoes().find(a => a.mes === c.ym && a.fonte && a.fonte.id === c.b.id);
  const grava = () => {
    const id = ja ? ja.id : uid('va');
    VS.store.put(id, { id, tipo: 'apuracao', mes: c.ym, fonte: { id: c.b.id, nome: Rot.nomeFonte(c.b.id) }, rac: { nome: c.rac.nome, preco: c.rac.preco, kmL: c.rac.kmL, cesta: c.rac.cesta, valor: c.vk },
      res: { uteis: c.res.uteis, sabados: c.res.sabados }, linhas: c.linhas.map(o => ({ v: o.v, nome: o.nome, km: Math.round(o.km * 10) / 10, dias: o.diasN, verba: o.verba, reemb: cent(o.reemb), desc: cent(o.desc), liq: o.liq, itens: o.itens.map(i => [i.iso, Math.round(i.km * 10) / 10]) })),
      tot: { km: Math.round(c.tot.km * 10) / 10, verba: cent(c.tot.verba), reemb: cent(c.tot.reemb), desc: cent(c.tot.desc), liq: cent(c.tot.liq), dias: c.tot.dias }, usuario: (st.usuario && st.usuario.nome) || '', em: Date.now() });
    R.audita('verba', `Salvou a apuração de ${fmtMes(c.ym)}: ${brl(c.tot.liq)}`); toast('Apuração salva no histórico'); render();
  };
  if (ja) R.armButton(btn, grava, 'Substituir a apuração já salva'); else grava();
}
function abaHist() {
  const l = apuracoes();
  if (!l.length) return '<div class="card"><div class="empty"><h3>Nenhuma apuração salva</h3><p>Em Cálculo, confira os valores do mês e clique em “Salvar no histórico”. A apuração guarda o racional, os KM, os dias e os valores daquele momento.</p></div></div>';
  const porMes = new Map(); for (const a of l) if (!porMes.has(a.mes)) porMes.set(a.mes, a);
  const ult = [...porMes.values()].slice(0, 12).reverse();
  const cols = ult.map(a => ({ label: fmtMes(a.mes).replace('/20', '/'), v: Math.round(a.tot.liq), cor: 'var(--accent)', tip: `${Rot.fmtPerLongo(a.mes)}\nTotal: ${brl(a.tot.liq)}\nVerba ${brl(a.tot.verba)} · reembolso ${brl(a.tot.reemb)} · desconto ${brl(a.tot.desc)}\n${fkm(a.tot.km)} km · ${a.rac.nome} (${brl4(a.rac.valor)}/km)` }));
  const vends = [...new Map(ult.flatMap(a => a.linhas.map(o => [o.v, o.nome]))).entries()];
  const mx = Math.max(1, ...ult.flatMap(a => a.linhas.map(o => o.liq)));
  return `<div class="card"><div class="ch"><h2>Total a pagar por mês</h2><span class="muted" style="font-size:12px">última apuração de cada mês</span></div><div class="cb">${vcols(cols)}</div></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Mês</th><th>Rotas de</th><th>Racional</th><th class="n">Vendedores</th><th class="n">KM</th><th class="n">Verba</th><th class="n">Reembolsos</th><th class="n">Descontos</th><th class="n">Total</th><th>Salvo</th><th></th></tr></thead><tbody>
      ${l.map(a => `<tr><td><b>${esc(fmtMes(a.mes))}</b></td><td class="wrap">${esc(a.fonte ? a.fonte.nome : '—')}</td><td>${esc(a.rac.nome)} · ${brl4(a.rac.valor)}</td><td class="n">${nf0.format(a.linhas.length)}</td><td class="n">${fkm(a.tot.km)}</td><td class="n">${brl(a.tot.verba)}</td><td class="n">${brl(a.tot.reemb)}</td><td class="n">${a.tot.desc ? '−' + brl(a.tot.desc) : '—'}</td><td class="n"><b>${brl(a.tot.liq)}</b></td><td class="muted">${fdh(a.em)}${a.usuario ? ' · ' + esc(a.usuario) : ''}</td><td class="n"><button class="btn sm" type="button" data-va="apver" data-id="${esc(a.id)}">Ver</button>${admin() ? ` <button class="btn sm danger" type="button" data-va="apdel" data-id="${esc(a.id)}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    ${ult.length > 1 ? `<div class="card"><div class="ch"><h2>Total por vendedor e mês</h2><span class="muted" style="font-size:12px">fundo mais forte = maior valor</span></div><div class="tblwrap" style="border:0;border-radius:0"><table class="t heat"><thead><tr><th>Vendedor</th>${ult.map(a => `<th class="n">${esc(fmtMes(a.mes))}</th>`).join('')}</tr></thead><tbody>
      ${vends.map(([v, n]) => `<tr><td><b>${esc(n)}</b></td>${ult.map(a => { const o = a.linhas.find(x => x.v === v); return o ? `<td class="n" style="background:color-mix(in srgb, var(--accent) ${Math.round(8 + 50 * Math.max(0, o.liq) / mx)}%, transparent)" data-tip="${esc(`${n} · ${Rot.fmtPerLongo(a.mes)}\n${fkm(o.km)} km · ${o.dias} dias\nTotal ${brl(o.liq)}`)}">${brl(o.liq)}</td>` : '<td class="n muted">—</td>'; }).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}`;
}
function verApuracao(id) {
  const a = VS.store.get(id); if (!a) return;
  openModal(`<div class="dh"><div><h2>Apuração de ${esc(Rot.fmtPerLongo(a.mes))}</h2><div class="muted" style="font-size:12.5px">${esc(a.fonte ? a.fonte.nome : '')} · ${esc(a.rac.nome)}: ${brl4(a.rac.preco)} ÷ ${nf1.format(a.rac.kmL)} km/L + ${brl4(a.rac.cesta)} = ${brl4(a.rac.valor)}/km · salva em ${fdh(a.em)}${a.usuario ? ' por ' + esc(a.usuario) : ''}</div></div><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <div class="db"><div class="tblwrap"><table class="t"><thead><tr><th>Vendedor</th><th class="n">Dias</th><th class="n">KM</th><th class="n">Verba</th><th class="n">Reembolso</th><th class="n">Desconto</th><th class="n">Total</th></tr></thead><tbody>
      ${a.linhas.map(o => `<tr><td>${esc(o.nome)}</td><td class="n">${o.dias}</td><td class="n">${fkm(o.km)}</td><td class="n">${brl(o.verba)}</td><td class="n">${brl(o.reemb)}</td><td class="n">${o.desc ? '−' + brl(o.desc) : '—'}</td><td class="n"><b>${brl(o.liq)}</b></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="n">${a.tot.dias}</td><td class="n">${fkm(a.tot.km)}</td><td class="n">${brl(a.tot.verba)}</td><td class="n">${brl(a.tot.reemb)}</td><td class="n">${a.tot.desc ? '−' + brl(a.tot.desc) : '—'}</td><td class="n">${brl(a.tot.liq)}</td></tr></tbody></table></div></div>
    <div class="df"><button class="btn" type="button" data-va="apxls" data-id="${esc(a.id)}">Exportar (.xlsx)</button><button class="btn primary" type="button" data-close>Fechar</button></div>`, 'lg');
}

/* ---------- Comparativo: mesmo KM com racionais diferentes, ou KM diferentes com o mesmo racional ---------- */
function abaCmp(A, B) {
  const c = VS.cmp, lado = k => `<div class="cmpl"><div class="cmph"><i class="sw" style="background:var(--cmp-${k})"></i><b>Lado ${k.toUpperCase()}</b></div>
    <label class="field"><span class="lbl">Rotas de</span><select data-vc="${k}.fonte">${Rot.fonteOpts(c[k].fonte)}</select></label>
    <label class="field"><span class="lbl">Racional</span><select data-vc="${k}.rac">${racOpts(c[k].rac)}</select></label></div>`;
  const ctl = `<div class="card"><div class="cb rt-cmpctl"><label class="field" style="max-width:180px"><span class="lbl">Mês</span><input type="month" data-vf="mes" value="${esc(VS.mes)}"></label>${lado('a')}<button class="btn sm" type="button" data-va="cmptroca" title="Trocar os lados">⇄</button>${lado('b')}</div>
    <div class="cb row" style="padding-top:0"><span class="muted" style="font-size:12.5px">Atalhos:</span><button class="btn sm" type="button" data-va="mesmokm">Mesmos KM, outro racional</button><button class="btn sm" type="button" data-va="mesmorac">Mesmo racional, outros KM</button></div></div>`;
  if (!A || !B) return ctl + '<div class="card"><div class="cb muted">Escolha as rotas e os racionais dos dois lados.</div></div>';
  const vs = new Map(); for (const o of A.linhas) vs.set(o.v, o.nome); for (const o of B.linhas) if (!vs.has(o.v)) vs.set(o.v, o.nome);
  const sinal = (x, f) => { const z = f(Math.abs(x)) === f(0); return `<span class="${z ? '' : x < 0 ? 'down' : 'up'}">${z ? '' : x > 0 ? '+' : '−'}${f(Math.abs(x))}</span>`; };
  const rows = [...vs].map(([v, n]) => { const a = A.linhas.find(o => o.v === v) || { km: 0, verba: 0, diasN: 0 }, b = B.linhas.find(o => o.v === v) || { km: 0, verba: 0, diasN: 0 }; return { v, n, a, b }; }).sort((x, y) => Math.abs(y.b.verba - y.a.verba) - Math.abs(x.b.verba - x.a.verba));
  const pct = (x, y) => (x ? `${nf0.format(Math.round((y - x) / x * 100))}%` : '—');
  const card = (t, a, b, f, menor = true) => `<div class="kc"><span class="k">${t}</span><span class="v rs">${f(a)} <span class="muted">→</span> ${f(b)}</span><span class="s">${sinal(b - a, f)} · ${pct(a, b)}</span></div>`;
  const mx = Math.max(1, ...rows.flatMap(r => [r.a.verba, r.b.verba]));
  return `${ctl}
    <div class="kgrid k4">${card('KM no mês', A.tot.km, B.tot.km, fkm)}${card('Racional por km', A.vk, B.vk, brl4)}${card('Verba', A.tot.verba, B.tot.verba, brl)}${card('Total a pagar', A.tot.liq, B.tot.liq, brl)}</div>
    <p class="muted" style="margin:0;font-size:12.5px">A: ${esc(Rot.nomeFonte(A.b.id))} · ${esc(A.rac.nome)} (${formulaRac(A.rac)}). B: ${esc(Rot.nomeFonte(B.b.id))} · ${esc(B.rac.nome)} (${formulaRac(B.rac)}). Diferença = B − A; verde = B custa menos.</p>
    <div class="cgrid"><div class="card"><div class="ch"><h2>Verba por vendedor</h2><span class="legend-row"><span class="li"><i class="sw" style="background:var(--cmp-a)"></i>A</span><span class="li"><i class="sw" style="background:var(--cmp-b)"></i>B</span></span></div><div class="cb"><div class="cmpbars">
      ${rows.slice(0, 14).map(r => `<div class="cb2"><span class="cn">${esc(r.n)}</span><div class="cr" data-tip="${esc(`${r.n}\nA: ${fkm(r.a.km)} km · ${brl(r.a.verba)}\nB: ${fkm(r.b.km)} km · ${brl(r.b.verba)}`)}"><span class="ct"><i style="width:${r.a.verba / mx * 100}%;background:var(--cmp-a)"></i></span><span class="cv num">${brl(r.a.verba)}</span><span class="ct"><i style="width:${r.b.verba / mx * 100}%;background:var(--cmp-b)"></i></span><span class="cv num">${brl(r.b.verba)}</span></div></div>`).join('')}</div></div></div>
    <div class="card"><div class="ch"><h2>Dias do mês</h2></div><div class="cb stack"><div class="dbrow"><div><div class="lbl">Dias úteis de ${esc(fmtMes(VS.mes))}</div><b class="num">${A.res.uteis}</b> <span class="muted">${diasMesTxt(A.res)}</span></div></div>
      <div class="dbrow"><div><div class="lbl">Dias calculados</div><span class="num">A: <b>${nf0.format(A.tot.dias)}</b> · B: <b>${nf0.format(B.tot.dias)}</b></span></div></div>
      <div class="dbrow"><div><div class="lbl">Reembolsos e descontos</div><span class="muted">São os mesmos dos dois lados (lançados por vendedor e mês): ${brl(A.tot.reemb)} e −${brl(A.tot.desc)}</span></div></div></div></div></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Vendedor</th><th class="n">KM A</th><th class="n">KM B</th><th class="n">Δ KM</th><th class="n">Dias A</th><th class="n">Dias B</th><th class="n">Verba A</th><th class="n">Verba B</th><th class="n">Δ verba</th><th class="n">Δ %</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.n)}</b></td><td class="n">${fkm(r.a.km)}</td><td class="n">${fkm(r.b.km)}</td><td class="n">${sinal(r.b.km - r.a.km, fkm)}</td><td class="n">${r.a.diasN}</td><td class="n">${r.b.diasN}</td><td class="n">${brl(r.a.verba)}</td><td class="n">${brl(r.b.verba)}</td><td class="n">${sinal(r.b.verba - r.a.verba, brl)}</td><td class="n">${pct(r.a.verba, r.b.verba)}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="n">${fkm(A.tot.km)}</td><td class="n">${fkm(B.tot.km)}</td><td class="n">${sinal(B.tot.km - A.tot.km, fkm)}</td><td class="n">${A.tot.dias}</td><td class="n">${B.tot.dias}</td><td class="n">${brl(A.tot.verba)}</td><td class="n">${brl(B.tot.verba)}</td><td class="n">${sinal(B.tot.verba - A.tot.verba, brl)}</td><td class="n">${pct(A.tot.verba, B.tot.verba)}</td></tr></tbody></table></div>`;
}

/* ---------- Racionais ---------- */
function abaRac() {
  const l = racionais();
  return `<div class="row" style="justify-content:space-between"><p class="muted" style="margin:0;max-width:80ch">Racional por km = preço médio do combustível pesquisado ÷ KM por litro + cesta de serviço (pedágio e manutenção, em R$ por km). Cadastre um por tipo de veículo, região ou período para comparar.</p><button class="btn primary" type="button" data-va="racnovo"${admin() ? '' : ' disabled'}>Novo racional</button></div>
    <div class="tblwrap"><table class="t"><thead><tr><th>Racional</th><th class="n">Combustível (R$/L)</th><th class="n">KM por litro</th><th class="n">Combustível por km</th><th class="n">Cesta (R$/km)</th><th class="n">Racional (R$/km)</th><th>Vale desde</th><th></th></tr></thead><tbody>
      ${l.map(r => `<tr><td class="wrap"><b>${esc(r.nome)}</b>${r.obs ? `<div class="muted" style="font-size:12px">${esc(r.obs)}</div>` : ''}</td><td class="n">${brl4(r.preco)}</td><td class="n">${nf1.format(r.kmL)}</td><td class="n">${brl4(r.preco / r.kmL)}</td><td class="n">${brl4(r.cesta)}</td><td class="n"><b>${brl4(valorRac(r))}</b></td><td>${r.desde ? esc(fmtMes(r.desde)) : '—'}</td><td class="n">${admin() ? `<button class="btn sm" type="button" data-va="racedita" data-id="${esc(r.id)}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum racional cadastrado.</td></tr>'}</tbody></table></div>`;
}
function racForm(r0 = {}) {
  if (!admin()) return;
  const r = { nome: '', preco: 6.2, kmL: 10, cesta: 0.28, desde: '', obs: '', ...r0 }, novo = !r0.id;
  openModal(`<div class="dh"><h2>${novo ? 'Novo racional' : 'Editar racional'}</h2><button class="iconbtn" data-close aria-label="Fechar">${ICON.close}</button></div>
    <form id="racForm"><div class="db"><div class="fgrid">
      <label class="field"><span class="lbl">Nome</span><input type="text" name="nome" maxlength="60" value="${esc(r.nome)}" placeholder="Ex.: Carro 1.0 · novembro" required></label>
      <label class="field"><span class="lbl">Combustível (R$ por litro)</span><input type="text" name="preco" inputmode="decimal" value="${esc(nf4.format(r.preco))}" required><span class="hint">Preço médio pesquisado</span></label>
      <label class="field"><span class="lbl">KM por litro</span><input type="text" name="kmL" inputmode="decimal" value="${esc(nf1.format(r.kmL))}" required></label>
      <label class="field"><span class="lbl">Cesta de serviço (R$ por km)</span><input type="text" name="cesta" inputmode="decimal" value="${esc(nf4.format(r.cesta))}" required><span class="hint">Pedágio e manutenção</span></label>
      <label class="field"><span class="lbl">Vale desde (opcional)</span><input type="month" name="desde" value="${esc(r.desde || '')}"></label></div>
      <label class="field"><span class="lbl">Observação</span><input type="text" name="obs" maxlength="160" value="${esc(r.obs || '')}" placeholder="Fonte da pesquisa de preço, tipo de veículo…"></label>
      <div class="vb-form" id="racPrev"></div></div>
    <div class="df">${novo ? '' : '<button class="btn danger" type="button" id="racDel">Excluir</button>'}<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, 'sm');
  const f = $('#racForm'), le = () => ({ preco: numBR(f.preco.value), kmL: numBR(f.kmL.value), cesta: numBR(f.cesta.value) });
  const prev = () => { const x = le(); $('#racPrev').innerHTML = isNum(x.preco) && x.kmL > 0 && isNum(x.cesta) ? formulaRac(x) + ` · 50 km por dia em 2 dias no mês = ${brl(50 * valorRac(x) * 2)}` : 'Preencha os valores'; };
  f.oninput = prev; prev();
  f.onsubmit = ev => {
    ev.preventDefault(); const x = le();
    if (!isNum(x.preco) || x.preco <= 0 || !(x.kmL > 0) || !isNum(x.cesta) || x.cesta < 0) { toast('Confira os valores'); return; }
    const id = r.id || uid('vr'), rec = { id, tipo: 'racional', nome: f.nome.value.trim(), ...x, desde: f.desde.value || '', obs: f.obs.value.trim(), em: Date.now() };
    VS.store.put(id, rec); R.audita('verba', `${novo ? 'Criou' : 'Alterou'} o racional ${rec.nome}: ${brl4(valorRac(rec))}/km`);
    if (!VS.rac) VS.rac = id; closeModal(); render(); toast('Racional salvo');
  };
  const del = $('#racDel'); if (del) del.onclick = () => R.armButton(del, () => { VS.store.del(r.id); R.audita('verba', `Excluiu o racional ${r.nome}`); closeModal(); render(); }, 'Confirmar exclusão');
}

/* ---------- Exportação ---------- */
function exportaCalc(c, v) {
  const cc = filtraVend(c, v);
  const resumo = cc.linhas.map(o => ({ Vendedor: o.nome, Codigo: o.v, 'Rotas por ciclo': o.rotas.size, 'Dias calculados': o.diasN, 'KM no mes': +o.km.toFixed(1), 'Racional R$/km': +c.vk.toFixed(4), Verba: o.verba, Reembolso: cent(o.reemb), Desconto: cent(o.desc), Total: o.liq }));
  const extrato = cc.linhas.flatMap(o => o.itens.map(i => ({ Vendedor: o.nome, Codigo: o.v, Data: Cal.fmtData(i.iso), Dia: DIA_L[i.d], Semana: 'S' + Cal.semana(i.iso), Quinzena: Cal.quinzena(Cal.semana(i.iso)), KM: +i.km.toFixed(1), Verba: cent(i.valor) })));
  const lan = cc.linhas.flatMap(o => o.lancs.map(l => ({ Vendedor: o.nome, Codigo: o.v, Tipo: l.natureza, Data: l.data ? Cal.fmtData(l.data) : '', Motivo: l.motivo, Referencia: l.ref || '', Valor: l.natureza === 'reembolso' ? l.valor : -l.valor })));
  saveFile(`verba_${slug(fmtMes(c.ym))}${v ? '_' + slug(v) : ''}_${dstamp()}.xlsx`, xlsxBlob([['Resumo', resumo], ['Extrato de KM', extrato], ['Reembolsos e descontos', lan], ['Racional', [{ Racional: c.rac.nome, 'Combustivel R$/L': c.rac.preco, 'KM por litro': c.rac.kmL, 'Cesta R$/km': c.rac.cesta, 'Racional R$/km': +c.vk.toFixed(4), 'Rotas de': Rot.nomeFonte(c.b.id), Mes: fmtMes(c.ym), 'Dias uteis': c.res.uteis }]]]));
  R.audita('exportacao', `Verba de ${fmtMes(c.ym)}${v ? ' · ' + v : ''}`);
}

/* ---------- Importação de reembolsos e descontos (pelo assistente do app) ---------- */
function opcoesImport(wz) {
  if (!wz.vb) wz.vb = { natureza: wz.natPadrao || 'reembolso', mes: VS.mes };
  return `<div class="fgrid"><label class="field"><span class="lbl">Tipo, quando a planilha não tiver a coluna</span><select id="vbNat"><option value="reembolso"${wz.vb.natureza === 'reembolso' ? ' selected' : ''}>Reembolso</option><option value="desconto"${wz.vb.natureza === 'desconto' ? ' selected' : ''}>Desconto</option></select></label>
    <label class="field"><span class="lbl">Mês, quando a planilha não tiver Mês nem Data</span><input type="month" id="vbMes" value="${esc(wz.vb.mes)}"></label></div>`;
}
function ligaOpcoesImport(wz) { const n = $('#vbNat'), m = $('#vbMes'); if (n) n.onchange = () => { wz.vb.natureza = n.value; }; if (m) m.onchange = () => { wz.vb.mes = m.value || VS.mes; }; }
const parseDataBR = v => { if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); } const s = String(v || '').trim(); let m; if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s))) return `${+m[3] < 100 ? 2000 + +m[3] : m[3]}-${pad2(m[2])}-${pad2(m[1])}`; if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[0]; return ''; };
const parseMes = v => { const d = parseDataBR(v); if (d) return d.slice(0, 7); const s = String(v || '').trim(); let m; if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) return `${m[2]}-${pad2(m[1])}`; if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) return `${m[1]}-${pad2(m[2])}`; return ''; };
async function importar(wz, cellOf) {
  if (!admin()) { toast('Só o administrador inclui reembolsos e descontos'); return null; }
  await iniciar();
  let n = 0, ign = 0, nR = 0, nD = 0, soma = 0;
  for (const row of wz.rows) {
    const c = cellOf(row), vend = String(c('vend') ?? '').trim(), valor = numBR(c('valor'));
    if (!vend || !isNum(valor) || valor === 0) { ign++; continue; }
    const t = R.norm(c('tipo')), natureza = /desc|debit|abat/.test(t) ? 'desconto' : /reemb|credit|ressarc/.test(t) ? 'reembolso' : valor < 0 ? 'desconto' : wz.vb.natureza;
    const data = parseDataBR(c('data')), mes = parseMes(c('mes')) || (data ? data.slice(0, 7) : '') || wz.vb.mes;
    const id = uid('vl');
    VS.store.put(id, { id, tipo: 'lanc', natureza, vend, vendNome: Rot.nomeVend(vend), mes, data, valor: cent(Math.abs(valor)), motivo: String(c('motivo') ?? '').trim().slice(0, 120) || (natureza === 'reembolso' ? 'Reembolso' : 'Desconto'), ref: String(c('ref') ?? '').trim().slice(0, 160), anexos: [], usuario: (st.usuario && st.usuario.nome) || '', em: Date.now(), importado: wz.arquivo || '' });
    n++; soma += Math.abs(valor); if (natureza === 'reembolso') nR++; else nD++;
  }
  const lines = [['info', `${nf0.format(n)} lançamento(s) importados: ${nR} reembolso(s) e ${nD} desconto(s), somando ${brl(soma)}.`]];
  if (ign) lines.push(['', `${nf0.format(ign)} linha(s) ignoradas por falta de vendedor ou valor.`]);
  if (st.verbaSemTabela) lines.push(['bad', 'O banco ainda não tem as tabelas da Verba: os lançamentos valem só nesta sessão. Rode <b>supabase/migracao_06_calendario_verba.sql</b>.']);
  R.audita('verba', `Importou ${n} lançamento(s) de ${wz.arquivo || 'planilha'}`);
  VS.aba = nD > nR ? 'desc' : 'reemb';
  return { lines, reg: { linhas: wz.rows.length, alteracoes: n, novos: n, ignorados: ign } };
}

/* ---------- Página ---------- */
let renderSeq = 0;
async function render(el = $('#homeView')) {
  if (!el || st.screen !== 'home' || st.homeSec !== 'verba') return;
  const seq = ++renderSeq; liga(el);
  if (!VS.store) { el.innerHTML = `<div class="page home">${R.migalha('Verba Indenizatória')}<p class="muted">Carregando…</p></div>`; await Promise.all([iniciar(), Rot.iniciar(), Cal.iniciar()]); if (seq !== renderSeq) return; }
  padroes();
  const keep = el.scrollTop;
  const ABAS = [['calc', 'Cálculo'], ['ext', 'Extrato'], ['reemb', 'Reembolsos'], ['desc', 'Descontos'], ['hist', 'Histórico'], ['cmp', 'Comparativo'], ['rac', 'Racionais']];
  const topo = `${R.migalha('Verba Indenizatória')}<div class="ph"><div><h1>Verba Indenizatória</h1><p>KM das rotas × racional × dias de rota no mês, com reembolsos, descontos, extrato por vendedor e histórico.</p></div></div>
    ${st.verbaSemTabela ? '<div class="banner bad">O banco ainda não tem as tabelas da Verba e do Calendário: o que for salvo vale só nesta sessão. Rode <b>supabase/migracao_06_calendario_verba.sql</b> no Supabase.</div>' : ''}
    ${admin() ? '' : '<div class="banner info">Somente leitura: só o administrador do ambiente altera racionais, lançamentos e apurações.</div>'}
    <nav class="rt-abas seg" aria-label="Visões">${ABAS.map(([k, t]) => `<button type="button" data-vaba="${k}" aria-pressed="${VS.aba === k}">${t}</button>`).join('')}</nav>`;
  let corpo = '';
  const precisa = VS.aba === 'calc' || VS.aba === 'ext' || VS.aba === 'cmp';
  if (precisa && vazio()) corpo = vazio();
  else if (VS.aba === 'calc' || VS.aba === 'ext') {
    el.innerHTML = `<div class="page home verba">${topo}<p class="muted">Calculando…</p></div>`;
    const c = await calcular(VS.fonte, VS.mes, VS.rac); if (seq !== renderSeq) return;
    VS.ult = c;
    corpo = !c ? '<div class="card"><div class="cb muted">Não foi possível calcular com estas escolhas.</div></div>' : VS.aba === 'calc' ? abaCalc(c) : abaExtrato(c);
  } else if (VS.aba === 'cmp') {
    el.innerHTML = `<div class="page home verba">${topo}<p class="muted">Calculando os dois lados…</p></div>`;
    const [A, B] = await Promise.all([calcular(VS.cmp.a.fonte, VS.mes, VS.cmp.a.rac), calcular(VS.cmp.b.fonte, VS.mes, VS.cmp.b.rac)]); if (seq !== renderSeq) return;
    corpo = abaCmp(A, B);
  }
  else if (VS.aba === 'reemb') corpo = abaLanc('reembolso');
  else if (VS.aba === 'desc') corpo = abaLanc('desconto');
  else if (VS.aba === 'hist') corpo = abaHist();
  else corpo = abaRac();
  el.innerHTML = `<div class="page home verba">${topo}${corpo}</div>`;
  el.scrollTop = keep;
}

function liga(el) {
  if (VS.ligado) return; VS.ligado = true;
  const ativo = () => st.screen === 'home' && st.homeSec === 'verba';
  const acao = (t, e) => {
    const ds = t.dataset, a = ds.va;
    if (ds.vaba) { VS.aba = ds.vaba; render(); return; }
    if (a === 'extrato') { VS.ext = ds.v; VS.aba = 'ext'; render(); $('#homeView').scrollTop = 0; }
    else if (a === 'xls' && VS.ult) exportaCalc(VS.ult, VS.vend);
    else if (a === 'xlsext' && VS.ult) exportaCalc(VS.ult, VS.ext);
    else if (a === 'imprimir') { document.body.classList.add('imprime-extrato'); setTimeout(() => { window.print(); document.body.classList.remove('imprime-extrato'); }, 50); }
    else if (a === 'salvar' && VS.ult) salvarApuracao(VS.ult, t);
    else if (a === 'lnovo') lancForm({}, ds.nat);
    else if (a === 'ledita') lancForm(VS.store.get(ds.id));
    else if (a === 'anexo') verAnexo(ds.id, +ds.i);
    else if (a === 'limport') R.openImport('lancamentos', { natPadrao: ds.nat });
    else if (a === 'lmodelo') R.downloadModelo('lancamentos');
    else if (a === 'racnovo') racForm();
    else if (a === 'racedita') racForm(VS.store.get(ds.id));
    else if (a === 'apver') verApuracao(ds.id);
    else if (a === 'apdel') R.armButton(t, () => { const x = VS.store.get(ds.id); VS.store.del(ds.id); R.audita('verba', `Excluiu a apuração de ${x ? fmtMes(x.mes) : ''}`); render(); }, 'Confirmar exclusão');
    else if (a === 'apxls') { const x = VS.store.get(ds.id); if (x) { saveFile(`verba_apuracao_${slug(fmtMes(x.mes))}.xlsx`, xlsxBlob([['Apuracao', x.linhas.map(o => ({ Vendedor: o.nome, Codigo: o.v, Dias: o.dias, KM: o.km, Verba: o.verba, Reembolso: o.reemb, Desconto: o.desc, Total: o.liq }))], ['Extrato de KM', x.linhas.flatMap(o => (o.itens || []).map(([iso, km]) => ({ Vendedor: o.nome, Data: Cal.fmtData(iso), KM: km, Verba: cent(km * x.rac.valor) })))]])); R.audita('exportacao', `Apuração da verba de ${fmtMes(x.mes)}`); } }
    else if (a === 'cmptroca') { const x = VS.cmp.a; VS.cmp.a = VS.cmp.b; VS.cmp.b = x; render(); }
    else if (a === 'mesmokm') { VS.cmp.b.fonte = VS.cmp.a.fonte; const outro = racionais().find(r => r.id !== VS.cmp.a.rac); if (outro) VS.cmp.b.rac = outro.id; else toast('Cadastre outro racional para comparar'); render(); }
    else if (a === 'mesmorac') { VS.cmp.b.rac = VS.cmp.a.rac; const outra = Rot.fontesLista().find(f => f.id !== VS.cmp.a.fonte); if (outra) VS.cmp.b.fonte = outra.id; render(); }
  };
  el.addEventListener('click', e => { if (!ativo()) return; const t = e.target.closest('[data-va],[data-vaba]'); if (t && !t.disabled) acao(t, e); });
  $('#modal').addEventListener('click', e => { if (!ativo()) return; const t = e.target.closest('[data-va]'); if (t) acao(t, e); });
  el.addEventListener('change', e => {
    if (!ativo()) return; const t = e.target, ds = t.dataset;
    if (ds.vf) { VS[ds.vf] = t.value || (ds.vf === 'mes' ? mesAtual() : ''); render(); }
    else if (ds.vl) { VS.lf[ds.vl] = t.type === 'checkbox' ? t.checked : t.value; render(); }
    else if (ds.vc) { const [k, campo] = ds.vc.split('.'); VS.cmp[k][campo] = t.value; render(); }
  });
}

function resumoHub() {
  if (!VS.store) return null;
  const r = racionais().find(x => x.id === VS.rac) || racionais()[0], ap = apuracoes()[0];
  return { racional: r ? brl4(valorRac(r)) + '/km' : '—', ultimo: ap ? `${fmtMes(ap.mes)} · ${brl(ap.tot.liq)}` : '—', lanc: lancs().filter(l => l.mes === mesAtual()).length };
}

window.VerbaMod = { iniciar, render, resumoHub, opcoesImport, ligaOpcoesImport, importar, calcular, valorRac };
})();
