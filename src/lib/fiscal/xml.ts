/**
 * Identificação dos XMLs fiscais encontrados na pasta da competência.
 *
 * A triagem só precisa saber o que é cada arquivo: documento (NF-e, NFC-e,
 * CF-e SAT), evento (cancelamento, carta de correção, inutilização) ou algo
 * fora do escopo. A leitura dos itens e dos tributos fica para a Auditoria.
 */

import { XMLParser } from "fast-xml-parser";
import { normalizarCnpj } from "@/lib/cnpj";

export type ModeloDocumento = "55" | "65" | "59";

export interface DocumentoFiscalXml {
  especie: "documento";
  modelo: ModeloDocumento;
  /** Chave de acesso com 44 posições. */
  chave: string;
  /** "0" entrada, "1" saída. O CF-e SAT é sempre saída. */
  tipoOperacao: "0" | "1";
  /** Data de emissão, "AAAA-MM-DD", no horário local do emitente. */
  dataEmissao: string;
  cnpjEmitente: string;
  numero: string;
  serie: string;
  /** cStat do protocolo de autorização, quando o XML traz o protocolo. */
  statusProtocolo: string | null;
}

export interface EventoFiscalXml {
  especie: "evento";
  /** "cancelamento" quando o evento cancela o documento da chave informada. */
  tipo: "cancelamento" | "carta_correcao" | "inutilizacao" | "outro";
  chave: string | null;
}

export interface XmlForaDoEscopo {
  especie: "fora_do_escopo";
  descricao: string;
}

export interface XmlInvalido {
  especie: "invalido";
  motivo: string;
}

export type LeituraXml = DocumentoFiscalXml | EventoFiscalXml | XmlForaDoEscopo | XmlInvalido;

type No = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Mantém tudo como texto: CNPJ, chave e número não podem perder zeros à esquerda.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function no(valor: unknown): No | null {
  if (Array.isArray(valor)) return no(valor[0]);
  return valor && typeof valor === "object" ? (valor as No) : null;
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number") return String(valor);
  const objeto = no(valor);
  return objeto && typeof objeto["#text"] === "string" ? (objeto["#text"] as string) : "";
}

function chaveDoId(id: string, prefixo: string): string {
  const chave = id.startsWith(prefixo) ? id.slice(prefixo.length) : id;
  return /^[A-Z0-9]{44}$/.test(chave) ? chave : "";
}

function lerNfe(nfe: No, protocolo: No | null): LeituraXml {
  const inf = no(nfe.infNFe);
  const ide = no(inf?.ide);
  const emit = no(inf?.emit);
  if (!inf || !ide || !emit) return { especie: "invalido", motivo: "NF-e sem infNFe, ide ou emit." };

  const modelo = texto(ide.mod);
  if (modelo !== "55" && modelo !== "65") {
    return { especie: "fora_do_escopo", descricao: `Documento modelo ${modelo || "não informado"}` };
  }
  const chave = chaveDoId(texto(inf["@_Id"]), "NFe");
  const emissao = texto(ide.dhEmi) || texto(ide.dEmi);
  const tipoOperacao = texto(ide.tpNF);
  if (!chave) return { especie: "invalido", motivo: "NF-e sem chave de acesso válida." };
  if (!/^\d{4}-\d{2}-\d{2}/.test(emissao)) {
    return { especie: "invalido", motivo: "NF-e sem data de emissão." };
  }
  if (tipoOperacao !== "0" && tipoOperacao !== "1") {
    return { especie: "invalido", motivo: "NF-e sem tipo de operação (tpNF)." };
  }

  const infProt = no(protocolo?.infProt);
  return {
    especie: "documento",
    modelo,
    chave,
    tipoOperacao,
    dataEmissao: emissao.slice(0, 10),
    cnpjEmitente: normalizarCnpj(texto(emit.CNPJ)),
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    statusProtocolo: infProt ? texto(infProt.cStat) || null : null,
  };
}

