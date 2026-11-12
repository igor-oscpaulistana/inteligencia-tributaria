import { after } from "next/server";
import { comUsuario, erro, uuidValido } from "@/lib/api";
import { competenciaValida } from "@/lib/competencia";
import { processarExecucao } from "@/lib/execucoes/executor";
import { criarFonteArquivos, obterConfiguracao, obterRepositorio } from "@/lib/servicos";

// A leitura dos arquivos continua depois da resposta (ver `after`); este é o
// tempo máximo que a plataforma concede à função.
export const maxDuration = 300;

/** Inicia a auditoria de um cliente e uma competência. Responde 202 e processa em segundo plano. */
export async function POST(requisicao: Request) {
  return comUsuario(async (usuario) => {
    const corpo = (await requisicao.json().catch(() => null)) as
      | { clienteId?: unknown; competencia?: unknown }
      | null;
    if (!corpo || !uuidValido(corpo.clienteId)) return erro(400, "Escolha um cliente.");
    if (typeof corpo.competencia !== "string" || !competenciaValida(corpo.competencia)) {
      return erro(400, "Escolha uma competência.");
    }

    const config = obterConfiguracao();
    const repositorio = obterRepositorio(config);
    const cliente = await repositorio.obterCliente(usuario, corpo.clienteId);
    if (!cliente) return erro(404, "Cliente não encontrado.");

    const criacao = await repositorio.criarExecucao(usuario, cliente, corpo.competencia, config.fonte);
    if (criacao.tipo === "conflito") {
      return erro(409, "Já existe uma auditoria em andamento para este cliente e competência.", {
        execucaoId: criacao.execucaoId,
      });
    }

    const { execucao } = criacao;
    after(() =>
      processarExecucao(execucao.id, { repositorio, fonte: criarFonteArquivos(config) }),
    );
    return Response.json({ execucao }, { status: 202 });
  });
}
