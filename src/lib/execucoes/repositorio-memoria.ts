import { randomUUID } from "node:crypto";
import type { ArquivoTriado, ResultadoTriagem } from "@/lib/agentes/triagem";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import {
  etapasIniciais,
  LIMITE_SEM_ATIVIDADE_MS,
  STATUS_ATIVOS,
  type AgenteId,
  type AtualizacaoEtapa,
  type Cliente,
  type EventoAuditoria,
  type Execucao,
  type Repositorio,
  type ResultadoCriacao,
  type StatusExecucao,
  type Usuario,
} from "./tipos";

/**
 * Repositório em memória para o modo de demonstração (sem Supabase).
 *
 * Os dados somem quando o processo reinicia e não são compartilhados entre
 * instâncias; serve para validar o fluxo localmente, não para produção.
 */
export class RepositorioMemoria implements Repositorio {
  private readonly clientes: Cliente[] = [];
  private readonly execucoes = new Map<string, Execucao>();
  private readonly arquivos = new Map<string, ArquivoTriado[]>();
  readonly eventos: Array<EventoAuditoria & { em: string }> = [];

  constructor(private readonly agora: () => Date = () => new Date()) {}

  async registrarCliente(usuario: Usuario, pasta: string): Promise<Cliente> {
    const existente = this.clientes.find((c) => c.pastaOnedrive === pasta);
    if (existente) return { ...existente };
    const cliente: Cliente = { id: randomUUID(), nome: pasta, cnpj: null, pastaOnedrive: pasta };
    this.clientes.push(cliente);
    await this.registrarEvento({
      acao: "cliente.cadastrado",
      usuarioId: usuario.id,
      clienteId: cliente.id,
      execucaoId: null,
      detalhes: { nome: cliente.nome, pasta },
    });
    return { ...cliente };
  }

  async criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
  ): Promise<ResultadoCriacao> {
    const agora = this.agora();
    for (const existente of this.execucoes.values()) {
      if (existente.clienteId !== cliente.id || existente.competencia !== competencia) continue;
      if (!STATUS_ATIVOS.includes(existente.status)) continue;
      if (agora.getTime() - Date.parse(existente.atualizadaEm) > LIMITE_SEM_ATIVIDADE_MS) {
        existente.status = "falhou";
        existente.erro = "Execução interrompida antes de terminar.";
        continue;
      }
      return { tipo: "conflito", execucaoId: existente.id };
    }

    const execucao: Execucao = {
      id: randomUUID(),
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      competencia,
      status: "na_fila",
      origemDados: origem,
      criadaPorNome: usuario.nome,
      criadaEm: agora.toISOString(),
      atualizadaEm: agora.toISOString(),
      erro: null,
      etapas: etapasIniciais(),
      triagem: null,
    };
    this.execucoes.set(execucao.id, execucao);
    return { tipo: "criada", execucao: structuredClone(execucao) };
  }

  async obterExecucao(_usuario: Usuario, execucaoId: string): Promise<Execucao | null> {
    const execucao = this.execucoes.get(execucaoId);
    return execucao ? structuredClone(execucao) : null;
  }

  async ultimaExecucao(): Promise<Execucao | null> {
    const ultima = [...this.execucoes.values()].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))[0];
    return ultima ? structuredClone(ultima) : null;
  }

  async listarArquivos(_usuario: Usuario, execucaoId: string): Promise<ArquivoTriado[]> {
    return this.arquivos.get(execucaoId) ?? [];
  }

  async sistemaCarregar(execucaoId: string) {
    const execucao = this.execucoes.get(execucaoId);
    const cliente = this.clientes.find((c) => c.id === execucao?.clienteId);
    return execucao && cliente ? { execucao: structuredClone(execucao), cliente: { ...cliente } } : null;
  }

  async sistemaAtualizarExecucao(
    execucaoId: string,
    dados: { status?: StatusExecucao; erro?: string | null },
  ): Promise<void> {
    const execucao = this.exigir(execucaoId);
    Object.assign(execucao, dados, { atualizadaEm: this.agora().toISOString() });
  }

  async sistemaAtualizarEtapa(
    execucaoId: string,
    agente: AgenteId,
    dados: AtualizacaoEtapa,
  ): Promise<void> {
    const execucao = this.exigir(execucaoId);
    const etapa = execucao.etapas.find((e) => e.agente === agente)!;
    if (agente === "retificacao" && dados.estado && dados.estado !== "aguardando_aprovacao") {
      // Mesma trava do banco: a Retificação não sai de "aguardando aprovação" nesta etapa.
      throw new Error("A Retificação só pode iniciar após a aprovação humana do relatório.");
    }
    Object.assign(etapa, dados);
    execucao.atualizadaEm = this.agora().toISOString();
  }

  async sistemaSalvarTriagem(
    execucaoId: string,
    resultado: ResultadoTriagem,
    arquivos: ArquivoTriado[],
  ): Promise<void> {
    const execucao = this.exigir(execucaoId);
    execucao.triagem = resultado;
    execucao.atualizadaEm = this.agora().toISOString();
    this.arquivos.set(execucaoId, arquivos);
  }

  async sistemaRegistrarCnpj(clienteId: string, cnpj: string): Promise<void> {
    const cliente = this.clientes.find((c) => c.id === clienteId);
    if (cliente && !cliente.cnpj) cliente.cnpj = cnpj;
  }

  async registrarEvento(evento: EventoAuditoria): Promise<void> {
    this.eventos.push({ ...evento, em: this.agora().toISOString() });
  }

  private exigir(execucaoId: string): Execucao {
    const execucao = this.execucoes.get(execucaoId);
    if (!execucao) throw new Error(`Execução ${execucaoId} não encontrada.`);
    return execucao;
  }
}
