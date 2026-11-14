import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ceoTools } from "@/lib/agent/tools-ceo";
import { clientTools } from "@/lib/agent/tools-client";
import { handleInbound, type AgentRunner } from "@/lib/inbound";
import { runTick, type TickOptions } from "@/lib/reminders";
import { localToUtc } from "@/lib/time";
import type { InboundMessage } from "@/lib/whatsapp";
import { callTool, TZ, world } from "./helpers";

// Segunda-feira, 16/11/2026, 08:00 em São Paulo.
const NOW = localToUtc("2026-11-16T08:00", TZ);
const at = (local: string) => localToUtc(local, TZ);

describe("pedido de reunião do cliente", () => {
  it("oferece horários sem expor a agenda e respeita a antecedência mínima", async () => {
    const w = await world();
    w.calendar.add("Conselho — pauta confidencial", at("2026-11-16T14:00"), at("2026-11-16T16:00"));
    const tools = clientTools(w.ctxFor(w.client, NOW));
    const out = await callTool(tools, "consultar_horarios_livres", {
      inicio: "2026-11-16T00:00",
      fim: "2026-11-16T23:59",
      duracao_min: 60,
    });
    const starts = out.horarios.map((h: { inicio: string }) => h.inicio);
    expect(starts[0]).toBe("2026-11-16T12:00"); // 08:00 + 4h de antecedência
    expect(starts).not.toContain("2026-11-16T14:00");
    expect(starts).not.toContain("2026-11-16T15:00");
    expect(starts).toContain("2026-11-16T16:00");
    expect(JSON.stringify(out)).not.toContain("Conselho");
  });

  it("reserva o horário como 'a confirmar', avisa o CEO e limita pedidos pendentes", async () => {
    const w = await world();
    const tools = clientTools(w.ctxFor(w.client, NOW));
    const ask = (inicio: string) =>
      callTool(tools, "solicitar_reuniao", { inicio, duracao_min: 60, assunto: "Revisão do contrato", modalidade: "online" });

    const first = await ask("2026-11-17T10:00");
    expect(first).toMatchObject({ numero_do_pedido: 1, situacao: "aguardando confirmação" });
    expect(w.calendar.events).toHaveLength(1);
    expect(w.calendar.events[0]).toMatchObject({ showAs: "tentative" });
    expect(w.calendar.events[0].subject).toContain("[A confirmar] Rafael Souza");
    expect(w.messenger.to(w.ceo)[0]).toContain("Pedido de reunião nº 1");
    expect(w.messenger.to(w.ceo)[0]).toContain("aprovar 1");

    // O mesmo horário agora está reservado.
    expect((await ask("2026-11-17T10:00")).erro).toContain("não está disponível");
    // Dentro da antecedência mínima e fora do expediente também não.
    expect((await ask("2026-11-16T09:00")).erro).toContain("não está disponível");
    expect((await ask("2026-11-17T19:00")).erro).toContain("não está disponível");

    expect((await ask("2026-11-17T14:00")).numero_do_pedido).toBe(2);
    expect((await ask("2026-11-18T10:00")).erro).toContain("aguardando confirmação");
    expect(w.calendar.events).toHaveLength(2);
  });

  it("o CEO aprova: o evento é confirmado e o cliente é avisado", async () => {
    const w = await world();
    await callTool(clientTools(w.ctxFor(w.client, NOW)), "solicitar_reuniao", {
      inicio: "2026-11-17T10:00",
      duracao_min: 30,
      assunto: "Planejamento 2027",
      modalidade: "presencial",
    });
    const ceo = ceoTools(w.ctxFor(w.ceo, NOW));
    const pending = await callTool(ceo, "listar_pedidos_de_reuniao", {});
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ numero: 1, duracao_min: 30, quando: "terça, 17/11 às 10:00" });

    const out = await callTool(ceo, "decidir_pedido_de_reuniao", { numero: 1, decisao: "aprovar", recado_ao_cliente: "Será na sede." });
    expect(out).toMatchObject({ situacao: "aprovada", cliente_avisado: true });
    expect(w.calendar.events[0]).toMatchObject({ subject: "Reunião com Rafael Souza — Planejamento 2027", showAs: "busy" });
    expect(w.calendar.events[0].attendees).toEqual([{ name: "Rafael Souza", email: "rafael@cliente.example" }]);
    const toClient = w.messenger.to(w.client).at(-1)!;
    expect(toClient).toContain("confirmada para terça, 17/11 às 10:00");
    expect(toClient).toContain("Será na sede.");

    // Decidir duas vezes não é permitido.
    expect((await callTool(ceo, "decidir_pedido_de_reuniao", { numero: 1, decisao: "recusar" })).erro).toContain("aprovada");
  });

  it("o CEO recusa: a reserva sai da agenda e o cliente é avisado", async () => {
    const w = await world();
    await callTool(clientTools(w.ctxFor(w.client, NOW)), "solicitar_reuniao", {
      inicio: "2026-11-17T10:00",
      duracao_min: 60,
      assunto: "Proposta",
      modalidade: "online",
    });
    const out = await callTool(ceoTools(w.ctxFor(w.ceo, NOW)), "decidir_pedido_de_reuniao", { numero: 1, decisao: "recusar" });
    expect(out.situacao).toBe("recusada");
    expect(w.calendar.events).toHaveLength(0);
    expect(w.messenger.to(w.client).at(-1)).toContain("não poderá atender");
  });

  it("o cliente só cancela os próprios pedidos", async () => {
    const w = await world();
    const other = await w.store.upsertContact({ phoneKey: "5531888880000", waId: "5531888880000", name: "Outra Pessoa", role: "cliente" });
    await callTool(clientTools(w.ctxFor(w.client, NOW)), "solicitar_reuniao", {
      inicio: "2026-11-17T10:00",
      duracao_min: 60,
      assunto: "Assunto qualquer",
      modalidade: "online",
    });
    const intruder = clientTools(w.ctxFor(other, NOW));
    expect((await callTool(intruder, "cancelar_pedido", { numero: 1 })).erro).toContain("não encontrado");
    expect(await callTool(intruder, "meus_pedidos", {})).toEqual([]);
    expect(w.calendar.events).toHaveLength(1);

    const out = await callTool(clientTools(w.ctxFor(w.client, NOW)), "cancelar_pedido", { numero: 1 });
    expect(out.situacao).toBe("cancelada");
    expect(w.calendar.events).toHaveLength(0);
    expect(w.messenger.to(w.ceo).at(-1)).toContain("cancelou a reunião");
  });

  it("clientes não recebem ferramentas de agenda nem de envio de mensagens", async () => {
    const w = await world();
    const names = clientTools(w.ctxFor(w.client, NOW)).map((t) => t.name).sort();
    expect(names).toEqual(["cancelar_pedido", "consultar_horarios_livres", "deixar_recado", "meus_pedidos", "solicitar_reuniao"]);
  });
});

