-- Auditoria por período e fila de execuções.
--
--   * Uma auditoria pode ser pedida para um período (por exemplo, 01/2023 a
--     12/2023). O pedido vira uma execução por competência, todas com o mesmo
--     lote_id e o mesmo período. A conferência e, depois, a retificação
--     continuam mensais; o período serve para acompanhar e consolidar.
--   * As execuções de um pedido ficam na fila e são processadas em sequência.
--   * A visão auditorias_atuais traz a execução mais recente de cada cliente e
--     competência, com os números que a lista de auditorias mostra.

alter table public.execucoes
  add column lote_id uuid,
  add column periodo_inicio text
    constraint execucoes_periodo_inicio_formato check (periodo_inicio ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add column periodo_fim text
    constraint execucoes_periodo_fim_formato check (periodo_fim ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Execuções anteriores: cada uma é um pedido de uma única competência.
update public.execucoes
  set lote_id = id, periodo_inicio = competencia, periodo_fim = competencia;

-- Pedido sem período informado vale para a própria competência.
create function privado.preencher_periodo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.lote_id := coalesce(new.lote_id, gen_random_uuid());
  new.periodo_inicio := coalesce(new.periodo_inicio, new.competencia);
  new.periodo_fim := coalesce(new.periodo_fim, new.competencia);
  return new;
end;
$$;

create trigger execucoes_preencher_periodo
  before insert on public.execucoes
  for each row execute function privado.preencher_periodo();

alter table public.execucoes
  alter column lote_id set not null,
  alter column periodo_inicio set not null,
  alter column periodo_fim set not null,
  add constraint execucoes_competencia_no_periodo
    check (periodo_inicio <= competencia and competencia <= periodo_fim);

create index execucoes_lote on public.execucoes (lote_id);
create index execucoes_fila on public.execucoes (criada_em, competencia) where status = 'na_fila';

grant insert (lote_id, periodo_inicio, periodo_fim) on public.execucoes to authenticated;

-- A trilha passa a registrar o período e o lote do pedido.
create or replace function privado.ao_criar_execucao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.execucao_etapas (execucao_id, agente, estado)
  values
    (new.id, 'triagem', 'pendente'),
    (new.id, 'auditoria', 'pendente'),
    (new.id, 'relatorio', 'pendente'),
    (new.id, 'retificacao', 'aguardando_aprovacao');

  insert into public.trilha_auditoria (usuario_id, cliente_id, execucao_id, acao, detalhes)
  values (
    new.criada_por, new.cliente_id, new.id, 'execucao.criada',
    jsonb_build_object(
      'competencia', new.competencia,
      'origem', new.origem_dados,
      'periodo_inicio', new.periodo_inicio,
      'periodo_fim', new.periodo_fim,
      'lote', new.lote_id
    )
  );
  return new;
end;
$$;

-- Execução mais recente de cada cliente e competência. security_invoker: quem
-- consulta só vê o que as políticas de execucoes e clientes permitem.
create view public.auditorias_atuais
with (security_invoker = true) as
select distinct on (e.cliente_id, e.competencia)
  e.id,
  e.cliente_id,
  c.nome as cliente_nome,
  e.competencia,
  e.status,
  e.origem_dados,
  e.erro,
  e.criada_por_nome,
  e.criada_em,
  e.atualizada_em,
  e.lote_id,
  e.periodo_inicio,
  e.periodo_fim,
  (e.triagem -> 'xml' ->> 'saidas')::integer as notas_saida,
  case when e.triagem is null then null else (
    select count(*)::integer
    from jsonb_array_elements(coalesce(e.triagem -> 'pendencias', '[]'::jsonb)) p
    where p ->> 'gravidade' = 'impeditiva'
  ) end as pendencias_impeditivas,
  case when e.triagem is null then null else (
    select count(*)::integer
    from jsonb_array_elements(coalesce(e.triagem -> 'pendencias', '[]'::jsonb)) p
    where p ->> 'gravidade' = 'alerta'
  ) end as pendencias_alerta
from public.execucoes e
join public.clientes c on c.id = e.cliente_id
order by e.cliente_id, e.competencia, e.criada_em desc;

revoke all on public.auditorias_atuais from anon, authenticated;
grant select on public.auditorias_atuais to authenticated, service_role;
