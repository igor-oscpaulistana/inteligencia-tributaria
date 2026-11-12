/**
 * Agente de Triagem.
 *
 * Localiza a pasta do cliente e da competência, lê os três conjuntos de
 * arquivos (XMLs, EFD-Contribuições e EFD ICMS/IPI), confere CNPJ e período e
 * registra o que está ausente ou incompatível. Não calcula tributo: separa as
 * notas de saída do cliente e entrega um inventário rastreável (com hash de
 * cada arquivo) para a Auditoria.
 */

import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { formatarCnpj, mesmaRaizCnpj, normalizarCnpj } from "@/lib/cnpj";
import { dataNaCompetencia, formatarCompetencia, limitesCompetencia } from "@/lib/competencia";
import {
  DESCRICAO_INCIDENCIA,
  lerCabecalhoSped,
  NOME_TIPO_SPED,
  type CabecalhoSped,
  type TipoSped,
} from "@/lib/fiscal/sped";
import { lerXmlFiscal, type DocumentoFiscalXml, type ModeloDocumento } from "@/lib/fiscal/xml";
import {
  coletarArquivos,
  localizarPastaCliente,
  localizarPastaCompetencia,
  type ArquivoEncontrado,
  type LeiautePasta,
} from "@/lib/arquivos/leiaute";
import type { FonteArquivos, TipoFonte } from "@/lib/arquivos/tipos";

export type CategoriaArquivo =
  | "efd_contribuicoes"
  | "efd_icms_ipi"
  | "xml_saida"
  | "xml_entrada_propria"
  | "xml_terceiros"
  | "xml_evento"
  | "xml_cancelado"
  | "xml_nao_autorizado"
  | "xml_fora_do_periodo"
  | "xml_duplicado"
  | "xml_invalido"
  | "fora_do_escopo";

export type SituacaoArquivo = "considerado" | "desconsiderado" | "incompativel";

export interface ArquivoTriado {
  caminho: string;
  nome: string;
  tamanho: number;
  sha256: string;
  modificadoEm: string | null;
  categoria: CategoriaArquivo;
  situacao: SituacaoArquivo;
  detalhe: string | null;
  chave: string | null;
  cnpj: string | null;
  /** Emissão do documento ou início do período da escrituração, "AAAA-MM-DD". */
  dataReferencia: string | null;
  modelo: ModeloDocumento | null;
}

export type GravidadePendencia = "impeditiva" | "alerta" | "informativa";

export interface Pendencia {
  codigo: string;
  gravidade: GravidadePendencia;
  mensagem: string;
  arquivo: string | null;
}

export interface EscrituracaoTriada {
  caminho: string;
  tipo: TipoSped;
  cnpj: string;
  nome: string;
  dataInicial: string;
  dataFinal: string;
  versaoLeiaute: string;
  retificadora: boolean;
  reciboAnterior: string | null;
  regime: string | null;
  estabelecimentos: number;
  compativel: boolean;
}

export interface ResumoXml {
  lidos: number;
  saidas: number;
  saidasPorModelo: Record<ModeloDocumento, number>;
  entradasProprias: number;
  terceiros: number;
  eventos: number;
  canceladas: number;
  naoAutorizadas: number;
  semProtocolo: number;
  foraDoPeriodo: number;
  duplicados: number;
  invalidos: number;
  foraDoEscopo: number;
}

export interface ResultadoTriagem {
  competencia: string;
  origem: TipoFonte;
  pastaCliente: string;
  caminhoCompetencia: string | null;
  leiaute: LeiautePasta | null;
  cnpjsDoCliente: string[];
  escrituracoes: EscrituracaoTriada[];
  xml: ResumoXml;
  pendencias: Pendencia[];
  /** true quando não há pendência impeditiva e a Auditoria pode começar. */
  apta: boolean;
}

export interface SaidaTriagem {
  resultado: ResultadoTriagem;
  arquivos: ArquivoTriado[];
}

