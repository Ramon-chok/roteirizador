/* Route VORTEX · segurança no navegador (window.RVXSeg)
   - Criptografia: AES-256-GCM para os campos sensíveis e para o backup protegido por senha (chave PBKDF2-SHA256).
   - Higienização: textos sem caracteres de controle nem marcas de direção, cores e imagens validadas, JSON sem __proto__.
   - Freio contra tentativas: espera progressiva e bloqueio por conta e por navegador.
   - CAPTCHA (Cloudflare Turnstile ou hCaptcha), verificação de senha vazada (k-anonimato) e comparação em tempo constante.
   Usado por js/app.js e pelos módulos. Não depende de biblioteca externa: só a Web Crypto do navegador. */
(function () {
'use strict';
const CFG = (window.RT_CONFIG || {}).seguranca || {};
const enc = new TextEncoder(), dec = new TextDecoder();
const temCripto = () => !!(window.crypto && crypto.subtle);

/* ================= Codificação ================= */
const b64 = {
  para(b) { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  de(s) { const t = atob(String(s)); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
};
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const aleatorio = n => crypto.getRandomValues(new Uint8Array(n));
async function sha256(txt) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(txt)))); }

// Comparação que leva o mesmo tempo acerte ou erre (não revela quantos caracteres batem)
function iguais(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let d = a.length ^ b.length;
  for (let i = 0, n = Math.max(a.length, b.length); i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/* ================= Higienização de entradas ================= */
// Caracteres de controle (menos tab e quebra de linha) e marcas invisíveis de direção do texto, usadas para disfarçar conteúdo
const RE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const PERIGO = new Set(['__proto__', 'constructor', 'prototype']);
// Texto digitado ou importado: normalizado, sem controles; numa linha só (a não ser multilinha) e com tamanho máximo
function texto(v, max = 0, multilinha = false) {
  if (v === null || v === undefined) return v;
  let s = typeof v === 'string' ? v : String(v);
  try { s = s.normalize('NFC'); } catch (e) { /* navegador antigo */ }
  s = s.replace(RE_CONTROLE, '');
  if (!multilinha) s = s.replace(/[\r\n\t]+/g, ' ');
  if (max > 0 && s.length > max) s = s.slice(0, max);
  return s;
}
// Cor que vai para o estilo da página: só #RGB, #RRGGBB ou #RRGGBBAA (bloqueia CSS injetado, como url(...))
const RE_COR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const cor = (c, padrao = '#7d8a84') => (typeof c === 'string' && RE_COR.test(c.trim()) ? c.trim() : padrao);
// Imagem embutida (anexos da Verba): só PNG, JPEG, WebP ou GIF em base64. Nada de endereço externo nem SVG com script
const RE_IMG = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]*$/;
const imagemOk = u => typeof u === 'string' && u.length < 8e6 && RE_IMG.test(u);
const urlHttp = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch (e) { return ''; } };

// Limpa um objeto inteiro (itens carregados do banco, backup restaurado): chaves perigosas, textos, cores e imagens.
// Altera no lugar e devolve o próprio objeto.
function higienizar(o, prof = 0) {
  if (o === null || typeof o !== 'object' || prof > 14) return o;
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) o[i] = valor(o[i], '', prof); return o; }
  for (const k of Object.keys(o)) {
    if (PERIGO.has(k)) { delete o[k]; continue; }
    o[k] = valor(o[k], k, prof);
  }
  return o;
}
function valor(v, k, prof) {
  if (typeof v === 'string') {
    if (k === 'cor') return cor(v);
    if (k === 'url' && (/^\s*(javascript|vbscript|data):/i.test(v) && !imagemOk(v))) return '';
    if (v.length > 2e5) return v; // imagens e traçados longos: só o essencial
    RE_CONTROLE.lastIndex = 0;
    return RE_CONTROLE.test(v) ? v.replace(RE_CONTROLE, '') : v;
  }
  if (v && typeof v === 'object') return higienizar(v, prof + 1);
  return v;
}
// JSON vindo de fora (arquivo de backup): descarta __proto__, constructor e prototype antes de qualquer uso
function json(txt) { return JSON.parse(txt, (k, v) => (PERIGO.has(k) ? undefined : v)); }

