-- =====================================================================
-- Route VORTEX: migração 07 · módulo Pedágios
-- Rode depois das migrações 04, 05 e 06. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo → Run.
--
-- Cada praça de pedágio é uma linha (nome, local e, em "dados", rodovia, KM, concessionária,
-- sentido de cobrança e tarifas por categoria). A linha '__cfg' guarda a categoria do veículo
-- usada nos cálculos e o raio de detecção. Quem é do ambiente lê e altera, como em Rotas.
-- =====================================================================

begin;

create table if not exists public.pedagios (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  id            text not null,
  tipo          text not null default 'praca' check (tipo in ('praca', 'cfg')),
  nome          text,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);
create index if not exists pedagios_local_idx on public.pedagios (empresa_id, lat, lng);

drop trigger if exists pedagios_tocar on public.pedagios;
create trigger pedagios_tocar before update on public.pedagios for each row execute function public.tocar_atualizado_em();

alter table public.pedagios enable row level security;
drop policy if exists pedagios_membros on public.pedagios;
create policy pedagios_membros on public.pedagios for all to authenticated
  using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));

-- Mesma exigência da segunda etapa das outras tabelas (migração 04)
do $$
begin
  if to_regprocedure('public.mfa_ok(text)') is not null then
    drop policy if exists pedagios_mfa on public.pedagios;
    create policy pedagios_mfa on public.pedagios as restrictive for all to authenticated
      using (public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id));
  else
    raise notice 'Rode a migracao_04_seguranca.sql e depois esta de novo, para exigir a segunda etapa também em Pedágios.';
  end if;
end $$;

revoke all on public.pedagios from anon;
grant select, insert, update, delete on public.pedagios to authenticated;

-- O histórico de importações passa a aceitar as praças de pedágio importadas
alter table public.importacoes drop constraint if exists importacoes_tipo_check;
alter table public.importacoes add constraint importacoes_tipo_check check (tipo in ('clientes', 'colaboradores', 'roteiro', 'rotas', 'lancamentos', 'pedagios'));

commit;
