/**
 * Fila de execuções.
 *
 * Um pedido de auditoria por período cria uma execução por competência, todas
 * "na fila". Este módulo as processa uma de cada vez, da mais antiga para a
 * mais nova, enquanto couber no tempo que a plataforma concede à função. O que
 * sobrar continua na fila e é retomado pela próxima chamada (a tela aberta
 * pede a continuação; ver POST /api/execucoes/fila).
 */

import type { FonteArquivos } from "@/lib/arquivos/tipos";
import { processarExecucao } from "./executor";
import type { Repositorio } from "./tipos";

/** Tempo útil de uma função: o limite da plataforma (300 s) com folga para gravar o resultado. */
export const TEMPO_UTIL_MS = 270_000;

export interface DependenciasFila {
  repositorio: Repositorio;
  /** Uma origem nova por execução: ela guarda os itens já listados a partir da raiz. */
  criarFonte: () => FonteArquivos;
  agora?: () => Date;
  tempoUtilMs?: number;
}

export interface ResultadoFila {
  processadas: number;
  /** true quando a fila parou por falta de tempo e ainda há execuções aguardando. */
  restam: boolean;
}

export async function processarFila({
  repositorio,
  criarFonte,
  agora = () => new Date(),
  tempoUtilMs = TEMPO_UTIL_MS,
}: DependenciasFila): Promise<ResultadoFila> {
  const inicio = agora().getTime();
  let processadas = 0;
  let maiorDuracao = 0;

  await repositorio.sistemaEncerrarInterrompidas();
  // Outro processo já está cuidando da fila: ele segue para as próximas.
  if ((await repositorio.sistemaSituacaoDaFila()).emAndamento > 0) return { processadas, restam: true };

  for (;;) {
    const proxima = await repositorio.sistemaProximaDaFila();
    if (!proxima) return { processadas, restam: false };

    // Só começa outra competência se uma leitura como a mais demorada até aqui,
    // com margem, ainda terminar dentro do tempo útil.
    const decorrido = agora().getTime() - inicio;
    if (processadas > 0 && decorrido + maiorDuracao * 1.5 > tempoUtilMs) {
      return { processadas, restam: true };
    }

    const antes = agora().getTime();
    const processou = await processarExecucao(proxima, { repositorio, fonte: criarFonte(), agora });
    if (processou) {
      processadas++;
      maiorDuracao = Math.max(maiorDuracao, agora().getTime() - antes);
    }
  }
}
