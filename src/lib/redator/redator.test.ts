import { describe, expect, it } from "vitest";
import { RedatorSimulado } from "./simulador";

describe("redator simulado", () => {
  it("usa só os dados recebidos e identifica a demonstração", async () => {
    const texto = await new RedatorSimulado().redigir({
      cliente: "Comercial Horizonte",
      competencia: "2026-05",
      demonstracao: true,
      achados: [{ id: "a1", titulo: "ICMS na base escriturada", dados: { base: "1.000,00", icms: "180,00" } }],
    });
    expect(texto.origem).toEqual({ provedor: "simulador", modelo: null });
    expect(texto.resumo).toBe(
      "[DEMONSTRAÇÃO] Comercial Horizonte, competência 05/2026: 1 achado para avaliação. Texto gerado pelo simulador.",
    );
    expect(texto.explicacoes).toEqual([
      { achadoId: "a1", texto: "[DEMONSTRAÇÃO] ICMS na base escriturada. base: 1.000,00; icms: 180,00." },
    ]);
  });
});
