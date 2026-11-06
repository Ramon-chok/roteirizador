-- =====================================================================
-- Route VORTEX: migração 08 · segurança avançada e auditoria LGPD
-- Rode depois das migrações 04 a 07. Pode rodar mais de uma vez.
-- Como usar: Supabase → SQL Editor → cole este arquivo → Run.
--
-- 1. Registro de atividades à prova de adulteração: cada registro leva o hash SHA-256 do anterior
--    (cadeia por ambiente), o IP de origem e o nome e o e-mail tirados do login, não do que o navegador envia.
-- 2. Auditoria feita pelo próprio banco: inclusões, alterações e exclusões de dados pessoais
--    (colaboradores e Verba Indenizatória), exclusões de clientes, estudos e bases de rotas, mudanças de
--    membros, da política e dos aceites ficam registradas mesmo se alguém usar a API sem passar pela tela.
-- 3. Bloqueio contra força bruta no servidor: depois de 5 senhas ou 5 códigos de duas etapas errados
--    seguidos, a conta fica bloqueada por 15 minutos (o tempo dobra a cada bloqueio, até 24 horas).
--    Precisa ligar os hooks em Authentication → Hooks (veja o fim do arquivo).
-- 4. Chave de criptografia por ambiente, guardada no Supabase Vault, para o sistema cifrar no navegador
--    (AES-256-GCM) o endereço e as coordenadas da base de saída dos colaboradores e os lançamentos
--    da Verba Indenizatória. No banco, esses campos ficam ilegíveis.
-- 5. LGPD: pedidos de titulares com prazo de 15 dias (art. 18 e 19), revogação do aceite (art. 8º, § 5º),
--    painel de conformidade para o administrador e função de retenção dos registros.
-- 6. Endurecimento: segunda etapa também para ver os membros e alterar a política, o último administrador
--    do ambiente não pode ser removido, cores e textos com formato e tamanho limitados.
-- =====================================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Versão da segurança do banco: o sistema liga os recursos desta migração quando a encontra
create or replace function public.seguranca_versao() returns integer
language sql immutable set search_path = '' as $$ select 8 $$;
revoke execute on function public.seguranca_versao() from public, anon;
grant execute on function public.seguranca_versao() to authenticated;

-- IP de quem fez a requisição (o Supabase passa os cabeçalhos da requisição para o banco)
create or replace function public.ip_requisicao() returns text
language plpgsql stable set search_path = '' as $$
declare h json;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  return left(nullif(trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), ''), 64);
exception when others then
  return null;
end $$;
revoke execute on function public.ip_requisicao() from public, anon, authenticated;

-- =====================================================================
-- 1. Registro de atividades à prova de adulteração
-- =====================================================================
alter table public.auditoria add column if not exists ip text;
alter table public.auditoria add column if not exists seq bigint;
alter table public.auditoria add column if not exists hash_anterior text;
alter table public.auditoria add column if not exists hash text;
create unique index if not exists auditoria_cadeia_idx on public.auditoria (empresa_id, seq);

-- O hash cobre todos os campos do registro e o hash do anterior. A data entra em microssegundos
-- desde 1970, para o resultado não depender do fuso horário de quem confere.
create or replace function public.auditoria_hash(r public.auditoria) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(concat_ws('|',
    coalesce(r.hash_anterior, ''), r.seq::text, r.empresa_id, r.user_id::text, coalesce(r.usuario, ''), coalesce(r.email, ''),
    r.acao, coalesce(r.detalhe, ''), coalesce(r.ip, ''), coalesce(r.agente, ''), (extract(epoch from r.em) * 1000000)::bigint::text
  ), 'UTF8'), 'sha256'), 'hex');
$$;
revoke execute on function public.auditoria_hash(public.auditoria) from public, anon;

-- Carimbo do servidor: data, autor, e-mail, nome, IP e o elo da cadeia. O navegador não escolhe nenhum deles.
create or replace function public.auditoria_carimbo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  quem uuid := auth.uid();
  ant public.auditoria;
begin
  new.em := clock_timestamp();
  if quem is not null then
    new.user_id := quem;
    new.email := coalesce(auth.jwt() ->> 'email', new.email);
    new.usuario := coalesce((select m.nome from public.membros_empresa m where m.empresa_id = new.empresa_id and m.user_id = quem), new.usuario);
    new.ip := public.ip_requisicao();
  else -- gravado pelo próprio banco (gatilhos, hooks, SQL Editor)
    new.user_id := coalesce(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid);
    new.ip := coalesce(new.ip, public.ip_requisicao());
  end if;
  new.usuario := left(new.usuario, 200);
  new.email := left(new.email, 320);
  new.acao := left(new.acao, 60);
  new.detalhe := left(new.detalhe, 1000);
  new.agente := left(new.agente, 300);
  -- Um registro por vez em cada ambiente, para a cadeia não se ramificar
  perform pg_advisory_xact_lock(hashtextextended('rvx:auditoria:' || new.empresa_id, 0));
  select * into ant from public.auditoria a where a.empresa_id = new.empresa_id and a.seq is not null order by a.seq desc limit 1;
  new.seq := coalesce(ant.seq, 0) + 1;
  new.hash_anterior := ant.hash;
  new.hash := public.auditoria_hash(new);
  return new;
