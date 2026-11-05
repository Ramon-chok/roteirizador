-- =====================================================================
-- Roteirizador RRM: migração 05 · módulo Rotas (bases de roteiros por período)
-- Rode depois da migração 04. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo → Run.
-- =====================================================================

begin;

-- Cada base é um período (mês/ano) importado. "dados" guarda nome, arquivo, quem importou, o ciclo,
-- o KM pelas ruas já calculado e o resumo por rota (vendedor × semana × dia) usado no histórico.
-- A linha de id '__parametros' guarda o valor do KM e os demais parâmetros do módulo.
create table if not exists public.rotas_bases (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  id            text not null,
  nome          text not null,
  periodo       text check (periodo is null or periodo ~ '^\d{4}-\d{2}$'),  -- 2026-11
  dados         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);
create index if not exists rotas_bases_periodo_idx on public.rotas_bases (empresa_id, periodo);

-- Linhas de cada base: cliente, vendedor, dias, semanas ou data, equipe, região, segmento...
-- Sem chave estrangeira para a base: o sistema grava as linhas e a base em paralelo e apaga as linhas ao excluir a base.
create table if not exists public.rotas_linhas (
  empresa_id text not null references public.empresas (id) on delete cascade,
  base_id    text not null,
  chave      text not null,
  sold       text not null,
  vendedor   text,
  dados      jsonb not null default '{}'::jsonb,
  primary key (empresa_id, base_id, chave)
);
create index if not exists rotas_linhas_vendedor_idx on public.rotas_linhas (empresa_id, base_id, vendedor);

drop trigger if exists rotas_bases_tocar on public.rotas_bases;
create trigger rotas_bases_tocar before update on public.rotas_bases for each row execute function public.tocar_atualizado_em();

alter table public.rotas_bases enable row level security;
alter table public.rotas_linhas enable row level security;
drop policy if exists rotas_bases_membros on public.rotas_bases;
drop policy if exists rotas_linhas_membros on public.rotas_linhas;
create policy rotas_bases_membros on public.rotas_bases for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy rotas_linhas_membros on public.rotas_linhas for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));

-- Mesma exigência da segunda etapa das outras tabelas (migração 04)
do $$
declare t text;
begin
  if to_regprocedure('public.mfa_ok(text)') is not null then
    foreach t in array array['rotas_bases', 'rotas_linhas'] loop
      execute format('drop policy if exists %I on public.%I', t || '_mfa', t);
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id))', t || '_mfa', t);
    end loop;
  else
    raise notice 'Rode a migracao_04_seguranca.sql e depois esta de novo, para exigir a segunda etapa também em Rotas.';
  end if;
end $$;

revoke all on public.rotas_bases, public.rotas_linhas from anon;
grant select, insert, update, delete on public.rotas_bases, public.rotas_linhas to authenticated;

-- O histórico de importações passa a aceitar as bases de Rotas
alter table public.importacoes drop constraint if exists importacoes_tipo_check;
alter table public.importacoes add constraint importacoes_tipo_check check (tipo in ('clientes', 'colaboradores', 'roteiro', 'rotas'));

commit;
