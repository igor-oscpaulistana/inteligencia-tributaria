-- Simula, em um PostgreSQL comum, o mínimo do ambiente do Supabase necessário
-- para testar a migração: papéis, schema auth e auth.uid().
-- Uso apenas em banco de teste local (ver supabase/testes/executar.sh).

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth, public to anon, authenticated, service_role;
-- Como no Supabase: toda tabela nova do schema public nasce com ALL para os três
-- papéis. Sem isto, o teste não percebe uma permissão que a migração esqueceu
-- de retirar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
