-- =====================================================================
-- Roteirizador RRM: migração 02 · cadastro de usuários pelo sistema
-- Para quem rodou o schema.sql antes desta migração. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- =====================================================================

begin;

-- E-mail do membro: o sistema lista as pessoas do ambiente e envia a redefinição de senha.
-- A tabela auth.users não pode ser lida pelo sistema, por segurança.
alter table public.membros_empresa add column if not exists email text;

update public.membros_empresa m set email = u.email
from auth.users u where u.id = m.user_id and m.email is distinct from u.email;

-- Preenche o e-mail sozinho, mesmo em inclusões feitas pelo SQL Editor
create or replace function public.membro_preencher_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null then
    select u.email into new.email from auth.users u where u.id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists membros_email on public.membros_empresa;
create trigger membros_email before insert on public.membros_empresa
  for each row execute function public.membro_preencher_email();

-- Vincula uma conta existente ao ambiente. Só o administrador daquele ambiente consegue.
-- Retorna 'ok' ou 'nao_encontrado' (sem conta com esse e-mail).
create or replace function public.adicionar_membro(e text, mail text, nome_membro text, papel_membro text default 'usuario')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  conta text;
begin
  if not public.admin_empresa(e) then
    raise exception 'Só o administrador do ambiente pode incluir pessoas.' using errcode = '42501';
  end if;
  select u.id, u.email into uid, conta from auth.users u where lower(u.email) = lower(trim(mail));
  if uid is null then
    return 'nao_encontrado';
  end if;
  insert into public.membros_empresa (empresa_id, user_id, nome, papel, email)
  values (e, uid, nome_membro, papel_membro, conta)
  on conflict (empresa_id, user_id) do update set nome = excluded.nome, papel = excluded.papel, email = excluded.email;
  return 'ok';
end $$;

revoke execute on function public.membro_preencher_email() from public, anon, authenticated;
revoke execute on function public.adicionar_membro(text, text, text, text) from public, anon;
grant execute on function public.adicionar_membro(text, text, text, text) to authenticated;

commit;