function lerCfe(cfe: No): LeituraXml {
  const inf = no(cfe.infCFe);
  const ide = no(inf?.ide);
  const emit = no(inf?.emit);
  if (!inf || !ide || !emit) return { especie: "invalido", motivo: "CF-e sem infCFe, ide ou emit." };
  const chave = chaveDoId(texto(inf["@_Id"]), "CFe");
  const emissao = /^(\d{4})(\d{2})(\d{2})$/.exec(texto(ide.dEmi));
  if (!chave || !emissao) return { especie: "invalido", motivo: "CF-e sem chave ou data de emissão." };
  return {
    especie: "documento",
    modelo: "59",
    chave,
    tipoOperacao: "1",
    dataEmissao: `${emissao[1]}-${emissao[2]}-${emissao[3]}`,
    cnpjEmitente: normalizarCnpj(texto(emit.CNPJ)),
    numero: texto(ide.nCFe),
    serie: texto(ide.nserieSAT),
    statusProtocolo: null,
  };
}

function lerEvento(evento: No): EventoFiscalXml {
  const inf = no(evento.infEvento);
  const tipoEvento = texto(inf?.tpEvento);
  const chave = texto(inf?.chNFe);
  const tipo =
    tipoEvento === "110111" || tipoEvento === "110112"
      ? "cancelamento"
      : tipoEvento === "110110"
        ? "carta_correcao"
        : "outro";
  return { especie: "evento", tipo, chave: /^[A-Z0-9]{44}$/.test(chave) ? chave : null };
}

export function lerXmlFiscal(bytes: Uint8Array): LeituraXml {
  let raiz: No;
  try {
    raiz = parser.parse(new TextDecoder("utf-8").decode(bytes)) as No;
  } catch {
    return { especie: "invalido", motivo: "XML malformado." };
  }

  const nfeProc = no(raiz.nfeProc);
  if (nfeProc) {
    const nfe = no(nfeProc.NFe);
    return nfe ? lerNfe(nfe, no(nfeProc.protNFe)) : { especie: "invalido", motivo: "nfeProc sem NFe." };
  }
  const nfe = no(raiz.NFe);
  if (nfe) return lerNfe(nfe, null);

  const cfe = no(raiz.CFe);
  if (cfe) return lerCfe(cfe);

  const cfeCanc = no(raiz.CFeCanc);
  if (cfeCanc) {
    const chave = chaveDoId(texto(no(cfeCanc.infCFe)?.["@_chCanc"]), "CFe");
    return { especie: "evento", tipo: "cancelamento", chave: chave || null };
  }

  const procEvento = no(raiz.procEventoNFe);
  if (procEvento) {
    const evento = no(procEvento.evento);
    return evento ? lerEvento(evento) : { especie: "evento", tipo: "outro", chave: null };
  }
  const evento = no(raiz.evento) ?? no(no(raiz.envEvento)?.evento);
  if (evento) return lerEvento(evento);

  if (raiz.procInutNFe || raiz.inutNFe || raiz.retInutNFe) {
    return { especie: "evento", tipo: "inutilizacao", chave: null };
  }
  if (raiz.cteProc || raiz.CTe || raiz.cteOSProc) {
    return { especie: "fora_do_escopo", descricao: "Conhecimento de transporte (CT-e)" };
  }
  if (raiz.CompNfse || raiz.Nfse || raiz.NFSe || raiz.ConsultarNfseResposta) {
    return { especie: "fora_do_escopo", descricao: "Nota fiscal de serviço (NFS-e)" };
  }

  const nomeRaiz = Object.keys(raiz).find((chave) => !chave.startsWith("?")) ?? "desconhecido";
  return { especie: "fora_do_escopo", descricao: `XML não fiscal ou não reconhecido (${nomeRaiz})` };
}

export const NOME_MODELO: Record<ModeloDocumento, string> = {
  "55": "NF-e",
  "65": "NFC-e",
  "59": "CF-e SAT",
};
