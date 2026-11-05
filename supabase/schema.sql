-- =====================================================================
-- Roteirizador RRM: schema para Supabase (PostgreSQL 15 ou superior)
-- Como usar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
-- Rode uma vez, em um projeto novo. Rodar de novo só dá erro de tabela existente,
-- sem alterar nada. Para refazer do zero em um projeto de teste, veja o fim do arquivo.
--
-- Depois deste arquivo, rode também migracao_04_seguranca.sql (duas etapas, privacidade
-- e registro de atividades), migracao_05_rotas.sql (módulo Rotas) e
-- migracao_06_calendario_verba.sql (Calendário e Verba Indenizatória), nessa ordem.
--
-- Cada empresa (ambiente) tem seus próprios usuários, clientes, colaboradores
-- e estudos. A separação é feita no banco, por Row Level Security (RLS):
-- um usuário só lê e grava os dados das empresas em que é membro.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Ambientes e acesso
-- ---------------------------------------------------------------------
create table public.empresas (
  id            text primary key,                    -- 'g4', 'jarantes'... mesmo id de js/config.js
  nome          text not null,
  sigla         text not null,
  padroes       jsonb not null default '{}'::jsonb,  -- valores iniciais dos novos estudos: {"jornada":440,"vel":30}
  ponto_mar_lat double precision,                    -- onde ficam os clientes sem coordenada, se diferente do padrão
  ponto_mar_lng double precision,
  criado_em     timestamptz not null default now()
);

insert into public.empresas (id, nome, sigla) values
  ('g4', 'G4 Distribuidora', 'G4'),
  ('jarantes', 'J.Arantes', 'JA'),
  ('chok', 'Chok Distribuidora', 'CH'),
  ('grupoarantes', 'Grupo Arantes', 'GA');

