import { describe, expect, it } from "vitest";
import {
  acessoDaMesa,
  assento,
  entradaNaMesa,
  PONTOS_DE_INTERESSE,
  posicaoNoTrecho,
  QUANTIDADE_DE_ESTACOES,
  rota,
  saidaDaMesa,
  sobreAsLinhas,
  type Trecho,
} from "./movimento";

const total = (trechos: Trecho[]) => trechos.reduce((soma, t) => soma + t.distancia, 0);

/** Cada trecho começa onde o anterior termina e anda em linha reta, paralelo a um eixo. */
function conferirContinuidade(trechos: Trecho[]) {
  for (let i = 0; i < trechos.length; i++) {
    const t = trechos[i];
    expect(t.de[0] === t.para[0] || t.de[1] === t.para[1]).toBe(true);
    if (i > 0) expect(t.de).toEqual(trechos[i - 1].para);
  }
}

describe("circulação pela sala", () => {
  it("todo ponto de interesse e todo acesso de mesa está sobre uma linha de circulação", () => {
    for (const p of PONTOS_DE_INTERESSE) expect(sobreAsLinhas(p.ponto), p.id).toBe(true);
    for (let i = 0; i < QUANTIDADE_DE_ESTACOES; i++) {
      expect(sobreAsLinhas(acessoDaMesa(i))).toBe(true);
      expect(sobreAsLinhas(assento(i))).toBe(false);
    }
  });

  it("liga qualquer mesa a qualquer ponto de interesse, em trechos contínuos", () => {
    for (let i = 0; i < QUANTIDADE_DE_ESTACOES; i++) {
      for (const destino of PONTOS_DE_INTERESSE) {
        const caminho = rota(acessoDaMesa(i), destino.ponto);
        if (caminho.length === 0) continue;
        conferirContinuidade(caminho);
        expect(caminho[0].de).toEqual(acessoDaMesa(i));
        expect(caminho.at(-1)!.para).toEqual(destino.ponto);
      }
    }
  });

  it("escolhe o caminho mais curto e a camada de cada linha", () => {
    // Da mesa 1 até a janela mais próxima: sobe a coluna da mesa e segue pelo corredor do fundo.
    const janela = PONTOS_DE_INTERESSE.find((p) => p.id === "janela-1")!;
    const caminho = rota(acessoDaMesa(0), janela.ponto);
    expect(caminho.map((t) => [t.camada, t.direcao])).toEqual([
      ["corredor:0", "-y"],
      ["fundo", "-x"],
    ]);
    expect(total(caminho)).toBeCloseTo(2.13 - 0.9 + (3.32 - 2.2), 5);

    // Até o corredor da frente o caminho desce a coluna, sem passar pelo fundo.
    const frente = PONTOS_DE_INTERESSE.find((p) => p.id === "frente-1")!;
    expect(rota(acessoDaMesa(0), frente.ponto).map((t) => t.camada)).toEqual(["corredor:0", "frente"]);
  });

  it("junta passos seguidos da mesma linha em um único trecho", () => {
    const bebedouro = PONTOS_DE_INTERESSE.find((p) => p.id === "bebedouro")!;
    const quadro = PONTOS_DE_INTERESSE.find((p) => p.id === "quadro")!;
    const caminho = rota(quadro.ponto, bebedouro.ponto);
    expect(caminho.map((t) => t.camada)).toEqual(["corredor:-1", "fundo"]);
    expect(caminho[1].distancia).toBeCloseTo(11.2 - 0.62, 5);
  });

  it("sai da mesa e volta a ela pelo mesmo caminho, em camadas próprias", () => {
    const saida = saidaDaMesa(2);
    const entrada = entradaNaMesa(2);
    conferirContinuidade(saida);
    conferirContinuidade(entrada);
    expect(saida.map((t) => t.camada)).toEqual(["interno", "corredor:2"]);
    expect(entrada.map((t) => t.camada)).toEqual(["corredor:2", "interno"]);
    expect(saida[0].de).toEqual(assento(2));
    expect(saida.at(-1)!.para).toEqual(acessoDaMesa(2));
    expect(entrada.at(-1)!.para).toEqual(assento(2));
  });

  it("calcula a posição no meio de um trecho e recusa pontos fora das linhas", () => {
    const [t] = rota([2.2, 0.9], [5.0, 0.9]);
    expect(posicaoNoTrecho(t, 0.5)).toEqual([3.6, 0.9]);
    expect(posicaoNoTrecho(t, 2)).toEqual([5.0, 0.9]);
    expect(sobreAsLinhas(posicaoNoTrecho(t, 0.37))).toBe(true);
    expect(rota([2.2, 0.9], [2.2, 0.9])).toEqual([]);
    expect(() => rota([2.2, 0.9], [5.0, 2.0])).toThrow(/fora das linhas/);
  });
});
