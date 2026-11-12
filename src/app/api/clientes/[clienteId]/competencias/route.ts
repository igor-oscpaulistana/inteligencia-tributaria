import { comUsuario, erro, uuidValido } from "@/lib/api";
import { listarCompetencias, localizarPastaCliente } from "@/lib/arquivos/leiaute";
import { formatarCompetencia } from "@/lib/competencia";
import { criarFonteArquivos, obterConfiguracao, obterRepositorio } from "@/lib/servicos";

/** Competências que têm pasta no OneDrive para o cliente escolhido. */
export async function GET(
  _requisicao: Request,
  contexto: RouteContext<"/api/clientes/[clienteId]/competencias">,
) {
  return comUsuario(async (usuario) => {
    const { clienteId } = await contexto.params;
    if (!uuidValido(clienteId)) return erro(400, "Cliente inválido.");

    const config = obterConfiguracao();
    // A consulta ao repositório aplica a permissão: cliente de outro usuário não aparece.
    const cliente = await obterRepositorio(config).obterCliente(usuario, clienteId);
    if (!cliente) return erro(404, "Cliente não encontrado.");

    const fonte = criarFonteArquivos(config);
    const pasta = localizarPastaCliente(await fonte.listarRaiz(), cliente.pastaOnedrive);
    const competencias = pasta ? await listarCompetencias(fonte, pasta) : [];

    return Response.json({
      origem: fonte.tipo,
      pastaEncontrada: pasta !== null,
      competencias: competencias.map((valor) => ({ valor, rotulo: formatarCompetencia(valor) })),
    });
  });
}
