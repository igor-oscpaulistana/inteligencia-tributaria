/**
 * CNPJ numérico e alfanumérico (IN RFB nº 2.229/2024, vigente desde julho de 2026).
 *
 * As 12 primeiras posições podem conter letras maiúsculas e dígitos; os dois
 * dígitos verificadores continuam numéricos. O cálculo usa o módulo 11 com o
 * valor de cada caractere igual ao seu código ASCII menos 48.
 */

const FORMATO = /^[A-Z0-9]{12}\d{2}$/;

export function normalizarCnpj(valor: string | null | undefined): string {
  return (valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function digitoVerificador(base: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Completa as 12 primeiras posições com os dois dígitos verificadores. */
export function completarCnpj(base12: string): string {
  const base = normalizarCnpj(base12);
  if (base.length !== 12) throw new Error("A base do CNPJ deve ter 12 posições.");
  const primeiro = digitoVerificador(base);
  return `${base}${primeiro}${digitoVerificador(base + primeiro)}`;
}

export function cnpjValido(valor: string): boolean {
  const cnpj = normalizarCnpj(valor);
  if (!FORMATO.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;
  const primeiro = digitoVerificador(cnpj.slice(0, 12));
  const segundo = digitoVerificador(cnpj.slice(0, 12) + primeiro);
  return cnpj.endsWith(`${primeiro}${segundo}`);
}

/** Raiz do CNPJ (8 primeiras posições), comum a todos os estabelecimentos. */
export function raizCnpj(valor: string): string {
  return normalizarCnpj(valor).slice(0, 8);
}

export function mesmaRaizCnpj(a: string, b: string): boolean {
  const raizA = raizCnpj(a);
  return raizA.length === 8 && raizA === raizCnpj(b);
}

export function formatarCnpj(valor: string): string {
  const c = normalizarCnpj(valor);
  if (c.length !== 14) return valor;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