end $$;
drop trigger if exists auditoria_carimbo on public.auditoria;
create trigger auditoria_carimbo before insert on public.auditoria for each row execute function public.auditoria_carimbo();
revoke execute on function public.auditoria_carimbo() from public, anon, authenticated;

-- Encadeia os registros que já existiam antes desta migração, na ordem em que foram gravados
do $$
declare r public.auditoria; e text; ant text; n bigint;
begin
  for e in select distinct empresa_id from public.auditoria where seq is null loop
    select coalesce(max(seq), 0), (select a.hash from public.auditoria a where a.empresa_id = e and a.seq is not null order by a.seq desc limit 1)
      into n, ant from public.auditoria where empresa_id = e;
    for r in select * from public.auditoria where empresa_id = e and seq is null order by id loop
      n := n + 1; r.seq := n; r.hash_anterior := ant; r.hash := public.auditoria_hash(r);
      update public.auditoria set seq = r.seq, hash_anterior = r.hash_anterior, hash = r.hash where id = r.id;
      ant := r.hash;
    end loop;
  end loop;
end $$;

-- Ver o registro exige a segunda etapa de quem a tem; incluir não (as entradas e os códigos errados são registrados antes dela)
drop policy if exists auditoria_mfa on public.auditoria;
create policy auditoria_mfa on public.auditoria as restrictive for select to authenticated using (public.mfa_ok(empresa_id));

