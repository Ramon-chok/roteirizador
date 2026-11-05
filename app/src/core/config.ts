/* Configuração: vem de js/config.js da raiz do projeto (o mesmo arquivo da versão anterior),
   carregado como script antes do app (ver vite.config.ts → plugin "config-da-raiz"). */
import type { Empresa } from './types';

export interface RTConfig {
  googleMapsKey?: string; osrmUrl?: string; valhallaUrl?: string; supabaseUrl?: string; supabaseKey?: string; urlWeb?: string;
  seguranca?: { inatividadeMin?: number; tentativas?: number; bloqueioMin?: number; privacidade?: { versao?: string; controlador?: string; encarregado?: string; contato?: string } };
  pontoMar?: { lat: number; lng: number }; empresas?: Empresa[];
}
declare global {
  interface Window {
    RT_CONFIG?: RTConfig;
    rrmDesktop?: { desktop: boolean; plataforma: string; versaoElectron: string };
    google?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}
export const CFG: RTConfig = window.RT_CONFIG || {};
export const EMPRESAS: Empresa[] = CFG.empresas || [];
export const SEA = { lat: -24.4, lng: -45.4, ...(CFG.pontoMar || {}) };
export const sbConfigurado = () => !!(CFG.supabaseUrl && CFG.supabaseKey);
export const urlRetorno = () => { const w = CFG.urlWeb; return window.rrmDesktop && w ? w : location.origin + location.pathname; };
