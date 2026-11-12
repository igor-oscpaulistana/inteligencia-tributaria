/**
 * Leitura do OneDrive corporativo pelo Microsoft Graph, com credenciais de
 * aplicativo do Entra ID (fluxo client credentials).
 *
 * O aplicativo deve ter apenas a permissão Files.SelectedOperations.Selected,
 * com papel de leitura concedido na pasta "Inteligência Tributária". Tudo aqui
 * é somente leitura: só emitimos GET.
 */

import { ErroFonteArquivos, type FonteArquivos, type ItemArquivo } from "./tipos";

export interface ConfigGraph {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Drive (OneDrive ou biblioteca do SharePoint) que contém a pasta raiz. */
  driveId: string;
  /** Item da pasta "Inteligência Tributária". */
  pastaRaizItemId: string;
}

interface OpcoesGraph {
  fetch?: typeof fetch;
  /** Espera entre tentativas; substituível nos testes. */
  aguardar?: (ms: number) => Promise<void>;
  maxTentativas?: number;
}

interface ItemGraph {
  id: string;
  name: string;
  size?: number;
  folder?: unknown;
  lastModifiedDateTime?: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const HOST_GRAPH = "graph.microsoft.com";
const MARGEM_EXPIRACAO_MS = 60_000;

export class FonteGraph implements FonteArquivos {
  readonly tipo = "onedrive" as const;

  private token: { valor: string; expiraEm: number } | null = null;
  private readonly conhecidos = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly aguardar: (ms: number) => Promise<void>;
  private readonly maxTentativas: number;

  constructor(
    private readonly config: ConfigGraph,
    opcoes: OpcoesGraph = {},
  ) {
    this.fetchImpl = opcoes.fetch ?? fetch;
    this.aguardar = opcoes.aguardar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxTentativas = opcoes.maxTentativas ?? 5;
  }

  async listarRaiz(): Promise<ItemArquivo[]> {
    return this.listar(this.config.pastaRaizItemId);
  }

  async listarFilhos(itemId: string): Promise<ItemArquivo[]> {
    this.exigirConhecido(itemId);
    return this.listar(itemId);
  }

  async baixar(itemId: string): Promise<Uint8Array> {
    this.exigirConhecido(itemId);
    const resposta = await this.requisitar(
      `${GRAPH}/drives/${encodeURIComponent(this.config.driveId)}/items/${encodeURIComponent(itemId)}/content`,
    );
    return new Uint8Array(await resposta.arrayBuffer());
  }

  private exigirConhecido(itemId: string): void {
    if (!this.conhecidos.has(itemId)) {
      throw new ErroFonteArquivos(
        "Item fora da árvore da pasta Inteligência Tributária.",
        "fora_da_arvore",
      );
    }
  }

  private async listar(itemId: string): Promise<ItemArquivo[]> {
    const itens: ItemArquivo[] = [];
    let url: string | null =
      `${GRAPH}/drives/${encodeURIComponent(this.config.driveId)}/items/${encodeURIComponent(itemId)}` +
      `/children?$select=id,name,size,folder,lastModifiedDateTime&$top=200`;

    while (url) {
      const resposta = await this.requisitar(url);
      const pagina = (await resposta.json()) as { value?: ItemGraph[]; "@odata.nextLink"?: string };
      for (const item of pagina.value ?? []) {
        this.conhecidos.add(item.id);
        itens.push({
          id: item.id,
          nome: item.name,
          pasta: item.folder !== undefined,
          tamanho: item.folder !== undefined ? 0 : (item.size ?? 0),
          modificadoEm: item.lastModifiedDateTime ?? null,
        });
      }
      url = pagina["@odata.nextLink"] ?? null;
    }
    return itens;
  }

  private async obterToken(forcar = false): Promise<string> {
    if (!forcar && this.token && this.token.expiraEm - MARGEM_EXPIRACAO_MS > Date.now()) {
      return this.token.valor;
    }
    const resposta = await this.fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    if (!resposta.ok) {
      const recusa = (await resposta.json().catch(() => null)) as { error_codes?: number[] } | null;
      const codigo = recusa?.error_codes?.[0];
      console.error(`[onedrive] Entra ID recusou o token (HTTP ${resposta.status}, AADSTS${codigo ?? "?"})`);
      throw new ErroFonteArquivos(mensagemDeRecusa(codigo), "credenciais", resposta.status);
    }
    const corpo = (await resposta.json()) as { access_token: string; expires_in: number };
    this.token = { valor: corpo.access_token, expiraEm: Date.now() + corpo.expires_in * 1000 };
    return this.token.valor;
  }

  private async requisitar(url: string): Promise<Response> {
    // O token só é enviado ao Graph. O nextLink vem do próprio Graph, mas conferimos
    // o host; o redirecionamento do /content é seguido pelo fetch sem o cabeçalho.
    if (new URL(url).host !== HOST_GRAPH) {
      throw new ErroFonteArquivos("Endereço fora do Microsoft Graph.", "fora_da_arvore");
    }

    let renovouToken = false;
    for (let tentativa = 1; ; tentativa++) {
      const token = await this.obterToken();
      const resposta = await this.fetchImpl(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (resposta.ok) return resposta;

      if (resposta.status === 401 && !renovouToken) {
        renovouToken = true;
        await this.obterToken(true);
        continue;
      }
      const transitorio = resposta.status === 429 || resposta.status >= 500;
      if (transitorio && tentativa < this.maxTentativas) {
        const retryAfter = Number(resposta.headers.get("retry-after"));
        const espera =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(500 * 2 ** (tentativa - 1), 8000);
        await this.aguardar(espera);
        continue;
      }
      throw erroDoGraph(resposta.status);
    }
  }
}

/** Explica a recusa do Entra ID pelo código AADSTS, sem expor nenhum dado da credencial. */
function mensagemDeRecusa(codigo: number | undefined): string {
  switch (codigo) {
    case 7000215:
      return "O Entra ID recusou o segredo do aplicativo. Confira se MS_CLIENT_SECRET tem o campo Valor do segredo, e não o ID do segredo.";
    case 7000222:
      return "O segredo do aplicativo no Entra ID expirou. Gere um novo segredo e atualize MS_CLIENT_SECRET.";
    case 700016:
      return "O Entra ID não encontrou o aplicativo neste locatário. Confira MS_CLIENT_ID e MS_TENANT_ID.";
    case 90002:
      return "O Entra ID não encontrou o locatário. Confira MS_TENANT_ID.";
    default:
      return `O Entra ID recusou as credenciais do aplicativo${codigo ? ` (AADSTS${codigo})` : ""}. Confira tenant, client ID e segredo.`;
  }
}

function erroDoGraph(status: number): ErroFonteArquivos {
  if (status === 401 || status === 403) {
    return new ErroFonteArquivos(
      "O aplicativo não tem leitura concedida na pasta Inteligência Tributária.",
      "sem_permissao",
      status,
    );
  }
  if (status === 404) {
    return new ErroFonteArquivos(
      "Pasta ou arquivo não encontrado no OneDrive. Confira o drive e a pasta raiz configurados.",
      "nao_encontrado",
      status,
    );
  }
  if (status === 429) {
    return new ErroFonteArquivos(
      "O Microsoft Graph limitou as requisições e as novas tentativas se esgotaram.",
      "limite_de_requisicoes",
      status,
    );
  }
  return new ErroFonteArquivos(`O Microsoft Graph respondeu com erro ${status}.`, "indisponivel", status);
}
