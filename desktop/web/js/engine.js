/* Motor de roteirização — funções puras (sem DOM). Exposto como globalThis.Engine */
(function (G) {
  'use strict';
  const RAD = Math.PI / 180;
  const R_TERRA = 6371.0088;

  function hav(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Projeção equirretangular local em km (boa para escala de cidade/região)
  function projector(pts) {
    let lat0 = 0; for (const p of pts) lat0 += p.lat; lat0 = pts.length ? lat0 / pts.length : 0;
    const kx = 111.32 * Math.cos(lat0 * RAD), ky = 110.574;
    return p => ({ x: p.lng * kx, y: p.lat * ky });
  }

  /* K-means com capacidade (equilíbrio por peso). pts: [{lat,lng,w}] → rótulos 0..k-1 */
  function balancedKMeans(pts, k, opts = {}) {
    const n = pts.length;
    if (n === 0) return [];
    k = Math.max(1, Math.min(k, n));
    if (k === 1) return new Array(n).fill(0);
    const P = projector(pts);
    const xy = pts.map(P);
    const w = pts.map(p => (p.w > 0 ? p.w : 1));
    const W = w.reduce((a, b) => a + b, 0);
    const r = rng(opts.seed || 7);
    // k-means++
    const C = [];
    C.push({ ...xy[Math.floor(r() * n)] });
    const d2 = new Float64Array(n).fill(Infinity);
    while (C.length < k) {
      const c = C[C.length - 1];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const dd = (xy[i].x - c.x) ** 2 + (xy[i].y - c.y) ** 2;
        if (dd < d2[i]) d2[i] = dd;
        sum += d2[i] * w[i];
      }
      let t = r() * sum, pick = n - 1;
      for (let i = 0; i < n; i++) { t -= d2[i] * w[i]; if (t <= 0) { pick = i; break; } }
      C.push({ ...xy[pick] });
    }
    const tol = opts.tol ?? 0.07;
    const iters = opts.iters ?? 16;
    let lab = new Int32Array(n);
    const dist = new Float64Array(n * k);
    for (let it = 0; it < iters; it++) {
      const cap = (W / k) * (1 + tol);
      const load = new Float64Array(k);
      const regret = new Float64Array(n);
      const order = new Array(n);
      for (let i = 0; i < n; i++) {
        let b1 = Infinity, b2 = Infinity;
        for (let j = 0; j < k; j++) {
          const dd = Math.hypot(xy[i].x - C[j].x, xy[i].y - C[j].y);
          dist[i * k + j] = dd;
          if (dd < b1) { b2 = b1; b1 = dd; } else if (dd < b2) b2 = dd;
        }
        regret[i] = b2 - b1; order[i] = i;
      }
      order.sort((a, b) => regret[b] - regret[a]);
      const js = [...Array(k).keys()];
      for (const i of order) {
        js.sort((a, b) => dist[i * k + a] - dist[i * k + b]);
        let chosen = -1;
        for (const j of js) { if (load[j] + w[i] <= cap) { chosen = j; break; } }
        if (chosen < 0) { // todos cheios: o de menor carga relativa entre os 3 mais próximos
          chosen = js.slice(0, 3).reduce((a, b) => (load[a] <= load[b] ? a : b));
        }
        lab[i] = chosen; load[chosen] += w[i];
      }
      let moved = 0;
      for (let j = 0; j < k; j++) {
        let sx = 0, sy = 0, sw = 0;
        for (let i = 0; i < n; i++) if (lab[i] === j) { sx += xy[i].x * w[i]; sy += xy[i].y * w[i]; sw += w[i]; }
        if (sw > 0) { const nx = sx / sw, ny = sy / sw; moved += Math.hypot(nx - C[j].x, ny - C[j].y); C[j].x = nx; C[j].y = ny; }
      }
      if (moved < 0.01 && it > 3) break;
    }
    return Array.from(lab);
  }

  /* Sequência: vizinho mais próximo + 2-opt. base opcional (rota fechada ida/volta). Retorna índices de pts. */
  function sequence(base, pts) {
    const n = pts.length;
    if (n <= 1) return [...Array(n).keys()];
    const nodes = base ? [base, ...pts] : pts.slice();
    const P = projector(nodes);
    const xy = nodes.map(P);
    const m = nodes.length;
    const D = (a, b) => Math.hypot(xy[a].x - xy[b].x, xy[a].y - xy[b].y);
    // NN
    const used = new Uint8Array(m);
    let start = 0;
    if (!base) { // começa no ponto mais a oeste para rota aberta
      for (let i = 1; i < m; i++) if (xy[i].x < xy[start].x) start = i;
    }
    const t = [start]; used[start] = 1;
    while (t.length < m) {
      const last = t[t.length - 1]; let best = -1, bd = Infinity;
      for (let i = 0; i < m; i++) if (!used[i]) { const d = D(last, i); if (d < bd) { bd = d; best = i; } }
      t.push(best); used[best] = 1;
    }
    // 2-opt
    const closed = !!base;
    let improved = true, passes = 0;
    while (improved && passes < 60) {
      improved = false; passes++;
      const lim = closed ? m : m - 1;
      for (let i = 0; i < m - 2; i++) {
        for (let j = i + 2; j < lim; j++) {
          if (closed && i === 0 && j === m - 1) continue;
          const a = t[i], b = t[i + 1], c = t[j], d = closed ? t[(j + 1) % m] : t[j + 1];
          if (d === undefined) continue;
          const delta = D(a, c) + D(b, d) - D(a, b) - D(c, d);
          if (delta < -1e-9) {
            let x = i + 1, y = j;
            while (x < y) { const tmp = t[x]; t[x] = t[y]; t[y] = tmp; x++; y--; }
            improved = true;
          }
        }
      }
    }
    if (closed) {
      const z = t.indexOf(0);
      const rot = t.slice(z).concat(t.slice(0, z));
      return rot.slice(1).map(i => i - 1);
    }
    return t;
  }

  /* Métricas de uma rota. base pode ser null. pts com {lat,lng,t(min)} na ordem. */
  function routeMetrics(base, pts, p) {
    const fator = p.fator || 1.3, vel = p.vel || 25, jornada = p.jornada || 480;
    let kmIda = 0, kmEntre = 0, kmVolta = 0, tAtend = 0;
    for (let i = 0; i < pts.length; i++) {
      tAtend += pts[i].t || 0;
      if (i > 0) kmEntre += hav(pts[i - 1], pts[i]) * fator;
    }
    if (base && pts.length) {
      kmIda = hav(base, pts[0]) * fator;
      kmVolta = hav(pts[pts.length - 1], base) * fator;
    }
    const km = kmIda + kmEntre + kmVolta;
    const tDesl = (km / vel) * 60;
    const total = tDesl + tAtend;
    return { n: pts.length, kmIda, kmEntre, kmVolta, km, tDesl, tAtend, total, ocup: jornada ? total / jornada : 0, jornada };
  }

  function weeksAll(W) { return [...Array(W).keys()].map(i => i + 1); }

  /* Distribui clientes de um setor em dias/semanas conforme frequência e sequencia cada dia.
     clients: [{sold,lat,lng,f,t}], base:{lat,lng}|null, p:{semanas,dias,...}
     → Map sold → {d:[...], w:[...], q:{dia:seq}} */
  function autoRoute(clients, base, p, opts = {}) {
    const D = (p.dias && p.dias.length ? p.dias : [1, 2, 3, 4, 5]).slice().sort((a, b) => a - b);
    const W = p.semanas || 4;
    const nd = D.length;
    const out = new Map();
    if (!clients.length) return out;
    const pts = clients.map(c => ({ lat: c.lat, lng: c.lng, w: ((c.t || p.tPadrao || 20) + 8) * Math.max(0.25, (c.f || 4) / 4) }));
    const lab = balancedKMeans(pts, nd, { seed: opts.seed || 11, tol: 0.05 });
    // ordena clusters por ângulo ao redor da base (varredura semanal)
    const ref = base || { lat: pts.reduce((a, b) => a + b.lat, 0) / pts.length, lng: pts.reduce((a, b) => a + b.lng, 0) / pts.length };
    const cent = [...Array(nd)].map(() => ({ lat: 0, lng: 0, n: 0 }));
    lab.forEach((j, i) => { cent[j].lat += pts[i].lat; cent[j].lng += pts[i].lng; cent[j].n++; });
    const ang = cent.map((c, j) => ({ j, a: c.n ? Math.atan2(c.lat / c.n - ref.lat, c.lng / c.n - ref.lng) : 99 }));
    ang.sort((x, y) => x.a - y.a);
    const dayIdxOfCluster = new Array(nd);
    ang.forEach((o, idx) => { dayIdxOfCluster[o.j] = idx; });
    // carga dia x semana
    const load = {}; D.forEach(d => { load[d] = new Float64Array(W + 1); });
    const order = clients.map((c, i) => i).sort((a, b) => (clients[b].t || 0) - (clients[a].t || 0));
    // primeiro os semanais (fixos), depois quinzenais, depois mensais
    order.sort((a, b) => (clients[b].f || 4) - (clients[a].f || 4));
    for (const i of order) {
      const c = clients[i];
      const f = c.f || 4;
      const di = dayIdxOfCluster[lab[i]];
      const kdays = f >= 8 ? Math.min(nd, Math.round(f / 4)) : 1;
      const days = [D[di]];
      for (let m = 1; m < kdays; m++) {
        const dd = D[(di + Math.round((m * nd) / kdays)) % nd];
        if (!days.includes(dd)) days.push(dd);
      }
      const wt = (c.t || p.tPadrao || 20) + 8;
      let weeks;
      if (W === 1 || f >= 4) weeks = weeksAll(W);
      else if (f >= 2) {
        const pats = W === 4 ? [[1, 3], [2, 4]] : W === 2 ? [[1], [2]] : [[1]];
        weeks = pats.reduce((best, pat) => {
          const lb = best.reduce((s, w) => s + load[days[0]][w], 0), lp = pat.reduce((s, w) => s + load[days[0]][w], 0);
          return lp < lb ? pat : best;
        });
      } else {
        let bw = 1;
        for (let w = 2; w <= W; w++) if (load[days[0]][w] < load[days[0]][bw]) bw = w;
        weeks = [bw];
      }
      for (const d of days) for (const w of weeks) load[d][w] += wt;
      out.set(c.sold, { d: days.sort((a, b) => a - b), w: weeks, q: {} });
    }
    // sequência por dia (união das semanas)
    for (const d of D) {
      const idx = clients.map((c, i) => i).filter(i => out.get(clients[i].sold).d.includes(d));
      const seq = sequence(base, idx.map(i => clients[i]));
      seq.forEach((k, pos) => { out.get(clients[idx[k]].sold).q[d] = pos + 1; });
    }
    return out;
  }

  /* Setorização: devolve rótulos e centros */
  function sectorize(clients, k, opts = {}) {
    const pts = clients.map(c => ({ lat: c.lat, lng: c.lng, w: opts.by === 'qtd' ? 1 : ((c.t || 20) + 8) * Math.max(0.25, (c.f || 4) / 4) }));
    const lab = balancedKMeans(pts, k, { seed: opts.seed || 5, tol: opts.tol ?? 0.06 });
    const kk = Math.max(1, Math.min(k, clients.length));
    const cent = [...Array(kk)].map(() => ({ lat: 0, lng: 0, n: 0 }));
    lab.forEach((j, i) => { cent[j].lat += pts[i].lat; cent[j].lng += pts[i].lng; cent[j].n++; });
    cent.forEach(c => { if (c.n) { c.lat /= c.n; c.lng /= c.n; } });
    return { lab, cent };
  }

  /* Atribui colaboradores (com base) aos centros, gulosamente pelo par mais próximo */
  function assignNearest(centers, colabs) {
    const pairs = [];
    centers.forEach((c, i) => colabs.forEach((b, j) => { if (b && isFinite(b.lat)) pairs.push({ i, j, d: hav(c, b) }); }));
    pairs.sort((a, b) => a.d - b.d);
    const ci = new Set(), cj = new Set(), res = new Array(centers.length).fill(-1);
    for (const p of pairs) { if (ci.has(p.i) || cj.has(p.j)) continue; ci.add(p.i); cj.add(p.j); res[p.i] = p.j; }
    // colaboradores sem base: preenchem o que sobrou em ordem
    let free = colabs.map((_, j) => j).filter(j => !cj.has(j));
    res.forEach((v, i) => { if (v < 0 && free.length) res[i] = free.shift(); });
    return res;
  }

  /* Dados de exemplo (procedurais, marcados como "Exemplo") */
  function sample(seed = 42) {
    const r = rng(seed);
    const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const bairros = [
      ['Vila Mariana', -23.5891, -46.6349], ['Moema', -23.6009, -46.6627], ['Saúde', -23.6180, -46.6390],
      ['Ipiranga', -23.5869, -46.6100], ['Jabaquara', -23.6460, -46.6410], ['Campo Belo', -23.6230, -46.6680],
      ['Santo Amaro', -23.6520, -46.7100], ['Cursino', -23.6150, -46.6210], ['Sacomã', -23.6050, -46.5980],
      ['Brooklin', -23.6110, -46.6900]
    ];
    const tipos = ['Mercado', 'Padaria', 'Empório', 'Adega', 'Conveniência', 'Hortifruti', 'Açougue', 'Mercearia', 'Bar', 'Restaurante', 'Atacadinho', 'Minimercado'];
    const ruas = ['Rua', 'Av.', 'Rua', 'Rua', 'Alameda'];
    const nomesRua = ['das Palmeiras', 'Domingos de Morais', 'dos Jacarandás', 'Bom Pastor', 'Santa Cruz', 'Vergueiro', 'Jabaquara', 'Ibirapuera', 'Cupecê', 'Nazaré', 'Agostinho Gomes', 'Ministro Gabriel', 'Professor Abraão', 'do Cursino', 'Santo Amaro'];
    const freqs = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 1, 1, 8];
    const clientes = [];
    let cod = 700100;
    for (let i = 0; i < 180; i++) {
      const b = bairros[Math.floor(r() * bairros.length)];
      const lat = +(b[1] + gauss() * 0.0085).toFixed(6), lng = +(b[2] + gauss() * 0.0095).toFixed(6);
      cod += 1 + Math.floor(r() * 37);
      const tipo = tipos[Math.floor(r() * tipos.length)];
      clientes.push({
        sold: String(cod), nome: `Exemplo · ${tipo} ${b[0]} ${String(i + 1).padStart(3, '0')}`,
        endereco: `${ruas[Math.floor(r() * ruas.length)]} ${nomesRua[Math.floor(r() * nomesRua.length)]}, ${10 + Math.floor(r() * 2400)}`,
        bairro: b[0], cidade: 'São Paulo', uf: 'SP', lat, lng,
        f: freqs[Math.floor(r() * freqs.length)], t: 10 + 5 * Math.floor(r() * 7), exemplo: true
      });
    }
    const cores = ['#2F6FB3', '#C2512B', '#3E8E5C', '#8A4FB0'];
    const colabs = [
      { codigo: 'V101', nome: 'Exemplo · Vendedor 1', funcao: 'Vendedor', endereco: 'Base Vila Mariana', lat: -23.5950, lng: -46.6400, jornada: 480, cor: cores[0], exemplo: true },
      { codigo: 'V102', nome: 'Exemplo · Vendedor 2', funcao: 'Vendedor', endereco: 'Base Santo Amaro', lat: -23.6450, lng: -46.6950, jornada: 480, cor: cores[1], exemplo: true },
      { codigo: 'V103', nome: 'Exemplo · Vendedor 3', funcao: 'Vendedor', endereco: 'Base Ipiranga', lat: -23.5950, lng: -46.6050, jornada: 480, cor: cores[2], exemplo: true },
      { codigo: 'V104', nome: 'Exemplo · Vendedor 4', funcao: 'Vendedor', endereco: 'Base Jabaquara', lat: -23.6420, lng: -46.6420, jornada: 480, cor: cores[3], exemplo: true },
      { codigo: 'P201', nome: 'Exemplo · Promotor 1', funcao: 'Promotor', endereco: 'Base Moema', lat: -23.6030, lng: -46.6650, jornada: 440, cor: '#B0892F', exemplo: true }
    ];
    return { clientes, colabs };
  }

  /* Monta um estudo completo (setorização + roteirização) — usado pelo exemplo e pelo botão "automático" */
  function buildStudy(clientes, colabs, k, params, opts = {}) {
    const { lab, cent } = sectorize(clientes, k, { by: opts.by, seed: opts.seed });
    const map = assignNearest(cent, colabs);
    const PALETA = G.Engine.PALETA;
    const setores = {};
    const ids = cent.map((_, i) => 's' + (i + 1).toString(36) + (opts.seed || 1).toString(36));
    cent.forEach((c, i) => {
      const col = map[i] >= 0 ? colabs[map[i]] : null;
      setores[ids[i]] = { nome: `Setor ${String(i + 1).padStart(2, '0')}`, cor: PALETA[i % PALETA.length], colab: col ? col.codigo : '' };
    });
    const itens = new Map();
    cent.forEach((c, i) => {
      const cls = clientes.filter((_, x) => lab[x] === i);
      const col = map[i] >= 0 ? colabs[map[i]] : null;
      const base = col && isFinite(col.lat) ? { lat: col.lat, lng: col.lng } : null;
      const rt = autoRoute(cls, base, params, { seed: i + 3 });
      for (const cl of cls) { const v = rt.get(cl.sold); itens.set(cl.sold, { s: ids[i], d: v.d, w: v.w, q: v.q }); }
    });
    return { setores, itens };
  }

  /* Sequência sobre matriz de custo real (distância ou tempo por ruas). M[i][j]; com base, nó 0 = base (rota fechada).
     Vizinho mais próximo + 2-opt + Or-opt, recalculando o custo completo (funciona com matriz assimétrica, mão de direção). */
  function sequenceMatrix(M, closed) {
    const n = M.length; if (n <= 2) return [...Array(n).keys()];
    const cost = t => { let c = 0; for (let i = 1; i < t.length; i++) c += M[t[i - 1]][t[i]]; if (closed) c += M[t[t.length - 1]][t[0]]; return c; };
    const nn = start => { const used = new Uint8Array(n), t = [start]; used[start] = 1; while (t.length < n) { const l = t[t.length - 1]; let b = -1, bd = Infinity; for (let i = 0; i < n; i++) if (!used[i] && M[l][i] < bd) { bd = M[l][i]; b = i; } t.push(b); used[b] = 1; } return t; };
    let t = nn(0);
    if (!closed) for (let s = 1; s < n; s++) { const x = nn(s); if (cost(x) < cost(t)) t = x; }
    let c = cost(t), imp = true, pass = 0; const lo = closed ? 1 : 0;
    while (imp && pass < 40) {
      imp = false; pass++;
      for (let i = lo; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const x = t.slice(0, i).concat(t.slice(i, j + 1).reverse(), t.slice(j + 1)); const xc = cost(x);
        if (xc < c - 1e-6) { t = x; c = xc; imp = true; }
      }
      for (let L = 1; L <= 3; L++) for (let i = lo; i + L <= n; i++) {
        const seg = t.slice(i, i + L), rest = t.slice(0, i).concat(t.slice(i + L));
        for (let k = lo; k <= rest.length; k++) {
          if (k === i) continue;
          const x = rest.slice(0, k).concat(seg, rest.slice(k)); const xc = cost(x);
          if (xc < c - 1e-6) { t = x; c = xc; imp = true; break; }
        }
      }
    }
    return t;
  }

  const PALETA = ['#2F6FB3', '#C2512B', '#3E8E5C', '#8A4FB0', '#B0892F', '#1F8A8A', '#C23C6E', '#5B6B2E', '#6A5ACD', '#D07A1E', '#2E7D9A', '#9C4A3A', '#4F8F2F', '#A0529C', '#3B5998', '#7A6A3A'];

  G.Engine = { hav, rng, balancedKMeans, sequence, sequenceMatrix, routeMetrics, autoRoute, sectorize, assignNearest, sample, buildStudy, PALETA };
})(typeof globalThis !== 'undefined' ? globalThis : window);