-- Confere a cadeia inteira do ambiente. Devolve o total, se está íntegra, o primeiro registro com problema
-- e o hash do último registro (guarde-o: ele prova que nada foi apagado do fim depois daquele momento).
create or replace function public.auditoria_verificar(e text)
returns table (registros bigint, integro boolean, primeiro_problema bigint, ultimo_hash text, ultimo_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare r public.auditoria; ant text; inicio boolean := true;
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente pode conferir o registro.' using errcode = '42501';
  end if;
  registros := 0; integro := true;
  for r in select * from public.auditoria a where a.empresa_id = e and a.seq is not null order by a.seq loop
    registros := registros + 1;
    -- O primeiro registro que restou pode apontar para um anterior já removido pela retenção
    if (not inicio and r.hash_anterior is distinct from ant) or r.hash is distinct from public.auditoria_hash(r) then
      if integro then integro := false; primeiro_problema := r.id; end if;
    end if;
    ant := r.hash; ultimo_em := r.em; inicio := false;
  end loop;
  ultimo_hash := ant;
  return next;
end $$;
revoke execute on function public.auditoria_verificar(text) from public, anon;
grant execute on function public.auditoria_verificar(text) to authenticated;

-- =====================================================================
-- 2. Auditoria feita pelo banco
-- =====================================================================
create or replace function public.auditar_bd(e text, acao_bd text, detalhe_bd text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Ambiente sendo excluído: não há onde registrar
  if not exists (select 1 from public.empresas x where x.id = e) then return; end if;
  insert into public.auditoria (empresa_id, user_id, acao, detalhe, agente)
  values (e, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), acao_bd, left(detalhe_bd, 1000), 'banco de dados');
end $$;
revoke execute on function public.auditar_bd(text, text, text) from public, anon, authenticated;

-- Um registro por comando e por ambiente, com a quantidade e as primeiras chaves (tg_argv: rótulo, coluna-chave)
create or replace function public.auditar_lote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rotulo text := tg_argv[0];
  chave text := tg_argv[1];
  verbo text := case tg_op when 'INSERT' then 'incluído(s)' when 'UPDATE' then 'alterado(s)' else 'excluído(s)' end;
  acao_bd text := case tg_op when 'INSERT' then 'bd_inclusao' when 'UPDATE' then 'bd_alteracao' else 'bd_exclusao' end;
  x record;
begin
  if tg_op = 'DELETE' then
    for x in select v.empresa_id, count(*) as n, string_agg(to_jsonb(v) ->> chave, ', ' order by to_jsonb(v) ->> chave) as ks from velhos v group by v.empresa_id loop
      perform public.auditar_bd(x.empresa_id, acao_bd, format('%s: %s %s · %s', rotulo, x.n, verbo, left(x.ks, 400)));
    end loop;
  else
    for x in select v.empresa_id, count(*) as n, string_agg(to_jsonb(v) ->> chave, ', ' order by to_jsonb(v) ->> chave) as ks from novos v group by v.empresa_id loop
      perform public.auditar_bd(x.empresa_id, acao_bd, format('%s: %s %s · %s', rotulo, x.n, verbo, left(x.ks, 400)));
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.auditar_lote() from public, anon, authenticated;

do $$
declare
  t record;
  ev text;
begin
  -- tabela, rótulo, coluna-chave, eventos auditados
  for t in select * from (values
      ('colaboradores', 'Colaboradores', 'codigo', array['INSERT', 'UPDATE', 'DELETE']),
      ('verba', 'Verba indenizatória', 'vendedor', array['INSERT', 'UPDATE', 'DELETE']),
      ('clientes', 'Clientes', 'sold', array['DELETE']),
      ('estudos', 'Estudos', 'nome', array['DELETE']),
      ('rotas_bases', 'Bases de rotas', 'nome', array['DELETE'])
    ) as v (tab, rotulo, chave, eventos) loop
    if to_regclass('public.' || t.tab) is null then continue; end if;
    foreach ev in array array['INSERT', 'UPDATE', 'DELETE'] loop
      execute format('drop trigger if exists %I on public.%I', t.tab || '_aud_' || lower(ev), t.tab);
      if ev = any (t.eventos) then
        execute format('create trigger %I after %s on public.%I referencing %s table as %s for each statement execute function public.auditar_lote(%L, %L)',
          t.tab || '_aud_' || lower(ev), ev, t.tab, case ev when 'DELETE' then 'old' else 'new' end, case ev when 'DELETE' then 'velhos' else 'novos' end, t.rotulo, t.chave);
      end if;
    end loop;
  end loop;
end $$;

-- Membros do ambiente: inclusão, troca de perfil e remoção
create or replace function public.auditar_membros() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.auditar_bd(new.empresa_id, 'usuario_incluido', format('%s <%s> · %s', new.nome, coalesce(new.email, '—'), new.papel));
  elsif tg_op = 'UPDATE' then
    if new.papel is distinct from old.papel or new.nome is distinct from old.nome then
      perform public.auditar_bd(new.empresa_id, 'usuario_alterado', format('%s <%s> · %s → %s', new.nome, coalesce(new.email, '—'), old.papel, new.papel));
    end if;
  else
    perform public.auditar_bd(old.empresa_id, 'usuario_removido', format('%s <%s>', old.nome, coalesce(old.email, '—')));
  end if;
  return null;
end $$;
drop trigger if exists membros_auditoria on public.membros_empresa;
create trigger membros_auditoria after insert or update or delete on public.membros_empresa for each row execute function public.auditar_membros();
revoke execute on function public.auditar_membros() from public, anon, authenticated;

-- Política de segurança do ambiente
create or replace function public.auditar_politica() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.exige_2fa is distinct from old.exige_2fa or new.inatividade_min is distinct from old.inatividade_min then
    perform public.auditar_bd(new.id, 'politica', format('Duas etapas obrigatória: %s · inatividade: %s',
      case when new.exige_2fa then 'sim' else 'não' end, case when new.inatividade_min > 0 then new.inatividade_min || ' min' else 'sem limite' end));
  end if;
  return null;
end $$;
drop trigger if exists empresas_auditoria on public.empresas;
create trigger empresas_auditoria after update on public.empresas for each row execute function public.auditar_politica();
revoke execute on function public.auditar_politica() from public, anon, authenticated;

-- =====================================================================
-- 3. Bloqueio contra força bruta no servidor (hooks do Supabase Auth)
-- =====================================================================
create table if not exists public.seguranca_tentativas (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  falhas        integer not null default 0,          -- senhas erradas seguidas
  falhas_mfa    integer not null default 0,          -- códigos de duas etapas errados seguidos
  bloqueios     integer not null default 0,          -- bloqueios seguidos: o tempo dobra a cada um
  bloqueado_ate timestamptz,
  ultima_falha  timestamptz,
  aviso_falhas  integer not null default 0,          -- tentativas erradas desde o último acesso (aparecem no próximo login)
  aviso_em      timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.seguranca_tentativas enable row level security;
revoke all on public.seguranca_tentativas from public, anon, authenticated;

-- Conta uma tentativa (tipo 'senha' ou 'mfa') e decide se o login continua.
-- Devolve o formato dos hooks: {"decision": "continue"} ou {"decision": "reject", "message": ...}.
create or replace function public.tentativa_registrar(uid uuid, valido boolean, tipo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  limite constant integer := 5;
  t public.seguranca_tentativas;
  falhas_agora integer;
  ate timestamptz;
  msg text;
  e text;
begin
  if uid is null then return jsonb_build_object('decision', 'continue'); end if;
  insert into public.seguranca_tentativas (user_id) values (uid) on conflict (user_id) do nothing;
  select * into t from public.seguranca_tentativas where user_id = uid for update;

  if t.bloqueado_ate is not null and t.bloqueado_ate > now() then
    return jsonb_build_object('decision', 'reject', 'should_logout_user', true,
      'message', format('Conta bloqueada por excesso de tentativas. Tente de novo depois das %s.', to_char(t.bloqueado_ate at time zone 'America/Sao_Paulo', 'HH24:MI')));
  end if;

  if valido then
    -- Senha certa de quem tem duas etapas ainda não conclui o acesso: o histórico de bloqueios só zera com o código certo
    update public.seguranca_tentativas set
      aviso_falhas = aviso_falhas + case when tipo = 'mfa' then falhas_mfa else falhas end,
      aviso_em = coalesce(ultima_falha, aviso_em),
      falhas = case when tipo = 'senha' then 0 else falhas end,
      falhas_mfa = case when tipo = 'mfa' then 0 else falhas_mfa end,
      bloqueios = case when tipo = 'mfa' or not exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified') then 0 else bloqueios end,
      bloqueado_ate = null, atualizado_em = now()
    where user_id = uid;
    return jsonb_build_object('decision', 'continue');
  end if;

  falhas_agora := case when tipo = 'mfa' then t.falhas_mfa else t.falhas end + 1;
  if falhas_agora < limite then
    update public.seguranca_tentativas set
      falhas = case when tipo = 'senha' then falhas_agora else falhas end,
      falhas_mfa = case when tipo = 'mfa' then falhas_agora else falhas_mfa end,
      ultima_falha = now(), atualizado_em = now()
    where user_id = uid;
    return jsonb_build_object('decision', 'continue');
  end if;

  -- Bloqueia: 15 min, 30, 60… até 24 horas
  ate := now() + least(interval '15 minutes' * power(2, least(t.bloqueios, 10)), interval '24 hours');
  update public.seguranca_tentativas set
    falhas = 0, falhas_mfa = 0, bloqueios = bloqueios + 1, bloqueado_ate = ate,
    aviso_falhas = aviso_falhas + falhas_agora, aviso_em = now(), ultima_falha = now(), atualizado_em = now()
  where user_id = uid;
  msg := format('%s %s errados seguidos: conta bloqueada até %s.', limite, case when tipo = 'mfa' then 'códigos de duas etapas' else 'senhas' end,
    to_char(ate at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'));
  for e in select m.empresa_id from public.membros_empresa m where m.user_id = uid loop
    perform public.auditar_bd(e, 'conta_bloqueada', (select coalesce(u.email, uid::text) from auth.users u where u.id = uid) || ' · ' || msg);
  end loop;
  return jsonb_build_object('decision', 'reject', 'should_logout_user', true,
    'message', format('Conta bloqueada por excesso de tentativas. Tente de novo depois das %s.', to_char(ate at time zone 'America/Sao_Paulo', 'HH24:MI')));
end $$;
revoke execute on function public.tentativa_registrar(uuid, boolean, text) from public, anon, authenticated;

-- Hook "Password Verification Attempt": recebe {"user_id", "valid"}
create or replace function public.hook_senha_tentativa(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.tentativa_registrar(nullif(event ->> 'user_id', '')::uuid, coalesce((event ->> 'valid')::boolean, false), 'senha');
end $$;
-- Hook "MFA Verification Attempt": recebe {"user_id", "factor_id", "valid"}
create or replace function public.hook_mfa_tentativa(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.tentativa_registrar(nullif(event ->> 'user_id', '')::uuid, coalesce((event ->> 'valid')::boolean, false), 'mfa');
end $$;
revoke execute on function public.hook_senha_tentativa(jsonb) from public, anon, authenticated;
revoke execute on function public.hook_mfa_tentativa(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_senha_tentativa(jsonb) to supabase_auth_admin;
    grant execute on function public.hook_mfa_tentativa(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- Para a própria pessoa: tentativas erradas na conta desde o último acesso (zera ao ler)
create or replace function public.minhas_tentativas() returns table (falhas integer, ultima timestamptz, bloqueios integer)
language plpgsql security definer set search_path = '' as $$
begin
  return query
    update public.seguranca_tentativas t set aviso_falhas = 0, aviso_em = null
    from (select s.user_id, s.aviso_falhas, s.aviso_em from public.seguranca_tentativas s where s.user_id = auth.uid()) v
    where t.user_id = v.user_id and v.aviso_falhas > 0
    returning v.aviso_falhas, v.aviso_em, t.bloqueios;
end $$;
revoke execute on function public.minhas_tentativas() from public, anon;
grant execute on function public.minhas_tentativas() to authenticated;

-- Para o administrador: contas do ambiente com tentativas erradas ou bloqueadas
create or replace function public.seguranca_bloqueios(e text)
returns table (user_id uuid, nome text, email text, falhas integer, falhas_mfa integer, bloqueios integer, bloqueado_ate timestamptz, ultima_falha timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente pode ver as tentativas.' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.nome, m.email, t.falhas, t.falhas_mfa, t.bloqueios, t.bloqueado_ate, t.ultima_falha
    from public.membros_empresa m join public.seguranca_tentativas t on t.user_id = m.user_id
    where m.empresa_id = e and (t.falhas > 0 or t.falhas_mfa > 0 or t.bloqueado_ate > now() or t.bloqueios > 0)
    order by t.bloqueado_ate desc nulls last, t.ultima_falha desc nulls last;
end $$;
revoke execute on function public.seguranca_bloqueios(text) from public, anon;
grant execute on function public.seguranca_bloqueios(text) to authenticated;

create or replace function public.seguranca_desbloquear(e text, alvo uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente pode desbloquear contas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membros_empresa m where m.empresa_id = e and m.user_id = alvo) then
    raise exception 'Essa pessoa não é deste ambiente.' using errcode = '42501';
  end if;
  update public.seguranca_tentativas set falhas = 0, falhas_mfa = 0, bloqueios = 0, bloqueado_ate = null, atualizado_em = now() where user_id = alvo;
  perform public.auditar_bd(e, 'conta_desbloqueada', (select coalesce(m.nome, '') || ' <' || coalesce(m.email, '—') || '>' from public.membros_empresa m where m.empresa_id = e and m.user_id = alvo));
end $$;
revoke execute on function public.seguranca_desbloquear(text, uuid) from public, anon;
grant execute on function public.seguranca_desbloquear(text, uuid) to authenticated;

-- =====================================================================
-- 4. Chave de criptografia dos dados sensíveis (uma por ambiente)
-- O sistema cifra e decifra no navegador com AES-256-GCM. A chave fica no Supabase Vault
-- (cifrada com uma chave mestra que não vai nos backups do banco) e só é entregue a quem é
-- membro do ambiente e passou pela segunda etapa, quando a tem.
-- =====================================================================
create table if not exists public.chaves_dados (
  empresa_id text primary key references public.empresas (id) on delete cascade,
  vault_id   uuid,       -- segredo no Supabase Vault
  chave      text,       -- só quando o Vault não está disponível no projeto
  criado_em  timestamptz not null default now()
);
alter table public.chaves_dados enable row level security;
revoke all on public.chaves_dados from public, anon, authenticated;

create or replace function public.chave_dados(e text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  k public.chaves_dados;
  segredo text;
  vid uuid;
begin
  if not (public.pertence_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Sem acesso à chave deste ambiente.' using errcode = '42501';
  end if;
  select * into k from public.chaves_dados where empresa_id = e;
  if not found then
    perform pg_advisory_xact_lock(hashtextextended('rvx:chave:' || e, 0));
    select * into k from public.chaves_dados where empresa_id = e;
    if not found then
      segredo := encode(extensions.gen_random_bytes(32), 'base64');
      if to_regclass('vault.secrets') is not null then
        execute 'select vault.create_secret($1, $2, $3)' into vid
          using segredo, 'rvx_dados_' || e || '_' || to_char(now(), 'YYYYMMDDHH24MISS'), 'Route VORTEX: chave AES-256 dos dados sensíveis do ambiente ' || e;
        insert into public.chaves_dados (empresa_id, vault_id) values (e, vid);
      else
        insert into public.chaves_dados (empresa_id, chave) values (e, segredo);
      end if;
      perform public.auditar_bd(e, 'chave_criada', 'Chave de criptografia dos dados sensíveis criada' || case when vid is null then ' (sem Vault)' else ' no Supabase Vault' end);
      return segredo;
    end if;
  end if;
  if k.vault_id is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into segredo using k.vault_id;
  else
    segredo := k.chave;
  end if;
  if segredo is null then raise exception 'Chave de criptografia indisponível.' using errcode = 'P0002'; end if;
  return segredo;
end $$;
revoke execute on function public.chave_dados(text) from public, anon;
grant execute on function public.chave_dados(text) to authenticated;

-- Coordenadas da base de saída cifradas (as colunas lat/lng ficam vazias para os colaboradores cifrados)
alter table public.colaboradores add column if not exists geo_cifrado text;

-- =====================================================================
-- 5. LGPD
-- =====================================================================
-- Revogação do aceite (art. 8º, § 5º). Datas sempre do servidor.
alter table public.consentimentos add column if not exists revogado_em timestamptz;
create or replace function public.consentimento_carimbo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.aceito_em := now();
    new.revogado_em := null;
  else
    new.user_id := old.user_id; new.empresa_id := old.empresa_id; new.versao := old.versao;
    if new.revogado_em is not null and old.revogado_em is null then
      new.revogado_em := now(); new.aceito_em := old.aceito_em;
    elsif new.revogado_em is null and old.revogado_em is not null then
      new.aceito_em := now();
    else
      new.aceito_em := old.aceito_em; new.revogado_em := old.revogado_em;
    end if;
  end if;
  new.agente := left(new.agente, 300);
  return new;
end $$;
drop trigger if exists consentimento_carimbo on public.consentimentos;
create trigger consentimento_carimbo before insert or update on public.consentimentos for each row execute function public.consentimento_carimbo();
revoke execute on function public.consentimento_carimbo() from public, anon, authenticated;

create or replace function public.auditar_consentimento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (old.revogado_em is not null and new.revogado_em is null) then
    perform public.auditar_bd(new.empresa_id, 'privacidade', 'Versão ' || new.versao);
  elsif new.revogado_em is not null and old.revogado_em is null then
    perform public.auditar_bd(new.empresa_id, 'privacidade_revogada', 'Versão ' || new.versao);
  end if;
  return null;
end $$;
drop trigger if exists consentimentos_auditoria on public.consentimentos;
create trigger consentimentos_auditoria after insert or update on public.consentimentos for each row execute function public.auditar_consentimento();
revoke execute on function public.auditar_consentimento() from public, anon, authenticated;

-- Pedidos de titulares (art. 18): o titular abre, o administrador responde em até 15 dias (art. 19, II)
create table if not exists public.pedidos_titular (
  id             bigint generated always as identity primary key,
  empresa_id     text not null references public.empresas (id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  nome           text,
  email          text,
  tipo           text not null check (tipo in ('confirmacao', 'acesso', 'correcao', 'anonimizacao', 'exclusao', 'portabilidade', 'informacao', 'revogacao', 'oposicao')),
  descricao      text not null check (char_length(descricao) between 3 and 2000),
  status         text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'atendido', 'negado')),
  resposta       text check (resposta is null or char_length(resposta) <= 2000),
  criado_em      timestamptz not null default now(),
  prazo          timestamptz not null default now() + interval '15 days',
  respondido_em  timestamptz,
  respondido_por text
);
create index if not exists pedidos_titular_empresa_idx on public.pedidos_titular (empresa_id, criado_em desc);

create or replace function public.pedido_carimbo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.email := coalesce(auth.jwt() ->> 'email', new.email);
    new.nome := coalesce((select m.nome from public.membros_empresa m where m.empresa_id = new.empresa_id and m.user_id = new.user_id), new.nome);
    new.criado_em := now(); new.prazo := now() + interval '15 days';
    new.status := 'aberto'; new.resposta := null; new.respondido_em := null; new.respondido_por := null;
  else
    -- Só o andamento e a resposta mudam; o pedido em si fica como foi feito
    new.empresa_id := old.empresa_id; new.user_id := old.user_id; new.nome := old.nome; new.email := old.email;
    new.tipo := old.tipo; new.descricao := old.descricao; new.criado_em := old.criado_em; new.prazo := old.prazo;
    if new.status is distinct from old.status or new.resposta is distinct from old.resposta then
      new.respondido_em := case when new.status in ('atendido', 'negado') then now() else null end;
      new.respondido_por := (select m.nome from public.membros_empresa m where m.empresa_id = old.empresa_id and m.user_id = auth.uid());
    else
      new.respondido_em := old.respondido_em; new.respondido_por := old.respondido_por;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pedido_carimbo on public.pedidos_titular;
create trigger pedido_carimbo before insert or update on public.pedidos_titular for each row execute function public.pedido_carimbo();
revoke execute on function public.pedido_carimbo() from public, anon, authenticated;

create or replace function public.auditar_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.auditar_bd(new.empresa_id, 'titular_pedido', format('Pedido nº %s (%s): %s', new.id, new.tipo, left(new.descricao, 300)));
  elsif new.status is distinct from old.status or new.resposta is distinct from old.resposta then
    perform public.auditar_bd(new.empresa_id, 'titular_resposta', format('Pedido nº %s de %s: %s', new.id, coalesce(new.nome, new.email, '—'), new.status));
  end if;
  return null;
end $$;
drop trigger if exists pedidos_auditoria on public.pedidos_titular;
create trigger pedidos_auditoria after insert or update on public.pedidos_titular for each row execute function public.auditar_pedido();
revoke execute on function public.auditar_pedido() from public, anon, authenticated;

alter table public.pedidos_titular enable row level security;
drop policy if exists pedidos_ler on public.pedidos_titular;
drop policy if exists pedidos_incluir on public.pedidos_titular;
drop policy if exists pedidos_responder on public.pedidos_titular;
drop policy if exists pedidos_mfa on public.pedidos_titular;
create policy pedidos_ler on public.pedidos_titular for select to authenticated
  using (user_id = auth.uid() or public.admin_empresa(empresa_id));
create policy pedidos_incluir on public.pedidos_titular for insert to authenticated
  with check (user_id = auth.uid() and public.pertence_empresa(empresa_id));
create policy pedidos_responder on public.pedidos_titular for update to authenticated
  using (public.admin_empresa(empresa_id)) with check (public.admin_empresa(empresa_id));
create policy pedidos_mfa on public.pedidos_titular as restrictive for all to authenticated
  using (public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id));
revoke all on public.pedidos_titular from public, anon;
grant select, insert, update on public.pedidos_titular to authenticated;

-- Painel de conformidade do administrador: duas etapas, último acesso e aceite de cada pessoa do ambiente
create or replace function public.membros_conformidade(e text)
returns table (user_id uuid, nome text, email text, papel text, duas_etapas boolean, ultimo_acesso timestamptz,
               aceite_versao text, aceite_em timestamptz, aceite_revogado boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente pode ver o painel de conformidade.' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.nome, m.email, m.papel,
           exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'),
           u.last_sign_in_at, c.versao, c.aceito_em, c.revogado_em is not null
    from public.membros_empresa m
    left join auth.users u on u.id = m.user_id
    left join lateral (select x.versao, x.aceito_em, x.revogado_em from public.consentimentos x
                       where x.empresa_id = e and x.user_id = m.user_id order by x.aceito_em desc limit 1) c on true
    where m.empresa_id = e
    order by m.nome;
end $$;
revoke execute on function public.membros_conformidade(text) from public, anon;
grant execute on function public.membros_conformidade(text) to authenticated;

-- Retenção: apaga registros de atividade mais antigos que N anos e contadores de tentativa parados há 180 dias.
-- Só quem administra o banco roda (SQL Editor ou pg_cron, veja o fim do arquivo).
create or replace function public.lgpd_retencao(anos integer default 5) returns text
language plpgsql security definer set search_path = '' as $$
declare a bigint; t bigint;
begin
  delete from public.auditoria where em < now() - make_interval(years => greatest(anos, 1));
  get diagnostics a = row_count;
  delete from public.seguranca_tentativas where atualizado_em < now() - interval '180 days' and (bloqueado_ate is null or bloqueado_ate < now());
  get diagnostics t = row_count;
  return format('%s registro(s) de atividade e %s contador(es) de tentativa removidos.', a, t);
end $$;
revoke execute on function public.lgpd_retencao(integer) from public, anon, authenticated;

-- =====================================================================
-- 6. Endurecimento
-- =====================================================================
-- Ver os colegas e alterar membros exige a segunda etapa de quem a tem (a própria linha continua visível no login)
drop policy if exists membros_mfa on public.membros_empresa;
create policy membros_mfa on public.membros_empresa as restrictive for all to authenticated
  using (user_id = auth.uid() or public.mfa_ok(empresa_id)) with check (public.mfa_ok(empresa_id));
-- Alterar a política do ambiente também
drop policy if exists empresas_mfa on public.empresas;
create policy empresas_mfa on public.empresas as restrictive for update to authenticated
  using (public.mfa_ok(id)) with check (public.mfa_ok(id));

-- O ambiente precisa de ao menos um administrador (vale para o que vem do sistema; o SQL Editor não é afetado)
create or replace function public.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and old.papel = 'admin' and (tg_op = 'DELETE' or new.papel <> 'admin')
     and not exists (select 1 from public.membros_empresa m where m.empresa_id = old.empresa_id and m.papel = 'admin' and m.user_id <> old.user_id) then
    raise exception 'O ambiente precisa de ao menos um administrador.' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists membros_ultimo_admin on public.membros_empresa;
create trigger membros_ultimo_admin before update or delete on public.membros_empresa for each row execute function public.proteger_ultimo_admin();
revoke execute on function public.proteger_ultimo_admin() from public, anon, authenticated;

-- Inclusão de membro com perfil e nome validados
create or replace function public.adicionar_membro(e text, mail text, nome_membro text, papel_membro text default 'usuario')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  conta text;
  nm text := left(trim(regexp_replace(coalesce(nome_membro, ''), '[[:cntrl:]]', '', 'g')), 120);
begin
  if not (public.admin_empresa(e) and public.mfa_ok(e)) then
    raise exception 'Só o administrador do ambiente pode incluir pessoas.' using errcode = '42501';
  end if;
  if papel_membro not in ('admin', 'usuario') then raise exception 'Perfil inválido.' using errcode = '22023'; end if;
  if char_length(nm) < 2 then raise exception 'Informe o nome da pessoa.' using errcode = '22023'; end if;
  select u.id, u.email into uid, conta from auth.users u where lower(u.email) = lower(trim(mail));
  if uid is null then
    return 'nao_encontrado';
  end if;
  insert into public.membros_empresa (empresa_id, user_id, nome, papel, email)
  values (e, uid, nm, papel_membro, conta)
  on conflict (empresa_id, user_id) do update set nome = excluded.nome, papel = excluded.papel, email = excluded.email;
  return 'ok';
end $$;
revoke execute on function public.adicionar_membro(text, text, text, text) from public, anon;
grant execute on function public.adicionar_membro(text, text, text, text) to authenticated;

-- Formato das cores (vão para o estilo da página) e tamanho dos textos. "not valid": vale para o que for
-- gravado daqui em diante, sem barrar os dados que já existem.
do $$
declare c record;
begin
  for c in select * from (values
      ('setores', 'setores_cor_formato', 'cor ~ ''^#[0-9A-Fa-f]{3,8}$'''),
      ('colaboradores', 'colaboradores_cor_formato', 'cor is null or cor ~ ''^#[0-9A-Fa-f]{3,8}$'''),
      ('colaboradores', 'colaboradores_tamanhos', 'char_length(nome) <= 300 and char_length(coalesce(endereco, '''')) <= 4000 and char_length(coalesce(bairro, '''')) <= 2000 and char_length(coalesce(cep, '''')) <= 1000 and char_length(coalesce(geo_cifrado, '''')) <= 1000'),
      ('clientes', 'clientes_tamanhos', 'char_length(sold) <= 100 and char_length(coalesce(nome, '''')) <= 500 and char_length(coalesce(endereco, '''')) <= 1000 and char_length(coalesce(bairro, '''')) <= 300 and char_length(coalesce(cidade, '''')) <= 300'),
      ('estudos', 'estudos_tamanhos', 'char_length(nome) <= 300 and char_length(coalesce(descricao, '''')) <= 5000'),
      ('membros_empresa', 'membros_tamanhos', 'char_length(nome) <= 200')
    ) as v (tab, nome, expr) loop
    if to_regclass('public.' || c.tab) is null then continue; end if;
    execute format('alter table public.%I drop constraint if exists %I', c.tab, c.nome);
    execute format('alter table public.%I add constraint %I check (%s) not valid', c.tab, c.nome, c.expr);
  end loop;
end $$;

-- Tabelas novas: sem acesso anônimo
revoke all on public.chaves_dados, public.seguranca_tentativas, public.pedidos_titular from anon;

commit;

-- =====================================================================
-- Depois de rodar
--
-- A. Bloqueio contra força bruta no servidor (recomendado):
--    Authentication → Hooks → "Password Verification Attempt" → Postgres → public.hook_senha_tentativa
--    Authentication → Hooks → "MFA Verification Attempt"      → Postgres → public.hook_mfa_tentativa
--    (esses dois hooks existem nos planos Team e Enterprise do Supabase; sem eles, valem o CAPTCHA,
--    os limites de requisição do Supabase e o bloqueio do navegador, veja o README → Segurança).
--
-- B. Desbloquear alguém pelo SQL Editor:
--    update public.seguranca_tentativas set falhas = 0, falhas_mfa = 0, bloqueios = 0, bloqueado_ate = null
--    where user_id = (select id from auth.users where email = 'pessoa@empresa.com.br');
--
-- C. Retenção automática (uma vez por mês, com a extensão pg_cron ligada em Database → Extensions):
--    select cron.schedule('rvx-retencao', '0 3 1 * *', $$select public.lgpd_retencao(5)$$);
--
-- D. Conferir a integridade do registro de atividades de um ambiente:
--    o administrador usa Configurações → Segurança e privacidade → Auditoria → Conferir integridade.
-- =====================================================================
