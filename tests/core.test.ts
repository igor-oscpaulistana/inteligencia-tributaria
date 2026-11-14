import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, extractHeadlines, parseFeed, plainText } from "@/lib/news";
import { phoneKey, toWaId, typedPhoneKey } from "@/lib/phone";
import { inWindow, pickReminders } from "@/lib/reminders";
import { freeSlots } from "@/lib/slots";
import { formatHuman, localToUtc, parseDateTime, utcToLocalIso } from "@/lib/time";
import { chunkText, insideServiceWindow, parseWebhook, templateParam, verifySignature } from "@/lib/whatsapp";
import { FakeCalendar, TZ } from "./helpers";

describe("data e hora", () => {
  it("converte hora local de São Paulo para UTC e de volta", () => {
    const d = localToUtc("2026-11-16T14:00", TZ);
    expect(d.toISOString()).toBe("2026-11-16T17:00:00.000Z");
    expect(utcToLocalIso(d, TZ)).toBe("2026-11-16T14:00:00");
    expect(formatHuman(d, TZ)).toBe("segunda, 16/11 às 14:00");
  });
  it("respeita horário de verão em outros fusos", () => {
    expect(localToUtc("2026-07-01T12:00", "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(localToUtc("2026-12-01T12:00", "America/New_York").toISOString()).toBe("2026-12-01T17:00:00.000Z");
  });
  it("aceita ISO com offset e rejeita texto solto", () => {
    expect(parseDateTime("2026-11-16T14:00:00-03:00", TZ).toISOString()).toBe("2026-11-16T17:00:00.000Z");
    expect(() => parseDateTime("amanhã às 14h", TZ)).toThrow();
  });
});

describe("telefone", () => {
  it("identifica o mesmo celular brasileiro com e sem o nono dígito", () => {
    expect(phoneKey("5511987654321")).toBe(phoneKey("551187654321"));
    expect(typedPhoneKey("+55 (11) 98765-4321")).toBe(typedPhoneKey("11987654321"));
    expect(typedPhoneKey("(11) 98765-4321")).toBe(phoneKey("5511987654321"));
    // Número recebido do WhatsApp nunca ganha DDI presumido (EUA, 11 dígitos).
    expect(phoneKey("14155550100")).toBe("14155550100");
    expect(typedPhoneKey("+1 415 555 0100")).toBe("14155550100");
    expect(toWaId("(11) 98765-4321")).toBe("5511987654321");
  });
});

describe("WhatsApp", () => {
  it("valida a assinatura do webhook", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = `sha256=${createHmac("sha256", "segredo").update(body).digest("hex")}`;
    expect(verifySignature(body, sig, "segredo")).toBe(true);
    expect(verifySignature(`${body} `, sig, "segredo")).toBe(false);
    expect(verifySignature(body, sig, "outro")).toBe(false);
    expect(verifySignature(body, null, "segredo")).toBe(false);
    expect(verifySignature(body, "sha256=zz", "segredo")).toBe(false);
  });

  it("extrai mensagens de texto e ignora status de entrega", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "5521999990000", profile: { name: "Rafael" } }],
                messages: [
                  { from: "5521999990000", id: "wamid.1", timestamp: "1794000000", type: "text", text: { body: " Olá " } },
                  { from: "5521999990000", id: "wamid.2", timestamp: "1794000001", type: "audio", audio: {} },
                ],
              },
            },
            { field: "messages", value: { statuses: [{ id: "wamid.0", status: "delivered" }] } },
          ],
        },
      ],
    };
    const msgs = parseWebhook(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ from: "5521999990000", text: "Olá", profileName: "Rafael", waMessageId: "wamid.1" });
    expect(msgs[1]).toMatchObject({ type: "audio", text: null });
    expect(parseWebhook({ object: "page" })).toEqual([]);
  });

  it("divide textos longos e achata o texto para templates", () => {
    const long = Array.from({ length: 300 }, (_, i) => `Parágrafo ${i} com algum conteúdo.`).join("\n\n");
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
    expect(chunks.join("\n\n")).toBe(long);
    expect(templateParam("linha 1\n\nlinha 2\tfim     x")).toBe("linha 1 | linha 2 fim x");
  });

  it("calcula a janela de 24h", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(insideServiceWindow(new Date("2026-11-15T13:00:00Z"), now)).toBe(true);
    expect(insideServiceWindow(new Date("2026-11-15T11:59:00Z"), now)).toBe(false);
    expect(insideServiceWindow(null, now)).toBe(false);
  });
});

