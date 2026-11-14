import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localToUtc } from "@/lib/time";
import { TZ, world } from "./helpers";

/**
 * Exercita runAgent de ponta a ponta contra um servidor local que imita a
 * Messages API: confere o formato da requisição e o ciclo de ferramentas.
 * Não valida o comportamento do modelo, só a integração.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requests: { url: string; headers: Record<string, any>; body: any }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let replies: any[] = [];
let server: Server;

const message = (content: unknown[], stop_reason: string) => ({
  id: `msg_${requests.length}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(replies.shift()));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterAll(() => new Promise<void>((resolve) => void server.close(() => resolve())));

describe("runAgent", () => {
  it("envia o contexto certo, executa a ferramenta pedida e devolve o texto final", async () => {
    const { runAgent } = await import("@/lib/agent/run");
    const now = localToUtc("2026-11-16T08:00", TZ);
    const w = await world();
    w.calendar.add("Reunião de diretoria", localToUtc("2026-11-16T14:00", TZ), localToUtc("2026-11-16T15:00", TZ));

    replies = [
      message(
        [{ type: "tool_use", id: "toolu_1", name: "consultar_agenda", input: { inicio: "2026-11-16T00:00", fim: "2026-11-17T00:00" } }],
        "tool_use",
      ),
      message([{ type: "text", text: "Hoje você tem *14:00* Reunião de diretoria." }], "end_turn"),
    ];

    const reply = await runAgent(w.ctxFor(w.ceo, now), [
      { role: "assistant", body: "lembrete antigo sem pergunta antes", createdAt: now },
      { role: "user", body: "o que tenho hoje?", createdAt: now },
      { role: "assistant", body: "aviso automático gravado durante o turno", createdAt: now },
    ]);
    expect(reply).toBe("Hoje você tem *14:00* Reunião de diretoria.");
    expect(requests).toHaveLength(2);

    const first = requests[0];
    expect(first.url).toContain("/v1/messages");
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium" } });
    expect(first.body.thinking).toBeUndefined();
    expect(first.body.system[0].text).toContain("assistente executivo de Marina");
    expect(first.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    // A conversa começa pelo usuário e termina com o contexto do turno.
    expect(first.body.messages).toEqual([
      { role: "user", content: "o que tenho hoje?" },
      { role: "system", content: expect.stringContaining("segunda, 16/11/2026, 08:00") },
    ]);
    const toolNames = first.body.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("cancelar_compromisso");
    expect(first.body.tools[0].input_schema.type).toBe("object");

    // O resultado da ferramenta volta ao modelo na segunda requisição.
    const toolResult = requests[1].body.messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(JSON.stringify(toolResult.content)).toContain("Reunião de diretoria");
  });

  it("dá ao cliente só as ferramentas restritas e trata recusa do modelo", async () => {
    const { runAgent } = await import("@/lib/agent/run");
    const now = localToUtc("2026-11-16T08:00", TZ);
    const w = await world();
    requests.length = 0;
    replies = [message([], "refusal")];
    const reply = await runAgent(w.ctxFor(w.client, now), [{ role: "user", body: "oi", createdAt: now }]);
    expect(reply).toContain("Não consigo ajudar");
    const body = requests[0].body;
    expect(body.system[0].text).toContain("assistente virtual de Marina");
    expect(body.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "cancelar_pedido",
      "consultar_horarios_livres",
      "deixar_recado",
      "meus_pedidos",
      "solicitar_reuniao",
    ]);
    expect(body.messages.at(-1).content).toContain("Rafael Souza");
    expect(body.messages.at(-1).content).toContain("cliente cadastrado");
  });
});
