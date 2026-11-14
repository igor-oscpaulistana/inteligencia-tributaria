/**
 * Chave canônica de um número completo (com DDI), como o WhatsApp entrega.
 *
 * O WhatsApp pode entregar celulares brasileiros com ou sem o nono dígito
 * (5511987654321 ou 551187654321). A chave remove esse 9 para que as duas
 * formas identifiquem o mesmo contato. Nada é presumido sobre o DDI aqui.
 */
export function phoneKey(waId: string): string {
  let d = waId.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") {
    d = d.slice(0, 4) + d.slice(5);
  }
  return d;
}

/**
 * Número digitado por uma pessoa → dígitos com DDI, para o campo `to` da API.
 * Sem "+" e com 10 ou 11 dígitos, presume Brasil (DDD + número); números de
 * outros países devem ser informados com "+" e o DDI.
 */
export function toWaId(typed: string): string {
  const d = typed.replace(/\D/g, "");
  if (!typed.trim().startsWith("+") && (d.length === 10 || d.length === 11)) return `55${d}`;
  return d;
}

/** Chave canônica a partir de um número digitado por uma pessoa. */
export function typedPhoneKey(typed: string): string {
  return phoneKey(toWaId(typed));
}

export function isPlausiblePhone(typed: string): boolean {
  const d = toWaId(typed);
  return d.length >= 10 && d.length <= 15;
}
