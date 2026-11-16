-- =====================================================================
-- Route VORTEX: migração 10 · cliente visitado por mais de um setor
-- Um cliente pode estar em mais de um setor do mesmo estudo (ex.: vendedor A
-- nas semanas 1,3 e vendedor B nas 2,4). A 1ª visita fica em estudo_clientes
-- com sold = "SOLD"; as seguintes com sold = "SOLD~2", "SOLD~3"…
-- A view v_visitas passa a devolver o SOLD do cliente e a achar o cadastro dele.
-- Pode rodar mais de uma vez.
-- =====================================================================

begin;

create or replace view public.v_visitas with (security_invoker = true) as
select ec.empresa_id, ec.estudo_id, ec.setor_id, s.nome as setor, s.colaborador_codigo,
       sem.semana, d.dia, (ec.sequencia ->> d.dia::text)::int as ordem,
       regexp_replace(ec.sold, '~[0-9]+$', '') as sold, c.nome as cliente, c.cidade, c.lat, c.lng, c.atendimento_min,
       c.sold is not null as cliente_cadastrado
from public.estudo_clientes ec
join public.setores s on s.empresa_id = ec.empresa_id and s.estudo_id = ec.estudo_id and s.id = ec.setor_id
cross join lateral unnest(ec.semanas) as sem (semana)
cross join lateral unnest(ec.dias) as d (dia)
left join public.clientes c on c.empresa_id = ec.empresa_id and c.sold = regexp_replace(ec.sold, '~[0-9]+$', '');

commit;
