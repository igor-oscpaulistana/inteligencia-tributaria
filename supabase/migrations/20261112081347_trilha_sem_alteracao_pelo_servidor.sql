-- O Supabase concede ALL ao service_role em toda tabela nova do schema public.
-- Na trilha de auditoria o servidor só deve ler e incluir: a alteração e a
-- exclusão já são barradas pelo gatilho, e aqui deixam de ser permitidas também.

revoke all on public.trilha_auditoria from service_role;
grant select, insert on public.trilha_auditoria to service_role;