export interface EntradaTriagem {
  pastaCliente: string;
  /** CNPJ do cadastro do cliente, quando informado. */
  cnpjCadastro: string | null;
  competencia: string;
}

export interface ProgressoTriagem {
  atual: number;
  total: number | null;
  mensagem: string;
}

export interface OpcoesTriagem {
  aoProgredir?: (progresso: ProgressoTriagem) => void | Promise<void>;
  concorrencia?: number;
}

const LIMITE_BYTES = 250 * 1024 * 1024;
const STATUS_AUTORIZADO = new Set(["100", "150"]);

interface Lido {
  arquivo: ArquivoTriado;
  sped?: CabecalhoSped;
  documento?: DocumentoFiscalXml;
  cancelaChave?: string | null;
}

function resumoVazio(): ResumoXml {
  return {
    lidos: 0,
    saidas: 0,
    saidasPorModelo: { "55": 0, "65": 0, "59": 0 },
    entradasProprias: 0,
    terceiros: 0,
    eventos: 0,
    canceladas: 0,
    naoAutorizadas: 0,
    semProtocolo: 0,
    foraDoPeriodo: 0,
    duplicados: 0,
    invalidos: 0,
    foraDoEscopo: 0,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto >= 0 ? nome.slice(ponto + 1).toLowerCase() : "";
}

function plural(quantidade: number, singular: string, pluralTexto: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : pluralTexto}`;
}

/** Lê o conteúdo de um arquivo (ou de uma entrada de ZIP) e identifica o que ele é. */
function lerConteudo(
  caminho: string,
  nome: string,
  bytes: Uint8Array,
  modificadoEm: string | null,
): Lido {
  const base: ArquivoTriado = {
    caminho,
    nome,
    tamanho: bytes.byteLength,
    sha256: sha256(bytes),
    modificadoEm,
    categoria: "fora_do_escopo",
    situacao: "desconsiderado",
    detalhe: null,
    chave: null,
    cnpj: null,
    dataReferencia: null,
    modelo: null,
  };
  const extensao = extensaoDe(nome);

  if (extensao === "txt") {
    const leitura = lerCabecalhoSped(bytes);
    if (!leitura.ok) {
      return { arquivo: { ...base, detalhe: leitura.motivo } };
    }
    const { cabecalho } = leitura;
    return {
      arquivo: {
        ...base,
        categoria: cabecalho.tipo,
        cnpj: cabecalho.cnpj,
        dataReferencia: cabecalho.dataInicial,
      },
      sped: cabecalho,
    };
  }

  if (extensao === "xml") {
    const leitura = lerXmlFiscal(bytes);
    if (leitura.especie === "invalido") {
      return { arquivo: { ...base, categoria: "xml_invalido", detalhe: leitura.motivo } };
    }
    if (leitura.especie === "fora_do_escopo") {
      return { arquivo: { ...base, detalhe: leitura.descricao } };
    }
    if (leitura.especie === "evento") {
      const descricao = {
        cancelamento: "Evento de cancelamento",
        carta_correcao: "Carta de correção",
        inutilizacao: "Inutilização de numeração",
        outro: "Outro evento",
      }[leitura.tipo];
      return {
        arquivo: { ...base, categoria: "xml_evento", detalhe: descricao, chave: leitura.chave },
        cancelaChave: leitura.tipo === "cancelamento" ? leitura.chave : null,
      };
    }
    return {
      arquivo: {
        ...base,
        chave: leitura.chave,
        cnpj: leitura.cnpjEmitente,
        dataReferencia: leitura.dataEmissao,
        modelo: leitura.modelo,
      },
      documento: leitura,
    };
  }

  return { arquivo: { ...base, detalhe: "Tipo de arquivo não utilizado pela auditoria." } };
}

async function emParalelo<T>(
  itens: T[],
  concorrencia: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(concorrencia, itens.length) }, async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      await tarefa(itens[indice]);
    }
  });
  await Promise.all(trabalhadores);
}

export async function executarTriagem(
  fonte: FonteArquivos,
  entrada: EntradaTriagem,
  opcoes: OpcoesTriagem = {},
): Promise<SaidaTriagem> {
  const { competencia } = entrada;
  const competenciaTexto = formatarCompetencia(competencia);
  const pendencias: Pendencia[] = [];
  const resultado: ResultadoTriagem = {
    competencia,
    origem: fonte.tipo,
    pastaCliente: entrada.pastaCliente,
    caminhoCompetencia: null,
    leiaute: null,
    cnpjsDoCliente: [],
    escrituracoes: [],
    xml: resumoVazio(),
    pendencias,
    apta: false,
  };
  const progredir = async (progresso: ProgressoTriagem) => {
    await opcoes.aoProgredir?.(progresso);
  };

  // 1. Localização
  await progredir({ atual: 0, total: null, mensagem: "Localizando a pasta do cliente" });
  const pastaCliente = localizarPastaCliente(await fonte.listarRaiz(), entrada.pastaCliente);
  if (!pastaCliente) {
    pendencias.push({
      codigo: "PASTA_CLIENTE_AUSENTE",
      gravidade: "impeditiva",
      mensagem: `A pasta "${entrada.pastaCliente}" não existe em Inteligência Tributária.`,
      arquivo: null,
    });
    return { resultado, arquivos: [] };
  }

  const pastaCompetencia = await localizarPastaCompetencia(fonte, pastaCliente, competencia);
  if (!pastaCompetencia) {
    pendencias.push({
      codigo: "PASTA_COMPETENCIA_AUSENTE",
      gravidade: "impeditiva",
      mensagem: `Não há pasta da competência ${competenciaTexto} para este cliente.`,
      arquivo: null,
    });
    return { resultado, arquivos: [] };
  }
  resultado.caminhoCompetencia = pastaCompetencia.caminho;
  resultado.leiaute = pastaCompetencia.leiaute;

  await progredir({ atual: 0, total: null, mensagem: "Listando os arquivos da competência" });
  const encontrados = await coletarArquivos(fonte, pastaCompetencia);

  // 2. Leitura — escriturações primeiro, depois os XMLs em paralelo
  const ordem = (a: ArquivoEncontrado) => (a.extensao === "txt" ? 0 : 1);
  const fila = [...encontrados].sort((a, b) => ordem(a) - ordem(b));
  const lidos: Lido[] = [];
  let concluidos = 0;

  await emParalelo(fila, opcoes.concorrencia ?? 8, async (encontrado) => {
    const { item, caminho, extensao } = encontrado;
    if (item.tamanho > LIMITE_BYTES) {
      pendencias.push({
        codigo: "ARQUIVO_MUITO_GRANDE",
        gravidade: "alerta",
        mensagem: "Arquivo acima do limite de 250 MB do piloto; não foi lido.",
        arquivo: caminho,
      });
    } else if (extensao === "txt" || extensao === "xml") {
      lidos.push(lerConteudo(caminho, item.nome, await fonte.baixar(item.id), item.modificadoEm));
    } else if (extensao === "zip") {
      let entradas: Record<string, Uint8Array>;
      try {
        entradas = unzipSync(await fonte.baixar(item.id), {
          filter: (arquivo) => /\.(xml|txt)$/i.test(arquivo.name) && arquivo.originalSize <= LIMITE_BYTES,
        });
      } catch {
        entradas = {};
        pendencias.push({
          codigo: "ZIP_INVALIDO",
          gravidade: "alerta",
          mensagem: "Não foi possível abrir o arquivo ZIP.",
          arquivo: caminho,
        });
      }
      for (const [nomeEntrada, bytes] of Object.entries(entradas)) {
        const nome = nomeEntrada.split("/").pop() ?? nomeEntrada;
        lidos.push(lerConteudo(`${caminho}!/${nomeEntrada}`, nome, bytes, item.modificadoEm));
      }
    } else {
      lidos.push({
        arquivo: {
          caminho,
          nome: item.nome,
          tamanho: item.tamanho,
          sha256: "",
          modificadoEm: item.modificadoEm,
          categoria: "fora_do_escopo",
          situacao: "desconsiderado",
          detalhe: "Tipo de arquivo não utilizado pela auditoria.",
          chave: null,
          cnpj: null,
          dataReferencia: null,
          modelo: null,
        },
      });
    }
    concluidos++;
    await progredir({
      atual: concluidos,
      total: fila.length,
      mensagem: `Lendo arquivos: ${concluidos} de ${fila.length}`,
    });
  });

  // A ordem de chegada varia com o paralelismo; o inventário sai ordenado por caminho.
  lidos.sort((a, b) => a.arquivo.caminho.localeCompare(b.arquivo.caminho, "pt-BR"));
  await progredir({ atual: fila.length, total: fila.length, mensagem: "Conferindo CNPJ e período" });

  // 3. Escriturações: período e CNPJ
  const limites = limitesCompetencia(competencia);
  const cnpjCadastro = normalizarCnpj(entrada.cnpjCadastro);
  const speds = lidos.filter((l) => l.sped);

  for (const lido of speds) {
    const sped = lido.sped!;
    const nomeTipo = NOME_TIPO_SPED[sped.tipo];
    const noPeriodo =
      dataNaCompetencia(sped.dataInicial, competencia) && dataNaCompetencia(sped.dataFinal, competencia);
    let compativel = true;

    if (!noPeriodo) {
      compativel = false;
      pendencias.push({
        codigo: "PERIODO_INCOMPATIVEL",
        gravidade: "impeditiva",
        mensagem: `${nomeTipo} de ${sped.dataInicial.slice(8)}/${sped.dataInicial.slice(5, 7)}/${sped.dataInicial.slice(0, 4)} a ${sped.dataFinal.slice(8)}/${sped.dataFinal.slice(5, 7)}/${sped.dataFinal.slice(0, 4)}, fora da competência ${competenciaTexto}.`,
        arquivo: lido.arquivo.caminho,
      });
    } else if (sped.dataInicial !== limites.inicio || sped.dataFinal !== limites.fim) {
      pendencias.push({
        codigo: "PERIODO_PARCIAL",
        gravidade: "alerta",
        mensagem: `${nomeTipo} não cobre o mês inteiro (${sped.dataInicial.slice(8)} a ${sped.dataFinal.slice(8)}/${competenciaTexto}).`,
        arquivo: lido.arquivo.caminho,
      });
    }
    if (cnpjCadastro && !mesmaRaizCnpj(sped.cnpj, cnpjCadastro)) {
      compativel = false;
      pendencias.push({
        codigo: "CNPJ_INCOMPATIVEL",
        gravidade: "impeditiva",
        mensagem: `${nomeTipo} do CNPJ ${formatarCnpj(sped.cnpj)}, diferente do cadastro do cliente (${formatarCnpj(cnpjCadastro)}).`,
        arquivo: lido.arquivo.caminho,
      });
    }
    if (!sped.encerrado) {
      pendencias.push({
        codigo: "ARQUIVO_SEM_ENCERRAMENTO",
        gravidade: "alerta",
        mensagem: `${nomeTipo} sem o registro 9999; o arquivo pode estar incompleto.`,
        arquivo: lido.arquivo.caminho,
      });
    }
    lido.arquivo.situacao = compativel ? "considerado" : "incompativel";
    lido.arquivo.detalhe = `${sped.nome} · leiaute ${sped.versaoLeiaute}`;
  }

  const contribuicoes = speds.filter(
    (l) => l.sped!.tipo === "efd_contribuicoes" && l.arquivo.situacao === "considerado",
  );
  const fiscais = speds.filter(
    (l) => l.sped!.tipo === "efd_icms_ipi" && l.arquivo.situacao === "considerado",
  );

  // CNPJs do cliente: cadastro, EFD-Contribuições (0000 e 0140) e EFD ICMS/IPI
  const cnpjs = new Set<string>();
  if (cnpjCadastro) cnpjs.add(cnpjCadastro);
  for (const lido of contribuicoes) {
    cnpjs.add(lido.sped!.cnpj);
    for (const estabelecimento of lido.sped!.estabelecimentos) {
      if (estabelecimento.cnpj) cnpjs.add(estabelecimento.cnpj);
    }
  }
  const cnpjsEscriturados = new Set(cnpjs);

  if (contribuicoes.length === 0) {
    pendencias.push({
      codigo: "EFD_CONTRIBUICOES_AUSENTE",
      gravidade: "impeditiva",
      mensagem: `Nenhuma EFD-Contribuições compatível com ${competenciaTexto} foi encontrada.`,
      arquivo: null,
    });
  } else if (contribuicoes.length > 1) {
    pendencias.push({
      codigo: "EFD_CONTRIBUICOES_DUPLICADA",
      gravidade: "impeditiva",
      mensagem: `Há ${contribuicoes.length} arquivos de EFD-Contribuições para ${competenciaTexto}. Deixe na pasta apenas a escrituração vigente.`,
      arquivo: null,
    });
  }
  for (const lido of contribuicoes) {
    if (lido.sped!.retificadora) {
      pendencias.push({
        codigo: "ESCRITURACAO_JA_RETIFICADORA",
        gravidade: "alerta",
        mensagem: `A EFD-Contribuições já é retificadora${lido.sped!.reciboAnterior ? ` (recibo anterior ${lido.sped!.reciboAnterior})` : ""}. A nova retificação partirá dela.`,
        arquivo: lido.arquivo.caminho,
      });
    }
  }

  const fiscaisPorCnpj = new Map<string, number>();
  for (const lido of fiscais) {
    const cnpj = lido.sped!.cnpj;
    if (cnpjsEscriturados.size > 0 && !cnpjsEscriturados.has(cnpj)) {
      const mesmaEmpresa = [...cnpjsEscriturados].some((c) => mesmaRaizCnpj(c, cnpj));
      if (mesmaEmpresa) {
        pendencias.push({
          codigo: "ESTABELECIMENTO_NAO_LISTADO",
          gravidade: "alerta",
          mensagem: `EFD ICMS/IPI do estabelecimento ${formatarCnpj(cnpj)}, que não consta no registro 0140 da EFD-Contribuições.`,
          arquivo: lido.arquivo.caminho,
        });
      } else {
        lido.arquivo.situacao = "incompativel";
        pendencias.push({
          codigo: "CNPJ_INCOMPATIVEL",
          gravidade: "impeditiva",
          mensagem: `EFD ICMS/IPI do CNPJ ${formatarCnpj(cnpj)}, que não pertence à empresa da EFD-Contribuições.`,
          arquivo: lido.arquivo.caminho,
        });
        continue;
      }
    }
    fiscaisPorCnpj.set(cnpj, (fiscaisPorCnpj.get(cnpj) ?? 0) + 1);
    cnpjs.add(cnpj);
  }
  for (const [cnpj, quantidade] of fiscaisPorCnpj) {
    if (quantidade > 1) {
      pendencias.push({
        codigo: "EFD_FISCAL_DUPLICADA",
        gravidade: "impeditiva",
        mensagem: `Há ${quantidade} arquivos de EFD ICMS/IPI do estabelecimento ${formatarCnpj(cnpj)}. Deixe na pasta apenas a escrituração vigente.`,
        arquivo: null,
      });
    }
  }
  if (fiscais.filter((l) => l.arquivo.situacao === "considerado").length === 0) {
    pendencias.push({
      codigo: "EFD_FISCAL_AUSENTE",
      gravidade: "impeditiva",
      mensagem: `Nenhuma EFD ICMS/IPI compatível com ${competenciaTexto} foi encontrada.`,
      arquivo: null,
    });
  }

  resultado.escrituracoes = speds.map((lido) => {
    const sped = lido.sped!;
    return {
      caminho: lido.arquivo.caminho,
      tipo: sped.tipo,
      cnpj: sped.cnpj,
      nome: sped.nome,
      dataInicial: sped.dataInicial,
      dataFinal: sped.dataFinal,
      versaoLeiaute: sped.versaoLeiaute,
      retificadora: sped.retificadora,
      reciboAnterior: sped.reciboAnterior,
      regime: sped.incidenciaTributaria ? DESCRICAO_INCIDENCIA[sped.incidenciaTributaria] : null,
      estabelecimentos: sped.estabelecimentos.length,
      compativel: lido.arquivo.situacao === "considerado",
    };
  });
  resultado.cnpjsDoCliente = [...cnpjs].sort();

  // 4. XMLs: separa as saídas do cliente
  const xml = resultado.xml;
  const canceladas = new Set<string>();
  for (const lido of lidos) {
    if (lido.cancelaChave) canceladas.add(lido.cancelaChave);
  }
  const doCliente = (cnpj: string) =>
    cnpjs.size === 0 || cnpjs.has(cnpj) || [...cnpjs].some((c) => mesmaRaizCnpj(c, cnpj));
  const chavesVistas = new Set<string>();
  const emitentesNaoListados = new Set<string>();

  for (const lido of lidos) {
    const { arquivo } = lido;
    if (lido.sped) continue;
    if (arquivo.nome.toLowerCase().endsWith(".xml")) xml.lidos++;

    if (arquivo.categoria === "xml_invalido") {
      xml.invalidos++;
      continue;
    }
    if (arquivo.categoria === "xml_evento") {
      xml.eventos++;
      continue;
    }
    const documento = lido.documento;
    if (!documento) {
      if (arquivo.nome.toLowerCase().endsWith(".xml")) xml.foraDoEscopo++;
      continue;
    }

    if (chavesVistas.has(documento.chave)) {
      arquivo.categoria = "xml_duplicado";
      arquivo.detalhe = "Mesma chave de acesso de outro arquivo da pasta.";
      xml.duplicados++;
      continue;
    }
    chavesVistas.add(documento.chave);

    if (!doCliente(documento.cnpjEmitente)) {
      arquivo.categoria = "xml_terceiros";
      arquivo.detalhe = "Documento emitido por terceiro (entrada).";
      xml.terceiros++;
    } else if (documento.tipoOperacao === "0") {
      arquivo.categoria = "xml_entrada_propria";
      arquivo.detalhe = "Nota de entrada de emissão própria.";
      xml.entradasProprias++;
    } else if (canceladas.has(documento.chave)) {
      arquivo.categoria = "xml_cancelado";
      arquivo.detalhe = "Documento cancelado por evento presente na pasta.";
      xml.canceladas++;
    } else if (documento.statusProtocolo && !STATUS_AUTORIZADO.has(documento.statusProtocolo)) {
      arquivo.categoria = "xml_nao_autorizado";
      arquivo.detalhe = `Protocolo com situação ${documento.statusProtocolo}; documento sem autorização de uso.`;
      xml.naoAutorizadas++;
    } else if (!dataNaCompetencia(documento.dataEmissao, competencia)) {
      arquivo.categoria = "xml_fora_do_periodo";
      arquivo.detalhe = `Emitido em ${documento.dataEmissao.slice(8)}/${documento.dataEmissao.slice(5, 7)}/${documento.dataEmissao.slice(0, 4)}, fora da competência.`;
      xml.foraDoPeriodo++;
    } else {
      arquivo.categoria = "xml_saida";
      arquivo.situacao = "considerado";
      xml.saidas++;
      xml.saidasPorModelo[documento.modelo]++;
      if (documento.modelo !== "59" && !documento.statusProtocolo) xml.semProtocolo++;
      if (cnpjs.size > 0 && !cnpjs.has(documento.cnpjEmitente)) {
        emitentesNaoListados.add(documento.cnpjEmitente);
      }
    }
  }

  if (xml.saidas === 0) {
    pendencias.push({
      codigo: "XML_DE_SAIDA_AUSENTE",
      gravidade: "impeditiva",
      mensagem:
        xml.lidos === 0
          ? `Nenhum XML foi encontrado na pasta de ${competenciaTexto}.`
          : `Nenhum dos ${plural(xml.lidos, "XML lido", "XMLs lidos")} é nota de saída do cliente em ${competenciaTexto}.`,
      arquivo: null,
    });
  }
  if (cnpjs.size === 0 && xml.saidas > 0) {
    pendencias.push({
      codigo: "SEM_CNPJ_DE_REFERENCIA",
      gravidade: "alerta",
      mensagem:
        "Sem CNPJ de referência (cadastro ou escrituração): as saídas foram separadas apenas pelo tipo de operação.",
      arquivo: null,
    });
  }
  for (const cnpj of emitentesNaoListados) {
    pendencias.push({
      codigo: "EMITENTE_NAO_LISTADO",
      gravidade: "alerta",
      mensagem: `Há notas de saída do estabelecimento ${formatarCnpj(cnpj)}, que não consta nas escriturações lidas.`,
      arquivo: null,
    });
  }
  const avisos: Array<[number, string, GravidadePendencia, string]> = [
    [
      xml.foraDoPeriodo,
      "XML_FORA_DO_PERIODO",
      "alerta",
      `${plural(xml.foraDoPeriodo, "nota de saída emitida", "notas de saída emitidas")} em outra competência, fora do cálculo de ${competenciaTexto}.`,
    ],
    [
      xml.semProtocolo,
      "XML_SEM_PROTOCOLO",
      "alerta",
      `${plural(xml.semProtocolo, "nota de saída", "notas de saída")} sem protocolo de autorização no XML.`,
    ],
    [
      xml.naoAutorizadas,
      "XML_NAO_AUTORIZADO",
      "alerta",
      `${plural(xml.naoAutorizadas, "nota", "notas")} sem autorização de uso, fora do cálculo.`,
    ],
    [
      xml.duplicados,
      "XML_DUPLICADO",
      "alerta",
      `${plural(xml.duplicados, "XML repetido", "XMLs repetidos")} (mesma chave de acesso); cada chave foi contada uma vez.`,
    ],
    [
      xml.invalidos,
      "XML_INVALIDO",
      "alerta",
      `${plural(xml.invalidos, "XML não pôde ser lido", "XMLs não puderam ser lidos")}.`,
    ],
    [
      xml.canceladas,
      "NOTA_CANCELADA",
      "informativa",
      `${plural(xml.canceladas, "nota cancelada", "notas canceladas")}, fora do cálculo.`,
    ],
    [
      xml.terceiros + xml.entradasProprias,
      "XML_DE_ENTRADA",
      "informativa",
      `${plural(xml.terceiros + xml.entradasProprias, "XML de entrada separado", "XMLs de entrada separados")}; a auditoria trata apenas das saídas.`,
    ],
  ];
  for (const [quantidade, codigo, gravidade, mensagem] of avisos) {
    if (quantidade > 0) pendencias.push({ codigo, gravidade, mensagem, arquivo: null });
  }

  const naoReconhecidos = lidos.filter(
    (l) => !l.sped && l.arquivo.nome.toLowerCase().endsWith(".txt"),
  );
  for (const lido of naoReconhecidos) {
    pendencias.push({
      codigo: "ARQUIVO_NAO_RECONHECIDO",
      gravidade: "alerta",
      mensagem: lido.arquivo.detalhe ?? "Arquivo TXT fora do leiaute do SPED.",
      arquivo: lido.arquivo.caminho,
    });
  }

  const peso: Record<GravidadePendencia, number> = { impeditiva: 0, alerta: 1, informativa: 2 };
  pendencias.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
  resultado.apta = !pendencias.some((p) => p.gravidade === "impeditiva");

  return { resultado, arquivos: lidos.map((l) => l.arquivo) };
}
