/**
 * DADOS FICTÍCIOS para validar o fluxo sem acesso ao OneDrive.
 *
 * Empresas, CNPJs, notas e escriturações abaixo são inventados. As
 * escriturações trazem apenas os registros de abertura e de encerramento: não
 * são arquivos válidos para o PVA.
 *
 * Os cenários cobrem os dois leiautes de pasta e as situações que a Triagem
 * precisa apontar (arquivo ausente, período ou CNPJ incompatível, XML de
 * entrada, cancelado, repetido ou fora da competência).
 */

import { zipSync } from "fflate";
import { completarCnpj } from "@/lib/cnpj";
import { limitesCompetencia, partesCompetencia, pastaCompetencia } from "@/lib/competencia";

export interface NoFicticio {
  nome: string;
  filhos?: NoFicticio[];
  conteudo?: Uint8Array;
}

export interface ClienteFicticio {
  id: string;
  nome: string;
  cnpj: string;
  pasta: string;
}

const HORIZONTE = completarCnpj("112223330001");
const AURORA_MATRIZ = completarCnpj("114447770001");
const AURORA_FILIAL = completarCnpj("114447770002");
const FORNECEDOR = completarCnpj("223334440001");
const DESTINATARIO = completarCnpj("334445550001");
const OUTRA_EMPRESA = completarCnpj("556667770001");

export const CLIENTES_FICTICIOS: ClienteFicticio[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    nome: "Comercial Horizonte",
    cnpj: HORIZONTE,
    pasta: "Comercial Horizonte",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    nome: "Distribuidora Aurora",
    cnpj: AURORA_MATRIZ,
    pasta: "Distribuidora Aurora",
  },
];

const utf8 = (texto: string) => new TextEncoder().encode(texto);
// O SPED é gravado em ISO-8859-1; os dados fictícios seguem a mesma codificação.
const latin1 = (texto: string) => Uint8Array.from(Buffer.from(texto, "latin1"));

function dataSped(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}

function chaveAcesso(dados: {
  competencia: string;
  cnpj: string;
  modelo: "55" | "65";
  numero: number;
}): string {
  const { ano, mes } = partesCompetencia(dados.competencia);
  const base =
    "35" +
    String(ano).slice(2) +
    String(mes).padStart(2, "0") +
    dados.cnpj +
    dados.modelo +
    "001" +
    String(dados.numero).padStart(9, "0") +
    "1" +
    String(10000000 + dados.numero).slice(-8);
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return base + (resto < 2 ? 0 : 11 - resto);
}

interface NotaFicticia {
  competencia: string;
  dia: number;
  numero: number;
  emitente: string;
  nomeEmitente: string;
  destinatario: string;
  tipoOperacao: "0" | "1";
  modelo?: "55" | "65";
  valor: number;
  status?: string | null;
}

function xmlNota(nota: NotaFicticia): { nome: string; chave: string; conteudo: Uint8Array } {
  const modelo = nota.modelo ?? "55";
  const chave = chaveAcesso({
    competencia: nota.competencia,
    cnpj: nota.emitente,
    modelo,
    numero: nota.numero,
  });
  const emissao = `${nota.competencia}-${String(nota.dia).padStart(2, "0")}T10:15:00-03:00`;
  const valor = nota.valor.toFixed(2);
  const icms = (nota.valor * 0.18).toFixed(2);
  const status = nota.status === undefined ? "100" : nota.status;
  const protocolo = status
    ? `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>${emissao}</dhRecbto><nProt>135${String(nota.numero).padStart(12, "0")}</nProt><cStat>${status}</cStat><xMotivo>DADOS FICTICIOS</xMotivo></infProt></protNFe>`
    : "";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<NFe><infNFe Id="NFe${chave}" versao="4.00">` +
    `<ide><cUF>35</cUF><natOp>OPERACAO FICTICIA</natOp><mod>${modelo}</mod><serie>1</serie><nNF>${nota.numero}</nNF>` +
    `<dhEmi>${emissao}</dhEmi><tpNF>${nota.tipoOperacao}</tpNF><tpAmb>2</tpAmb></ide>` +
    `<emit><CNPJ>${nota.emitente}</CNPJ><xNome>${nota.nomeEmitente}</xNome></emit>` +
    `<dest><CNPJ>${nota.destinatario}</CNPJ><xNome>DESTINATARIO FICTICIO</xNome></dest>` +
    `<det nItem="1"><prod><cProd>001</cProd><xProd>PRODUTO FICTICIO</xProd><NCM>00000000</NCM>` +
    `<CFOP>${nota.tipoOperacao === "1" ? "5102" : "1202"}</CFOP><vProd>${valor}</vProd></prod>` +
    `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${valor}</vBC><pICMS>18.00</pICMS><vICMS>${icms}</vICMS></ICMS00></ICMS></imposto></det>` +
    `<total><ICMSTot><vBC>${valor}</vBC><vICMS>${icms}</vICMS><vProd>${valor}</vProd><vNF>${valor}</vNF></ICMSTot></total>` +
    `</infNFe></NFe>${protocolo}</nfeProc>`;
  return { nome: `${chave}-nfe.xml`, chave, conteudo: utf8(xml) };
}

function xmlCancelamento(chave: string, cnpj: string, competencia: string): NoFicticio {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<evento versao="1.00"><infEvento Id="ID110111${chave}01"><cOrgao>35</cOrgao><tpAmb>2</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${competencia}-20T09:00:00-03:00</dhEvento>` +
    `<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento>` +
    `<xJust>DADOS FICTICIOS</xJust></detEvento></infEvento></evento></procEventoNFe>`;
  return { nome: `${chave}-cancelamento.xml`, conteudo: utf8(xml) };
}

