import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArquivoTriado, ResultadoTriagem } from "@/lib/agentes/triagem";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import type { ConfigSupabase } from "@/lib/config";
import { supabaseDoServidor, supabaseDoUsuario } from "@/lib/supabase/clientes";
import {
  AGENTES,
  LIMITE_SEM_ATIVIDADE_MS,
  MENSAGEM_INTERROMPIDA,
  STATUS_ATIVOS,
  type AgenteId,
  type AtualizacaoEtapa,
  type Cliente,
  type Etapa,
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

const VIOLACAO_DE_UNICIDADE = "23505";
const LOTE_ARQUIVOS = 500;
const COLUNAS_CLIENTE = "id, nome, cnpj, pasta_onedrive";
const SELECAO_EXECUCAO = `*, clientes(${COLUNAS_CLIENTE}), execucao_etapas(*)`;
/** O PostgREST devolve no máximo esta quantidade de linhas por consulta. */
const PAGINA_AUDITORIAS = 1000;
const LIMITE_AUDITORIAS = 5000;

interface LinhaCliente {
  id: string;
  nome: string;
  cnpj: string | null;
  pasta_onedrive: string;
}

interface LinhaEtapa {
  agente: AgenteId;
  estado: Etapa["estado"];
  mensagem: string | null;
  progresso_atual: number;
  progresso_total: number | null;
  iniciada_em: string | null;
  concluida_em: string | null;
}

interface LinhaExecucao {
  id: string;
  cliente_id: string;
  competencia: string;
  status: StatusExecucao;
  origem_dados: TipoFonte;
  criada_por_nome: string;
  criada_em: string;
  atualizada_em: string;
  erro: string | null;
  lote_id: string;
  periodo_inicio: string;
  periodo_fim: string;
  triagem: ResultadoTriagem | null;
  clientes: LinhaCliente | null;
  execucao_etapas: LinhaEtapa[];
}

/** Linha da visão auditorias_atuais. */
interface LinhaAuditoria {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  competencia: string;
  status: StatusExecucao;
  origem_dados: TipoFonte;
  erro: string | null;
  criada_por_nome: string;
  criada_em: string;
  atualizada_em: string;
  lote_id: string;
  periodo_inicio: string;
  periodo_fim: string;
  notas_saida: number | null;
  pendencias_impeditivas: number | null;
  pendencias_alerta: number | null;
}

function paraResumo(linha: LinhaAuditoria): ResumoAuditoria {
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    clienteNome: linha.cliente_nome,
    competencia: linha.competencia,
    status: linha.status,
    origemDados: linha.origem_dados,
    erro: linha.erro,
    criadaPorNome: linha.criada_por_nome,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
    loteId: linha.lote_id,
    periodoInicio: linha.periodo_inicio,
    periodoFim: linha.periodo_fim,
    notasSaida: linha.notas_saida,
    pendenciasImpeditivas: linha.pendencias_impeditivas,
    pendenciasAlerta: linha.pendencias_alerta,
  };
}

function paraCliente(linha: LinhaCliente): Cliente {
  return { id: linha.id, nome: linha.nome, cnpj: linha.cnpj, pastaOnedrive: linha.pasta_onedrive };
}

function paraExecucao(linha: LinhaExecucao): Execucao {
  const etapas = [...linha.execucao_etapas]
    .sort((a, b) => AGENTES.indexOf(a.agente) - AGENTES.indexOf(b.agente))
    .map<Etapa>((e) => ({
      agente: e.agente,
      estado: e.estado,
      mensagem: e.mensagem,
      progressoAtual: e.progresso_atual,
      progressoTotal: e.progresso_total,
      iniciadaEm: e.iniciada_em,
      concluidaEm: e.concluida_em,
    }));
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    clienteNome: linha.clientes?.nome ?? "",
    competencia: linha.competencia,
    status: linha.status,
    origemDados: linha.origem_dados,
    criadaPorNome: linha.criada_por_nome,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
    erro: linha.erro,
    loteId: linha.lote_id,
    periodoInicio: linha.periodo_inicio,
    periodoFim: linha.periodo_fim,
    etapas,
    triagem: linha.triagem,
  };
}

