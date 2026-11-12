import { describe, expect, it } from "vitest";
import { cnpjValido, completarCnpj, formatarCnpj, mesmaRaizCnpj, normalizarCnpj } from "@/lib/cnpj";
import {
  dataNaCompetencia,
  formatarCompetencia,
  limitesCompetencia,
  normalizarCompetencia,
  pastaCompetencia,
} from "@/lib/competencia";
import { lerCabecalhoSped } from "./sped";
import { lerXmlFiscal } from "./xml";

const latin1 = (texto: string) => Uint8Array.from(Buffer.from(texto, "latin1"));
const utf8 = (texto: string) => new TextEncoder().encode(texto);

describe("competência", () => {
  it("aceita os formatos de pasta e de interface", () => {
    expect(normalizarCompetencia("05/2026")).toBe("2026-05");
    expect(normalizarCompetencia("05-2026")).toBe("2026-05");
    expect(normalizarCompetencia("5-2026")).toBe("2026-05");
    expect(normalizarCompetencia("2026-05")).toBe("2026-05");
    expect(normalizarCompetencia("13/2026")).toBeNull();
    expect(normalizarCompetencia("2026")).toBeNull();
    expect(normalizarCompetencia("XMLs")).toBeNull();
  });

  it("formata para a interface e para a pasta", () => {
    expect(formatarCompetencia("2026-05")).toBe("05/2026");
    expect(pastaCompetencia("2026-05")).toBe("05-2026");
  });

  it("calcula os limites do mês, inclusive fevereiro bissexto", () => {
    expect(limitesCompetencia("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(limitesCompetencia("2028-02")).toEqual({ inicio: "2028-02-01", fim: "2028-02-29" });
    expect(dataNaCompetencia("2026-05-31", "2026-05")).toBe(true);
    expect(dataNaCompetencia("2026-06-01", "2026-05")).toBe(false);
  });
});

describe("CNPJ", () => {
  it("valida CNPJ numérico", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(completarCnpj("112223330001")).toBe("11222333000181");
  });

  it("valida CNPJ alfanumérico", () => {
    // Exemplo divulgado pela Receita Federal para o CNPJ alfanumérico.
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-36")).toBe(false);
    expect(normalizarCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("compara estabelecimentos pela raiz e formata", () => {
    expect(mesmaRaizCnpj("11444777000161", completarCnpj("114447770002"))).toBe(true);
    expect(mesmaRaizCnpj("11444777000161", "11222333000181")).toBe(false);
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("cabeçalho do SPED", () => {
  const contribuicoes = [
    "|0000|006|1||123456789012345678901234567890123456789-0|01052026|31052026|EMPRESA FICTÍCIA LTDA|11222333000181|SP|3550308||00|2|",
    "|0001|0|",
    "|0110|2|||9|",
    "|0140|001|MATRIZ|11222333000181|SP||3550308|||",
    "|0140|002|FILIAL|11222333000262|SP||3550308|||",
    "|0990|6|",
    "|9999|7|",
    "ASSINATURA DIGITAL FORA DA ESCRITURACAO",
  ].join("\r\n");

  it("identifica a EFD-Contribuições, o regime e os estabelecimentos", () => {
    const leitura = lerCabecalhoSped(latin1(contribuicoes));
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.cabecalho).toMatchObject({
      tipo: "efd_contribuicoes",
      versaoLeiaute: "006",
      dataInicial: "2026-05-01",
      dataFinal: "2026-05-31",
      nome: "EMPRESA FICTÍCIA LTDA",
      cnpj: "11222333000181",
      retificadora: true,
      reciboAnterior: "123456789012345678901234567890123456789-0",
      incidenciaTributaria: "2",
      encerrado: true,
      totalLinhas: 7,
    });
    expect(leitura.cabecalho.estabelecimentos.map((e) => e.cnpj)).toEqual([
      "11222333000181",
      "11222333000262",
    ]);
  });

  it("identifica a EFD ICMS/IPI", () => {
    const fiscal =
      "|0000|020|0|01052026|31052026|EMPRESA FICTICIA LTDA|11222333000181||SP|110042490114|3550308|||A|1|\n|0001|0|\n";
    const leitura = lerCabecalhoSped(utf8(fiscal));
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.cabecalho).toMatchObject({
      tipo: "efd_icms_ipi",
      dataInicial: "2026-05-01",
      dataFinal: "2026-05-31",
      cnpj: "11222333000181",
      uf: "SP",
      retificadora: false,
      encerrado: false,
    });
  });

  it("recusa arquivo que não é do SPED", () => {
    expect(lerCabecalhoSped(utf8("relatorio qualquer\nlinha 2")).ok).toBe(false);
    expect(lerCabecalhoSped(utf8("|0000|LECD|01012026|31122026|EMPRESA|11222333000181|")).ok).toBe(false);
  });
});

describe("XML fiscal", () => {
  const chave = "35260511222333000181550010000043001100043005";
  const nfe = (tpNF: string, protocolo = true) =>
    utf8(
      `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>4300</nNF>` +
        `<dhEmi>2026-05-31T23:40:00-03:00</dhEmi><tpNF>${tpNF}</tpNF></ide>` +
        `<emit><CNPJ>01222333000181</CNPJ></emit></infNFe></NFe>` +
        (protocolo ? `<protNFe><infProt><cStat>100</cStat></infProt></protNFe>` : "") +
        `</nfeProc>`,
    );

  it("lê NF-e de saída preservando zeros e a data local de emissão", () => {
    expect(lerXmlFiscal(nfe("1"))).toEqual({
      especie: "documento",
      modelo: "55",
      chave,
      tipoOperacao: "1",
      dataEmissao: "2026-05-31",
      cnpjEmitente: "01222333000181",
      numero: "4300",
      serie: "1",
      statusProtocolo: "100",
    });
  });

  it("distingue entrada e ausência de protocolo", () => {
    const leitura = lerXmlFiscal(nfe("0", false));
    expect(leitura).toMatchObject({ especie: "documento", tipoOperacao: "0", statusProtocolo: null });
  });

  it("lê CF-e SAT como saída", () => {
    const chaveCfe = "35260511222333000181590001234560000011234567";
    const cfe = utf8(
      `<CFe><infCFe Id="CFe${chaveCfe}"><ide><mod>59</mod><nserieSAT>000123456</nserieSAT><nCFe>000001</nCFe>` +
        `<dEmi>20260512</dEmi></ide><emit><CNPJ>11222333000181</CNPJ></emit></infCFe></CFe>`,
    );
    expect(lerXmlFiscal(cfe)).toMatchObject({
      especie: "documento",
      modelo: "59",
      chave: chaveCfe,
      tipoOperacao: "1",
      dataEmissao: "2026-05-12",
    });
  });

  it("reconhece cancelamento, CT-e e XML malformado", () => {
    const evento = utf8(
      `<procEventoNFe><evento><infEvento><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>`,
    );
    expect(lerXmlFiscal(evento)).toEqual({ especie: "evento", tipo: "cancelamento", chave });
    expect(lerXmlFiscal(utf8("<cteProc><CTe/></cteProc>")).especie).toBe("fora_do_escopo");
    expect(lerXmlFiscal(utf8("<nfeProc><NFe><infNFe>")).especie).toBe("invalido");
  });
});
