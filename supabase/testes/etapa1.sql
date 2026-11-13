-- Testes das migrações: acesso único do MVP, cadastro automático de clientes,
-- trava da Retificação, execução única por competência, trilha imutável,
-- auditoria por período e lista de auditorias.
-- Cada bloco falha com exceção se a regra não valer.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'autorizado@teste.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'colega@teste.invalid'),
  ('cccccccc-0000-4000-8000-000000000003', 'autocadastro@teste.invalid');

-- A terceira conta existe, mas não foi autorizada.
insert into public.usuarios_autorizados (usuario_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

-- Executa um comando esperando erro com o SQLSTATE informado.
create function pg_temp.espera_erro(comando text, estado text, descricao text) returns void
language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if sqlstate = estado then return; end if;
    raise exception 'FALHOU: % — esperava SQLSTATE %, veio % (%)', descricao, estado, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % — o comando deveria ter sido recusado', descricao;
end $$;

create function pg_temp.confere(condicao boolean, descricao text) returns void
language plpgsql as $$
begin
  if condicao is not true then raise exception 'FALHOU: %', descricao; end if;
end $$;

grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- --------------------------------------------------- usuário autorizado ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Cadastro automático: só nome e pasta.
insert into public.clientes (nome, pasta_onedrive) values ('Cliente Um', 'Cliente Um');
insert into public.clientes (nome, pasta_onedrive) values ('Cliente Dois', 'Cliente Dois');
select pg_temp.confere((select count(*) = 2 from public.clientes), 'autorizado vê todos os clientes');
select pg_temp.confere(
  (select count(*) = 2 from public.trilha_auditoria
    where acao = 'cliente.cadastrado' and usuario_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'cadastro de cliente registrado na trilha com o usuário');
select pg_temp.espera_erro(
  $$insert into public.clientes (nome, pasta_onedrive) values ('Repetido', 'Cliente Um')$$,
  '23505', 'pasta já cadastrada');
select pg_temp.espera_erro(
  $$insert into public.clientes (nome, pasta_onedrive, cnpj) values ('Com CNPJ', 'Outra', '11222333000181')$$,
  '42501', 'usuário não informa o CNPJ do cliente');
select pg_temp.espera_erro(
  $$update public.clientes set cnpj = '11222333000181'$$, '42501', 'usuário não altera cliente');

insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
select id, '2026-05', 'ficticia', 'Autorizado Teste' from public.clientes where pasta_onedrive = 'Cliente Um';

select pg_temp.confere(
  (select criada_por = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'na_fila' from public.execucoes),
  'execução nasce na fila e registra quem criou');
select pg_temp.confere((select count(*) = 4 from public.execucao_etapas), 'quatro etapas criadas');
select pg_temp.confere(
  (select estado = 'aguardando_aprovacao' from public.execucao_etapas where agente = 'retificacao'),
  'Retificação nasce aguardando aprovação');
select pg_temp.confere(
  (select count(*) = 1 from public.trilha_auditoria
    where acao = 'execucao.criada' and usuario_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'criação registrada na trilha com o usuário');

select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    select id, '2026-05', 'ficticia', 'Autorizado Teste' from public.clientes where pasta_onedrive = 'Cliente Um'$$,
  '23505', 'segunda execução ativa na mesma competência');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome, status)
    select id, '2026-06', 'ficticia', 'Autorizado Teste', 'triagem_concluida' from public.clientes limit 1$$,
  '42501', 'usuário não escolhe o status inicial');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    select id, '2026-13', 'ficticia', 'Autorizado Teste' from public.clientes limit 1$$,
  '23514', 'competência inválida');
select pg_temp.espera_erro(
  $$update public.execucoes set status = 'triagem_concluida'$$, '42501', 'usuário não altera execução');
select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'concluida'$$, '42501', 'usuário não altera etapa');
select pg_temp.espera_erro(
  $$insert into public.trilha_auditoria (acao) values ('forjada')$$, '42501', 'usuário não escreve na trilha');
select pg_temp.espera_erro(
  $$insert into public.usuarios_autorizados (usuario_id) values ('cccccccc-0000-4000-8000-000000000003')$$,
  '42501', 'usuário não autoriza outras contas');
commit;

-- ------------------------------------------ outro usuário autorizado vê tudo ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.confere((select count(*) = 2 from public.clientes), 'colega vê todos os clientes');
select pg_temp.confere((select count(*) = 1 from public.execucoes), 'colega vê a execução de outro usuário');
select pg_temp.confere((select count(*) = 4 from public.execucao_etapas), 'colega vê as etapas');
select pg_temp.confere((select count(*) = 3 from public.trilha_auditoria), 'colega vê a trilha');
select pg_temp.confere(
  (select count(*) = 1 from public.usuarios_autorizados), 'cada um vê só a própria autorização');
insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
select id, '2026-05', 'ficticia', 'Colega Teste' from public.clientes where pasta_onedrive = 'Cliente Dois';
commit;

-- ---------------------------------- conta autenticada, mas não autorizada ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select pg_temp.confere((select count(*) = 0 from public.clientes), 'não autorizado não vê clientes');
select pg_temp.confere((select count(*) = 0 from public.execucoes), 'não autorizado não vê execuções');
select pg_temp.confere((select count(*) = 0 from public.execucao_etapas), 'não autorizado não vê etapas');
select pg_temp.confere((select count(*) = 0 from public.trilha_auditoria), 'não autorizado não vê a trilha');
select pg_temp.espera_erro(
  $$insert into public.clientes (nome, pasta_onedrive) values ('Intruso', 'Intruso')$$,
  '42501', 'não autorizado não cadastra cliente');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    values ('11111111-0000-4000-8000-000000000001', '2026-06', 'ficticia', 'Intruso')$$,
  '42501', 'não autorizado não cria execução');
commit;

-- --------------------------------------------------------------- anônimo ---
begin;
set local role anon;
select pg_temp.espera_erro($$select * from public.clientes$$, '42501', 'anônimo não lê clientes');
select pg_temp.espera_erro($$select * from public.execucoes$$, '42501', 'anônimo não lê execuções');
select pg_temp.espera_erro(
  $$select * from public.usuarios_autorizados$$, '42501', 'anônimo não lê as autorizações');
commit;

-- ------------------------------------------------- servidor (chave secreta) ---
begin;
set local role service_role;

update public.clientes set cnpj = '11222333000181' where pasta_onedrive = 'Cliente Um';
update public.execucao_etapas
  set estado = 'em_andamento', mensagem = 'Lendo arquivos', progresso_atual = 3, progresso_total = 10
  where agente = 'triagem';
update public.execucoes set status = 'em_andamento';
select pg_temp.confere(
  (select bool_and(atualizada_em >= criada_em) from public.execucoes), 'atualização marca o horário');

select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'em_andamento' where agente = 'retificacao'$$,
  '23514', 'nem o servidor inicia a Retificação sem aprovação');
select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'concluida' where agente = 'retificacao'$$,
  '23514', 'nem o servidor conclui a Retificação sem aprovação');

insert into public.execucao_arquivos
  (execucao_id, caminho, nome, tamanho, sha256, categoria, situacao)
select id, 'Cliente Um/05-2026/XMLs/nota.xml', 'nota.xml', 100, repeat('a', 64), 'xml_saida', 'considerado'
from public.execucoes limit 1;

insert into public.trilha_auditoria (acao, execucao_id) select 'triagem.concluida', id from public.execucoes limit 1;
select pg_temp.espera_erro(
  $$update public.trilha_auditoria set acao = 'alterada'$$, '42501', 'trilha não aceita alteração');
select pg_temp.espera_erro(
  $$delete from public.trilha_auditoria$$, '42501', 'trilha não aceita exclusão');
select pg_temp.espera_erro(
  $$truncate public.trilha_auditoria$$, '42501', 'trilha não aceita truncate');
commit;

-- Mesmo o dono das tabelas é barrado pelo gatilho da trilha.
select pg_temp.espera_erro(
  $$update public.trilha_auditoria set acao = 'alterada'$$, 'P0001', 'gatilho barra alteração da trilha');
select pg_temp.espera_erro(
  $$delete from public.trilha_auditoria$$, 'P0001', 'gatilho barra exclusão da trilha');
select pg_temp.espera_erro(
  $$truncate public.trilha_auditoria$$, 'P0001', 'gatilho barra truncate da trilha');

-- Concluída a execução, uma nova pode ser criada para a mesma competência.
update public.execucoes set status = 'triagem_concluida';
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
select id, '2026-05', 'ficticia', 'Autorizado Teste' from public.clientes where pasta_onedrive = 'Cliente Um';
select pg_temp.confere((select count(*) = 3 from public.execucoes), 'nova execução após a anterior terminar');
select pg_temp.confere((select count(*) = 1 from public.execucao_arquivos), 'autorizado vê o inventário');
commit;

-- ------------------------------------- período, fila e lista de auditorias ---
-- Neste ponto: Cliente Um tem duas execuções de 2026-05 (a antiga, concluída, e
-- a nova, na fila) e Cliente Dois tem uma de 2026-05, concluída.
select pg_temp.confere(
  (select bool_and(periodo_inicio = competencia and periodo_fim = competencia and lote_id is not null)
    from public.execucoes),
  'pedido sem período vale para a própria competência');

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Pedido de um período: uma execução por competência, todas no mesmo lote.
insert into public.execucoes
  (cliente_id, competencia, origem_dados, criada_por_nome, lote_id, periodo_inicio, periodo_fim)
