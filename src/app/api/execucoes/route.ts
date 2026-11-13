import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { comUsuario, erro, uuidValido } from "@/lib/api";
import { localizarPastaCliente } from "@/lib/arquivos/leiaute";
import { competenciaValida, competenciasDoPeriodo } from "@/lib/competencia";
import { processarFila } from "@/lib/execucoes/fila";
import { LIMITE_COMPETENCIAS_POR_PEDIDO, type Execucao, type Lote } from "@/lib/execucoes/tipos";
import { criarFonteArquivos, obterConfiguracao, obterRepositorio } from "@/lib/servicos";

// A leitura dos arquivos continua depois da resposta (ver `after`); este é o
// tempo máximo que a plataforma concede à função.
export const maxDuration = 300;

/**
 * Lista de auditorias: a execução mais recente de cada cliente e competência,
 * de todos os clientes ou de um só (`?cliente=<id>`), e a situação da fila.
 */
export async function GET(requisicao: Request) {
  return comUsuario(async (usuario) => {
    const clienteId = new URL(requisicao.url).searchParams.get("cliente");
    if (clienteId !== null && !uuidValido(clienteId)) return erro(400, "Cliente inválido.");
    const repositorio = obterRepositorio();
    const [auditorias, fila] = await Promise.all([
      repositorio.listarAuditorias(usuario, clienteId ? { clienteId } : {}),
      repositorio.situacaoDaFila(usuario),
    ]);
    return Response.json({ auditorias, fila });
  });
}

/**
 * Inicia a auditoria de um cliente (pasta) em uma competência ou em um período.
 * O período vira uma execução por competência, todas no mesmo lote e na fila;
 * a leitura acontece em segundo plano, uma competência de cada vez. O cliente é
 * cadastrado na primeira auditoria. Responde 202.
 */
export async function POST(requisicao: Request) {
  return comUsuario(async (usuario) => {
    const corpo = (await requisicao.json().catch(() => null)) as
      | { pasta?: unknown; competencia?: unknown; competenciaInicial?: unknown; competenciaFinal?: unknown }
      | null;
    const nomePasta = typeof corpo?.pasta === "string" ? corpo.pasta.trim() : "";
    if (!nomePasta || nomePasta.length > 200) return erro(400, "Escolha um cliente.");

    const inicial = corpo?.competenciaInicial ?? corpo?.competencia;
    const final = corpo?.competenciaFinal ?? inicial;
    if (typeof inicial !== "string" || !competenciaValida(inicial)) {
      return erro(400, "Escolha a competência inicial.");
    }
    if (typeof final !== "string" || !competenciaValida(final)) {
      return erro(400, "Escolha a competência final.");
    }
    if (final < inicial) return erro(400, "A competência final não pode ser anterior à inicial.");
    const competencias = competenciasDoPeriodo(inicial, final);
    if (competencias.length > LIMITE_COMPETENCIAS_POR_PEDIDO) {
      return erro(400, `O período pode ter no máximo ${LIMITE_COMPETENCIAS_POR_PEDIDO} competências.`);
    }

    const config = obterConfiguracao();
    // Só vira cliente o que é pasta de "Inteligência Tributária": o cadastro usa
    // o nome devolvido pela listagem, nunca o texto recebido.
    const pasta = localizarPastaCliente(await criarFonteArquivos(config).listarRaiz(), nomePasta);
    if (!pasta) return erro(404, "A pasta deste cliente não existe em Inteligência Tributária.");

    const repositorio = obterRepositorio(config);
    const cliente = await repositorio.registrarCliente(usuario, pasta.nome);
    // Execuções que pararam no meio não devem travar a competência.
    await repositorio.sistemaEncerrarInterrompidas();

    const lote: Lote = { id: randomUUID(), periodoInicio: inicial, periodoFim: final };
    const execucoes: Execucao[] = [];
    const jaAtivas: Array<{ competencia: string; execucaoId: string }> = [];
    for (const competencia of competencias) {
      const criacao = await repositorio.criarExecucao(usuario, cliente, competencia, config.fonte, lote);
      if (criacao.tipo === "criada") execucoes.push(criacao.execucao);
      else jaAtivas.push({ competencia, execucaoId: criacao.execucaoId });
    }

    if (execucoes.length === 0) {
      return erro(
        409,
        competencias.length === 1
          ? "Já existe uma auditoria em andamento para este cliente e competência."
          : "Todas as competências deste período já têm auditoria em andamento ou na fila.",
        { execucaoId: jaAtivas[0].execucaoId, clienteId: cliente.id },
      );
    }

    after(() => processarFila({ repositorio, criarFonte: () => criarFonteArquivos(config) }));
    return Response.json(
      { clienteId: cliente.id, lote, execucao: execucoes[0], criadas: execucoes.length, jaAtivas },
      { status: 202 },
    );
  });
}
