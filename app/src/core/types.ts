/* Tipos de domínio (mesmo formato de dados da versão anterior: os dois sistemas leem e gravam as mesmas bases) */

export interface GeoPend { msg: string; [k: string]: unknown }
export interface Cliente {
  sold: string; nome?: string; endereco?: string; bairro?: string; cidade?: string; uf?: string; cep?: string;
  lat?: number | null; lng?: number | null; f?: number; t?: number; geo?: string; geoNivel?: string; geoPend?: GeoPend | null; exemplo?: boolean | null;
  [k: string]: unknown;
}
export interface Colaborador {
  codigo: string; nome: string; funcao?: string; endereco?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; email?: string;
  lat?: number | null; lng?: number | null; jornada?: number; cor?: string; geo?: string; geoNivel?: string; geoPend?: GeoPend | null; exemplo?: boolean | null;
  [k: string]: unknown;
}
export interface Setor { nome: string; cor: string; colab: string }
export interface Params {
  semanas: number; dias: number[]; vel: number; fator: number; jornada: number; tPadrao: number; criterio: 'tempo' | 'distancia' | string;
  motor?: string; evitaPedagio?: boolean; evitaTerra?: boolean;
}
export interface Estudo {
  id: string; nome: string; desc?: string; criado: number; alterado: number; params: Partial<Params>;
  setores: Record<string, Setor>; pend: { cli: string[]; col: string[] }; exemplo?: boolean | null;
}
export interface Item { s: string; d: number[]; w: number[]; q: Record<number | string, number> }
export interface GeoRota {
  sig: string; km: number; kmIda: number; kmEntre: number; kmVolta: number; min: number; p?: string; src?: string; o?: string;
  toll?: boolean | null; terra?: number | null; em: number;
}
export interface MetricasRota {
  n: number; kmIda: number; kmEntre: number; kmVolta: number; km: number; tDesl: number; tAtend: number; total: number; ocup: number; jornada: number;
  real?: boolean; src?: string; o?: string; toll?: boolean | null; terra?: number | null;
}
export interface Rota { k: string; s: string; w: number; d: number; stops: string[]; m: MetricasRota; missing: number; sig: string; stale: boolean }

export interface Empresa { id: string; nome: string; sigla: string; padroes?: Partial<Params>; pontoMar?: { lat: number; lng: number } }
export interface Usuario {
  id: string; nome: string; login: string; papel: 'admin' | 'usuario' | string; criado?: number;
  senha?: { salt: string; hash: string }; rec?: { salt: string; hash: string }; trocarSenha?: boolean;
  mfa?: { on: boolean; secret: string; ult?: number; reservas?: { salt: string; hash: string }[]; em?: number };
  privacidade?: { versao: string; em: number };
}
export interface Backend {
  kind: 'local' | 'cloud';
  list(coll: string): Promise<{ id: string; data: { items?: Record<string, unknown> } & Record<string, unknown> }[]>;
  set(coll: string, id: string, data: unknown): Promise<void>;
  del(coll: string, id: string): Promise<void>;
}
export interface ErroApp { code?: string; message?: string; status?: number }
