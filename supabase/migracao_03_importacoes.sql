-- =====================================================================
-- Roteirizador RRM: migração 03 · histórico de importações
-- Para quem rodou o schema.sql antes desta migração. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- =====================================================================

begin;

-- Histórico de importações: quem importou o quê, quando, as quantidades e uma observação opcional.
-- O estudo não tem chave estrangeira: o registro continua mesmo se o estudo for excluído.
create table if not exists public.importacoes (
  empresa_id     text not null references public.empresas (id) on delete cascade,
  id             text not null,
  tipo           text not null check (tipo in ('clientes', 'colaboradores', 'roteiro')),
  arquivo        text,                                  -- nome do arquivo, ou "Dados colados"
  estudo_id      text,
  estudo_nome    text,
  usuario        text,                                  -- nome de quem importou
  usuario_login  text,
  importado_em   timestamptz not null default now(),
  linhas         integer not null default 0,            -- linhas lidas da planilha
  alteracoes     integer not null default 0,            -- registros criados ou alterados (no roteiro: linhas aplicadas ao estudo)
  novos          integer not null default 0,
  atualizados    integer not null default 0,
  ignorados      integer not null default 0,
  pendencias     integer not null default 0,
  resumo         jsonb not null default '[]',           -- frases do resultado mostradas ao fim da importação
  mensagem       text,                                  -- observação de quem importou
  primary key (empresa_id, id)
);
create index if not exists importacoes_data_idx on public.importacoes (empresa_id, importado_em desc);

alter table public.importacoes enable row level security;
drop policy if exists importacoes_membros on public.importacoes;
create policy importacoes_membros on public.importacoes for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
revoke all on public.importacoes from anon;
grant select, insert, update, delete on public.importacoes to authenticated;

commit;
