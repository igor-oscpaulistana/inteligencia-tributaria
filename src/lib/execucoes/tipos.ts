import type { ArquivoTriado, ResultadoTriagem } from "@/lib/agentes/triagem";
import type { TipoFonte } from "@/lib/arquivos/tipos";

export const AGENTES = ["triagem", "auditoria", "relatorio", "retificacao"] as const;
export type AgenteId = (typeof AGENTES)[number];

export type EstadoEtapa =
  | "pendente"
  | "em_andamento"
  | "concluida"
  | "falhou"
  /** Estado da Retificação até que um analista aprove o relatório. */
  | "aguardando_aprovacao";

export type StatusExecucao =
  | "na_fila"
  | "em_andamento"
  | "triagem_concluida"
  | "triagem_com_pendencias"
  | "falhou";

export const STATUS_ATIVOS: StatusExecucao[] = ["na_fila", "em_andamento"];

export interface Usuario {
  id: string;
  nome: string;
  email: string | null;
}

export interface Cliente {
  id: string;
  nome: string;
  cnpj: string | null;
  /** Nome da pasta do cliente dentro de "Inteligência Tributária". */
  pastaOnedrive: string;
}

export interface Etapa {
  agente: AgenteId;
  estado: EstadoEtapa;
  mensagem: string | null;
  progressoAtual: number;
  progressoTotal: number | null;
  iniciadaEm: string | null;
  concluidaEm: string | null;
}

export interface Execucao {
  id: string;
  clienteId: string;
  clienteNome: string;
  /** "AAAA-MM" */
  competencia: string;
  status: StatusExecucao;
  origemDados: TipoFonte;
  criadaPorNome: string;
  criadaEm: string;
  atualizadaEm: string;
  erro: string | null;
  /** Pedido que criou a execução; as competências de um mesmo período compartilham o lote. */
  loteId: string;
  /** Período pedido, em "AAAA-MM"; igual à competência quando o pedido foi de um mês só. */
  periodoInicio: string;
  periodoFim: string;
  etapas: Etapa[];
  triagem: ResultadoTriagem | null;
}

/** Período de um pedido de auditoria: uma execução por competência, todas no mesmo lote. */
export interface Lote {
  id: string;
  periodoInicio: string;
  periodoFim: string;
}

/** Linha da lista de auditorias: a execução mais recente de um cliente e competência. */
export interface ResumoAuditoria {
  id: string;
  clienteId: string;
  clienteNome: string;
  competencia: string;
  status: StatusExecucao;
  origemDados: TipoFonte;
  erro: string | null;
  criadaPorNome: string;
  criadaEm: string;
  atualizadaEm: string;
  loteId: string;
  periodoInicio: string;
  periodoFim: string;
  /** Números da triagem; null enquanto ela não terminou. */
  notasSaida: number | null;
  pendenciasImpeditivas: number | null;
  pendenciasAlerta: number | null;
}

export interface SituacaoFila {
  naFila: number;
  emAndamento: number;
}

export type AtualizacaoEtapa = Partial<Omit<Etapa, "agente">>;

export interface EventoAuditoria {
  acao: string;
  usuarioId: string | null;
  clienteId: string | null;
  execucaoId: string | null;
  detalhes: Record<string, unknown>;
}

export type ResultadoCriacao =
  | { tipo: "criada"; execucao: Execucao }
  /** Já existe execução em andamento para o mesmo cliente e competência. */
  | { tipo: "conflito"; execucaoId: string };

/**
 * Persistência de clientes, execuções e trilha de auditoria.
 *
 * No MVP não há segregação por analista: todo usuário autorizado vê todos os
 * clientes. Os métodos que recebem `usuario` passam pela sessão dele; os métodos
 * `sistema*` são usados pelo executor, depois que a execução já foi autorizada.
 */
export interface Repositorio {
  /**
   * Localiza o cliente pela pasta do OneDrive ou o cadastra, se ainda não existir.
   * Quem chama já conferiu que a pasta existe em "Inteligência Tributária".
   */
  registrarCliente(usuario: Usuario, pasta: string): Promise<Cliente>;
  obterCliente(usuario: Usuario, clienteId: string): Promise<Cliente | null>;
  /** Cria a execução de uma competência dentro do lote (pedido) informado. */
  criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
    lote: Lote,
  ): Promise<ResultadoCriacao>;
  obterExecucao(usuario: Usuario, execucaoId: string): Promise<Execucao | null>;
  /**
   * Execução que o escritório mostra: a que está em andamento; sem ela, a
   * próxima da fila; sem fila, a mais recente.
   */
  execucaoEmFoco(usuario: Usuario): Promise<Execucao | null>;
  /** Execução mais recente de cada cliente e competência, opcionalmente de um só cliente. */
  listarAuditorias(usuario: Usuario, filtro?: { clienteId?: string }): Promise<ResumoAuditoria[]>;
  situacaoDaFila(usuario: Usuario): Promise<SituacaoFila>;
  listarArquivos(usuario: Usuario, execucaoId: string): Promise<ArquivoTriado[]>;

  /** Encerra como falha as execuções em andamento sem sinal de vida; devolve quantas foram. */
  sistemaEncerrarInterrompidas(): Promise<number>;
  /** Quantas execuções estão na fila e em andamento, sem depender da sessão de um usuário. */
  sistemaSituacaoDaFila(): Promise<SituacaoFila>;
  /** Execução mais antiga que ainda está na fila. */
  sistemaProximaDaFila(): Promise<string | null>;
  /** Passa a execução de "na fila" para "em andamento"; false se outro processo já a pegou. */
  sistemaReivindicar(execucaoId: string): Promise<boolean>;
  sistemaCarregar(execucaoId: string): Promise<{ execucao: Execucao; cliente: Cliente } | null>;
  sistemaAtualizarExecucao(
    execucaoId: string,
    dados: { status?: StatusExecucao; erro?: string | null },
  ): Promise<void>;
  sistemaAtualizarEtapa(execucaoId: string, agente: AgenteId, dados: AtualizacaoEtapa): Promise<void>;
  sistemaSalvarTriagem(
    execucaoId: string,
    resultado: ResultadoTriagem,
    arquivos: ArquivoTriado[],
  ): Promise<void>;
  /** Grava o CNPJ lido na EFD-Contribuições em um cliente que ainda não tem CNPJ. */
  sistemaRegistrarCnpj(clienteId: string, cnpj: string): Promise<void>;
  registrarEvento(evento: EventoAuditoria): Promise<void>;
}

/**
 * Sem sinal de vida por este tempo, a execução em andamento é considerada
 * interrompida. A função que a processa vive no máximo 5 minutos; passado esse
 * prazo com folga, ela certamente não está mais rodando.
 */
export const LIMITE_SEM_ATIVIDADE_MS = 6 * 60 * 1000;

export const MENSAGEM_INTERROMPIDA = "Execução interrompida antes de terminar. Inicie uma nova auditoria desta competência.";

/** Máximo de competências em um único pedido (cinco anos). */
export const LIMITE_COMPETENCIAS_POR_PEDIDO = 60;

export function etapasIniciais(): Etapa[] {
  return AGENTES.map((agente) => ({
    agente,
    estado: agente === "retificacao" ? "aguardando_aprovacao" : "pendente",
    mensagem: null,
    progressoAtual: 0,
    progressoTotal: null,
    iniciadaEm: null,
    concluidaEm: null,
  }));
}
