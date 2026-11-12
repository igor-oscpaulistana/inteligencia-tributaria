import "server-only";
import { connection } from "next/server";
import { lerConfiguracao } from "@/lib/config";
import type { Usuario } from "@/lib/execucoes/tipos";
import { supabaseDoUsuario } from "@/lib/supabase/clientes";

/** Usuário da requisição e se a conta dele está autorizada a usar o sistema. */
export type UsuarioDaSessao = Usuario & { autorizado: boolean };

/** Usuário do modo de demonstração (sem Supabase): só enxerga dados fictícios. */
export const USUARIO_DEMONSTRACAO: UsuarioDaSessao = {
  id: "00000000-0000-4000-8000-0000000000aa",
  nome: "Analista de demonstração",
  email: null,
  autorizado: true,
};

/**
 * Usuário autenticado da requisição, ou null quando não há sessão.
 * Sempre lido no servidor; o navegador nunca informa quem é o usuário.
 *
 * Estar autenticado não basta: `autorizado` diz se a conta consta em
 * usuarios_autorizados. As rotas que leem o OneDrive dependem dessa conferência,
 * porque a leitura dos arquivos não passa pelas regras do banco.
 */
export async function obterUsuario(): Promise<UsuarioDaSessao | null> {
  const config = lerConfiguracao();
  if (!config.supabase) {
    await connection();
    return USUARIO_DEMONSTRACAO;
  }
  const supabase = await supabaseDoUsuario(config.supabase);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Pela sessão do usuário: a regra do banco só devolve a linha da própria conta.
  const autorizacao = await supabase
    .from("usuarios_autorizados")
    .select("usuario_id")
    .eq("usuario_id", data.user.id)
    .maybeSingle();
  if (autorizacao.error) {
    throw new Error(`Supabase (conferir autorização): ${autorizacao.error.message}`);
  }

  const metadados = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
  return {
    id: data.user.id,
    nome: metadados?.full_name ?? metadados?.name ?? data.user.email ?? "Usuário",
    email: data.user.email ?? null,
    autorizado: autorizacao.data !== null,
  };
}
