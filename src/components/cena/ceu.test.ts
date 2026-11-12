import { describe, expect, it } from "vitest";
import { ceuDaHora } from "./ceu";

describe("céu das janelas", () => {
  it("mostra sol de dia e lua à noite, pela hora local", () => {
    expect(ceuDaHora(12).periodo).toBe("dia");
    expect(ceuDaHora(6).periodo).toBe("dia");
    expect(ceuDaHora(17.99).periodo).toBe("dia");
    expect(ceuDaHora(18).periodo).toBe("noite");
    expect(ceuDaHora(23.5).periodo).toBe("noite");
    expect(ceuDaHora(0).periodo).toBe("noite");
    expect(ceuDaHora(5.99).periodo).toBe("noite");
  });

  it("acende as luzes dos prédios e mostra estrelas só quando escurece", () => {
    expect(ceuDaHora(12)).toMatchObject({ luzesAcesas: false, estrelas: false, crepusculo: false });
    expect(ceuDaHora(22)).toMatchObject({ luzesAcesas: true, estrelas: true, crepusculo: false });
  });

  it("deixa o céu alaranjado perto do nascer e do pôr do sol", () => {
    expect(ceuDaHora(6.5)).toMatchObject({ periodo: "dia", crepusculo: true, luzesAcesas: true });
    expect(ceuDaHora(17.5)).toMatchObject({ periodo: "dia", crepusculo: true });
    expect(ceuDaHora(8).crepusculo).toBe(false);
    expect(ceuDaHora(16).crepusculo).toBe(false);
  });

  it("move o astro da esquerda para a direita, mais alto no meio do período", () => {
    expect(ceuDaHora(6).astro).toEqual({ horizontal: 0, altura: 0 });
    expect(ceuDaHora(12).astro.horizontal).toBeCloseTo(0.5, 5);
    expect(ceuDaHora(12).astro.altura).toBeCloseTo(1, 5);
    expect(ceuDaHora(15).astro.horizontal).toBeCloseTo(0.75, 5);
    // A lua faz o mesmo caminho entre 18h e 6h, atravessando a meia-noite.
    expect(ceuDaHora(18).astro.horizontal).toBe(0);
    expect(ceuDaHora(0).astro.horizontal).toBeCloseTo(0.5, 5);
    expect(ceuDaHora(3).astro.horizontal).toBeCloseTo(0.75, 5);
    for (const hora of [0, 3.3, 6, 9.9, 12, 17.9, 18, 21.2]) {
      const { horizontal, altura } = ceuDaHora(hora).astro;
      expect(horizontal).toBeGreaterThanOrEqual(0);
      expect(horizontal).toBeLessThan(1);
      expect(altura).toBeGreaterThanOrEqual(0);
      expect(altura).toBeLessThanOrEqual(1);
    }
  });

  it("aceita horas fora de 0 a 24", () => {
    expect(ceuDaHora(36).periodo).toBe("dia");
    expect(ceuDaHora(-2).periodo).toBe("noite");
  });
});