describe("ferramentas do CEO", () => {
  it("consulta, cria com aviso de conflito, altera e cancela por referência", async () => {
    const w = await world();
    w.calendar.add("Almoço com investidores", at("2026-11-16T12:00"), at("2026-11-16T13:30"), { location: "Restaurante" });
    const tools = ceoTools(w.ctxFor(w.ceo, NOW));

    const day = await callTool(tools, "consultar_agenda", { inicio: "2026-11-16T00:00", fim: "2026-11-17T00:00" });
    expect(day.total).toBe(1);
    expect(day.compromissos[0]).toMatchObject({ assunto: "Almoço com investidores", inicio: "2026-11-16T12:00", local: "Restaurante" });
    const ref = day.compromissos[0].ref;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);

    const created = await callTool(tools, "criar_compromisso", {
      assunto: "Call com o banco",
      inicio: "2026-11-16T13:00",
      fim: "2026-11-16T13:30",
      participantes: [{ nome: "Gerente", email: "gerente@banco.example" }],
    });
    expect(created.criado.assunto).toBe("Call com o banco");
    expect(created.conflitos).toHaveLength(1);
    expect((await callTool(tools, "criar_compromisso", { assunto: "X", inicio: "2026-11-16T15:00", fim: "2026-11-16T14:00" })).erro).toBeTruthy();

    // Em outro turno (índice de referências vazio) a ref continua valendo.
    const later = ceoTools(w.ctxFor(w.ceo, NOW));
    const moved = await callTool(later, "alterar_compromisso", { ref, inicio: "2026-11-16T12:30", fim: "2026-11-16T14:00" });
    expect(moved.alterado.inicio).toBe("2026-11-16T12:30");
    expect((await callTool(later, "alterar_compromisso", { ref, inicio: "2026-11-16T12:30" })).erro).toContain("início e fim");
    expect((await callTool(later, "cancelar_compromisso", { ref: "deadbeef" })).erro).toContain("não encontrado");
    expect(await callTool(later, "cancelar_compromisso", { ref })).toEqual({ cancelado: true });
    expect(w.calendar.events.map((e) => e.subject)).toEqual(["Call com o banco"]);
  });

  it("cadastra contatos e envia mensagens só a contatos identificados sem ambiguidade", async () => {
    const w = await world();
    const tools = ceoTools(w.ctxFor(w.ceo, NOW));
    const saved = await callTool(tools, "salvar_contato", { nome: "Rafael Lima", telefone: "(31) 97777-0000", papel: "cliente" });
    expect(saved.salvo).toMatchObject({ nome: "Rafael Lima", telefone: "+5531977770000", papel: "cliente" });
    expect((await callTool(tools, "salvar_contato", { nome: "Eu", telefone: "11 98765-4321", papel: "cliente" })).erro).toContain("CEO");

    expect((await callTool(tools, "enviar_mensagem", { contato: "Rafael", texto: "Olá" })).erro).toContain("Mais de um contato");
    expect((await callTool(tools, "enviar_mensagem", { contato: "Fulano", texto: "Olá" })).erro).toContain("Nenhum contato");
    const sent = await callTool(tools, "enviar_mensagem", { contato: "Rafael Souza", texto: "Podemos antecipar para as 9h?" });
    expect(sent).toMatchObject({ enviado: true });
    expect(w.messenger.to(w.client)).toEqual(["Podemos antecipar para as 9h?"]);

    w.messenger.fail = true;
    expect(await callTool(tools, "enviar_mensagem", { contato: "31977770000", texto: "Olá" })).toMatchObject({ enviado: false });
  });

  it("gerencia fontes de notícias recusando endereços internos", async () => {
    const w = await world();
    const tools = ceoTools(w.ctxFor(w.ceo, NOW));
    expect((await callTool(tools, "fontes_de_noticias", { acao: "adicionar", nome: "Interno", url: "https://localhost/feed" })).erro).toBeTruthy();
    await callTool(tools, "fontes_de_noticias", { acao: "adicionar", nome: "Portal Fiscal", url: "https://portal.example/rss" });
    expect(await callTool(tools, "fontes_de_noticias", { acao: "listar" })).toEqual([{ nome: "Portal Fiscal", url: "https://portal.example/rss", ativa: true }]);
    expect(await callTool(tools, "fontes_de_noticias", { acao: "remover", nome: "portal" })).toEqual({ removida: "Portal Fiscal" });
  });
});

