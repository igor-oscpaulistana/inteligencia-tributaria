import { randomUUID } from "node:crypto";
import type { ArquivoTriado, ResultadoTriagem } from "@/lib/agentes/triagem";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import {
  etapasIniciais,
  LIMITE_SEM_ATIVIDADE_MS,
  MENSAGEM_INTERROMPIDA,
  STATUS_ATIVOS,
  type AgenteId,
  type AtualizacaoEtapa,
  type Cliente,
  type EventoAuditoria,
  type Execucao,
  type Lote,
  type Repositorio,
  type ResultadoCriacao,
  type ResumoAuditoria,
  type SituacaoFila,
  type StatusExecucao,
  type Usuario,
} from "./tipos";

function paraResumo(execucao: Execucao): ResumoAuditoria {
  const pendencias = execucao.triagem?.pendencias ?? null;
  const contar = (gravidade: string) => pendencias?.filter((p) => p.gravidade === gravidade).length ?? null;
  return {
    id: execucao.id,
    clienteId: execucao.clienteId,
    clienteNome: execucao.clienteNome,
    competencia: execucao.competencia,
    status: execucao.status,
    origemDados: execucao.origemDados,
    erro: execucao.erro,
    criadaPorNome: execucao.criadaPorNome,
    criadaEm: execucao.criadaEm,
    atualizadaEm: execucao.atualizadaEm,
    loteId: execucao.loteId,
    periodoInicio: execucao.periodoInicio,
    periodoFim: execucao.periodoFim,
    notasSaida: execucao.triagem?.xml.saidas ?? null,
    pendenciasImpeditivas: contar("impeditiva"),
    pendenciasAlerta: contar("alerta"),
  };
}

/** Ordem da lista: cliente em ordem alfabética e, dentro dele, a competência mais recente primeiro. */
export function ordenarAuditorias(lista: ResumoAuditoria[]): ResumoAuditoria[] {
  return [...lista].sort(
    (a, b) => a.clienteNome.localeCompare(b.clienteNome, "pt-BR") || b.competencia.localeCompare(a.competencia),
  );
}

/**
 * Repositório em memória para o modo de demonstração (sem Supabase).
 *
 * Os dados somem quando o processo reinicia e não são compartilhados entre
 * instâncias; serve para validar o fluxo localmente, não para produção.
 */
export class RepositorioMemoria implements Repositorio {
  private readonly clientes: Cliente[] = [];
  /** A ordem de inclusão do Map é a ordem de criação das execuções. */
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

  async obterCliente(_usuario: Usuario, clienteId: string): Promise<Cliente | null> {
    const cliente = this.clientes.find((c) => c.id === clienteId);
    return cliente ? { ...cliente } : null;
  }

  async criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
    lote: Lote,
  ): Promise<ResultadoCriacao> {
    const agora = this.agora();
    for (const existente of this.execucoes.values()) {
      if (existente.clienteId !== cliente.id || existente.competencia !== competencia) continue;
      if (STATUS_ATIVOS.includes(existente.status)) return { tipo: "conflito", execucaoId: existente.id };
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
      loteId: lote.id,
      periodoInicio: lote.periodoInicio,
      periodoFim: lote.periodoFim,
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

  async execucaoEmFoco(): Promise<Execucao | null> {
    const todas = [...this.execucoes.values()];
    const foco =
      todas.find((e) => e.status === "em_andamento") ??
      this.naFila()[0] ??
      // A mais recente; no empate de horário, a criada por último.
      todas.map((e, ordem) => ({ e, ordem })).sort(
        (a, b) => b.e.atualizadaEm.localeCompare(a.e.atualizadaEm) || b.ordem - a.ordem,
      )[0]?.e;
    return foco ? structuredClone(foco) : null;
  }

  async listarAuditorias(_usuario: Usuario, filtro: { clienteId?: string } = {}): Promise<ResumoAuditoria[]> {
    // O Map preserva a ordem de criação: a última de cada chave é a mais recente.
    const atuais = new Map<string, Execucao>();
    for (const execucao of this.execucoes.values()) {
      if (filtro.clienteId && execucao.clienteId !== filtro.clienteId) continue;
      atuais.set(`${execucao.clienteId}|${execucao.competencia}`, execucao);
    }
    return ordenarAuditorias([...atuais.values()].map(paraResumo));
  }

  async situacaoDaFila(): Promise<SituacaoFila> {
    const todas = [...this.execucoes.values()];
    return {
      naFila: todas.filter((e) => e.status === "na_fila").length,
      emAndamento: todas.filter((e) => e.status === "em_andamento").length,
    };
  }

  async sistemaSituacaoDaFila(): Promise<SituacaoFila> {
    return this.situacaoDaFila();
  }

  private naFila(): Execucao[] {
    return [...this.execucoes.values()]
      .filter((e) => e.status === "na_fila")
      .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.competencia.localeCompare(b.competencia));
  }

  async sistemaEncerrarInterrompidas(): Promise<number> {
    const agora = this.agora();
    let encerradas = 0;
    for (const execucao of this.execucoes.values()) {
      if (execucao.status !== "em_andamento") continue;
      if (agora.getTime() - Date.parse(execucao.atualizadaEm) <= LIMITE_SEM_ATIVIDADE_MS) continue;
      execucao.status = "falhou";
      execucao.erro = MENSAGEM_INTERROMPIDA;
      execucao.atualizadaEm = agora.toISOString();
      for (const etapa of execucao.etapas) {
        if (etapa.estado !== "em_andamento") continue;
        etapa.estado = "falhou";
        etapa.mensagem = MENSAGEM_INTERROMPIDA;
        etapa.concluidaEm = agora.toISOString();
      }
      encerradas++;
    }
    return encerradas;
  }

  async sistemaProximaDaFila(): Promise<string | null> {
    return this.naFila()[0]?.id ?? null;
  }

  async sistemaReivindicar(execucaoId: string): Promise<boolean> {
    const execucao = this.execucoes.get(execucaoId);
    if (!execucao || execucao.status !== "na_fila") return false;
    execucao.status = "em_andamento";
    execucao.atualizadaEm = this.agora().toISOString();
    return true;
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