select c.id, mes, 'ficticia', 'Autorizado Teste', '99999999-0000-4000-8000-000000000009', '2023-01', '2023-03'
from public.clientes c, unnest(array['2023-01', '2023-02', '2023-03']) mes
where c.pasta_onedrive = 'Cliente Dois';
select pg_temp.confere(
  (select count(*) = 3 and bool_and(status = 'na_fila') from public.execucoes
    where lote_id = '99999999-0000-4000-8000-000000000009'),
  'período cria uma execução na fila por competência');
select pg_temp.confere(
  (select count(*) = 3 from public.trilha_auditoria
    where acao = 'execucao.criada' and detalhes ->> 'periodo_inicio' = '2023-01'
      and detalhes ->> 'periodo_fim' = '2023-03'),
  'trilha registra o período do pedido');
select pg_temp.confere(
  (select count(*) = 12 from public.execucao_etapas e join public.execucoes x on x.id = e.execucao_id
    where x.lote_id = '99999999-0000-4000-8000-000000000009')
  and (select count(*) = 3 from public.execucao_etapas e join public.execucoes x on x.id = e.execucao_id
    where x.lote_id = '99999999-0000-4000-8000-000000000009'
      and e.agente = 'retificacao' and e.estado = 'aguardando_aprovacao'),
  'cada competência do período tem as suas etapas e a sua Retificação bloqueada');
select pg_temp.espera_erro(
  $$insert into public.execucoes
      (cliente_id, competencia, origem_dados, criada_por_nome, periodo_inicio, periodo_fim)
    select id, '2023-04', 'ficticia', 'Autorizado Teste', '2023-01', '2023-03'
    from public.clientes where pasta_onedrive = 'Cliente Dois'$$,
  '23514', 'competência fora do período do pedido');
select pg_temp.espera_erro(
  $$insert into public.execucoes
      (cliente_id, competencia, origem_dados, criada_por_nome, periodo_inicio, periodo_fim)
    select id, '2023-04', 'ficticia', 'Autorizado Teste', '2023-1', '2023-04'
    from public.clientes where pasta_onedrive = 'Cliente Dois'$$,
  '23514', 'período em formato inválido');
select pg_temp.espera_erro(
  $$insert into public.execucoes
      (cliente_id, competencia, origem_dados, criada_por_nome, lote_id, periodo_inicio, periodo_fim)
    select id, '2023-02', 'ficticia', 'Autorizado Teste', gen_random_uuid(), '2023-02', '2023-02'
    from public.clientes where pasta_onedrive = 'Cliente Dois'$$,
  '23505', 'competência do período que já está na fila');

-- Lista: uma linha por cliente e competência, com a execução mais recente.
select pg_temp.confere(
  (select count(*) = 5 from public.auditorias_atuais), 'lista traz uma linha por cliente e competência');
select pg_temp.confere(
  (select a.status = 'na_fila' and a.cliente_nome = 'Cliente Um'
    from public.auditorias_atuais a join public.clientes c on c.id = a.cliente_id
    where c.pasta_onedrive = 'Cliente Um' and a.competencia = '2026-05'),
  'lista mostra a execução mais recente da competência');
select pg_temp.confere(
  (select notas_saida is null and pendencias_impeditivas is null and pendencias_alerta is null
    from public.auditorias_atuais where competencia = '2023-02'),
  'sem triagem, a lista não inventa números');
select pg_temp.espera_erro(
  $$update public.auditorias_atuais set status = 'triagem_concluida'$$, '55000', 'lista é só leitura');
commit;

-- O servidor grava a triagem; a lista passa a mostrar os números dela.
begin;
set local role service_role;
update public.execucoes
  set status = 'triagem_com_pendencias',
      triagem = '{"xml": {"saidas": 7}, "pendencias": [{"gravidade": "impeditiva"}, {"gravidade": "alerta"},
                 {"gravidade": "alerta"}, {"gravidade": "informativa"}]}'
  where competencia = '2023-01';
select pg_temp.confere(
  (select count(*) = 2 from public.execucoes where status = 'na_fila' and competencia like '2023-%'),
  'servidor vê o restante do período na fila');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.confere(
  (select notas_saida = 7 and pendencias_impeditivas = 1 and pendencias_alerta = 2
      and periodo_inicio = '2023-01' and periodo_fim = '2023-03'
    from public.auditorias_atuais where competencia = '2023-01'),
  'lista mostra notas de saída, pendências e o período do pedido');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select pg_temp.confere(
  (select count(*) = 0 from public.auditorias_atuais), 'não autorizado não vê a lista de auditorias');
commit;

begin;
set local role anon;
select pg_temp.espera_erro(
  $$select * from public.auditorias_atuais$$, '42501', 'anônimo não lê a lista de auditorias');
commit;

\echo 'OK: todas as regras foram verificadas.'