describe("mensagens recebidas", () => {
  const msg = (from: string, id: string, text: string | null, type = "text"): InboundMessage => ({
    from,
    waMessageId: id,
    profileName: "Perfil WA",
    text,
    type,
    timestamp: NOW,
  });
  const echo: AgentRunner = async (ctx, history) => `[${ctx.contact.role}] ${history.at(-1)!.body}`;
  const opts = { allowUnknown: true, runAgent: echo, now: NOW };

  it("atende o CEO mesmo quando o WhatsApp omite o nono dígito, e ignora reentregas", async () => {
    const w = await world();
    expect(await handleInbound(msg("551187654321", "wamid.A", "agenda de hoje"), w.deps, opts)).toBe("respondido");
    expect(w.messenger.to(w.ceo)).toEqual(["[ceo] agenda de hoje"]);
    expect(await handleInbound(msg("551187654321", "wamid.A", "agenda de hoje"), w.deps, opts)).toBe("duplicada");
    expect(w.messenger.sent).toHaveLength(1);
  });

  it("atende número desconhecido com acesso restrito e avisa o CEO uma única vez", async () => {
    const w = await world();
    expect(await handleInbound(msg("5541900001111", "wamid.B", "oi"), w.deps, opts)).toBe("respondido");
    const stranger = (await w.store.getContactByPhoneKey("554100001111"))!;
    expect(stranger).toMatchObject({ role: "desconhecido", name: "Perfil WA" });
    expect(w.messenger.to(stranger)).toEqual(["[desconhecido] oi"]);
    expect(w.messenger.to(w.ceo)).toHaveLength(1);
    expect(w.messenger.to(w.ceo)[0]).toContain("Novo contato");
    await handleInbound(msg("5541900001111", "wamid.C", "tudo bem?"), w.deps, opts);
    expect(w.messenger.to(w.ceo)).toHaveLength(1);

    const closed = await world();
    expect(await handleInbound(msg("5541900001111", "wamid.D", "oi"), closed.deps, { ...opts, allowUnknown: false })).toBe("desconhecido_ignorado");
    expect(closed.messenger.sent).toHaveLength(0);
  });

  it("ignora bloqueados, responde a áudio com aviso e se desculpa quando o agente falha", async () => {
    const w = await world();
    await w.store.upsertContact({ phoneKey: w.client.phoneKey, waId: w.client.waId, role: "bloqueado" });
    expect(await handleInbound(msg(w.client.waId, "wamid.E", "oi"), w.deps, opts)).toBe("bloqueado");
    expect(w.messenger.sent).toHaveLength(0);

    await w.store.upsertContact({ phoneKey: w.client.phoneKey, waId: w.client.waId, role: "cliente" });
    expect(await handleInbound(msg(w.client.waId, "wamid.F", null, "audio"), w.deps, opts)).toBe("tipo_nao_suportado");
    expect(w.messenger.to(w.client).at(-1)).toContain("só consigo ler mensagens de texto");

    const broken: AgentRunner = async () => {
      throw new Error("API fora do ar");
    };
    expect(await handleInbound(msg(w.client.waId, "wamid.G", "oi"), w.deps, { ...opts, runAgent: broken })).toBe("erro");
    expect(w.messenger.to(w.client).at(-1)).toContain("problema técnico");
  });

  it("limita o volume de mensagens de quem não é o CEO", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) await handleInbound(msg(w.client.waId, `wamid.L${i}`, "oi"), w.deps, { ...opts, maxPerHour: 3 });
    expect(await handleInbound(msg(w.client.waId, "wamid.L3", "oi"), w.deps, { ...opts, maxPerHour: 3 })).toBe("limite_excedido");
    expect(w.messenger.to(w.client)).toHaveLength(3);
  });
});

