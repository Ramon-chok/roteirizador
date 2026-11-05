/* Temas da marca. A escolha fica neste dispositivo (mesma chave da versão anterior: rvx:tema). */
import { emit } from '../core/store';

export type TemaId = 'dark' | 'light' | 'mono' | 'vertical' | 'auto';
export const TEMAS: { id: TemaId; nome: string; desc: string; cores: [string, string, string, string, string] }[] = [
  { id: 'dark', nome: 'Escuro', desc: 'Navy Vortex', cores: ['#0B1426', '#0D1830', '#22D3EE', '#3B82F6', '#F97316'] },
  { id: 'light', nome: 'Claro', desc: 'Fundo claro', cores: ['#F5F8FC', '#FFFFFF', '#0B1426', '#2563EB', '#F97316'] },
  { id: 'mono', nome: 'Monocromático', desc: 'Azul e branco', cores: ['#1D4ED8', '#1B48CC', '#FFFFFF', '#DBE6FF', '#FFFFFF'] },
  { id: 'vertical', nome: 'Vertical', desc: 'Noite', cores: ['#111D35', '#13213D', '#E8F1FF', '#3B82F6', '#22D3EE'] },
  { id: 'auto', nome: 'Automático', desc: 'Segue o sistema', cores: ['#F5F8FC', '#0B1426', '#22D3EE', '#3B82F6', '#F97316'] }
];
const CHAVE = 'rvx:tema', PADRAO: TemaId = 'dark';
export function temaAtual(): TemaId { try { const v = localStorage.getItem(CHAVE) as TemaId; return TEMAS.some(t => t.id === v) ? v : PADRAO; } catch { return PADRAO; } }
export function aplicaTema(id: TemaId = temaAtual()) {
  const h = document.documentElement;
  if (id === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', id);
  h.setAttribute('data-tema', id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(h).getPropertyValue('--bg').trim() || '#0B1426');
}
export function defineTema(id: TemaId) { try { localStorage.setItem(CHAVE, id); } catch { /* só nesta sessão */ } aplicaTema(id); emit(); window.dispatchEvent(new Event('rvx-tema')); }
export const temaEscuro = () => { const t = document.documentElement.getAttribute('data-theme'); if (t) return t !== 'light'; return matchMedia('(prefers-color-scheme: dark)').matches; };

/* Preferências de exibição deste dispositivo */
const PREF_KEY = 'rvx:prefs';
export type Prefs = { contraste?: boolean; semAnimacao?: boolean; compacto?: boolean; menuMini?: boolean };
export function lerPrefs(): Prefs { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } }
export function aplicaPrefs(p: Prefs = lerPrefs()) { const h = document.documentElement; h.toggleAttribute('data-contraste', !!p.contraste); h.toggleAttribute('data-sem-animacao', !!p.semAnimacao); h.toggleAttribute('data-compacto', !!p.compacto); }
export function salvaPref<K extends keyof Prefs>(k: K, v: Prefs[K]) { const p = { ...lerPrefs(), [k]: v }; try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignora */ } aplicaPrefs(p); emit(); }
