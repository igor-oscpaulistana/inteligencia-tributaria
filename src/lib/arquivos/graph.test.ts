import { describe, expect, it } from "vitest";
import { FonteGraph, type ConfigGraph } from "./graph";

const config: ConfigGraph = {
  tenantId: "tenant-teste",
  clientId: "cliente-teste",
  clientSecret: "segredo-teste",
  driveId: "drive-teste",
  pastaRaizItemId: "RAIZ",
};

type Resposta = { status?: number; corpo?: unknown; headers?: Record<string, string>; bytes?: Uint8Array };

/** fetch simulado: responde conforme a fila de cada URL e registra as chamadas. */
function simularFetch(rotas: Record<string, Resposta[]>) {
  const chamadas: { url: string; metodo: string; autorizacao: string | null }[] = [];
  const fetchSimulado = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    chamadas.push({
      url,
      metodo: init?.method ?? "GET",
      autorizacao: new Headers(init?.headers).get("authorization"),
    });
    const fila = rotas[url];
    if (!fila || fila.length === 0) throw new Error(`Chamada inesperada: ${url}`);
    const r = fila.length > 1 ? fila.shift()! : fila[0];
    return new Response(r.bytes ? (r.bytes as BodyInit) : JSON.stringify(r.corpo ?? {}), {
      status: r.status ?? 200,
      headers: r.headers,
    });
  }) as typeof fetch;
  return { fetchSimulado, chamadas };
}

const TOKEN = "https://login.microsoftonline.com/tenant-teste/oauth2/v2.0/token";
const filhos = (id: string) =>
  `https://graph.microsoft.com/v1.0/drives/drive-teste/items/${id}/children?$select=id,name,size,folder,lastModifiedDateTime&$top=200`;
const token = (valor: string) => ({ corpo: { access_token: valor, expires_in: 3600 } });