describe("agendador", () => {
  const fakeAnthropic = (text: string) =>
    ({
      beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }) } },
    }) as unknown as Anthropic;
  const options = (over: Partial<TickOptions> = {}): TickOptions => ({
    leads: [60, 15],
    briefingTime: "07:30",
    newsDigestTime: "18:00",
    newsFocus: "tributação",
    anthropic: () => fakeAnthropic("📰 *Notícias*\n\n• Resumo gerado"),
    ...over,
  });

  it("envia cada lembrete uma única vez e tenta de novo se o envio falhar", async () => {
    const w = await world();
    const now = at("2026-11-16T13:10");
    w.calendar.add("Reunião de diretoria", at("2026-11-16T14:00"), at("2026-11-16T15:00"), { location: "Sala 2" });

    w.messenger.fail = true;
    const failed = await runTick(w.deps, now, options());
    expect(failed.lembretes).toBe(0);
    expect(failed.erros).toHaveLength(1);

    w.messenger.fail = false;
    expect((await runTick(w.deps, now, options())).lembretes).toBe(1);
    expect((await runTick(w.deps, at("2026-11-16T13:15"), options())).lembretes).toBe(0);
    expect(w.messenger.to(w.ceo)).toHaveLength(1);
    expect(w.messenger.to(w.ceo)[0]).toContain("Em 50 min:* Reunião de diretoria");
    expect(w.messenger.to(w.ceo)[0]).toContain("Local: Sala 2");

    // Segundo lembrete, na antecedência de 15 min.
    expect((await runTick(w.deps, at("2026-11-16T13:46"), options())).lembretes).toBe(1);
    expect(w.messenger.to(w.ceo).at(-1)).toContain("Em 14 min:");
  });

  it("envia a agenda do dia com notícias uma vez, e o resumo da tarde só se houver novidades", async () => {
    const w = await world();
    w.calendar.add("Reunião de diretoria", at("2026-11-16T14:00"), at("2026-11-16T15:00"));
    w.calendar.add("Amanhã", at("2026-11-17T10:00"), at("2026-11-17T11:00"));
    const src = await w.store.addNewsSource("Portal", "https://portal.example/rss");
    await w.store.insertNewsItems(src.id, [{ url: "https://portal.example/1", title: "Manchete" }], false);

    expect((await runTick(w.deps, at("2026-11-16T07:20"), options())).briefing).toBe(false);
    const morning = await runTick(w.deps, at("2026-11-16T07:35"), options());
    expect(morning).toMatchObject({ briefing: true, erros: [] });
    const text = w.messenger.to(w.ceo)[0];
    expect(text).toContain("Agenda de hoje (16/11)");
    expect(text).toContain("*14:00–15:00* Reunião de diretoria");
    expect(text).not.toContain("Amanhã");
    expect(text).toContain("Resumo gerado");
    expect((await runTick(w.deps, at("2026-11-16T07:40"), options())).briefing).toBe(false);

    // À tarde não há itens novos: nada é enviado.
    expect((await runTick(w.deps, at("2026-11-16T18:05"), options())).noticias).toBe(false);
    expect(w.messenger.to(w.ceo)).toHaveLength(1);

    // No dia seguinte, com item novo que o modelo julga irrelevante: também não.
    await w.store.insertNewsItems(src.id, [{ url: "https://portal.example/2", title: "Outra" }], false);
    const quiet = await runTick(w.deps, at("2026-11-17T18:05"), options({ anthropic: () => fakeAnthropic("NADA") }));
    expect(quiet.noticias).toBe(false);
    expect(await w.store.undigestedNews(10)).toHaveLength(0);
  });
});
