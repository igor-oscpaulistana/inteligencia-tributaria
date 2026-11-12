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
  etapas: Etapa[];
  triagem: ResultadoTriagem | null;
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
 * Os métodos que recebem `usuario` só devolvem o que ele pode ver. Os métodos
 * `sistema*` são usados pelo executor, depois que a execução já foi autorizada.
 */
export interface Repositorio {
  listarClientes(usuario: Usuario): Promise<Cliente[]>;
  obterCliente(usuario: Usuario, clienteId: string): Promise<Cliente | null>;
  criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
  ): Promise<ResultadoCriacao>;
  obterExecucao(usuario: Usuario, execucaoId: string): Promise<Execucao | null>;
  ultimaExecucao(usuario: Usuario): Promise<Execucao | null>;
  listarArquivos(usuario: Usuario, execucaoId: string): Promise<ArquivoTriado[]>;

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
  registrarEvento(evento: EventoAuditoria): Promise<void>;
}

/** Sem sinal de vida por este tempo, a execução é considerada interrompida. */
export const LIMITE_SEM_ATIVIDADE_MS = 15 * 60 * 1000;

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
