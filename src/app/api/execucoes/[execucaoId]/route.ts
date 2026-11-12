import { comUsuario, erro, uuidValido } from "@/lib/api";
import { obterRepositorio } from "@/lib/servicos";

/** Estado atual da execução: etapas, andamento e resultado da triagem. */
export async function GET(
  _requisicao: Request,
  contexto: RouteContext<"/api/execucoes/[execucaoId]">,
) {
  return comUsuario(async (usuario) => {
    const { execucaoId } = await contexto.params;
    if (!uuidValido(execucaoId)) return erro(400, "Execução inválida.");
    const execucao = await obterRepositorio().obterExecucao(usuario, execucaoId);
    if (!execucao) return erro(404, "Execução não encontrada.");
    return Response.json({ execucao });
  });
}
