/**
 * Tradução do estado registrado da execução para o que as estações mostram.
 * A cena 3D e a interface acessível usam exatamente esta mesma leitura.
 */

import { STATUS_ATIVOS, type AgenteId, type Etapa, type Execucao } from "./tipos";

export type EstadoVisual = "ocioso" | "trabalhando" | "concluido" | "falhou" | "aguardando_aprovacao";

/** Valor enviado às variáveis da cena do Spline. */
export const CODIGO_ESTADO_VISUAL: Record<EstadoVisual, number> = {
  ocioso: 0,
  trabalhando: 1,
  concluido: 2,
  falhou: 3,
  aguardando_aprovacao: 4,
};

export interface SituacaoEstacao {
  agente: AgenteId;
  visual: EstadoVisual;
  /** Texto curto exibido na estação. */
  rotulo: string;
  /** Tarefa atual, quando a execução registrou uma. */
  tarefa: string | null;
  progressoAtual: number;
  progressoTotal: number | null;
}

const AGUARDANDO_APROVACAO: Omit<SituacaoEstacao, "agente"> = {
  visual: "aguardando_aprovacao",
  rotulo: "Aguardando aprovação",
  tarefa: null,
  progressoAtual: 0,
  progressoTotal: null,
};

export function execucaoAtiva(execucao: Execucao | null): boolean {
  return execucao !== null && STATUS_ATIVOS.includes(execucao.status);
}

function situacaoDaEtapa(etapa: Etapa, execucao: Execucao): Omit<SituacaoEstacao, "agente"> {
  const base = {
    tarefa: etapa.mensagem,
    progressoAtual: etapa.progressoAtual,
    progressoTotal: etapa.progressoTotal,
  };
  switch (etapa.estado) {
    case "aguardando_aprovacao":
      return AGUARDANDO_APROVACAO;
    case "em_andamento":
      return { ...base, visual: "trabalhando", rotulo: "Trabalhando" };
    case "falhou":
      return { ...base, visual: "falhou", rotulo: "Falhou" };
    case "concluida":
      return {
        ...base,
        visual: "concluido",
        rotulo:
          etapa.agente === "triagem" && execucao.status === "triagem_com_pendencias"
            ? "Concluído com pendências"
            : "Concluído",
      };
    case "pendente": {
      if (etapa.agente === "triagem") return { ...base, visual: "ocioso", rotulo: "Na fila" };
      const triagem = execucao.etapas.find((e) => e.agente === "triagem");
      const triagemEncerrada = triagem?.estado === "concluida" || triagem?.estado === "falhou";
      return {
        ...base,
        visual: "ocioso",
        rotulo: triagemEncerrada ? "Próxima etapa do piloto" : "Aguardando etapa anterior",
      };
    }
  }
}

export function situacaoDasEstacoes(execucao: Execucao | null): SituacaoEstacao[] {
  const agentes: AgenteId[] = ["triagem", "auditoria", "relatorio", "retificacao"];
  return agentes.map((agente) => {
    if (agente === "retificacao" && !execucao) return { agente, ...AGUARDANDO_APROVACAO };
    const etapa = execucao?.etapas.find((e) => e.agente === agente);
    if (!execucao || !etapa) {
      return {
        agente,
        visual: "ocioso",
        rotulo: "Disponível",
        tarefa: null,
        progressoAtual: 0,
        progressoTotal: null,
      };
    }
    return { agente, ...situacaoDaEtapa(etapa, execucao) };
  });
}

export function resumoDaExecucao(execucao: Execucao | null): string {
  if (!execucao) return "Nenhuma auditoria iniciada";
  switch (execucao.status) {
    case "na_fila":
      return "Auditoria na fila";
    case "em_andamento":
      return "Auditoria em andamento";
    case "triagem_concluida":
      return "Triagem concluída";
    case "triagem_com_pendencias":
      return "Triagem concluída com pendências";
    case "falhou":
      return "A triagem falhou";
  }
}
