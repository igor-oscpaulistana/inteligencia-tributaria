/**
 * Executor assíncrono da auditoria.
 *
 * Roda depois que a rota já respondeu (ver `after` em /api/execucoes) e grava
 * o andamento de cada etapa no repositório. A interface lê esse registro; nada
 * do que ela mostra vem de estado local.
 *
 * Etapa 1 do piloto: só a Triagem é executada. Auditoria e Relatório ficam
 * pendentes e a Retificação permanece aguardando aprovação.
 */

import { executarTriagem, type ProgressoTriagem } from "@/lib/agentes/triagem";
import { ErroFonteArquivos, type FonteArquivos } from "@/lib/arquivos/tipos";
import type { Repositorio } from "./tipos";

const INTERVALO_PROGRESSO_MS = 400;

export interface DependenciasExecutor {
  repositorio: Repositorio;
  fonte: FonteArquivos;
  agora?: () => Date;
}

export async function processarExecucao(
  execucaoId: string,
  { repositorio, fonte, agora = () => new Date() }: DependenciasExecutor,
): Promise<void> {
  const carregada = await repositorio.sistemaCarregar(execucaoId);
  if (!carregada || carregada.execucao.status !== "na_fila") return;
  const { execucao, cliente } = carregada;
  const base = { usuarioId: null, clienteId: cliente.id, execucaoId };

  try {
    await repositorio.sistemaAtualizarExecucao(execucaoId, { status: "em_andamento" });
    await repositorio.sistemaAtualizarEtapa(execucaoId, "triagem", {
      estado: "em_andamento",
      mensagem: "Localizando XMLs e SPEDs",
      iniciadaEm: agora().toISOString(),
    });
    await repositorio.registrarEvento({
      ...base,
      acao: "triagem.iniciada",
      detalhes: { competencia: execucao.competencia, origem: fonte.tipo },
    });

    // As leituras correm em paralelo: gravamos o andamento em sequência e com
    // intervalo mínimo, para não escrever no banco a cada arquivo.
    let ultimaGravacao = 0;
    let gravacao: Promise<void> = Promise.resolve();
    const aoProgredir = (progresso: ProgressoTriagem) => {
      const instante = agora().getTime();
      const final = progresso.total !== null && progresso.atual >= progresso.total;
      if (!final && instante - ultimaGravacao < INTERVALO_PROGRESSO_MS) return;
      ultimaGravacao = instante;
      gravacao = gravacao
        .then(() =>
          repositorio.sistemaAtualizarEtapa(execucaoId, "triagem", {
            mensagem: progresso.mensagem,
            progressoAtual: progresso.atual,
            progressoTotal: progresso.total,
          }),
        )
        // O andamento é informativo: falha ao gravá-lo não derruba a triagem.
        .catch((erro) => console.warn(`[execucao ${execucaoId}] andamento não gravado`, erro));
    };

    const { resultado, arquivos } = await executarTriagem(
      fonte,
      { pastaCliente: cliente.pastaOnedrive, cnpjCadastro: cliente.cnpj, competencia: execucao.competencia },
      { aoProgredir },
    );
    await gravacao;

    await repositorio.sistemaSalvarTriagem(execucaoId, resultado, arquivos);
    const impeditivas = resultado.pendencias.filter((p) => p.gravidade === "impeditiva").length;
    await repositorio.sistemaAtualizarEtapa(execucaoId, "triagem", {
      estado: "concluida",
      mensagem: resultado.apta
        ? "Arquivos do período conferidos"
        : `Conferência concluída com ${impeditivas} ${impeditivas === 1 ? "pendência impeditiva" : "pendências impeditivas"}`,
      concluidaEm: agora().toISOString(),
    });
    await repositorio.sistemaAtualizarExecucao(execucaoId, {
      status: resultado.apta ? "triagem_concluida" : "triagem_com_pendencias",
    });
    await repositorio.registrarEvento({
      ...base,
      acao: "triagem.concluida",
      detalhes: {
        apta: resultado.apta,
        arquivosLidos: arquivos.length,
        saidas: resultado.xml.saidas,
        pendencias: resultado.pendencias.map((p) => p.codigo),
      },
    });
  } catch (erro) {
    const mensagem =
      erro instanceof ErroFonteArquivos
        ? erro.message
        : "Falha inesperada ao ler os arquivos. Tente novamente.";
    console.error(`[execucao ${execucaoId}] triagem falhou`, erro);
    await repositorio.sistemaAtualizarEtapa(execucaoId, "triagem", {
      estado: "falhou",
      mensagem,
      concluidaEm: agora().toISOString(),
    });
    await repositorio.sistemaAtualizarExecucao(execucaoId, { status: "falhou", erro: mensagem });
    await repositorio.registrarEvento({
      ...base,
      acao: "triagem.falhou",
      detalhes: {
        mensagem,
        codigo: erro instanceof ErroFonteArquivos ? erro.codigo : "inesperado",
      },
    });
  }
}
