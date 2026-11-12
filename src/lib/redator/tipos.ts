/**
 * Redação do relatório por modelo de linguagem (etapa 3 do piloto).
 *
 * O modelo só explica achados e redige texto a partir de dados estruturados já
 * calculados em código. Ele não calcula, não altera valores e não decide o que
 * entra na retificação.
 *
 * A conexão prevista é o OAuth da OpenAI, no mesmo formato do Concilia AI. A
 * implementação de referência não estava acessível quando esta interface foi
 * escrita, então só existe o simulador; o conector real deve implementar
 * `RedatorRelatorio` sem mudar quem o chama.
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
  /** Identifica quem redigiu, para a trilha de auditoria. */
  origem: { provedor: "simulador" | "openai"; modelo: string | null };
}

export interface RedatorRelatorio {
  redigir(pedido: PedidoDeRedacao): Promise<TextoRedigido>;
}