function spedContribuicoes(dados: {
  competencia: string;
  cnpj: string;
  nome: string;
  estabelecimentos: Array<{ cnpj: string; nome: string }>;
}): Uint8Array {
  const { inicio, fim } = limitesCompetencia(dados.competencia);
  const linhas = [
    `|0000|006|0|||${dataSped(inicio)}|${dataSped(fim)}|${dados.nome}|${dados.cnpj}|SP|3550308||00|2|`,
    `|0001|0|`,
    `|0110|1|1|1||`,
    ...dados.estabelecimentos.map(
      (e, i) => `|0140|${String(i + 1).padStart(3, "0")}|${e.nome}|${e.cnpj}|SP||3550308|||`,
    ),
  ];
  linhas.push(`|0990|${linhas.length + 1}|`, `|9001|0|`, `|9990|3|`);
  linhas.push(`|9999|${linhas.length + 1}|`);
  return latin1(linhas.join("\r\n") + "\r\n");
}

function spedFiscal(dados: { competencia: string; cnpj: string; nome: string }): Uint8Array {
  const { inicio, fim } = limitesCompetencia(dados.competencia);
  const linhas = [
    `|0000|020|0|${dataSped(inicio)}|${dataSped(fim)}|${dados.nome}|${dados.cnpj}||SP|110042490114|3550308|||A|1|`,
    `|0001|0|`,
    `|0990|3|`,
    `|9001|0|`,
    `|9990|3|`,
  ];
  linhas.push(`|9999|${linhas.length + 1}|`);
  return latin1(linhas.join("\r\n") + "\r\n");
}

/** XMLs de um mês: saídas, entradas de terceiros, entrada própria e uma nota cancelada. */
function xmlsDoMes(
  competencia: string,
  emitente: string,
  nomeEmitente: string,
  numeroInicial: number,
  quantidadeSaidas: number,
): NoFicticio[] {
  const nos: NoFicticio[] = [];
  for (let i = 0; i < quantidadeSaidas; i++) {
    const nota = xmlNota({
      competencia,
      dia: 2 + ((i * 3) % 25),
      numero: numeroInicial + i,
      emitente,
      nomeEmitente,
      destinatario: DESTINATARIO,
      tipoOperacao: "1",
      modelo: i % 4 === 3 ? "65" : "55",
      valor: 1800 + i * 430,
    });
    nos.push({ nome: nota.nome, conteudo: nota.conteudo });
  }
  const cancelada = xmlNota({
    competencia,
    dia: 19,
    numero: numeroInicial + 90,
    emitente,
    nomeEmitente,
    destinatario: DESTINATARIO,
    tipoOperacao: "1",
    valor: 2600,
  });
  nos.push({ nome: cancelada.nome, conteudo: cancelada.conteudo });
  nos.push(xmlCancelamento(cancelada.chave, emitente, competencia));

  for (let i = 0; i < 2; i++) {
    const compra = xmlNota({
      competencia,
      dia: 5 + i * 9,
      numero: 70000 + numeroInicial + i,
      emitente: FORNECEDOR,
      nomeEmitente: "FORNECEDOR FICTICIO LTDA",
      destinatario: emitente,
      tipoOperacao: "1",
      valor: 5200 + i * 800,
    });
    nos.push({ nome: compra.nome, conteudo: compra.conteudo });
  }
  const devolucao = xmlNota({
    competencia,
    dia: 22,
    numero: numeroInicial + 95,
    emitente,
    nomeEmitente,
    destinatario: DESTINATARIO,
    tipoOperacao: "0",
    valor: 640,
  });
  nos.push({ nome: devolucao.nome, conteudo: devolucao.conteudo });
  return nos;
}

