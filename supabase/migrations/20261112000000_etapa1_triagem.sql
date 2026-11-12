-- Inteligência Tributária — Etapa 1 do piloto
-- Clientes, permissões por cliente, execuções, etapas, inventário de arquivos
-- e trilha de auditoria.
--
-- Regras de acesso:
--   * usuários autenticados só enxergam os clientes dos quais são membros;
--   * analistas e administradores podem criar execuções; leitores só consultam;
--   * andamento, triagem e inventário são gravados apenas pelo servidor
--     (chave secreta), nunca pelo navegador;
--   * a etapa de Retificação não sai de "aguardando_aprovacao" (a liberação por
--     aprovação humana do relatório chega na etapa 4 do piloto);
--   * a trilha de auditoria só aceita inclusão.

create schema if not exists privado;

create type public.papel_membro as enum ('leitor', 'analista', 'administrador');
create type public.agente as enum ('triagem', 'auditoria', 'relatorio', 'retificacao');
create type public.estado_etapa as enum
  ('pendente', 'em_andamento', 'concluida', 'falhou', 'aguardando_aprovacao');
create type public.status_execucao as enum
  ('na_fila', 'em_andamento', 'triagem_concluida', 'triagem_com_pendencias', 'falhou');
create type public.origem_dados as enum ('onedrive', 'ficticia');

