/* Acesso, contas e segurança (LGPD). Porta fiel da versão anterior: mesmas chaves, mesmas tabelas, mesmos hashes.
   Sem Supabase, as contas ficam no navegador (senhas só como hash PBKDF2). Com Supabase, o Supabase Auth valida o login. */
import { createClient } from '@supabase/supabase-js';
import qrcode from 'qrcode-generator';
import { CFG } from './config';
import { emit, LocalBackend, st, SupabaseBackend } from './store';
import { dstamp, isNum, normLogin, saveFile, slug } from './util';
import type { Empresa, ErroApp, Usuario } from './types';

export const SES_KEY = 'rt1:sessao', ULT_KEY = 'rt1:ultimoAmbiente', MANTER_DIAS = 30, SENHA_MIN = 10;
export const SEG = { inatividadeMin: 30, tentativas: 5, bloqueioMin: 5, ...(CFG.seguranca || {}) };
export const PRIV = { versao: '2026-11', controlador: '', encarregado: '', contato: '', ...((CFG.seguranca || {}).privacidade || {}) };
st.politica = { exige2fa: false, inatividadeMin: SEG.inatividadeMin };

/* ----- Supabase: "Manter conectado" decide se a sessão fica no navegador ou só nesta aba ----- */
let sbManter = false;
try { sbManter = !!localStorage.getItem(SES_KEY); } catch { /* ignora */ }
export const setSbManter = (v: boolean) => { sbManter = v; };
const sbArmazem = {
  getItem: (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { (sbManter ? localStorage : sessionStorage).setItem(k, v); } catch { /* ignora */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignora */ } }
};
export const criaSupabase = () => createClient(CFG.supabaseUrl!, CFG.supabaseKey!, { auth: { storage: sbArmazem, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
export const clienteTemp = () => createClient(CFG.supabaseUrl!, CFG.supabaseKey!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'rt1-temp' } });
export async function sbMembro(emp: Empresa, user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<Usuario | null> {
  const { data, error } = await st.sb!.from('membros_empresa').select('nome,papel').eq('empresa_id', emp.id).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data ? { id: user.id, nome: data.nome, login: user.email || '', papel: data.papel, trocarSenha: !!(user.user_metadata && user.user_metadata.trocar_senha) } : null;
}
export const sbMensagem = (e: unknown) => {
  const x = e as ErroApp; const m = (x && x.message) || '';
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/not confirmed/i.test(m)) return 'Este e-mail ainda não foi confirmado. Abra o link enviado para ele.';
  if (/rate limit|too many/i.test(m) || (x && x.status === 429)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';
  if (/fetch|network/i.test(m)) return 'Sem conexão com o banco de dados. Verifique a internet e tente de novo.';
  if (/different from the old/i.test(m)) return 'A nova senha precisa ser diferente da atual.';
  if (/not authorized/i.test(m)) return 'O Supabase não envia e-mail para este endereço sem um servidor de e-mail próprio. Crie a conta em Authentication → Users e inclua de novo aqui.';
  return m || 'Não foi possível concluir. Tente de novo.';
};

/* ----- Senhas e códigos (PBKDF2) ----- */
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function derivar(txt: string, salt: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(txt), 'PBKDF2', false, ['deriveBits']);
  return hexOf(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150000 }, k, 256));
}
export async function segredo(txt: string) { const salt = hexOf(crypto.getRandomValues(new Uint8Array(16)).buffer); return { salt, hash: await derivar(txt, salt) }; }
export const confere = async (txt: string, s?: { salt: string; hash: string }) => !!s && (await derivar(txt, s.salt)) === s.hash;
export function novoCodigo() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(12))].map(x => A[x % A.length]).join('').match(/.{4}/g)!.join('-'); }
export const normCodigo = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const colUsuarios = (emp: Empresa) => emp.id + '_usuarios';
export const usuariosDe = async (emp: Empresa) => (await st.base.list(colUsuarios(emp))).map(d => d.data as unknown as Usuario);
export const salvarUsuario = (emp: Empresa, u: Usuario) => st.base.set(colUsuarios(emp), u.id, u);
export const SENHAS_FRACAS = ['12345678', '123456789', '1234567890', 'senha123', 'password', 'qwerty123', 'abc12345', 'mudar123', 'admin123', '11111111', '00000000'];
export function forcaSenha(s: string) { s = String(s); let p = 0; if (s.length >= SENHA_MIN) p++; if (s.length >= 14) p++; if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++; if (/\d/.test(s)) p++; if (/[^A-Za-z0-9]/.test(s)) p++; return Math.min(4, p); }
export function validaSenha(a: unknown, b: unknown) {
  const s = String(a);
  if (s.length < SENHA_MIN) return `A senha precisa ter ao menos ${SENHA_MIN} caracteres.`;
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'Use letras e números na senha.';
  if (SENHAS_FRACAS.includes(s.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  if (a !== b) return 'As duas senhas não são iguais.';
  return '';
}

/* ----- Sessão ----- */
export function limparSessao() { for (const n of ['localStorage', 'sessionStorage'] as const) { try { window[n].removeItem(SES_KEY); } catch { /* ignora */ } } }
export function salvarSessao(emp: Empresa, u: Usuario, manter: boolean) {
  limparSessao();
  const v = JSON.stringify({ emp: emp.id, uid: u.id, ate: manter ? Date.now() + MANTER_DIAS * 864e5 : 0 });
  try { (manter ? localStorage : sessionStorage).setItem(SES_KEY, v); localStorage.setItem(ULT_KEY, emp.id); } catch { /* dura até recarregar */ }
}
export function lerSessao(): { emp: string; uid: string; ate: number } | null {
  for (const n of ['sessionStorage', 'localStorage'] as const) {
    try { const v = JSON.parse(window[n].getItem(SES_KEY) as string); if (v && (!v.ate || v.ate > Date.now())) return v; } catch { /* ignora */ }
  }
  return null;
}
export const ultimoAmbiente = () => { try { return localStorage.getItem(ULT_KEY); } catch { return null; } };

/* ----- Dados antigos (antes da separação por ambiente) e envio do navegador para o banco ----- */
const COLS_BASE = ['clientes', 'colaboradores', 'ambientes'];
export async function contarBase(pre: string, base = st.base) { const out: Record<string, number> = {}; for (const c of COLS_BASE) out[c] = (await base.list(pre + c)).reduce((n, d) => n + Object.keys((d.data && d.data.items) || {}).length, 0); return out; }
export async function dadosAntigos(emp: Empresa) {
  const v = await contarBase(''); if (!v.clientes && !v.colaboradores && !v.ambientes) return null;
  const n = await contarBase(emp.id + '_'); return n.clientes || n.colaboradores || n.ambientes ? null : { ...v, pre: '' };
}
export async function moverDadosAntigos(emp: Empresa) {
  const pre = emp.id + '_', cols = [...COLS_BASE], feitos: [string, { id: string; data: unknown }][] = [];
  for (const d of await st.base.list('ambientes')) for (const id of Object.keys((d.data && d.data.items) || {})) cols.push(`itens/${id}/b`, `geo/${id}/b`);
  try { for (const c of cols) for (const d of await st.base.list(c)) { await st.base.set(pre + c, d.id, d.data); await st.base.del(c, d.id); feitos.push([c, d]); } }
  catch (e) { for (const [c, d] of feitos.reverse()) { try { await st.base.del(pre + c, d.id); await st.base.set(c, d.id, d.data); } catch { /* ignora */ } } throw e; }
  try { const ui = localStorage.getItem('rt1:ui'); if (ui) { localStorage.setItem('rt1:' + pre + 'ui', ui); localStorage.removeItem('rt1:ui'); } } catch { /* ignora */ }
}
const sbMarca = (pre: string) => `rt1:enviado_${pre || 'antigos'}`;
export async function sbDadosLocais(emp: Empresa) {
  const { count, error } = await st.sb!.from('clientes').select('sold', { count: 'exact', head: true }).eq('empresa_id', emp.id);
  if (error || count) return null;
  const { count: nEst } = await st.sb!.from('estudos').select('id', { count: 'exact', head: true }).eq('empresa_id', emp.id);
  if (nEst) return null;
  for (const pre of [emp.id + '_', '']) {
    let enviado = null; try { enviado = localStorage.getItem(sbMarca(pre)); } catch { /* ignora */ }
    if (enviado) continue;
    const v = await contarBase(pre, LocalBackend);
    if (v.clientes || v.colaboradores || v.ambientes) return { ...v, pre };
  }
  return null;
}
export async function sbEnviarLocais(emp: Empresa, pre: string) {
  const dest = SupabaseBackend(st.sb!, emp.id), cols = ['colaboradores', 'clientes', 'ambientes'];
  for (const d of await LocalBackend.list(pre + 'ambientes')) for (const id of Object.keys((d.data && d.data.items) || {})) cols.push(`itens/${id}/b`, `geo/${id}/b`);
  for (const c of cols) for (const d of await LocalBackend.list(pre + c)) await dest.set(c, d.id, d.data);
  try { localStorage.setItem(sbMarca(pre), String(Date.now())); } catch { /* ignora */ }
}

/* ----- Duas etapas (TOTP) ----- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(bytes: Uint8Array) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(s: string) { const out: number[] = []; let bits = 0, val = 0; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = ((val << 5) | B32.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function totpEm(secret: string, ctr: number) {
  const key = await crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8), dv = new DataView(buf); dv.setUint32(0, Math.floor(ctr / 2 ** 32)); dv.setUint32(4, ctr >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf)), o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
async function totpConfere(secret: string, code: unknown, ultimo = -1) {
  const c = String(code || '').replace(/\D/g, ''); if (c.length !== 6) return -1;
  const agora = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) { const ctr = agora + d; if (ctr > ultimo && (await totpEm(secret, ctr)) === c) return ctr; }
  return -1;
}
const somenteDigitos = (v: unknown) => String(v || '').replace(/\D/g, '');
function qrDeUri(uri: string) { try { const g = qrcode(0, 'M'); g.addData(uri); g.make(); return g.createDataURL(5, 2); } catch { return ''; } }

async function sbFatores() { const { data, error } = await st.sb!.auth.mfa.listFactors(); if (error) throw error; return { ok: (data.totp || []).filter(f => f.status === 'verified'), todos: data.all || [] }; }
export async function sbPrecisaMfa() { try { const { data } = await st.sb!.auth.mfa.getAuthenticatorAssuranceLevel(); return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'; } catch { return false; } }
export async function mfaAtivo() {
  if (st.sb) { try { return (await sbFatores()).ok.length > 0; } catch { return false; } }
  return !!(st.usuario && st.usuario.mfa && st.usuario.mfa.on);
}
export interface MfaInicio { secret: string; uri: string; qr: string; factorId?: string }
export async function mfaIniciar(): Promise<MfaInicio> {
  const e = st.empresa!, login = (st.usuario && st.usuario.login) || '';
  if (st.sb) {
    const f = await sbFatores();
    for (const x of f.todos.filter(x => x.status === 'unverified')) await st.sb.auth.mfa.unenroll({ factorId: x.id }).catch(() => {});
    const { data, error } = await st.sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `RRM ${e.sigla} ${new Date().toLocaleDateString('pt-BR')}`, issuer: 'Roteirizador RRM' });
    if (error) throw error;
    const q = String(data.totp.qr_code || ''), svg = q.replace(/^data:image\/svg\+xml;[^,]*,/, '');
    return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qr: svg.trim().startsWith('<') ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : q || qrDeUri(data.totp.uri) };
  }
  const secret = b32enc(crypto.getRandomValues(new Uint8Array(20)));
  const uri = `otpauth://totp/${encodeURIComponent(`Roteirizador RRM (${e.sigla}):${login}`)}?secret=${secret}&issuer=${encodeURIComponent('Roteirizador RRM')}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, qr: qrDeUri(uri) };
}
const MSG_CODIGO = 'Código incorreto ou vencido. Confira a hora do celular e digite o código que aparece agora.';
export async function mfaConfirmar(ini: MfaInicio, code: string): Promise<{ reservas: string[] }> {
  if (st.sb) {
    const { error } = await st.sb.auth.mfa.challengeAndVerify({ factorId: ini.factorId!, code: somenteDigitos(code) });
    if (error) throw new Error(/invalid|expired/i.test(error.message || '') ? MSG_CODIGO : sbMensagem(error));
    st.mfaAtivo = true; audita('mfa_ativada'); emit(); return { reservas: [] };
  }
  const ctr = await totpConfere(ini.secret, code); if (ctr < 0) throw new Error(MSG_CODIGO);
  const reservas = [...Array(8)].map(() => novoCodigo().slice(0, 9));
  const hashes = []; for (const r of reservas) hashes.push(await segredo(normCodigo(r)));
  st.usuario = { ...st.usuario!, mfa: { on: true, secret: ini.secret, ult: ctr, reservas: hashes, em: Date.now() } };
  await salvarUsuario(st.empresa!, st.usuario); st.mfaAtivo = true; audita('mfa_ativada'); emit();
  return { reservas };
}
export async function mfaDesligar(code: string) {
  if (st.sb) {
    const f = await sbFatores(); if (!f.ok.length) return;
    const v = await st.sb.auth.mfa.challengeAndVerify({ factorId: f.ok[0].id, code: somenteDigitos(code) });
    if (v.error) throw new Error('Código incorreto. Digite o código que aparece agora no aplicativo.');
    for (const x of f.ok) { const { error } = await st.sb.auth.mfa.unenroll({ factorId: x.id }); if (error) throw error; }
    await st.sb.auth.refreshSession().catch(() => {});
  } else {
    if ((await totpConfere(st.usuario!.mfa!.secret, code)) < 0) throw new Error('Código incorreto. Digite o código que aparece agora no aplicativo.');
    const u = { ...st.usuario! }; delete u.mfa; st.usuario = u; await salvarUsuario(st.empresa!, u);
  }
  st.mfaAtivo = false; audita('mfa_desativada'); emit();
}
/* Segunda etapa do login. u = usuário local (sem Supabase). Aceita código de reserva; devolve quantos restam se usou um */
export async function mfaConferirLogin(code: string, emp: Empresa | null, u?: Usuario): Promise<{ ok: boolean; restam?: number }> {
  if (st.sb) {
    const f = await sbFatores(); if (!f.ok.length) return { ok: true };
    const { error } = await st.sb.auth.mfa.challengeAndVerify({ factorId: f.ok[0].id, code: somenteDigitos(code) });
    return { ok: !error };
  }
  const m = u && u.mfa; if (!m || !m.on) return { ok: true };
  const ctr = await totpConfere(m.secret, code, m.ult ?? -1);
  if (ctr >= 0) { await salvarUsuario(emp!, { ...u!, mfa: { ...m, ult: ctr } }); return { ok: true }; }
  const n = normCodigo(code);
  if (n.length >= 8) for (let i = 0; i < (m.reservas || []).length; i++) if (await confere(n, m.reservas![i])) {
    const res = m.reservas!.slice(); res.splice(i, 1); await salvarUsuario(emp!, { ...u!, mfa: { ...m, reservas: res } }); return { ok: true, restam: res.length };
  }
  return { ok: false };
}

/* ----- Bloqueio depois de tentativas erradas (neste navegador) ----- */
const chaveFalha = (emp: Empresa | null, login: string) => `rt1:falhas:${emp && emp.id}:${normLogin(login)}`;
export function bloqueado(emp: Empresa | null, login: string) { try { const v = JSON.parse(localStorage.getItem(chaveFalha(emp, login)) || 'null'); return v && v.ate > Date.now() ? v.ate : 0; } catch { return 0; } }
export function registraFalha(emp: Empresa | null, login: string) {
  try {
    const k = chaveFalha(emp, login), v = JSON.parse(localStorage.getItem(k) || '{"n":0,"vez":0}'); v.n++;
    if (v.n >= SEG.tentativas) { v.vez = (v.vez || 0) + 1; v.ate = Date.now() + SEG.bloqueioMin * 60000 * 2 ** (v.vez - 1); v.n = 0; }
    localStorage.setItem(k, JSON.stringify(v)); return v.ate && v.ate > Date.now() ? v.ate : 0;
  } catch { return 0; }
}
export function limpaFalhas(emp: Empresa | null, login: string) { try { localStorage.removeItem(chaveFalha(emp, login)); } catch { /* ignora */ } }
export const msgBloqueio = (ate: number) => `Acesso bloqueado por excesso de tentativas. Tente de novo às ${new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;

/* ----- Registro de atividades ----- */
const AUD_MAX_LOCAL = 1500;
export const AUD_ACAO: Record<string, string> = { login: 'Entrou no sistema', logout: 'Saiu do sistema', sessao_expirada: 'Sessão encerrada por inatividade', login_falhou: 'Tentativa de login recusada', mfa_ativada: 'Ativou a verificação em duas etapas', mfa_desativada: 'Desligou a verificação em duas etapas', mfa_falhou: 'Código de verificação recusado', politica: 'Alterou a política de segurança', privacidade: 'Aceitou o aviso de privacidade', senha: 'Alterou a senha', exportacao: 'Exportou dados', backup: 'Exportou backup', restauracao: 'Restaurou backup', importacao: 'Importou planilha', exclusao: 'Excluiu dados', usuario_incluido: 'Incluiu usuário', usuario_removido: 'Removeu usuário', titular_exportou: 'Baixou os próprios dados (LGPD)', titular_pedido: 'Enviou pedido de titular (LGPD)', calendario: 'Alterou o calendário', verba: 'Verba indenizatória' };
export interface RegAud { acao: string; detalhe: string; usuario: string; email: string; em: number; uid?: string; user_id?: string }
const audLocalColl = () => (st.empresa ? st.empresa.id : 'x') + '_auditoria';
async function audLocalLer(): Promise<RegAud[]> { try { const d = (await st.base.list(audLocalColl())).find(x => x.id === 'log'); return ((d && d.data && (d.data as { items?: RegAud[] }).items) || []) as RegAud[]; } catch { return []; } }
export function audita(acao: string, detalhe = ''): Promise<void> {
  const u = st.usuario || ({} as Usuario), e = st.empresa; if (!e) return Promise.resolve();
  const reg: RegAud = { acao, detalhe: String(detalhe || '').slice(0, 500), usuario: u.nome || '', email: u.login || '', em: Date.now() };
  if (st.sb) {
    if (st.audSemTabela || !u.id) return Promise.resolve();
    return Promise.resolve(st.sb.from('auditoria').insert({ empresa_id: e.id, user_id: u.id, usuario: reg.usuario, email: reg.email, acao, detalhe: reg.detalhe, agente: navigator.userAgent.slice(0, 200) }))
      .then(({ error }) => { if (error && /auditoria|does not exist|PGRST205|42P01/i.test((error.message || '') + error.code)) st.audSemTabela = true; }, () => {});
  }
  return audLocalLer().then(l => { l.unshift({ ...reg, uid: u.id || '' }); return st.base.set(audLocalColl(), 'log', { items: l.slice(0, AUD_MAX_LOCAL) }); }).catch(() => {});
}
export async function audLista(proprios: boolean): Promise<RegAud[]> {
  if (st.sb) {
    let q = st.sb.from('auditoria').select('acao,detalhe,usuario,email,em,user_id').eq('empresa_id', st.empresa!.id).order('em', { ascending: false }).limit(300);
    if (proprios) q = q.eq('user_id', st.usuario!.id);
    const { data, error } = await q; if (error) throw error;
    return (data || []).map(r => ({ ...r, em: Date.parse(r.em) })) as RegAud[];
  }
  const l = await audLocalLer(); return proprios ? l.filter(r => r.uid === st.usuario!.id) : l;
}
export const AUD_MAX = AUD_MAX_LOCAL;

/* ----- Política do ambiente ----- */
const polColl = () => st.empresa!.id + '_seguranca';
export async function carregaPolitica() {
  const p = { exige2fa: false, inatividadeMin: SEG.inatividadeMin };
  try {
    if (st.sb) {
      const { data, error } = await st.sb.from('empresas').select('exige_2fa,inatividade_min').eq('id', st.empresa!.id).maybeSingle();
      if (!error && data) { p.exige2fa = !!data.exige_2fa; if (isNum(+data.inatividade_min) && data.inatividade_min !== null) p.inatividadeMin = +data.inatividade_min; }
      else if (error) st.polSemColuna = true;
    } else { const d = (await st.base.list(polColl())).find(x => x.id === 'politica'); if (d && d.data) Object.assign(p, d.data); }
  } catch { /* fica o padrão */ }
  st.politica = p; emit(); return p;
}
export async function salvaPolitica(p: { exige2fa: boolean; inatividadeMin: number }) {
  if (st.sb) { const { error } = await st.sb.from('empresas').update({ exige_2fa: !!p.exige2fa, inatividade_min: p.inatividadeMin }).eq('id', st.empresa!.id); if (error) throw error; }
  else await st.base.set(polColl(), 'politica', p);
  st.politica = { ...st.politica, ...p }; audita('politica', `Duas etapas obrigatória: ${p.exige2fa ? 'sim' : 'não'} · inatividade: ${p.inatividadeMin || 'sem limite'} min`);
  iniciaInatividade(); emit();
}

/* ----- Aviso de privacidade (LGPD) ----- */
const chaveAceite = () => `rt1:privacidade:${st.empresa!.id}:${st.usuario!.id}`;
const lerAceiteLocal = () => { try { return localStorage.getItem(chaveAceite()) === PRIV.versao; } catch { return false; } };
export async function privacidadeAceita() {
  const u = st.usuario!;
  if (st.sb) {
    try { const { data, error } = await st.sb.from('consentimentos').select('versao').eq('empresa_id', st.empresa!.id).eq('user_id', u.id).eq('versao', PRIV.versao).maybeSingle(); if (error) { st.consSemTabela = true; return lerAceiteLocal(); } return !!data; }
    catch { return lerAceiteLocal(); }
  }
  return !!(u.privacidade && u.privacidade.versao === PRIV.versao);
}
export async function registraAceite() {
  const u = st.usuario!;
  if (st.sb) {
    if (!st.consSemTabela) { const { error } = await st.sb.from('consentimentos').upsert({ empresa_id: st.empresa!.id, user_id: u.id, versao: PRIV.versao, agente: navigator.userAgent.slice(0, 200) }, { onConflict: 'empresa_id,user_id,versao' }); if (error) st.consSemTabela = true; }
    try { localStorage.setItem(chaveAceite(), PRIV.versao); } catch { /* ignora */ }
  } else { st.usuario = { ...u, privacidade: { versao: PRIV.versao, em: Date.now() } }; await salvarUsuario(st.empresa!, st.usuario); }
  audita('privacidade', 'Versão ' + PRIV.versao);
}
export const privControlador = () => PRIV.controlador || (st.empresa && st.empresa.nome) || 'a empresa do ambiente';
export const privEncarregado = () => (PRIV.encarregado ? `${PRIV.encarregado}${PRIV.contato ? ' · ' + PRIV.contato : ''}` : 'o administrador do ambiente, em Minha conta');

/* ----- Fim da sessão por inatividade (a atividade em qualquer aba conta para todas) ----- */
const ATV_KEY = 'rt1:atividade';
let atvT: ReturnType<typeof setInterval> | null = null, atvUlt = 0, ligado = false;
export const inatividade = { aviso: 0 as number, ao: null as null | (() => void) };
function marcaAtividade() { const t = Date.now(); if (t - atvUlt < 15000) return; atvUlt = t; try { localStorage.setItem(ATV_KEY, String(t)); } catch { /* ignora */ } }
const ultimaAtividade = () => { try { return Math.max(atvUlt, +(localStorage.getItem(ATV_KEY) || 0)); } catch { return atvUlt; } };
export function continuarConectado() { atvUlt = 0; marcaAtividade(); inatividade.aviso = 0; emit(); }
export function iniciaInatividade() {
  if (atvT) clearInterval(atvT); atvT = null;
  const min = +st.politica.inatividadeMin || 0; if (!min) return;
  atvUlt = 0; marcaAtividade();
  if (!ligado) { ligado = true; ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, marcaAtividade, { passive: true, capture: true })); }
  atvT = setInterval(() => {
    const ocioso = Date.now() - ultimaAtividade(), lim = min * 60000;
    if (ocioso >= lim) { clearInterval(atvT!); atvT = null; inatividade.aviso = 0; emit(); audita('sessao_expirada', `${st.politica.inatividadeMin} min sem uso`); try { localStorage.setItem('rt1:saiuPorInatividade', '1'); } catch { /* ignora */ } inatividade.ao && inatividade.ao(); }
    else if (ocioso >= lim - 60000) { inatividade.aviso = Date.now() + (lim - ocioso); emit(); }
    else if (inatividade.aviso) { inatividade.aviso = 0; emit(); }
  }, 5000);
}
export function pararInatividade() { if (atvT) clearInterval(atvT); atvT = null; }

/* ----- Baixar os próprios dados (LGPD, art. 18, II) ----- */
export async function baixarMeusDados() {
  const u = st.usuario!, out: Record<string, unknown> = { geradoEm: new Date().toISOString(), ambiente: { id: st.empresa!.id, nome: st.empresa!.nome }, conta: { id: u.id, nome: u.nome, login: u.login, papel: u.papel, criado: u.criado ? new Date(u.criado).toISOString() : undefined, duasEtapas: !!st.mfaAtivo }, aceitesPrivacidade: [], atividades: [] };
  try {
    if (st.sb) { const { data } = await st.sb.from('consentimentos').select('versao,aceito_em').eq('empresa_id', st.empresa!.id).eq('user_id', u.id); out.aceitesPrivacidade = data || []; }
    else if (u.privacidade) out.aceitesPrivacidade = [{ versao: u.privacidade.versao, aceito_em: new Date(u.privacidade.em).toISOString() }];
  } catch { /* segue sem */ }
  try { out.atividades = (await audLista(true)).map(r => ({ em: new Date(r.em).toISOString(), acao: AUD_ACAO[r.acao] || r.acao, detalhe: r.detalhe || '' })); } catch { /* segue sem */ }
  const col = [...(st.col ? st.col.values() : [])].find(c => normLogin(c.email || '') === normLogin(u.login));
  if (col) out.cadastroDeColaborador = col;
  saveFile(`meus_dados_${slug(u.nome || 'usuario')}_${dstamp()}.json`, new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  audita('titular_exportou');
}