function horizonte(): NoFicticio {
  const nome = "COMERCIAL HORIZONTE LTDA - DADOS FICTÍCIOS";
  const estabelecimentos = [{ cnpj: HORIZONTE, nome }];
  const mes = (competencia: string, numero: number, quantidade: number): NoFicticio => ({
    nome: pastaCompetencia(competencia),
    filhos: [
      { nome: "XMLs", filhos: xmlsDoMes(competencia, HORIZONTE, nome, numero, quantidade) },
      {
        nome: "Sped_Contribuicoes.txt",
        conteudo: spedContribuicoes({ competencia, cnpj: HORIZONTE, nome, estabelecimentos }),
      },
      { nome: "Sped_Fiscal.txt", conteudo: spedFiscal({ competencia, cnpj: HORIZONTE, nome }) },
    ],
  });

  // 06/2026: falta a EFD ICMS/IPI e há uma nota de maio esquecida na pasta.
  const junho = mes("2026-06", 4400, 7);
  junho.filhos = junho.filhos!.filter((filho) => filho.nome !== "Sped_Fiscal.txt");
  const notaDeMaio = xmlNota({
    competencia: "2026-05",
    dia: 30,
    numero: 4399,
    emitente: HORIZONTE,
    nomeEmitente: nome,
    destinatario: DESTINATARIO,
    tipoOperacao: "1",
    valor: 990,
  });
  junho.filhos[0].filhos!.push({ nome: notaDeMaio.nome, conteudo: notaDeMaio.conteudo });

  return {
    nome: "Comercial Horizonte",
    filhos: [mes("2026-03", 4100, 6), mes("2026-04", 4200, 8), mes("2026-05", 4300, 9), junho],
  };
}

function aurora(): NoFicticio {
  const nomeMatriz = "DISTRIBUIDORA AURORA S.A. - DADOS FICTÍCIOS";
  const nomeFilial = "DISTRIBUIDORA AURORA S.A. FILIAL - DADOS FICTÍCIOS";
  const estabelecimentos = [
    { cnpj: AURORA_MATRIZ, nome: nomeMatriz },
    { cnpj: AURORA_FILIAL, nome: nomeFilial },
  ];

  const pastaMes = (
    mes: string,
    xml: NoFicticio[],
    contribuicoes: NoFicticio[],
    fiscal: NoFicticio[],
  ): NoFicticio => ({
    nome: mes,
    filhos: [
      { nome: "a. XML", filhos: xml },
      { nome: "b. SPED Contribuições", filhos: contribuicoes },
      { nome: "c. SPED Fiscal", filhos: fiscal },
    ],
  });

  // 05/2026: completo, com dois estabelecimentos e os XMLs da filial em um ZIP.
  const maio = "2026-05";
  const xmlFilial = xmlsDoMes(maio, AURORA_FILIAL, nomeFilial, 8200, 5);
  const zipFilial = zipSync(
    Object.fromEntries(xmlFilial.map((arquivo) => [arquivo.nome, arquivo.conteudo!])),
  );
  const repetida = xmlsDoMes(maio, AURORA_MATRIZ, nomeMatriz, 8100, 1)[0];
  const completo = pastaMes(
    "05",
    [
      ...xmlsDoMes(maio, AURORA_MATRIZ, nomeMatriz, 8100, 7),
      { nome: "copia-" + repetida.nome, conteudo: repetida.conteudo },
      { nome: "filial.zip", conteudo: zipFilial },
      { nome: "leia-me.xml", conteudo: utf8("<anotacoes><item>DADOS FICTICIOS</item></anotacoes>") },
    ],
    [
      {
        nome: "EFD_Contribuicoes_052026.txt",
        conteudo: spedContribuicoes({
          competencia: maio,
          cnpj: AURORA_MATRIZ,
          nome: nomeMatriz,
          estabelecimentos,
        }),
      },
    ],
    [
      {
        nome: "EFD_ICMS_IPI_matriz.txt",
        conteudo: spedFiscal({ competencia: maio, cnpj: AURORA_MATRIZ, nome: nomeMatriz }),
      },
      {
        nome: "EFD_ICMS_IPI_filial.txt",
        conteudo: spedFiscal({ competencia: maio, cnpj: AURORA_FILIAL, nome: nomeFilial }),
      },
    ],
  );

  // 06/2026: a EFD-Contribuições na pasta é de maio e a EFD ICMS/IPI é de outra empresa.
  const junho = "2026-06";
  const incompativel = pastaMes(
    "06",
    xmlsDoMes(junho, AURORA_MATRIZ, nomeMatriz, 8300, 6),
    [
      {
        nome: "EFD_Contribuicoes.txt",
        conteudo: spedContribuicoes({
          competencia: maio,
          cnpj: AURORA_MATRIZ,
          nome: nomeMatriz,
          estabelecimentos,
        }),
      },
    ],
    [
      {
        nome: "EFD_ICMS_IPI.txt",
        conteudo: spedFiscal({
          competencia: junho,
          cnpj: OUTRA_EMPRESA,
          nome: "OUTRA EMPRESA LTDA - DADOS FICTÍCIOS",
        }),
      },
    ],
  );

  // 04/2026: pastas criadas, ainda sem arquivos.
  const vazio = pastaMes("04", [], [], []);

  return {
    nome: "Distribuidora Aurora",
    filhos: [{ nome: "2026", filhos: [vazio, completo, incompativel] }],
  };
}

export function arvoreFicticia(): NoFicticio {
  return { nome: "Inteligência Tributária", filhos: [horizonte(), aurora()] };
}
