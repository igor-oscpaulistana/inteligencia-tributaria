import { after } from "next/server";
import { comUsuario, erro } from "@/lib/api";
import { localizarPastaCliente } from "@/lib/arquivos/leiaute";
import { competenciaValida } from "@/lib/competencia";
import { processarExecucao } from "@/lib/execucoes/executor";
import { criarFonteArquivos, obterConfiguracao, obterRepositorio } from "@/lib/servicos";

// A leitura dos arquivos continua depois da resposta (ver `after`); este é o
// tempo máximo que a plataforma concede à função.
export const maxDuration = 300;

/**
 * Inicia a auditoria de um cliente (pasta) e uma competência. O cliente é
 * cadastrado na primeira auditoria. Responde 202 e processa em segundo plano.
 */
export async function POST(requisicao: Request) {
  return comUsuario(async (usuario) => {
    const corpo = (await requisicao.json().catch(() => null)) as
      | { pasta?: unknown; competencia?: unknown }
      | null;
    const nomePasta = typeof corpo?.pasta === "string" ? corpo.pasta.trim() : "";
    if (!nomePasta || nomePasta.length > 200) return erro(400, "Escolha um cliente.");
    if (typeof corpo?.competencia !== "string" || !competenciaValida(corpo.competencia)) {
      return erro(400, "Escolha uma competência.");
    }

    const config = obterConfiguracao();
    // Só vira cliente o que é pasta de "Inteligência Tributária": o cadastro usa
    // o nome devolvido pela listagem, nunca o texto recebido.
    const pasta = localizarPastaCliente(await criarFonteArquivos(config).listarRaiz(), nomePasta);
    if (!pasta) return erro(404, "A pasta deste cliente não existe em Inteligência Tributária.");

    const repositorio = obterRepositorio(config);
    const cliente = await repositorio.registrarCliente(usuario, pasta.nome);
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
