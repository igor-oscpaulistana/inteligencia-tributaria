import { formatarCompetencia } from "@/lib/competencia";
import type { PedidoDeRedacao, RedatorRelatorio, TextoRedigido } from "./tipos";

/**
 * Redator simulado: monta o texto com modelos fixos, sem chamar nenhum serviço.
 * Serve para desenvolver e testar o fluxo do relatório enquanto o OAuth da
 * OpenAI não está ativo.
 */
export class RedatorSimulado implements RedatorRelatorio {
  async redigir(pedido: PedidoDeRedacao): Promise<TextoRedigido> {
    const quantidade = pedido.achados.length;
    const prefixo = pedido.demonstracao ? "[DEMONSTRAÇÃO] " : "";
    return {
      resumo:
        `${prefixo}${pedido.cliente}, competência ${formatarCompetencia(pedido.competencia)}: ` +
        `${quantidade} ${quantidade === 1 ? "achado" : "achados"} para avaliação. Texto gerado pelo simulador.`,
      explicacoes: pedido.achados.map((achado) => ({
        achadoId: achado.id,
        texto:
          `${prefixo}${achado.titulo}. ` +
          Object.entries(achado.dados)
            .map(([campo, valor]) => `${campo}: ${valor ?? "não informado"}`)
            .join("; ") +
          ".",
      })),
      origem: { provedor: "simulador", modelo: null },
    };
  }
}