-- Senha, e-mail e redefinição de senha ficam no Supabase Auth (auth.users), nunca aqui.
create table public.membros_empresa (
  empresa_id text not null references public.empresas (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  nome       text not null,
  papel      text not null default 'usuario' check (papel in ('admin', 'usuario')),
  email      text,                                     -- cópia do e-mail: o sistema não pode ler auth.users
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index membros_empresa_user_idx on public.membros_empresa (user_id);

-- Preferências de tela de cada pessoa em cada ambiente: mapa de fundo, cor, último estudo aberto
create table public.preferencias_usuario (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

-- ---------------------------------------------------------------------
-- Bases: clientes e colaboradores (cadastro mestre, usado por todos os estudos)
-- ---------------------------------------------------------------------
create table public.clientes (
  empresa_id       text not null references public.empresas (id) on delete cascade,
  sold             text not null,                     -- código do cliente, identifica o cadastro na empresa
  nome             text,
  endereco         text,
  bairro           text,
  cidade           text,
  uf               text,
  cep              text,
  lat              double precision check (lat between -90 and 90),      -- nulo = endereço ainda não encontrado ("no mar")
  lng              double precision check (lng between -180 and 180),
  visitas_mes      numeric not null default 4 check (visitas_mes >= 0),  -- 1 mensal, 2 quinzenal, 4 semanal, 8 duas por semana...
  atendimento_min  numeric check (atendimento_min >= 0),                 -- nulo = usa o padrão do estudo
  geo_origem       text,                                                 -- planilha, mapa, manual, osm, google
  geo_nivel        text,                                                 -- exato, rua, bairro, cidade
  geo_pendencia    jsonb,                                                -- {"msg": "...", "sug": {...}} quando não foi localizado
  exemplo          boolean not null default false,                       -- dados fictícios gerados pelo sistema
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  primary key (empresa_id, sold)
);
create index clientes_cidade_idx on public.clientes (empresa_id, cidade);       -- filtro por cidade no mapa da base
create index clientes_sem_coord_idx on public.clientes (empresa_id) where lat is null or lng is null;

create table public.colaboradores (
  empresa_id    text not null references public.empresas (id) on delete cascade,
  codigo        text not null,                        -- SOLD vendedor
  nome          text not null,
  funcao        text,
  endereco      text,                                 -- endereço da base de saída: início e fim das rotas
  bairro        text,
  cidade        text,
  uf            text,
  cep           text,
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  jornada_min   numeric check (jornada_min > 0),      -- nulo = usa o padrão do estudo
  cor           text,
  geo_origem    text,
  geo_nivel     text,
  geo_pendencia jsonb,
  exemplo       boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, codigo)
);

-- ---------------------------------------------------------------------
-- Estudos: cenários de setorização e roteiro sobre as bases
-- ---------------------------------------------------------------------
create table public.estudos (
  empresa_id     text not null references public.empresas (id) on delete cascade,
  id             text not null,
  nome           text not null,
  descricao      text,
  semanas        smallint not null default 4 check (semanas > 0),      -- ciclo do roteiro
  dias           smallint[] not null default '{1,2,3,4,5}' check (dias <@ '{1,2,3,4,5,6,7}'::smallint[]),  -- 1 = segunda ... 7 = domingo
  velocidade_kmh numeric not null default 25 check (velocidade_kmh > 0),
  fator_rota     numeric not null default 1.35 check (fator_rota > 0),
  jornada_min    numeric not null default 480 check (jornada_min > 0),
  atendimento_min numeric not null default 20 check (atendimento_min >= 0),
  criterio       text not null default 'tempo' check (criterio in ('tempo', 'distancia')),  -- mais rápida ou mais curta
  evita_pedagio  boolean not null default false,
  evita_terra    boolean not null default false,
  motor          text not null default 'osrm' check (motor in ('osrm', 'google')),
  pendencias     jsonb not null default '{"cli": [], "col": []}'::jsonb,  -- citados em planilha e ainda não cadastrados
  exemplo        boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  primary key (empresa_id, id)
);

-- A chave inclui o estudo porque um estudo duplicado como cenário mantém os mesmos ids de setor.
-- O colaborador não tem chave estrangeira: um roteiro importado pode citar um código ainda não cadastrado.
create table public.setores (
  empresa_id         text not null,
  estudo_id          text not null,
  id                 text not null,
  nome               text not null,
  cor                text not null,
  colaborador_codigo text,
  primary key (empresa_id, estudo_id, id),
  foreign key (empresa_id, estudo_id) references public.estudos (empresa_id, id) on delete cascade
);
create index setores_colaborador_idx on public.setores (empresa_id, colaborador_codigo);

-- Cada cliente dentro de um estudo: setor, dias, semanas e ordem de visita.
-- O cliente não tem chave estrangeira: o estudo pode citar um SOLD ainda não cadastrado e continua
-- existindo se o cadastro sair da base. A view v_visitas mostra esses casos com cliente_cadastrado = false.
create table public.estudo_clientes (
  empresa_id text not null,
  estudo_id  text not null,
  sold       text not null,
  setor_id   text,                                     -- nulo = cliente no estudo, ainda sem setor
  dias       smallint[] not null default '{}' check (dias <@ '{1,2,3,4,5,6,7}'::smallint[]),
  semanas    smallint[] not null default '{}',
  sequencia  jsonb not null default '{}'::jsonb,       -- ordem de visita em cada dia: {"1": 3, "4": 7}
  primary key (empresa_id, estudo_id, sold),
  foreign key (empresa_id, estudo_id) references public.estudos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, estudo_id, setor_id) references public.setores (empresa_id, estudo_id, id) on delete set null (setor_id)
);
create index estudo_clientes_setor_idx on public.estudo_clientes (empresa_id, estudo_id, setor_id);

-- Percurso pelas ruas já calculado de cada rota (setor × semana × dia), para não consultar o servidor de novo.
-- As rotas em si são derivadas de estudo_clientes; a view v_rotas as monta.
create table public.rotas_calculadas (
  empresa_id   text not null,
  estudo_id    text not null,
  setor_id     text not null,
  semana       smallint not null,
  dia          smallint not null check (dia between 1 and 7),
  assinatura   text not null,                          -- muda quando as visitas mudam: indica percurso desatualizado
  km           numeric not null,
  km_ida       numeric not null default 0,
  km_entre     numeric not null default 0,
  km_volta     numeric not null default 0,
  minutos      numeric not null,                       -- deslocamento
  polilinha    text,                                   -- traçado no formato encoded polyline, precisão 5
  fonte        text not null default 'osrm',           -- osrm, valhalla, google
  formato      text not null default 'rapida',         -- rapida, curta, +pedagio, +terra. Ex.: curta+pedagio
  tem_pedagio  boolean not null default false,
  km_terra     numeric,                                -- medido quando a rota foi pedida evitando terra
  calculado_em timestamptz not null default now(),
  primary key (empresa_id, estudo_id, setor_id, semana, dia),
  foreign key (empresa_id, estudo_id, setor_id) references public.setores (empresa_id, estudo_id, id) on delete cascade
);

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

-- ---------------------------------------------------------------------
-- Consultas prontas. security_invoker faz a view respeitar o RLS de quem consulta.
-- ---------------------------------------------------------------------
create view public.v_visitas with (security_invoker = true) as
select ec.empresa_id, ec.estudo_id, ec.setor_id, s.nome as setor, s.colaborador_codigo,
       sem.semana, d.dia, (ec.sequencia ->> d.dia::text)::int as ordem,
       ec.sold, c.nome as cliente, c.cidade, c.lat, c.lng, c.atendimento_min,
       c.sold is not null as cliente_cadastrado
from public.estudo_clientes ec
join public.setores s on s.empresa_id = ec.empresa_id and s.estudo_id = ec.estudo_id and s.id = ec.setor_id
cross join lateral unnest(ec.semanas) as sem (semana)
cross join lateral unnest(ec.dias) as d (dia)
left join public.clientes c on c.empresa_id = ec.empresa_id and c.sold = ec.sold;

create view public.v_rotas with (security_invoker = true) as
select v.empresa_id, v.estudo_id, v.setor_id, v.setor, v.colaborador_codigo, col.nome as colaborador,
       v.semana, v.dia, count(*) as visitas,
       r.km, r.minutos, r.fonte, r.formato, r.tem_pedagio, r.km_terra, r.calculado_em
from public.v_visitas v
left join public.colaboradores col on col.empresa_id = v.empresa_id and col.codigo = v.colaborador_codigo
left join public.rotas_calculadas r on r.empresa_id = v.empresa_id and r.estudo_id = v.estudo_id
  and r.setor_id = v.setor_id and r.semana = v.semana and r.dia = v.dia
group by v.empresa_id, v.estudo_id, v.setor_id, v.setor, v.colaborador_codigo, col.nome, v.semana, v.dia,
         r.km, r.minutos, r.fonte, r.formato, r.tem_pedagio, r.km_terra, r.calculado_em;

create view public.v_setores_resumo with (security_invoker = true) as
select s.empresa_id, s.estudo_id, s.id as setor_id, s.nome as setor, s.colaborador_codigo,
       (select count(*) from public.estudo_clientes ec
         where ec.empresa_id = s.empresa_id and ec.estudo_id = s.estudo_id and ec.setor_id = s.id) as clientes,
       (select count(*) from public.estudo_clientes ec
         where ec.empresa_id = s.empresa_id and ec.estudo_id = s.estudo_id and ec.setor_id = s.id and cardinality(ec.dias) = 0) as clientes_sem_dia,
       (select coalesce(sum(r.km), 0) from public.rotas_calculadas r
         where r.empresa_id = s.empresa_id and r.estudo_id = s.estudo_id and r.setor_id = s.id) as km_calculado
from public.setores s;

-- ---------------------------------------------------------------------
-- Data de alteração automática
-- ---------------------------------------------------------------------
create function public.tocar_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger clientes_tocar before update on public.clientes for each row execute function public.tocar_atualizado_em();
create trigger colaboradores_tocar before update on public.colaboradores for each row execute function public.tocar_atualizado_em();
create trigger estudos_tocar before update on public.estudos for each row execute function public.tocar_atualizado_em();
create trigger preferencias_tocar before update on public.preferencias_usuario for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Segurança: Row Level Security
-- Estas funções rodam com privilégio do dono para consultar membros_empresa
-- sem cair em recursão nas políticas da própria tabela.
-- ---------------------------------------------------------------------
create function public.pertence_empresa(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros_empresa m where m.empresa_id = e and m.user_id = auth.uid());
$$;

create function public.admin_empresa(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros_empresa m where m.empresa_id = e and m.user_id = auth.uid() and m.papel = 'admin');
$$;

revoke execute on function public.pertence_empresa(text) from public, anon;
revoke execute on function public.admin_empresa(text) from public, anon;
grant execute on function public.pertence_empresa(text) to authenticated;
grant execute on function public.admin_empresa(text) to authenticated;

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

alter table public.empresas             enable row level security;
alter table public.membros_empresa      enable row level security;
alter table public.preferencias_usuario enable row level security;
alter table public.clientes             enable row level security;
alter table public.colaboradores        enable row level security;
alter table public.estudos              enable row level security;
alter table public.setores              enable row level security;
alter table public.estudo_clientes      enable row level security;
alter table public.rotas_calculadas     enable row level security;
alter table public.importacoes          enable row level security;

-- Vê o próprio ambiente; só o admin altera os dados do ambiente
create policy empresas_ler on public.empresas for select to authenticated using (public.pertence_empresa(id));
create policy empresas_alterar on public.empresas for update to authenticated using (public.admin_empresa(id)) with check (public.admin_empresa(id));

-- Membros: quem é do ambiente vê os colegas; só o admin inclui, altera ou remove
create policy membros_ler on public.membros_empresa for select to authenticated using (public.pertence_empresa(empresa_id));
create policy membros_incluir on public.membros_empresa for insert to authenticated with check (public.admin_empresa(empresa_id));
create policy membros_alterar on public.membros_empresa for update to authenticated using (public.admin_empresa(empresa_id)) with check (public.admin_empresa(empresa_id));
create policy membros_remover on public.membros_empresa for delete to authenticated using (public.admin_empresa(empresa_id));

-- Preferências: cada pessoa só as próprias
create policy preferencias_proprias on public.preferencias_usuario for all to authenticated
  using (user_id = auth.uid() and public.pertence_empresa(empresa_id))
  with check (user_id = auth.uid() and public.pertence_empresa(empresa_id));

-- Dados: qualquer membro do ambiente lê e grava
create policy clientes_membros on public.clientes for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy colaboradores_membros on public.colaboradores for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy estudos_membros on public.estudos for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy setores_membros on public.setores for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy estudo_clientes_membros on public.estudo_clientes for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy rotas_calculadas_membros on public.rotas_calculadas for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));
create policy importacoes_membros on public.importacoes for all to authenticated using (public.pertence_empresa(empresa_id)) with check (public.pertence_empresa(empresa_id));

-- Sem login, nada. Com login, o que as políticas acima permitirem.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

commit;

-- =====================================================================
-- Depois de rodar: dê acesso ao primeiro usuário
-- 1. Supabase → Authentication → Users → Add user (e-mail e senha).
-- 2. Rode, trocando o e-mail e o ambiente:
--
-- insert into public.membros_empresa (empresa_id, user_id, nome, papel)
-- select 'g4', id, 'Seu nome', 'admin' from auth.users where email = 'voce@empresa.com.br';
--
-- Para refazer do zero em um projeto de TESTE (apaga todos os dados destas tabelas):
--
-- drop view if exists public.v_setores_resumo, public.v_rotas, public.v_visitas;
-- drop table if exists public.rotas_calculadas, public.estudo_clientes, public.setores, public.estudos,
--   public.colaboradores, public.clientes, public.preferencias_usuario, public.membros_empresa, public.empresas;
-- drop function if exists public.pertence_empresa(text), public.admin_empresa(text), public.tocar_atualizado_em();
-- =====================================================================
