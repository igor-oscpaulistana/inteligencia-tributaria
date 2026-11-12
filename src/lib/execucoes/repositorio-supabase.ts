import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArquivoTriado, ResultadoTriagem } from "@/lib/agentes/triagem";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import type { ConfigSupabase } from "@/lib/config";
import { supabaseDoServidor, supabaseDoUsuario } from "@/lib/supabase/clientes";
import {
  AGENTES,
  LIMITE_SEM_ATIVIDADE_MS,
  STATUS_ATIVOS,
  type AgenteId,
  type AtualizacaoEtapa,
  type Cliente,
  type Etapa,
  type EventoAuditoria,
  type Execucao,
  type Repositorio,
  type ResultadoCriacao,
  type StatusExecucao,
  type Usuario,
} from "./tipos";

const VIOLACAO_DE_UNICIDADE = "23505";
const LOTE_ARQUIVOS = 500;
const COLUNAS_CLIENTE = "id, nome, cnpj, pasta_onedrive";
const SELECAO_EXECUCAO = `*, clientes(${COLUNAS_CLIENTE}), execucao_etapas(*)`;

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
  triagem: ResultadoTriagem | null;
  clientes: LinhaCliente | null;
  execucao_etapas: LinhaEtapa[];
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

  async criarExecucao(
    usuario: Usuario,
    cliente: Cliente,
    competencia: string,
    origem: TipoFonte,
  ): Promise<ResultadoCriacao> {
    // Execuções sem sinal de vida são encerradas para não travar a competência.
    const limite = new Date(Date.now() - LIMITE_SEM_ATIVIDADE_MS).toISOString();
    exigir(
      await this.admin()
        .from("execucoes")
        .update({ status: "falhou", erro: "Execução interrompida antes de terminar." })
        .eq("cliente_id", cliente.id)
        .eq("competencia", competencia)
        .in("status", STATUS_ATIVOS)
        .lt("atualizada_em", limite),
      "encerrar execuções interrompidas",
    );

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

  async ultimaExecucao(): Promise<Execucao | null> {
    const supabase = await supabaseDoUsuario(this.config);
    const linha = exigir(
      await supabase
        .from("execucoes")
        .select(SELECAO_EXECUCAO)
        .order("criada_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "obter última execução",
    ) as LinhaExecucao | null;
    return linha ? paraExecucao(linha) : null;
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
