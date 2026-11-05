-- =====================================================================
-- Roteirizador RRM: migração 04 · segurança e privacidade (LGPD)
-- Verificação em duas etapas exigida pelo banco, política do ambiente, aceite do aviso
-- de privacidade e registro de atividades que não pode ser alterado.
-- Pode rodar mais de uma vez. Como usar: Supabase → SQL Editor → cole este arquivo → Run.
--
-- Antes: em Authentication → Multi-Factor (MFA), deixe o TOTP (aplicativo autenticador) ligado.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Política do ambiente: o administrador liga em Configurações → Segurança e privacidade
-- ---------------------------------------------------------------------
alter table public.empresas add column if not exists exige_2fa boolean not null default false;
alter table public.empresas add column if not exists inatividade_min integer not null default 30 check (inatividade_min >= 0);

-- ---------------------------------------------------------------------
-- Segunda etapa: quem tem um autenticador cadastrado só acessa os dados depois de digitar o código (aal2).
-- Se o ambiente exige as duas etapas, quem ainda não cadastrou também fica sem acesso aos dados até cadastrar.
-- ---------------------------------------------------------------------
create or replace function public.mfa_ok(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
          and not coalesce((select x.exige_2fa from public.empresas x where x.id = e), false));
$$;
revoke execute on function public.mfa_ok(text) from public, anon;
grant execute on function public.mfa_ok(text) to authenticated;

-- Políticas restritivas: somam-se às de membro do ambiente (as duas precisam valer)
do $$
declare t text;
begin
  foreach t in array array['clientes', 'colaboradores', 'estudos', 'setores', 'estudo_clientes', 'rotas_calculadas', 'importacoes', 'preferencias_usuario'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_mfa', t);
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id))', t || '_mfa', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Aceite do aviso de privacidade (LGPD): quem aceitou, qual versão e quando
-- ---------------------------------------------------------------------
create table if not exists public.consentimentos (
  empresa_id text not null references public.empresas (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  versao     text not null,
  aceito_em  timestamptz not null default now(),
  agente     text,                                       -- navegador usado no aceite
  primary key (empresa_id, user_id, versao)
);
alter table public.consentimentos enable row level security;
drop policy if exists consentimentos_ler on public.consentimentos;
drop policy if exists consentimentos_incluir on public.consentimentos;
drop policy if exists consentimentos_alterar on public.consentimentos;
create policy consentimentos_ler on public.consentimentos for select to authenticated
  using (user_id = auth.uid() or public.admin_empresa(empresa_id));
create policy consentimentos_incluir on public.consentimentos for insert to authenticated
  with check (user_id = auth.uid() and public.pertence_empresa(empresa_id));
create policy consentimentos_alterar on public.consentimentos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.pertence_empresa(empresa_id));
revoke all on public.consentimentos from anon;
grant select, insert, update on public.consentimentos to authenticated;

-- ---------------------------------------------------------------------
-- Registro de atividades: entradas, saídas, exportações, importações, exclusões, mudanças de segurança
-- e pedidos de titulares. Só inclusão: ninguém altera nem apaga um registro pelo sistema.
-- O administrador vê tudo do ambiente; cada pessoa vê o que ela mesma fez.
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id         bigint generated always as identity primary key,
  empresa_id text not null references public.empresas (id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  usuario    text,
  email      text,
  acao       text not null,
  detalhe    text,
  agente     text,
  em         timestamptz not null default now()
);
create index if not exists auditoria_empresa_idx on public.auditoria (empresa_id, em desc);
create index if not exists auditoria_usuario_idx on public.auditoria (user_id, em desc);
alter table public.auditoria enable row level security;
drop policy if exists auditoria_incluir on public.auditoria;
drop policy if exists auditoria_ler on public.auditoria;
create policy auditoria_incluir on public.auditoria for insert to authenticated
  with check (user_id = auth.uid() and public.pertence_empresa(empresa_id) and char_length(coalesce(detalhe, '')) <= 500);
create policy auditoria_ler on public.auditoria for select to authenticated
  using (user_id = auth.uid() or public.admin_empresa(empresa_id));
revoke all on public.auditoria from anon;
revoke update, delete, truncate on public.auditoria from authenticated;
grant select, insert on public.auditoria to authenticated;

-- A data do registro é sempre a do servidor, não a do computador de quem usa
create or replace function public.auditoria_carimbo() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.em := now();
  new.user_id := auth.uid();
  return new;
end $$;
drop trigger if exists auditoria_carimbo on public.auditoria;
create trigger auditoria_carimbo before insert on public.auditoria for each row execute function public.auditoria_carimbo();

commit;

-- =====================================================================
-- Para desligar as duas etapas de alguém que perdeu o celular:
-- Supabase → Authentication → Users → abra o usuário → apague o fator em "Multi-Factor Authentication".
--
-- Registros de atividades com mais de 5 anos podem ser apagados por quem administra o banco:
-- delete from public.auditoria where em < now() - interval '5 years';
-- =====================================================================
