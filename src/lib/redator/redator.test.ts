import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MODELO_REDATOR, montarPedido, RedatorClaude, redatorConfigurado } from "./claude";
import { obterRedator } from "./index";
import { RedatorSimulado } from "./simulador";
import type { PedidoDeRedacao } from "./tipos";

const pedido: PedidoDeRedacao = {
  cliente: "Comercial Horizonte",
  competencia: "2026-05",
  demonstracao: true,
  achados: [
    { id: "a1", titulo: "ICMS na base escriturada", dados: { base: "1.000,00", icms: "180,00" } },
    { id: "a2", titulo: "Nota sem vínculo", dados: { chave: "3526...", registro: null } },
  ],
};

type Requisicao = Anthropic.Beta.MessageCreateParamsNonStreaming;

function respostaDoModelo(
  corpo: unknown,
  extra: Partial<Anthropic.Beta.BetaMessage> = {},
): Anthropic.Beta.BetaMessage {
  return {
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }],
    usage: { input_tokens: 420, output_tokens: 96 },
    ...extra,
  } as unknown as Anthropic.Beta.BetaMessage;
}

describe("redator simulado", () => {
  it("usa só os dados recebidos e identifica a demonstração", async () => {
    const texto = await new RedatorSimulado().redigir({ ...pedido, achados: [pedido.achados[0]] });
    expect(texto.origem).toEqual({ provedor: "simulador", modelo: null, tokensEntrada: null, tokensSaida: null });
    expect(texto.resumo).toBe(
      "[DEMONSTRAÇÃO] Comercial Horizonte, competência 05/2026: 1 achado para avaliação. Texto gerado pelo simulador.",
    );
    expect(texto.explicacoes).toEqual([
      { achadoId: "a1", texto: "[DEMONSTRAÇÃO] ICMS na base escriturada. base: 1.000,00; icms: 180,00." },
    ]);
  });
});

describe("redator com Claude Opus", () => {
  it("envia o pedido no formato do HUB do Paralegal", async () => {
    const enviadas: Requisicao[] = [];
    const redator = new RedatorClaude({
      enviar: async (requisicao) => {
        enviadas.push(requisicao);
        return respostaDoModelo({
          resumo: " Resumo. ",
          explicacoes: [
            { achadoId: "a2", texto: "Explicação 2." },
            { achadoId: "a1", texto: "Explicação 1." },
          ],
        });
      },
    });

    const texto = await redator.redigir(pedido);

    expect(MODELO_REDATOR).toBe("claude-opus-5-5");
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(enviadas[0].output_config?.effort).toBe("high");
    expect(enviadas[0].output_config?.format?.type).toBe("json_schema");
    expect(enviadas[0].messages).toEqual([{ role: "user", content: montarPedido(pedido) }]);
    // Sem parâmetros que o modelo rejeita.
    expect(enviadas[0]).not.toHaveProperty("temperature");
    expect(enviadas[0]).not.toHaveProperty("thinking");

    // As explicações voltam na ordem dos achados enviados, com a origem registrada.
    expect(texto).toEqual({
      resumo: "Resumo.",
      explicacoes: [
        { achadoId: "a1", texto: "Explicação 1." },
        { achadoId: "a2", texto: "Explicação 2." },
      ],
      origem: { provedor: "anthropic", modelo: "claude-opus-5-5", tokensEntrada: 420, tokensSaida: 96 },
    });
  });

  it("monta o pedido só com os fatos de cada achado", () => {
    expect(montarPedido(pedido)).toBe(
      [
        "Cliente: Comercial Horizonte",
        "Competência: 05/2026",
        "Dados fictícios (demonstração): sim",
        "",
        "Achados (2):",
        "",
        '<achado id="a1">',
        "Título: ICMS na base escriturada",
        "base: 1.000,00",
        "icms: 180,00",
        "</achado>",
        "",
        '<achado id="a2">',
        "Título: Nota sem vínculo",
        "chave: 3526...",
        "registro: não consta",
        "</achado>",
      ].join("\n"),
    );
  });

  it("recusa resposta que não cobre exatamente os achados enviados", async () => {
    const com = (corpo: unknown, extra?: Partial<Anthropic.Beta.BetaMessage>) =>
      new RedatorClaude({ enviar: async () => respostaDoModelo(corpo, extra) }).redigir(pedido);

    await expect(com({ resumo: "r", explicacoes: [{ achadoId: "a1", texto: "t" }] })).rejects.toThrow(
      /não correspondem/,
    );
    await expect(
      com({
        resumo: "r",
        explicacoes: [
          { achadoId: "a1", texto: "t" },
          { achadoId: "a2", texto: "t" },
          { achadoId: "inventado", texto: "t" },
        ],
      }),
    ).rejects.toThrow(/não correspondem/);
    await expect(com("isto não é JSON")).rejects.toThrow(/fora do formato/);
    await expect(com({ resumo: "r" })).rejects.toThrow(/fora do formato/);
  });

  it("trata recusa e resposta cortada como falha, sem texto parcial", async () => {
    const com = (stop: string) =>
      new RedatorClaude({
        enviar: async () =>
          respostaDoModelo({ resumo: "r", explicacoes: [] }, { stop_reason: stop } as Partial<Anthropic.Beta.BetaMessage>),
      }).redigir(pedido);
    await expect(com("refusal")).rejects.toThrow(/recusou/);
    await expect(com("max_tokens")).rejects.toThrow(/limite de tamanho/);
  });

  it("usa o Claude só quando a chave está configurada", () => {
    expect(redatorConfigurado({})).toBe(false);
    expect(redatorConfigurado({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(obterRedator({})).toBeInstanceOf(RedatorSimulado);
    expect(obterRedator({ ANTHROPIC_API_KEY: "chave-de-teste" })).toBeInstanceOf(RedatorClaude);
  });
});