/* ================= AES-256-GCM ================= */
// Formato dos campos cifrados: "rvx1." + base64(iv de 12 bytes + texto cifrado + etiqueta de 16 bytes).
// O "aad" (dados associados) amarra o valor ao ambiente, tabela, registro e campo: copiado para outro lugar, não abre.
const PREFIXO = 'rvx1.';
const cifrado = s => typeof s === 'string' && s.startsWith(PREFIXO);
async function importarChave(base64) {
  const raw = b64.de(base64); if (raw.length !== 32) throw new Error('chave inválida');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function cifrar(chave, txt, aad = '') {
  if (txt === null || txt === undefined || cifrado(txt)) return txt;
  const iv = aleatorio(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 }, chave, enc.encode(String(txt))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return PREFIXO + b64.para(out);
}
async function decifrar(chave, s, aad = '') {
  if (!cifrado(s)) return s;
  const raw = b64.de(s.slice(PREFIXO.length));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: enc.encode(aad), tagLength: 128 }, chave, raw.subarray(12));
  return dec.decode(pt);
}

/* ================= Cofre protegido por senha (backup) ================= */
const ITER_COFRE = 600000; // recomendação OWASP para PBKDF2-SHA256
async function chaveDeSenha(senha, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function selar(obj, senha, extra = {}) {
  const salt = aleatorio(16), iv = aleatorio(12), chave = await chaveDeSenha(senha, salt, ITER_COFRE);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('rvx-cofre-1') }, chave, enc.encode(JSON.stringify(obj)));
  return { ...extra, formato: 'rvx-cofre', v: 1, cifra: 'AES-256-GCM', kdf: { alg: 'PBKDF2-SHA256', iter: ITER_COFRE, salt: b64.para(salt) }, iv: b64.para(iv), dados: b64.para(ct) };
}
async function abrir(env, senha) {
  if (!env || env.formato !== 'rvx-cofre' || env.v !== 1) throw new Error('arquivo protegido em formato desconhecido');
  const iter = Math.min(5e6, Math.max(1e5, +env.kdf.iter || ITER_COFRE));
  const chave = await chaveDeSenha(senha, b64.de(env.kdf.salt), iter);
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.de(env.iv), additionalData: enc.encode('rvx-cofre-1') }, chave, b64.de(env.dados)); }
  catch (e) { throw new Error('Senha incorreta ou arquivo alterado.'); }
  return json(dec.decode(pt));
}

/* ================= Senha vazada (Have I Been Pwned, k-anonimato) =================
   Só os 5 primeiros caracteres do hash SHA-1 saem do computador; a senha e o hash completo, nunca.
   Devolve quantas vezes a senha apareceu em vazamentos, 0 se nenhuma, ou -1 se não deu para conferir. */
