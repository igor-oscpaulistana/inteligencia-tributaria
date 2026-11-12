-- Testes da migração da etapa 1: permissões por cliente, trava da Retificação,
-- execução única por competência e trilha de auditoria imutável.
-- Cada bloco falha com exceção se a regra não valer.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'analista@teste.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'leitor@teste.invalid'),
  ('cccccccc-0000-4000-8000-000000000003', 'outro@teste.invalid');

insert into public.clientes (id, nome, cnpj, pasta_onedrive) values
  ('11111111-0000-4000-8000-000000000001', 'Cliente Um', '11222333000181', 'Cliente Um'),
  ('22222222-0000-4000-8000-000000000002', 'Cliente Dois', '11444777000161', 'Cliente Dois');

insert into public.cliente_membros (cliente_id, usuario_id, papel) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'analista'),
  ('11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'leitor'),
  ('22222222-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003', 'analista');

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

-- ------------------------------------------------------------- analista ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.confere((select count(*) = 1 from public.clientes), 'analista vê só o próprio cliente');

insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
values ('11111111-0000-4000-8000-000000000001', '2026-05', 'ficticia', 'Analista Teste');

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
    values ('11111111-0000-4000-8000-000000000001', '2026-05', 'ficticia', 'Analista Teste')$$,
  '23505', 'segunda execução ativa na mesma competência');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    values ('22222222-0000-4000-8000-000000000002', '2026-05', 'ficticia', 'Analista Teste')$$,
  '42501', 'execução em cliente sem permissão');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome, status)
    values ('11111111-0000-4000-8000-000000000001', '2026-06', 'ficticia', 'Analista Teste', 'triagem_concluida')$$,
  '42501', 'usuário não escolhe o status inicial');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    values ('11111111-0000-4000-8000-000000000001', '2026-13', 'ficticia', 'Analista Teste')$$,
  '23514', 'competência inválida');
select pg_temp.espera_erro(
  $$update public.execucoes set status = 'triagem_concluida'$$, '42501', 'usuário não altera execução');
select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'concluida'$$, '42501', 'usuário não altera etapa');
select pg_temp.espera_erro(
  $$insert into public.trilha_auditoria (acao) values ('forjada')$$, '42501', 'usuário não escreve na trilha');
commit;

-- --------------------------------------------------------------- leitor ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.confere((select count(*) = 1 from public.execucoes), 'leitor consulta a execução');
select pg_temp.confere((select count(*) = 0 from public.trilha_auditoria), 'leitor não vê a trilha');
select pg_temp.espera_erro(
  $$insert into public.execucoes (cliente_id, competencia, origem_dados, criada_por_nome)
    values ('11111111-0000-4000-8000-000000000001', '2026-06', 'ficticia', 'Leitor Teste')$$,
  '42501', 'leitor não cria execução');
commit;

-- ------------------------------------------------- usuário de outro cliente ---
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';
select pg_temp.confere(
  (select count(*) = 1 and min(nome) = 'Cliente Dois' from public.clientes), 'vê só o Cliente Dois');
select pg_temp.confere((select count(*) = 0 from public.execucoes), 'não vê execuções de outro cliente');
select pg_temp.confere((select count(*) = 0 from public.execucao_etapas), 'não vê etapas de outro cliente');
select pg_temp.confere((select count(*) = 0 from public.trilha_auditoria), 'não vê trilha de outro cliente');
select pg_temp.confere(
  (select count(*) = 1 from public.cliente_membros), 'vê só a própria permissão');
commit;

-- --------------------------------------------------------------- anônimo ---
begin;
set local role anon;
select pg_temp.espera_erro($$select * from public.clientes$$, '42501', 'anônimo não lê clientes');
select pg_temp.espera_erro($$select * from public.execucoes$$, '42501', 'anônimo não lê execuções');
commit;

-- ------------------------------------------------- servidor (chave secreta) ---
begin;
set local role service_role;

update public.execucao_etapas
  set estado = 'em_andamento', mensagem = 'Lendo arquivos', progresso_atual = 3, progresso_total = 10
  where agente = 'triagem';
update public.execucoes set status = 'em_andamento';
select pg_temp.confere(
  (select atualizada_em >= criada_em from public.execucoes), 'atualização marca o horário');

select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'em_andamento' where agente = 'retificacao'$$,
  '23514', 'nem o servidor inicia a Retificação sem aprovação');
select pg_temp.espera_erro(
  $$update public.execucao_etapas set estado = 'concluida' where agente = 'retificacao'$$,
  '23514', 'nem o servidor conclui a Retificação sem aprovação');

insert into public.execucao_arquivos
  (execucao_id, caminho, nome, tamanho, sha256, categoria, situacao)
select id, 'Cliente Um/05-2026/XMLs/nota.xml', 'nota.xml', 100, repeat('a', 64), 'xml_saida', 'considerado'
from public.execucoes;

insert into public.trilha_auditoria (acao, execucao_id) select 'triagem.concluida', id from public.execucoes;
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
values ('11111111-0000-4000-8000-000000000001', '2026-05', 'ficticia', 'Analista Teste');
select pg_temp.confere((select count(*) = 2 from public.execucoes), 'nova execução após a anterior terminar');
select pg_temp.confere((select count(*) = 1 from public.execucao_arquivos), 'analista vê o inventário');
commit;

\echo 'OK: todas as regras da etapa 1 foram verificadas.'
