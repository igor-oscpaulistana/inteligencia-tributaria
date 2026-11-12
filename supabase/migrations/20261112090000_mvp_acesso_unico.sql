-- MVP: sem segregação por analista e com cadastro automático de clientes.
--
--   * Quem está em usuarios_autorizados vê e audita todos os clientes. Estar
--     autenticado não basta: uma conta criada por autocadastro não enxerga nada
--     enquanto não for incluída na lista.
--   * O cliente é cadastrado quando alguém pede a auditoria de uma pasta de
--     "Inteligência Tributária". O usuário informa só o nome e a pasta; o CNPJ
--     é gravado pelo servidor, a partir da EFD-Contribuições lida na Triagem.
--   * cliente_membros fica sem uso enquanto durar o MVP; volta a valer se a
--     segregação por cliente for retomada.

create table public.usuarios_autorizados (
  usuario_id uuid primary key references auth.users on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.usuarios_autorizados enable row level security;
revoke all on public.usuarios_autorizados from anon, authenticated;
grant select on public.usuarios_autorizados to authenticated;
grant all on public.usuarios_autorizados to service_role;

create policy "usuario ve a propria autorizacao" on public.usuarios_autorizados
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create function privado.tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_autorizados u where u.usuario_id = (select auth.uid())
  );
$$;

grant execute on function privado.tem_acesso() to authenticated, service_role;

comment on table public.cliente_membros is
  'Sem uso no MVP: o acesso é único (usuarios_autorizados). Reservada para a segregação por cliente.';

-- ----------------------------------------------- políticas: acesso único ---

alter policy "membros veem o cliente" on public.clientes
  using (ativo and privado.tem_acesso());
alter policy "membros veem o cliente" on public.clientes
  rename to "usuarios autorizados veem os clientes";

alter policy "membros veem as execucoes" on public.execucoes
  using (privado.tem_acesso());
alter policy "membros veem as execucoes" on public.execucoes
  rename to "usuarios autorizados veem as execucoes";

alter policy "analistas criam execucoes" on public.execucoes
  with check (privado.tem_acesso());
alter policy "analistas criam execucoes" on public.execucoes
  rename to "usuarios autorizados criam execucoes";

alter policy "membros veem as etapas" on public.execucao_etapas
  using (privado.tem_acesso());
alter policy "membros veem as etapas" on public.execucao_etapas
  rename to "usuarios autorizados veem as etapas";

alter policy "membros veem os arquivos" on public.execucao_arquivos
  using (privado.tem_acesso());
alter policy "membros veem os arquivos" on public.execucao_arquivos
  rename to "usuarios autorizados veem os arquivos";

alter policy "analistas veem a trilha" on public.trilha_auditoria
  using (privado.tem_acesso());
alter policy "analistas veem a trilha" on public.trilha_auditoria
  rename to "usuarios autorizados veem a trilha";

-- ------------------------------------------ cadastro automático do cliente ---

grant insert (nome, pasta_onedrive) on public.clientes to authenticated;

create policy "usuarios autorizados cadastram clientes" on public.clientes
  for insert to authenticated
  with check (privado.tem_acesso());

create function privado.ao_cadastrar_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trilha_auditoria (usuario_id, cliente_id, acao, detalhes)
  values (
    (select auth.uid()), new.id, 'cliente.cadastrado',
    jsonb_build_object('nome', new.nome, 'pasta', new.pasta_onedrive)
  );
  return new;
end;
$$;

create trigger clientes_ao_cadastrar
  after insert on public.clientes
  for each row execute function privado.ao_cadastrar_cliente();