-- ---------------------------------------------------------------- tabelas ---

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- CNPJ sem pontuação; aceita o formato alfanumérico.
  cnpj text check (cnpj is null or cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  -- Nome da pasta do cliente dentro de "Inteligência Tributária" no OneDrive.
  pasta_onedrive text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.cliente_membros (
  cliente_id uuid not null references public.clientes on delete cascade,
  usuario_id uuid not null references auth.users on delete cascade,
  papel public.papel_membro not null default 'analista',
  criado_em timestamptz not null default now(),
  primary key (cliente_id, usuario_id)
);
create index cliente_membros_usuario on public.cliente_membros (usuario_id);

create table public.execucoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes,
  competencia text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status public.status_execucao not null default 'na_fila',
  origem_dados public.origem_dados not null,
  criada_por uuid references auth.users default auth.uid(),
  criada_por_nome text not null,
  erro text,
  -- Resultado da Triagem (conferência de CNPJ e período, resumo e pendências).
  triagem jsonb,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index execucoes_cliente on public.execucoes (cliente_id, criada_em desc);
-- Uma única execução em andamento por cliente e competência.
create unique index execucoes_ativa_por_competencia
  on public.execucoes (cliente_id, competencia)
  where status in ('na_fila', 'em_andamento');

create table public.execucao_etapas (
  execucao_id uuid not null references public.execucoes on delete cascade,
  agente public.agente not null,
  estado public.estado_etapa not null default 'pendente',
  mensagem text,
  progresso_atual integer not null default 0,
  progresso_total integer,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  primary key (execucao_id, agente),
  constraint retificacao_exige_aprovacao
    check (agente <> 'retificacao' or estado = 'aguardando_aprovacao')
);

create table public.execucao_arquivos (
  id bigint generated always as identity primary key,
  execucao_id uuid not null references public.execucoes on delete cascade,
  caminho text not null,
  nome text not null,
  tamanho bigint not null,
  sha256 text not null,
  modificado_em timestamptz,
  categoria text not null,
  situacao text not null check (situacao in ('considerado', 'desconsiderado', 'incompativel')),
  detalhe text,
  chave text,
  cnpj text,
  data_referencia date,
  modelo text
);
create index execucao_arquivos_execucao on public.execucao_arquivos (execucao_id, categoria);

create table public.trilha_auditoria (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  usuario_id uuid,
  cliente_id uuid,
  execucao_id uuid,
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb
);
create index trilha_auditoria_cliente on public.trilha_auditoria (cliente_id, ocorrido_em desc);
create index trilha_auditoria_execucao on public.trilha_auditoria (execucao_id);

-- ---------------------------------------------------------------- funções ---

-- Papel do usuário atual no cliente. SECURITY DEFINER para que as políticas
-- possam consultar cliente_membros sem recursão; fica fora do schema exposto.
create function privado.eh_membro(p_cliente uuid, p_papeis public.papel_membro[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cliente_membros m
    where m.cliente_id = p_cliente
      and m.usuario_id = (select auth.uid())
      and (p_papeis is null or m.papel = any (p_papeis))
  );
$$;

create function privado.ao_criar_execucao()
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
    jsonb_build_object('competencia', new.competencia, 'origem', new.origem_dados)
  );
  return new;
end;
$$;

create trigger execucoes_ao_criar
  after insert on public.execucoes
  for each row execute function privado.ao_criar_execucao();

create function privado.marcar_atualizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizada_em := now();
  return new;
end;
$$;

create trigger execucoes_marcar_atualizacao
  before update on public.execucoes
  for each row execute function privado.marcar_atualizacao();

-- O andamento de uma etapa também conta como sinal de vida da execução.
create function privado.sinal_de_vida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.execucoes set atualizada_em = now() where id = new.execucao_id;
  return new;
end;
$$;

create trigger execucao_etapas_sinal_de_vida
  after update on public.execucao_etapas
  for each row execute function privado.sinal_de_vida();

create function privado.trilha_somente_inclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A trilha de auditoria não pode ser alterada nem apagada.';
end;
$$;

create trigger trilha_auditoria_imutavel
  before update or delete on public.trilha_auditoria
  for each row execute function privado.trilha_somente_inclusao();

create trigger trilha_auditoria_sem_truncate
  before truncate on public.trilha_auditoria
  for each statement execute function privado.trilha_somente_inclusao();

-- ------------------------------------------------------------- permissões ---

revoke all on public.clientes, public.cliente_membros, public.execucoes,
  public.execucao_etapas, public.execucao_arquivos, public.trilha_auditoria
  from anon, authenticated;

grant select on public.clientes, public.cliente_membros, public.execucoes,
  public.execucao_etapas, public.execucao_arquivos, public.trilha_auditoria
  to authenticated;
-- O usuário só informa cliente, competência, origem e o próprio nome; o resto
-- (status, triagem, erro) nasce com o valor padrão e só o servidor altera.
grant insert (cliente_id, competencia, origem_dados, criada_por_nome)
  on public.execucoes to authenticated;

grant all on public.clientes, public.cliente_membros, public.execucoes,
  public.execucao_etapas, public.execucao_arquivos to service_role;
grant select, insert on public.trilha_auditoria to service_role;

grant usage on schema privado to authenticated, service_role;
grant execute on function privado.eh_membro(uuid, public.papel_membro[]) to authenticated, service_role;

alter table public.clientes enable row level security;
alter table public.cliente_membros enable row level security;
alter table public.execucoes enable row level security;
alter table public.execucao_etapas enable row level security;
alter table public.execucao_arquivos enable row level security;
alter table public.trilha_auditoria enable row level security;

create policy "membros veem o cliente" on public.clientes
  for select to authenticated
  using (ativo and privado.eh_membro(id));

create policy "usuario ve as proprias permissoes" on public.cliente_membros
  for select to authenticated
  using (
    usuario_id = (select auth.uid())
    or privado.eh_membro(cliente_id, array['administrador']::public.papel_membro[])
  );

create policy "membros veem as execucoes" on public.execucoes
  for select to authenticated
  using (privado.eh_membro(cliente_id));

create policy "analistas criam execucoes" on public.execucoes
  for insert to authenticated
  with check (
    privado.eh_membro(cliente_id, array['analista', 'administrador']::public.papel_membro[])
  );

create policy "membros veem as etapas" on public.execucao_etapas
  for select to authenticated
  using (
    exists (
      select 1 from public.execucoes e
      where e.id = execucao_id and privado.eh_membro(e.cliente_id)
    )
  );

create policy "membros veem os arquivos" on public.execucao_arquivos
  for select to authenticated
  using (
    exists (
      select 1 from public.execucoes e
      where e.id = execucao_id and privado.eh_membro(e.cliente_id)
    )
  );

create policy "analistas veem a trilha" on public.trilha_auditoria
  for select to authenticated
  using (
    cliente_id is not null
    and privado.eh_membro(cliente_id, array['analista', 'administrador']::public.papel_membro[])
  );
