/**
 * Céu visto pelas janelas do escritório, conforme a hora local de quem acessa:
 * sol de dia, lua à noite, e tons quentes perto do nascer e do pôr do sol.
 */

export type Periodo = "dia" | "noite";

export interface Ceu {
  periodo: Periodo;
  /** true perto do nascer ou do pôr do sol. */
  crepusculo: boolean;
  /** Posição do sol ou da lua na janela: 0 a 1 da esquerda para a direita e 0 a 1 de baixo para cima. */
  astro: { horizontal: number; altura: number };
  cores: {
    alto: string;
    baixo: string;
    predios: readonly [string, string];
    janelas: string;
  };
  /** Luzes dos prédios acesas e estrelas visíveis. */
  luzesAcesas: boolean;
  estrelas: boolean;
}

const NASCER = 6;
const POR = 18;
/** Fração do dia, em cada ponta, em que o céu fica alaranjado. */
const FAIXA_DO_CREPUSCULO = 0.1;

/** `hora` é a hora local em fração (14,5 = 14h30). */
export function ceuDaHora(hora: number): Ceu {
  const h = ((hora % 24) + 24) % 24;
  const dia = h >= NASCER && h < POR;
  // Fração percorrida do período: o sol cruza a janela das 6h às 18h; a lua, das 18h às 6h.
  const percorrido = dia ? (h - NASCER) / (POR - NASCER) : ((h - POR + 24) % 24) / (24 - POR + NASCER);
  const astro = { horizontal: percorrido, altura: Math.sin(percorrido * Math.PI) };

  if (!dia) {
    return {
      periodo: "noite",
      crepusculo: false,
      astro,
      cores: { alto: "#0e1b3d", baixo: "#16285a", predios: ["#182a52", "#1d315f"], janelas: "#ffd98a" },
      luzesAcesas: true,
      estrelas: true,
    };
  }
  const crepusculo = percorrido < FAIXA_DO_CREPUSCULO || percorrido > 1 - FAIXA_DO_CREPUSCULO;
  if (crepusculo) {
    return {
      periodo: "dia",
      crepusculo: true,
      astro,
      cores: { alto: "#6f8fd0", baixo: "#f6b27a", predios: ["#4f5c84", "#5d6a92"], janelas: "#ffd98a" },
      luzesAcesas: true,
      estrelas: false,
    };
  }
  return {
    periodo: "dia",
    crepusculo: false,
    astro,
    cores: { alto: "#6db3ee", baixo: "#c5e6fb", predios: ["#6f88ad", "#8098ba"], janelas: "#4d6890" },
    luzesAcesas: false,
    estrelas: false,
  };
}
