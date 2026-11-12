import { comUsuario, erro, uuidValido } from "@/lib/api";
import { obterRepositorio } from "@/lib/servicos";

/**
 * Inventário da triagem, sem as notas de saída consideradas (que podem ser
 * milhares): escriturações e arquivos desconsiderados ou incompatíveis.
 */
export async function GET(
  _requisicao: Request,
  contexto: RouteContext<"/api/execucoes/[execucaoId]/arquivos">,
) {
  return comUsuario(async (usuario) => {
    const { execucaoId } = await contexto.params;
    if (!uuidValido(execucaoId)) return erro(400, "Execução inválida.");
    const repositorio = obterRepositorio();
    if (!(await repositorio.obterExecucao(usuario, execucaoId))) {
      return erro(404, "Execução não encontrada.");
    }
    const arquivos = await repositorio.listarArquivos(usuario, execucaoId);
    return Response.json({
      arquivos: arquivos
        .filter((a) => a.categoria !== "xml_saida")
        .slice(0, 1000)
        .map(({ caminho, nome, tamanho, categoria, situacao, detalhe, cnpj, dataReferencia }) => ({
          caminho,
          nome,
          tamanho,
          categoria,
          situacao,
          detalhe,
          cnpj,
          dataReferencia,
        })),
    });
  });
}
