/**
 * Leitura do cabeçalho das escriturações do SPED usadas no piloto:
 * EFD-Contribuições e EFD ICMS/IPI.
 *
 * Nesta etapa lemos apenas o necessário para a triagem: identificação do
 * arquivo (registro 0000), regime de apuração (0110) e estabelecimentos (0140).
 *
 * Posições do registro 0000 conforme os Guias Práticos:
 *  - EFD-Contribuições: REG, COD_VER, TIPO_ESCRIT, IND_SIT_ESP, NUM_REC_ANTERIOR,
 *    DT_INI, DT_FIN, NOME, CNPJ, UF, COD_MUN, SUFRAMA, IND_NAT_PJ, IND_ATIV
 *  - EFD ICMS/IPI: REG, COD_VER, COD_FIN, DT_INI, DT_FIN, NOME, CNPJ, CPF, UF, IE,
 *    COD_MUN, IM, SUFRAMA, IND_PERFIL, IND_ATIV
 */

import { normalizarCnpj } from "@/lib/cnpj";

export type TipoSped = "efd_contribuicoes" | "efd_icms_ipi";

export interface EstabelecimentoSped {
  codigo: string;
  nome: string;
  cnpj: string;
  uf: string;
}

export interface CabecalhoSped {
  tipo: TipoSped;
  versaoLeiaute: string;
  /** Data inicial das informações, "AAAA-MM-DD". */
  dataInicial: string;
  /** Data final das informações, "AAAA-MM-DD". */
  dataFinal: string;
  nome: string;
  cnpj: string;
  uf: string;
  /** true quando o arquivo já é uma retificadora (Contribuições) ou substituto (ICMS/IPI). */
  retificadora: boolean;
  /** Recibo da escrituração anterior — só existe na EFD-Contribuições retificadora. */
  reciboAnterior: string | null;
  /** COD_INC_TRIB do registro 0110 da EFD-Contribuições: 1, 2 ou 3. */
  incidenciaTributaria: "1" | "2" | "3" | null;
  /** Estabelecimentos do registro 0140 da EFD-Contribuições. */
  estabelecimentos: EstabelecimentoSped[];
  totalLinhas: number;
  /** true quando o registro 9999 (encerramento) foi encontrado. */
  encerrado: boolean;
}

export type LeituraSped =
  | { ok: true; cabecalho: CabecalhoSped }
  | { ok: false; motivo: string };

const DATA_SPED = /^(\d{2})(\d{2})(\d{4})$/;

function dataSpedParaIso(valor: string | undefined): string | null {
  const partes = DATA_SPED.exec(valor ?? "");
  if (!partes) return null;
  const [, dia, mes, ano] = partes;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const coerente =
    data.getUTCFullYear() === Number(ano) &&
    data.getUTCMonth() === Number(mes) - 1 &&
    data.getUTCDate() === Number(dia);
  return coerente ? `${ano}-${mes}-${dia}` : null;
}

/**
 * Os arquivos do SPED são gravados em ISO-8859-1. Aceitamos também UTF-8,
 * comum em arquivos reexportados por sistemas de terceiros.
 */
export function decodificarSped(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

function campos(linha: string): string[] {
  // "|0000|006|0|...|" → ["0000", "006", "0", ...]
  const partes = linha.split("|");
  return partes.slice(1, partes.length - 1);
}

export function lerCabecalhoSped(bytes: Uint8Array): LeituraSped {
  const texto = decodificarSped(bytes);
  const linhas = texto.split(/\r?\n/);
  const primeira = linhas.find((linha) => linha.trim().length > 0)?.trim() ?? "";

  if (!primeira.startsWith("|0000|")) {
    return { ok: false, motivo: "O arquivo não começa com o registro 0000 do SPED." };
  }

  const c = campos(primeira);
  let cabecalho: CabecalhoSped;

  const inicioFiscal = dataSpedParaIso(c[3]);
  const fimFiscal = dataSpedParaIso(c[4]);
  const inicioContrib = dataSpedParaIso(c[5]);
  const fimContrib = dataSpedParaIso(c[6]);

  if (inicioFiscal && fimFiscal) {
    cabecalho = {
      tipo: "efd_icms_ipi",
      versaoLeiaute: c[1] ?? "",
      dataInicial: inicioFiscal,
      dataFinal: fimFiscal,
      nome: c[5] ?? "",
      cnpj: normalizarCnpj(c[6]),
      uf: c[8] ?? "",
      retificadora: c[2] === "1",
      reciboAnterior: null,
      incidenciaTributaria: null,
      estabelecimentos: [],
      totalLinhas: 0,
      encerrado: false,
    };
  } else if (inicioContrib && fimContrib) {
    cabecalho = {
      tipo: "efd_contribuicoes",
      versaoLeiaute: c[1] ?? "",
      dataInicial: inicioContrib,
      dataFinal: fimContrib,
      nome: c[7] ?? "",
      cnpj: normalizarCnpj(c[8]),
      uf: c[9] ?? "",
      retificadora: c[2] === "1",
      reciboAnterior: c[4] ? c[4] : null,
      incidenciaTributaria: null,
      estabelecimentos: [],
      totalLinhas: 0,
      encerrado: false,
    };
  } else {
    return {
      ok: false,
      motivo: "Registro 0000 fora do leiaute da EFD-Contribuições e da EFD ICMS/IPI.",
    };
  }

  let total = 0;
  for (const bruta of linhas) {
    const linha = bruta.trim();
    if (!linha.startsWith("|")) continue;
    total++;
    if (linha.startsWith("|9999|")) {
      cabecalho.encerrado = true;
      // Depois do 9999 pode existir o bloco de assinatura digital; não é escrituração.
      break;
    }
    if (cabecalho.tipo !== "efd_contribuicoes") continue;
    if (linha.startsWith("|0110|")) {
      const incidencia = campos(linha)[1];
      if (incidencia === "1" || incidencia === "2" || incidencia === "3") {
        cabecalho.incidenciaTributaria = incidencia;
      }
    } else if (linha.startsWith("|0140|")) {
      const e = campos(linha);
      cabecalho.estabelecimentos.push({
        codigo: e[1] ?? "",
        nome: e[2] ?? "",
        cnpj: normalizarCnpj(e[3]),
        uf: e[4] ?? "",
      });
    }
  }
  cabecalho.totalLinhas = total;

  if (!cabecalho.cnpj) {
    return { ok: false, motivo: "Registro 0000 sem CNPJ." };
  }
  return { ok: true, cabecalho };
}

export const DESCRICAO_INCIDENCIA: Record<"1" | "2" | "3", string> = {
  "1": "Regime não cumulativo",
  "2": "Regime cumulativo",
  "3": "Regimes não cumulativo e cumulativo",
};

export const NOME_TIPO_SPED: Record<TipoSped, string> = {
  efd_contribuicoes: "EFD-Contribuições",
  efd_icms_ipi: "EFD ICMS/IPI",
};