describe("horários livres", () => {
  const base = {
    tz: TZ,
    workStart: "09:00",
    workEnd: "18:00",
    workDays: [1, 2, 3, 4, 5],
    durationMin: 60,
  };
  it("respeita expediente, compromissos, fim de semana e antecedência", () => {
    const cal = new FakeCalendar();
    cal.add("Ocupado", localToUtc("2026-11-16T10:00", TZ), localToUtc("2026-11-16T12:00", TZ));
    cal.add("Livre", localToUtc("2026-11-16T14:00", TZ), localToUtc("2026-11-16T15:00", TZ), { showAs: "free" });
    const slots = freeSlots({
      ...base,
      events: cal.events,
      from: localToUtc("2026-11-14T00:00", TZ), // sábado
      to: localToUtc("2026-11-16T23:59", TZ), // segunda
      notBefore: localToUtc("2026-11-16T09:30", TZ),
    }).map((d) => utcToLocalIso(d, TZ).slice(0, 16));
    expect(slots[0]).toBe("2026-11-16T12:00"); // 09:30 conflitaria com o compromisso das 10h
    expect(slots).toContain("2026-11-16T14:00"); // evento marcado como "livre" não bloqueia
    expect(slots).toContain("2026-11-16T17:00");
    expect(slots).not.toContain("2026-11-16T17:30"); // passaria das 18h
    expect(slots.every((s) => s.startsWith("2026-11-16"))).toBe(true); // nada no fim de semana
  });
});

describe("lembretes", () => {
  const now = new Date("2026-11-16T15:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  it("escolhe a menor antecedência já atingida", () => {
    const cal = new FakeCalendar();
    cal.add("Em 50 min", at(50), at(110));
    cal.add("Em 12 min", at(12), at(60));
    cal.add("Em 3 horas", at(180), at(240));
    cal.add("Já começou", at(-10), at(50));
    cal.add("[A confirmar] Rafael — pedido", at(14), at(74), { showAs: "tentative" });
    cal.add("Feriado", at(10), at(1450), { isAllDay: true });
    const due = pickReminders(cal.events, now, [60, 15]);
    expect(due.map((d) => [d.event.subject, d.lead])).toEqual([
      ["Em 50 min", 60],
      ["Em 12 min", 15],
    ]);
    expect(new Set(due.map((d) => d.key)).size).toBe(2);
  });
  it("abre a janela do briefing só a partir do horário configurado", () => {
    expect(inWindow(localToUtc("2026-11-16T07:29", TZ), "07:30", TZ)).toBe(false);
    expect(inWindow(localToUtc("2026-11-16T07:31", TZ), "07:30", TZ)).toBe(true);
    expect(inWindow(localToUtc("2026-11-16T10:31", TZ), "07:30", TZ)).toBe(false);
  });
});

describe("notícias", () => {
  it("lê RSS e Atom", () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Site</title>
      <item><title>Reforma tributária &amp; novas regras</title><link>https://site.example/a</link>
        <description><![CDATA[<p>Resumo <b>com</b> HTML</p>]]></description><pubDate>Mon, 16 Nov 2026 10:00:00 -0300</pubDate></item>
      <item><title>Segundo item</title><link>/relativo</link></item></channel></rss>`;
    const items = parseFeed(rss, "https://site.example/feed");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: "https://site.example/a", title: "Reforma tributária & novas regras", summary: "Resumo com HTML" });
    expect(items[0].publishedAt?.toISOString()).toBe("2026-11-16T13:00:00.000Z");
    expect(items[1].url).toBe("https://site.example/relativo");

    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Título Atom</title>
      <link rel="alternate" href="https://blog.example/post"/><updated>2026-11-16T10:00:00Z</updated><summary>Texto</summary></entry></feed>`;
    expect(parseFeed(atom, "https://blog.example/")).toMatchObject([{ url: "https://blog.example/post", title: "Título Atom" }]);
    expect(parseFeed("<html><body>não é feed</body></html>", "https://x.example/")).toEqual([]);
  });

  it("extrai manchetes de uma página HTML", () => {
    const html = `<nav><a href="/sobre">Sobre</a><a href="/">Página inicial do portal de notícias</a></nav>
      <a class="t" href="/noticias/1"><h2>Receita publica nova instrução normativa sobre créditos</h2></a>
      <a href="/noticias/1#comentarios">Receita publica nova instrução normativa sobre créditos</a>
      <a href="https://outro.example/x">Link externo com um título razoavelmente comprido aqui</a>
      <a href="https://www.portal.example/noticias/2">Câmara aprova projeto que altera regras do imposto</a>`;
    const items = extractHeadlines(html, "https://portal.example/noticias");
    expect(items.map((i) => i.url)).toEqual(["https://portal.example/noticias/1", "https://www.portal.example/noticias/2"]);
  });

  it("recusa URLs internas ou sem https", () => {
    expect(assertPublicHttpsUrl("https://site.example/feed#x")).toBe("https://site.example/feed");
    for (const bad of ["http://site.example", "https://localhost/x", "https://10.0.0.1/", "https://intranet/", "ftp://a.b", "nada"]) {
      expect(() => assertPublicHttpsUrl(bad)).toThrow();
    }
    expect(plainText("<p>a&nbsp;b &#233;</p>")).toBe("a b é");
  });
});