describe("FonteGraph", () => {
  it("autentica com credenciais de aplicativo e pagina a listagem", async () => {
    const pagina2 = "https://graph.microsoft.com/v1.0/drives/drive-teste/items/RAIZ/children?$skiptoken=abc";
    const { fetchSimulado, chamadas } = simularFetch({
      [TOKEN]: [token("t1")],
      [filhos("RAIZ")]: [
        {
          corpo: {
            value: [{ id: "A", name: "Cliente A", folder: { childCount: 2 }, size: 999 }],
            "@odata.nextLink": pagina2,
          },
        },
      ],
      [pagina2]: [
        { corpo: { value: [{ id: "B", name: "nota.xml", size: 120, lastModifiedDateTime: "2026-06-01T10:00:00Z" }] } },
      ],
    });
    const fonte = new FonteGraph(config, { fetch: fetchSimulado });

    expect(await fonte.listarRaiz()).toEqual([
      { id: "A", nome: "Cliente A", pasta: true, tamanho: 0, modificadoEm: null },
      { id: "B", nome: "nota.xml", pasta: false, tamanho: 120, modificadoEm: "2026-06-01T10:00:00Z" },
    ]);
    expect(chamadas.map((c) => c.metodo)).toEqual(["POST", "GET", "GET"]);
    expect(chamadas[1].autorizacao).toBe("Bearer t1");
    // O token é reaproveitado: uma única chamada ao Entra ID.
    await fonte.listarRaiz();
    expect(chamadas.filter((c) => c.url === TOKEN)).toHaveLength(1);
  });

  it("só baixa e lista itens obtidos por listagem a partir da raiz", async () => {
    const conteudo = "https://graph.microsoft.com/v1.0/drives/drive-teste/items/B/content";
    const { fetchSimulado } = simularFetch({
      [TOKEN]: [token("t1")],
      [filhos("RAIZ")]: [{ corpo: { value: [{ id: "B", name: "nota.xml", size: 3 }] } }],
      [conteudo]: [{ bytes: new Uint8Array([1, 2, 3]) }],
    });
    const fonte = new FonteGraph(config, { fetch: fetchSimulado });

    await expect(fonte.baixar("B")).rejects.toMatchObject({ codigo: "fora_da_arvore" });
    await expect(fonte.listarFilhos("OUTRA-PASTA")).rejects.toMatchObject({ codigo: "fora_da_arvore" });
    await fonte.listarRaiz();
    expect(await fonte.baixar("B")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("respeita o Retry-After quando o Graph limita as requisições", async () => {
    const esperas: number[] = [];
    const { fetchSimulado, chamadas } = simularFetch({
      [TOKEN]: [token("t1")],
      [filhos("RAIZ")]: [
        { status: 429, headers: { "retry-after": "3" } },
        { status: 503 },
        { corpo: { value: [] } },
      ],
    });
    const fonte = new FonteGraph(config, {
      fetch: fetchSimulado,
      aguardar: async (ms) => void esperas.push(ms),
    });

    expect(await fonte.listarRaiz()).toEqual([]);
    expect(esperas).toEqual([3000, 1000]);
    expect(chamadas.filter((c) => c.metodo === "GET")).toHaveLength(3);
  });

  it("renova o token uma vez quando o Graph responde 401", async () => {
    const { fetchSimulado, chamadas } = simularFetch({
      [TOKEN]: [token("vencido"), token("novo")],
      [filhos("RAIZ")]: [{ status: 401 }, { corpo: { value: [] } }],
    });
    const fonte = new FonteGraph(config, { fetch: fetchSimulado });

    await fonte.listarRaiz();
    expect(chamadas.filter((c) => c.metodo === "GET").map((c) => c.autorizacao)).toEqual([
      "Bearer vencido",
      "Bearer novo",
    ]);
  });

  it("traduz falta de permissão, pasta inexistente e credenciais recusadas", async () => {
    const semPermissao = simularFetch({ [TOKEN]: [token("t1")], [filhos("RAIZ")]: [{ status: 403 }] });
    await expect(
      new FonteGraph(config, { fetch: semPermissao.fetchSimulado }).listarRaiz(),
    ).rejects.toMatchObject({ codigo: "sem_permissao", status: 403 });

    const inexistente = simularFetch({ [TOKEN]: [token("t1")], [filhos("RAIZ")]: [{ status: 404 }] });
    await expect(
      new FonteGraph(config, { fetch: inexistente.fetchSimulado }).listarRaiz(),
    ).rejects.toMatchObject({ codigo: "nao_encontrado" });

    const recusado = simularFetch({ [TOKEN]: [{ status: 401 }] });
    await expect(
      new FonteGraph(config, { fetch: recusado.fetchSimulado }).listarRaiz(),
    ).rejects.toMatchObject({ codigo: "credenciais" });
  });

  it("explica a recusa do Entra ID pelo código, sem expor a credencial", async () => {
    const recusa = async (codigos: number[] | undefined) => {
      const { fetchSimulado } = simularFetch({
        [TOKEN]: [{ status: 401, corpo: { error: "invalid_client", error_codes: codigos } }],
      });
      return new FonteGraph(config, { fetch: fetchSimulado }).listarRaiz().catch((erro: Error) => erro.message);
    };
    expect(await recusa([7000215])).toMatch(/campo Valor do segredo, e não o ID do segredo/);
    expect(await recusa([7000222])).toMatch(/expirou/);
    expect(await recusa([700016])).toMatch(/não encontrou o aplicativo/);
    expect(await recusa([90002])).toMatch(/não encontrou o locatário/);
    expect(await recusa([50000])).toMatch(/AADSTS50000/);
    expect(await recusa(undefined)).toMatch(/Confira tenant, client ID e segredo/);
    for (const mensagem of [await recusa([7000215]), await recusa([50000])]) {
      expect(mensagem).not.toContain("segredo-teste");
    }
  });

  it("não envia o token para endereço fora do Graph", async () => {
    const { fetchSimulado, chamadas } = simularFetch({
      [TOKEN]: [token("t1")],
      [filhos("RAIZ")]: [{ corpo: { value: [], "@odata.nextLink": "https://exemplo.invalid/proxima" } }],
    });
    await expect(new FonteGraph(config, { fetch: fetchSimulado }).listarRaiz()).rejects.toMatchObject({
      codigo: "fora_da_arvore",
    });
    expect(chamadas.some((c) => c.url.includes("exemplo.invalid"))).toBe(false);
  });
});
