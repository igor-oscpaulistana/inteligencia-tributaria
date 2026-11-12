/**
 * Redação do relatório por modelo de linguagem (etapa 3 do piloto).
 *
 * O modelo só explica achados e redige texto a partir de dados estruturados já
 * calculados em código. Ele não calcula, não altera valores e não decide o que
 * entra na retificação.
 *
 * O redator real usa o Claude Opus pela API da Anthropic, no mesmo formato do
 * HUB do Paralegal (ver ./claude.ts). Sem ANTHROPIC_API_KEY, entra o simulador.
 */

export interface AchadoParaRedacao {
  /** Identificador estável do achado (ex.: código da pendência ou chave da NF-e). */
  id: string;
  titulo: string;
  /** Dados já calculados, exibidos como estão. O redator não os recalcula. */
  dados: Record<string, string | number | boolean | null>;
}

export interface PedidoDeRedacao {
  cliente: string;
  /** "AAAA-MM" */
  competencia: string;
  achados: AchadoParaRedacao[];
  /** true quando os dados são fictícios; o texto deve dizer que é demonstração. */
  demonstracao: boolean;
}

export interface TextoRedigido {
  resumo: string;
  explicacoes: Array<{ achadoId: string; texto: string }>;
  /** Quem redigiu e quanto consumiu, para a trilha de auditoria. */
  origem: {
    provedor: "simulador" | "anthropic";
    modelo: string | null;
    tokensEntrada: number | null;
    tokensSaida: number | null;
  };
}

export interface RedatorRelatorio {
  redigir(pedido: PedidoDeRedacao): Promise<TextoRedigido>;
}