function exigir<T>(resposta: { data: T; error: { message: string } | null }, operacao: string): T {
  if (resposta.error) throw new Error(`Supabase (${operacao}): ${resposta.error.message}`);
  return resposta.data;
}

export class RepositorioSupabase implements Repositorio {
  private servidor: SupabaseClient | null = null;

  constructor(private readonly config: ConfigSupabase) {}

  private admin(): SupabaseClient {
    this.servidor ??= supabaseDoServidor(this.config);
    return this.servidor;
  }

  async registrarCliente(_usuario: Usuario, pasta: string): Promise<Cliente> {
    const supabase = await supabaseDoUsuario(this.config);
    const localizar = async () =>
      exigir(
        await supabase.from("clientes").select(COLUNAS_CLIENTE).eq("pasta_onedrive", pasta).maybeSingle(),
        "localizar cliente",
      ) as LinhaCliente | null;

    const existente = await localizar();
    if (existente) return paraCliente(existente);

    // A inclusão usa a sessão do usuário: a RLS confere a autorização e o
    // gatilho registra o cadastro na trilha de auditoria.
    const resposta = await supabase
      .from("clientes")
      .insert({ nome: pasta, pasta_onedrive: pasta })
      .select(COLUNAS_CLIENTE)
      .single();
    if (resposta.error?.code === VIOLACAO_DE_UNICIDADE) {
      // Outra requisição cadastrou a mesma pasta, ou o cliente existe e está inativo.
      const criado = await localizar();
      if (criado) return paraCliente(criado);
      throw new Error(`O cliente da pasta "${pasta}" está inativo.`);
    }
    return paraCliente(exigir(resposta, "cadastrar cliente") as LinhaCliente);
  }

  async obterCliente(_usuario: Usuario, clienteId: string): Promise<Cliente | null> {
    const supabase = await supabaseDoUsuario(this.config);
    const linha = exigir(
      await supabase.from("clientes").select(COLUNAS_CLIENTE).eq("id", clienteId).maybeSingle(),
      "obter cliente",
    ) as LinhaCliente | null;
    return linha ? paraCliente(linha) : null;
  }

