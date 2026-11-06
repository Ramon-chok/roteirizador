-- =====================================================================
-- Route VORTEX: migração 09 · bloqueio de tentativas por IP
-- Rode depois da migração 08. Pode rodar mais de uma vez.
-- =====================================================================

begin;

create or replace function public.seguranca_versao() returns integer
language sql immutable set search_path = '' as $$ select 9 $$;
revoke execute on function public.seguranca_versao() from public;
grant execute on function public.seguranca_versao() to anon, authenticated;

create table if not exists public.seguranca_tentativas_ip (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  ip            inet not null,
  falhas        integer not null default 0,
  janela_inicio timestamptz,
  bloqueios     integer not null default 0,
  bloqueado_ate timestamptz,
  ultima_falha  timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, ip)
);
create index if not exists seguranca_tentativas_ip_atualizado_idx
  on public.seguranca_tentativas_ip (empresa_id, atualizado_em);
alter table public.seguranca_tentativas_ip enable row level security;
revoke all on public.seguranca_tentativas_ip from public, anon, authenticated;

create or replace function public.ip_login_origem() returns inet
language plpgsql stable security definer set search_path = '' as $$
declare
  ip_texto text := public.ip_requisicao();
begin
  if ip_texto is null then
    raise exception 'O servidor não identificou o IP de origem.' using errcode = '42501';
  end if;
  begin
    return ip_texto::inet;
  exception when invalid_text_representation then
    raise exception 'O servidor não conseguiu validar o IP de origem.' using errcode = '42501';
  end;
end $$;
revoke execute on function public.ip_login_origem() from public, anon, authenticated;

create or replace function public.seguranca_ip_verificar(e text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ip_atual inet := public.ip_login_origem();
  t public.seguranca_tentativas_ip;
begin
  if not exists (select 1 from public.empresas x where x.id = e) then
    raise exception 'Ambiente inválido.' using errcode = '22023';
  end if;

  delete from public.seguranca_tentativas_ip
  where empresa_id = e
    and atualizado_em < now() - interval '90 days'
    and coalesce(bloqueado_ate, '-infinity'::timestamptz) <= now();

  select * into t
  from public.seguranca_tentativas_ip
  where empresa_id = e and ip = ip_atual
  for update;

  if not found then
    return jsonb_build_object('decision', 'continue');
  end if;

  if t.bloqueado_ate > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', format('Acesso bloqueado para este IP até %s.', to_char(t.bloqueado_ate at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
      'bloqueado_ate', t.bloqueado_ate
    );
  end if;

  if t.bloqueado_ate is not null then
    update public.seguranca_tentativas_ip
    set falhas = 0, janela_inicio = null, bloqueado_ate = null, atualizado_em = now()
    where empresa_id = e and ip = ip_atual;
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;
revoke execute on function public.seguranca_ip_verificar(text) from public;
grant execute on function public.seguranca_ip_verificar(text) to anon, authenticated;

create or replace function public.seguranca_ip_falha(e text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ip_atual inet := public.ip_login_origem();
  t public.seguranca_tentativas_ip;
  falhas_agora integer;
  inicio_janela timestamptz;
  ate timestamptz;
  limite constant integer := 20;
begin
  if not exists (select 1 from public.empresas x where x.id = e) then
    raise exception 'Ambiente inválido.' using errcode = '22023';
  end if;

  insert into public.seguranca_tentativas_ip (empresa_id, ip)
  values (e, ip_atual)
  on conflict (empresa_id, ip) do nothing;

  select * into t
  from public.seguranca_tentativas_ip
  where empresa_id = e and ip = ip_atual
  for update;

  if t.bloqueado_ate > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', format('Acesso bloqueado para este IP até %s.', to_char(t.bloqueado_ate at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
      'bloqueado_ate', t.bloqueado_ate
    );
  end if;

  if t.bloqueado_ate is not null then
    t.falhas := 0;
    t.janela_inicio := null;
  end if;
  if t.janela_inicio is null or t.janela_inicio < now() - interval '15 minutes' then
    falhas_agora := 1;
    inicio_janela := now();
  else
    falhas_agora := t.falhas + 1;
    inicio_janela := t.janela_inicio;
  end if;

  if falhas_agora > limite then
    ate := now() + least(interval '15 minutes' * power(2::double precision, least(t.bloqueios, 10)::double precision), interval '24 hours');
    update public.seguranca_tentativas_ip
    set falhas = 0, janela_inicio = null, bloqueios = bloqueios + 1,
        bloqueado_ate = ate, ultima_falha = now(), atualizado_em = now()
    where empresa_id = e and ip = ip_atual;
    return jsonb_build_object(
      'decision', 'reject',
      'message', format('Acesso bloqueado para este IP até %s.', to_char(ate at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
      'bloqueado_ate', ate
    );
  end if;

  update public.seguranca_tentativas_ip
  set falhas = falhas_agora, janela_inicio = inicio_janela,
      bloqueado_ate = null, ultima_falha = now(), atualizado_em = now()
  where empresa_id = e and ip = ip_atual;
  return jsonb_build_object('decision', 'continue', 'falhas', falhas_agora);
end $$;
revoke execute on function public.seguranca_ip_falha(text) from public;
grant execute on function public.seguranca_ip_falha(text) to anon, authenticated;

create or replace function public.seguranca_ip_sucesso(e text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ip_atual inet := public.ip_login_origem();
begin
  if auth.uid() is null or not public.pertence_empresa(e) then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  update public.seguranca_tentativas_ip
  set falhas = 0, janela_inicio = null, bloqueios = 0,
      bloqueado_ate = null, atualizado_em = now()
  where empresa_id = e and ip = ip_atual;
end $$;
revoke execute on function public.seguranca_ip_sucesso(text) from public, anon;
grant execute on function public.seguranca_ip_sucesso(text) to authenticated;

create or replace function public.seguranca_ips_bloqueados(e text)
returns table (ip text, falhas integer, bloqueios integer, bloqueado_ate timestamptz, ultima_falha timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente com verificação em duas etapas pode ver os IPs.' using errcode = '42501';
  end if;
  return query
    select t.ip::text, t.falhas, t.bloqueios, t.bloqueado_ate, t.ultima_falha
    from public.seguranca_tentativas_ip t
    where t.empresa_id = e and (t.falhas > 0 or t.bloqueios > 0 or t.bloqueado_ate > now())
    order by t.bloqueado_ate desc nulls last, t.ultima_falha desc nulls last;
end $$;
revoke execute on function public.seguranca_ips_bloqueados(text) from public, anon;
grant execute on function public.seguranca_ips_bloqueados(text) to authenticated;

create or replace function public.seguranca_ip_desbloquear(e text, alvo inet) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente com verificação em duas etapas pode desbloquear IPs.' using errcode = '42501';
  end if;
  update public.seguranca_tentativas_ip
  set falhas = 0, janela_inicio = null, bloqueios = 0,
      bloqueado_ate = null, atualizado_em = now()
  where empresa_id = e and ip = alvo;
  perform public.auditar_bd(e, 'ip_desbloqueado', 'Desbloqueou um IP bloqueado');
end $$;
revoke execute on function public.seguranca_ip_desbloquear(text, inet) from public, anon;
grant execute on function public.seguranca_ip_desbloquear(text, inet) to authenticated;

commit;
