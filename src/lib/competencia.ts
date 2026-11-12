/**
 * Competência fiscal (mês de apuração).
 *
 * Formato canônico interno: "AAAA-MM". Na interface exibimos "MM/AAAA" e nas
 * pastas do OneDrive aceitamos "MM-AAAA" ou "AAAA/MM".
 */

const CANONICA = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MES_ANO = /^(0?[1-9]|1[0-2])[\/\-._ ](\d{4})$/;
const ANO_MES = /^(\d{4})[\/\-._ ](0?[1-9]|1[0-2])$/;

export function normalizarCompetencia(valor: string): string | null {
  const texto = valor.trim();
  const mesAno = MES_ANO.exec(texto);
  if (mesAno) return `${mesAno[2]}-${mesAno[1].padStart(2, "0")}`;
  const anoMes = ANO_MES.exec(texto);
  if (anoMes) return `${anoMes[1]}-${anoMes[2].padStart(2, "0")}`;
  return null;
}

export function competenciaValida(valor: string): boolean {
  return CANONICA.test(valor);
}

export function partesCompetencia(competencia: string): { ano: number; mes: number } {
  const partes = CANONICA.exec(competencia);
  if (!partes) throw new Error(`Competência inválida: ${competencia}`);
  return { ano: Number(partes[1]), mes: Number(partes[2]) };
}

/** "2026-05" → "05/2026" */
export function formatarCompetencia(competencia: string): string {
  const { ano, mes } = partesCompetencia(competencia);
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

/** "2026-05" → "05-2026" (nome de pasta no leiaute proposto) */
export function pastaCompetencia(competencia: string): string {
  return formatarCompetencia(competencia).replace("/", "-");
}

/** Primeiro e último dia da competência, em "AAAA-MM-DD". */
export function limitesCompetencia(competencia: string): { inicio: string; fim: string } {
  const { ano, mes } = partesCompetencia(competencia);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(ultimoDia).padStart(2, "0")}`,
  };
}

/** Verdadeiro quando a data ("AAAA-MM-DD...") pertence ao mês da competência. */
export function dataNaCompetencia(dataIso: string, competencia: string): boolean {
  return dataIso.slice(0, 7) === competencia;
}

export function compararCompetenciasDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
