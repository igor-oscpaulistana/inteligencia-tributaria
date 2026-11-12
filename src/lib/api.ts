import "server-only";
import { unstable_rethrow } from "next/navigation";
import { obterUsuario } from "@/lib/auth/sessao";
import { ErroFonteArquivos } from "@/lib/arquivos/tipos";
import type { Usuario } from "@/lib/execucoes/tipos";

export function erro(status: number, mensagem: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ erro: mensagem, ...extra }, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Executa a rota com o usuário autenticado e autorizado e traduz falhas em respostas JSON. */
export async function comUsuario(
  rota: (usuario: Usuario) => Promise<Response>,
): Promise<Response> {
  try {
    const usuario = await obterUsuario();
    if (!usuario) return erro(401, "Sessão expirada. Entre novamente.");
    if (!usuario.autorizado) return erro(403, "Sua conta não tem acesso a este sistema.");
    return await rota(usuario);
  } catch (falha) {
    // Erros de controle do próprio Next (pré-renderização, redirect) seguem adiante.
    unstable_rethrow(falha);
    if (falha instanceof ErroFonteArquivos) {
      return erro(502, falha.message, { codigo: falha.codigo });
    }
    console.error("[api] falha inesperada", falha);
    return erro(500, "Não foi possível concluir a operação.");
  }
}