async function vazamentos(senha) {
  if (CFG.verificarSenhaVazada === false || !temCripto()) return -1;
  try {
    const h = hex(await crypto.subtle.digest('SHA-1', enc.encode(String(senha)))).toUpperCase();
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { headers: { 'Add-Padding': 'true' }, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    clearTimeout(t); if (!r.ok) return -1;
    const fim = h.slice(5);
    for (const linha of (await r.text()).split('\n')) { const [suf, n] = linha.trim().split(':'); if (suf === fim) return +n || 0; }
    return 0;
  } catch (e) { return -1; }
}

/* ================= Freio contra tentativas (neste navegador) =================
   Por conta: a partir da 3ª tentativa errada seguida, espera progressiva (1 s, 2 s, 4 s… até 30 s); na N-ésima
   (seguranca.tentativas), bloqueio de seguranca.bloqueioMin minutos, que dobra a cada novo bloqueio (até 24 h).
   Por navegador: mais de 20 tentativas erradas em 15 minutos, somando todas as contas, bloqueiam o login por 15 minutos
   (dificulta testar muitas contas a partir do mesmo computador). O servidor tem o próprio bloqueio (migração 08). */
const Freio = {
  N: () => Math.max(3, +CFG.tentativas || 5),
  MIN: () => Math.max(1, +CFG.bloqueioMin || 5),
  chave: k => 'rt1:freio:' + String(k).toLowerCase(),
  ler(k) { try { return JSON.parse(localStorage.getItem(this.chave(k)) || 'null') || { n: 0, vez: 0 }; } catch (e) { return { n: 0, vez: 0 }; } },
  gravar(k, v) { try { localStorage.setItem(this.chave(k), JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  // Até quando a conta k está bloqueada ou em espera (0 = livre)
  ate(k) {
    const agora = Date.now(), v = this.ler(k), g = this.ler('*');
    let fim = Math.max(v.ate || 0, g.ate || 0);
    if (v.n >= 3 && v.ult) fim = Math.max(fim, v.ult + Math.min(30000, 1000 * 2 ** (v.n - 3)));
    return fim > agora ? fim : 0;
  },
  falhou(k) {
    const agora = Date.now(), v = this.ler(k);
    v.n = (v.n || 0) + 1; v.ult = agora; v.total = (v.total || 0) + 1;
    if (v.n >= this.N()) { v.vez = (v.vez || 0) + 1; v.ate = agora + Math.min(864e5, this.MIN() * 60000 * 2 ** (v.vez - 1)); v.n = 0; }
    this.gravar(k, v);
    const g = this.ler('*'); g.lista = (g.lista || []).filter(t => agora - t < 15 * 60000); g.lista.push(agora);
    if (g.lista.length > 20) { g.ate = agora + 15 * 60000; g.lista = []; }
    this.gravar('*', g);
    return this.ate(k);
  },
  // Acerto: zera a conta e devolve quantas tentativas erradas houve desde o último acesso
  ok(k) { const v = this.ler(k); try { localStorage.removeItem(this.chave(k)); } catch (e) { /* ignora */ } return v.total || 0; },
  liberar(k) { try { localStorage.removeItem(this.chave(k)); } catch (e) { /* ignora */ } },
  // Contas com tentativas registradas neste navegador (prefixo do ambiente)
  lista(pre) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const c = localStorage.key(i); if (c && c.startsWith('rt1:freio:' + pre)) { const v = JSON.parse(localStorage.getItem(c) || '{}'); out.push({ conta: c.slice(('rt1:freio:' + pre).length), ...v }); } } } catch (e) { /* ignora */ }
    return out;
  }
};

/* ================= CAPTCHA (opcional) =================
   RT_CONFIG.seguranca.captcha = { provedor: 'turnstile' | 'hcaptcha', siteKey: '...' }. Ligue o mesmo provedor no Supabase em
   Authentication → Attack Protection: o servidor passa a recusar login, cadastro e redefinição de senha sem o desafio resolvido. */
const CAP = Object.assign({ provedor: '', siteKey: '' }, CFG.captcha || {});
const CAP_SRC = { turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off' };
let capLib = null;
const widgets = new WeakMap();
const captcha = {
  ativo: () => !!(CAP.siteKey && CAP_SRC[CAP.provedor]),
  carregar() {
    const g = () => (CAP.provedor === 'turnstile' ? window.turnstile : window.hcaptcha);
    if (g()) return Promise.resolve(g());
    if (!capLib) capLib = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = CAP_SRC[CAP.provedor]; sc.async = true; sc.crossOrigin = 'anonymous';
      sc.onload = () => { const t0 = Date.now(); (function espera() { if (g()) res(g()); else if (Date.now() - t0 > 8000) rej(new Error('CAPTCHA indisponível')); else setTimeout(espera, 50); })(); };
      sc.onerror = () => { capLib = null; rej(new Error('CAPTCHA indisponível: verifique a internet')); };
      document.head.append(sc);
    });
    return capLib;
  },
  async montar(el) {
    if (!this.ativo() || !el) return;
    const lib = await this.carregar();
    const tema = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const id = lib.render(el, { sitekey: CAP.siteKey, theme: tema, language: 'pt-BR', hl: 'pt-BR', size: 'flexible' });
    widgets.set(el, id);
  },
  token(el) {
    if (!this.ativo()) return undefined;
    const lib = CAP.provedor === 'turnstile' ? window.turnstile : window.hcaptcha, id = el && widgets.get(el);
    if (!lib || id === undefined) return '';
    try { return lib.getResponse(id) || ''; } catch (e) { return ''; }
  },
  reiniciar(el) {
    const lib = CAP.provedor === 'turnstile' ? window.turnstile : window.hcaptcha, id = el && widgets.get(el);
    if (lib && id !== undefined) { try { lib.reset(id); } catch (e) { /* ignora */ } }
  }
};

window.RVXSeg = Object.freeze({ temCripto, b64, hex, sha256, iguais, texto, cor, imagemOk, urlHttp, higienizar, json, PREFIXO, cifrado, importarChave, cifrar, decifrar, selar, abrir, ITER_COFRE, vazamentos, Freio, captcha });
})();
