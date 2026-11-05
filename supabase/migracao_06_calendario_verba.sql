-- =====================================================================
-- Roteirizador RRM: migração 06 · Calendário e Verba Indenizatória
-- Rode depois das migrações 04 e 05. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo → Run.
--
-- Quem é do ambiente lê; só o administrador inclui, altera ou exclui
-- (eventos do calendário, racionais, reembolsos, descontos e apurações).
-- =====================================================================

begin;

-- Calendário: eventos (reembolso, reunião, pagamento de verba...), categorias e a semana de referência do ciclo.
-- As linhas '__cats' e '__cfg' guardam as categorias e a configuração; os eventos têm a data preenchida.
create table if not exists public.calendario (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  id            text not null,
  data          date,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);
create index if not exists calendario_data_idx on public.calendario (empresa_id, data);

-- Verba Indenizatória. tipo: racional (preço do combustível, KM por litro, cesta de serviço),
-- lanc (reembolso ou desconto, com motivo e imagens), apuracao (fechamento de um mês).
create table if not exists public.verba (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  id            text not null,
  tipo          text not null check (tipo in ('racional', 'lanc', 'apuracao', 'outro')),
  mes           text check (mes is null or mes ~ '^\d{4}-\d{2}$'),
  vendedor      text,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, id)
);
create index if not exists verba_mes_idx on public.verba (empresa_id, tipo, mes);
create index if not exists verba_vendedor_idx on public.verba (empresa_id, vendedor, mes);

do $$
declare t text;
begin
  foreach t in array array['calendario', 'verba'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tocar', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.tocar_atualizado_em()', t || '_tocar', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_incluir', t);
    execute format('drop policy if exists %I on public.%I', t || '_alterar', t);
    execute format('drop policy if exists %I on public.%I', t || '_excluir', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pertence_empresa(empresa_id))', t || '_ler', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.admin_empresa(empresa_id))', t || '_incluir', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.admin_empresa(empresa_id)) with check (public.admin_empresa(empresa_id))', t || '_alterar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.admin_empresa(empresa_id))', t || '_excluir', t);
    -- Mesma exigência da segunda etapa das outras tabelas (migração 04)
    if to_regprocedure('public.mfa_ok(text)') is not null then
      execute format('drop policy if exists %I on public.%I', t || '_mfa', t);
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id))', t || '_mfa', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- O histórico de importações passa a aceitar os reembolsos e descontos importados
alter table public.importacoes drop constraint if exists importacoes_tipo_check;
alter table public.importacoes add constraint importacoes_tipo_check check (tipo in ('clientes', 'colaboradores', 'roteiro', 'rotas', 'lancamentos'));

commit;
