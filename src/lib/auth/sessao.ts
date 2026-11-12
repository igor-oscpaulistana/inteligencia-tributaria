import "server-only";
import { connection } from "next/server";
import { lerConfiguracao } from "@/lib/config";
import type { Usuario } from "@/lib/execucoes/tipos";
import { supabaseDoUsuario } from "@/lib/supabase/clientes";

/** Usuário do modo de demonstração (sem Supabase): só enxerga dados fictícios. */
export const USUARIO_DEMONSTRACAO: Usuario = {
  id: "00000000-0000-4000-8000-0000000000aa",
  nome: "Analista de demonstração",
  email: null,
};

/**
 * Usuário autenticado da requisição, ou null quando não há sessão.
 * Sempre lido no servidor; o navegador nunca informa quem é o usuário.
 */
export async function obterUsuario(): Promise<Usuario | null> {
  const config = lerConfiguracao();
  if (!config.supabase) {
    await connection();
    return USUARIO_DEMONSTRACAO;
  }
  const supabase = await supabaseDoUsuario(config.supabase);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const metadados = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
  return {
    id: data.user.id,
    nome: metadados?.full_name ?? metadados?.name ?? data.user.email ?? "Usuário",
    email: data.user.email ?? null,
  };
}