  async criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
    lote: Lote,
  ): Promise<ResultadoCriacao> {
    // A inclusão usa a sessão do usuário: a RLS confere a permissão no cliente
    // e o gatilho registra a criação na trilha de auditoria.
    const supabase = await supabaseDoUsuario(this.config);
    const resposta = await supabase
      .from("execucoes")
      .insert({
        cliente_id: cliente.id,
        competencia,
        origem_dados: origem,
        criada_por_nome: usuario.nome,
        lote_id: lote.id,
        periodo_inicio: lote.periodoInicio,
        periodo_fim: lote.periodoFim,
      })
      .select(SELECAO_EXECUCAO)
      .single();

    if (resposta.error?.code === VIOLACAO_DE_UNICIDADE) {
      const ativa = exigir(
        await supabase
          .from("execucoes")
          .select("id")
          .eq("cliente_id", cliente.id)
          .eq("competencia", competencia)
          .in("status", STATUS_ATIVOS)
          .maybeSingle(),
        "localizar execução ativa",
      ) as { id: string } | null;
      if (ativa) return { tipo: "conflito", execucaoId: ativa.id };
    }
    return { tipo: "criada", execucao: paraExecucao(exigir(resposta, "criar execução") as LinhaExecucao) };
  }

  async obterExecucao(_usuario: Usuario, execucaoId: string): Promise<Execucao | null> {
    const supabase = await supabaseDoUsuario(this.config);
    const linha = exigir(
      await supabase.from("execucoes").select(SELECAO_EXECUCAO).eq("id", execucaoId).maybeSingle(),
      "obter execução",
    ) as LinhaExecucao | null;
    return linha ? paraExecucao(linha) : null;
  }

  async execucaoEmFoco(): Promise<Execucao | null> {
    const supabase = await supabaseDoUsuario(this.config);
    const primeira = async (status: StatusExecucao | null) => {
      let consulta = supabase.from("execucoes").select(SELECAO_EXECUCAO);
      if (status) consulta = consulta.eq("status", status);
      // Fila: a mais antiga primeiro. Sem filtro: a que mudou por último.
      consulta =
        status === "na_fila"
          ? consulta.order("criada_em").order("competencia")
          : consulta.order("atualizada_em", { ascending: false });
      return exigir(await consulta.limit(1).maybeSingle(), "obter execução em foco") as LinhaExecucao | null;
    };
    const linha = (await primeira("em_andamento")) ?? (await primeira("na_fila")) ?? (await primeira(null));
    return linha ? paraExecucao(linha) : null;
  }

  async listarAuditorias(_usuario: Usuario, filtro: { clienteId?: string } = {}): Promise<ResumoAuditoria[]> {
    const supabase = await supabaseDoUsuario(this.config);
    const linhas: LinhaAuditoria[] = [];
    for (let inicio = 0; inicio < LIMITE_AUDITORIAS; inicio += PAGINA_AUDITORIAS) {
      let consulta = supabase.from("auditorias_atuais").select("*");
      if (filtro.clienteId) consulta = consulta.eq("cliente_id", filtro.clienteId);
      const pagina = exigir(
        await consulta
          .order("cliente_nome")
          .order("competencia", { ascending: false })
          .order("id")
          .range(inicio, inicio + PAGINA_AUDITORIAS - 1),
        "listar auditorias",
      ) as LinhaAuditoria[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA_AUDITORIAS) break;
    }
    return linhas.map(paraResumo);
  }

  async situacaoDaFila(): Promise<SituacaoFila> {
    return this.contarFila(await supabaseDoUsuario(this.config));
  }

  async sistemaSituacaoDaFila(): Promise<SituacaoFila> {
    return this.contarFila(this.admin());
  }

  private async contarFila(supabase: SupabaseClient): Promise<SituacaoFila> {
    const contar = async (status: StatusExecucao) => {
      const resposta = await supabase
        .from("execucoes")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (resposta.error) throw new Error(`Supabase (contar fila): ${resposta.error.message}`);
      return resposta.count ?? 0;
    };
    const [naFila, emAndamento] = await Promise.all([contar("na_fila"), contar("em_andamento")]);
    return { naFila, emAndamento };
  }

  async listarArquivos(_usuario: Usuario, execucaoId: string): Promise<ArquivoTriado[]> {
    const supabase = await supabaseDoUsuario(this.config);
    const linhas = exigir(
      await supabase
        .from("execucao_arquivos")
        .select(
          "caminho, nome, tamanho, sha256, modificado_em, categoria, situacao, detalhe, chave, cnpj, data_referencia, modelo",
        )
        .eq("execucao_id", execucaoId)
        .neq("categoria", "xml_saida")
        .order("caminho")
        .limit(1000),
      "listar arquivos",
    ) as Array<Record<string, unknown>>;
    return linhas.map(
      (l) =>
        ({
          caminho: l.caminho,
          nome: l.nome,
          tamanho: l.tamanho,
          sha256: l.sha256,
          modificadoEm: l.modificado_em,
          categoria: l.categoria,
          situacao: l.situacao,
          detalhe: l.detalhe,
          chave: l.chave,
          cnpj: l.cnpj,
          dataReferencia: l.data_referencia,
          modelo: l.modelo,
        }) as ArquivoTriado,
    );
  }

  async sistemaEncerrarInterrompidas(): Promise<number> {
    const admin = this.admin();
    const limite = new Date(Date.now() - LIMITE_SEM_ATIVIDADE_MS).toISOString();
    const encerradas = exigir(
      await admin
        .from("execucoes")
        .update({ status: "falhou", erro: MENSAGEM_INTERROMPIDA })
        .eq("status", "em_andamento")
        .lt("atualizada_em", limite)
        .select("id"),
      "encerrar execuções interrompidas",
    ) as Array<{ id: string }>;
    if (encerradas.length === 0) return 0;
    exigir(
      await admin
        .from("execucao_etapas")
        .update({ estado: "falhou", mensagem: MENSAGEM_INTERROMPIDA, concluida_em: new Date().toISOString() })
        .in("execucao_id", encerradas.map((e) => e.id))
        .eq("estado", "em_andamento"),
      "encerrar etapas interrompidas",
    );
    return encerradas.length;
  }

  async sistemaProximaDaFila(): Promise<string | null> {
    const linha = exigir(
      await this.admin()
        .from("execucoes")
        .select("id")
        .eq("status", "na_fila")
        .order("criada_em")
        .order("competencia")
        .limit(1)
        .maybeSingle(),
      "obter próxima da fila",
    ) as { id: string } | null;
    return linha?.id ?? null;
  }

  async sistemaReivindicar(execucaoId: string): Promise<boolean> {
    // A condição no status torna a troca atômica: só um processo consegue.
    const linhas = exigir(
      await this.admin()
        .from("execucoes")
        .update({ status: "em_andamento" })
        .eq("id", execucaoId)
        .eq("status", "na_fila")
        .select("id"),
      "reivindicar execução",
    ) as Array<{ id: string }>;
    return linhas.length === 1;
  }

  async sistemaCarregar(execucaoId: string) {
    const linha = exigir(
      await this.admin()
        .from("execucoes")
        .select(SELECAO_EXECUCAO)
        .eq("id", execucaoId)
        .maybeSingle(),
      "carregar execução",
    ) as LinhaExecucao | null;
    if (!linha?.clientes) return null;
    return { execucao: paraExecucao(linha), cliente: paraCliente(linha.clientes) };
  }

  async sistemaAtualizarExecucao(
    execucaoId: string,
    dados: { status?: StatusExecucao; erro?: string | null },
  ): Promise<void> {
    exigir(
      await this.admin().from("execucoes").update(dados).eq("id", execucaoId),
      "atualizar execução",
    );
  }

  async sistemaAtualizarEtapa(
    execucaoId: string,
    agente: AgenteId,
    dados: AtualizacaoEtapa,
  ): Promise<void> {
    const colunas: Record<string, unknown> = {};
    if (dados.estado !== undefined) colunas.estado = dados.estado;
    if (dados.mensagem !== undefined) colunas.mensagem = dados.mensagem;
    if (dados.progressoAtual !== undefined) colunas.progresso_atual = dados.progressoAtual;
    if (dados.progressoTotal !== undefined) colunas.progresso_total = dados.progressoTotal;
    if (dados.iniciadaEm !== undefined) colunas.iniciada_em = dados.iniciadaEm;
    if (dados.concluidaEm !== undefined) colunas.concluida_em = dados.concluidaEm;
    exigir(
      await this.admin()
        .from("execucao_etapas")
        .update(colunas)
        .eq("execucao_id", execucaoId)
        .eq("agente", agente),
      "atualizar etapa",
    );
  }

  async sistemaSalvarTriagem(
    execucaoId: string,
    resultado: ResultadoTriagem,
    arquivos: ArquivoTriado[],
  ): Promise<void> {
    const admin = this.admin();
    exigir(
      await admin.from("execucao_arquivos").delete().eq("execucao_id", execucaoId),
      "limpar inventário",
    );
    for (let inicio = 0; inicio < arquivos.length; inicio += LOTE_ARQUIVOS) {
      const lote = arquivos.slice(inicio, inicio + LOTE_ARQUIVOS).map((a) => ({
        execucao_id: execucaoId,
        caminho: a.caminho,
        nome: a.nome,
        tamanho: a.tamanho,
        sha256: a.sha256,
        modificado_em: a.modificadoEm,
        categoria: a.categoria,
        situacao: a.situacao,
        detalhe: a.detalhe,
        chave: a.chave,
        cnpj: a.cnpj,
        data_referencia: a.dataReferencia,
        modelo: a.modelo,
      }));
      exigir(await admin.from("execucao_arquivos").insert(lote), "gravar inventário");
    }
    exigir(
      await admin.from("execucoes").update({ triagem: resultado }).eq("id", execucaoId),
      "gravar triagem",
    );
  }

  async sistemaRegistrarCnpj(clienteId: string, cnpj: string): Promise<void> {
    exigir(
      await this.admin().from("clientes").update({ cnpj }).eq("id", clienteId).is("cnpj", null),
      "registrar CNPJ do cliente",
    );
  }

  async registrarEvento(evento: EventoAuditoria): Promise<void> {
    exigir(
      await this.admin().from("trilha_auditoria").insert({
        acao: evento.acao,
        usuario_id: evento.usuarioId,
        cliente_id: evento.clienteId,
        execucao_id: evento.execucaoId,
        detalhes: evento.detalhes,
      }),
      "registrar evento",
    );
  }
}
