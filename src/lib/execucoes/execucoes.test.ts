import { describe, expect, it } from "vitest";
import { FonteFicticia } from "@/lib/arquivos/ficticia";
import { ErroFonteArquivos, type FonteArquivos } from "@/lib/arquivos/tipos";
import { lerConfiguracao } from "@/lib/config";
import { CODIGO_ESTADO_VISUAL, execucaoAtiva, situacaoDasEstacoes } from "./apresentacao";
import { processarExecucao } from "./executor";
import { RepositorioMemoria } from "./repositorio-memoria";
import type { Usuario } from "./tipos";

const usuario: Usuario = { id: "u1", nome: "Analista Teste", email: null };

async function criar(repositorio: RepositorioMemoria, indiceCliente: number, competencia: string) {
  const cliente = (await repositorio.listarClientes())[indiceCliente];
  const criacao = await repositorio.criarExecucao(usuario, cliente, competencia, "ficticia");
  if (criacao.tipo !== "criada") throw new Error("execução não criada");
  return criacao.execucao;
}

describe("executor", () => {
  it("executa a triagem, registra o andamento e mantém a Retificação bloqueada", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    expect(criada.status).toBe("na_fila");
    expect(criada.etapas.map((e) => e.estado)).toEqual([
      "pendente",
      "pendente",
      "pendente",
      "aguardando_aprovacao",
    ]);

    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });

    const final = (await repositorio.obterExecucao(usuario, criada.id))!;
    expect(final.status).toBe("triagem_concluida");
    expect(final.origemDados).toBe("ficticia");
    expect(final.triagem?.apta).toBe(true);
    expect(final.etapas.map((e) => e.estado)).toEqual([
      "concluida",
      "pendente",
      "pendente",
      "aguardando_aprovacao",
    ]);
    expect(final.etapas[0]).toMatchObject({ progressoAtual: 16, progressoTotal: 16 });
    expect(final.etapas[0].iniciadaEm).not.toBeNull();
    expect(final.etapas[0].concluidaEm).not.toBeNull();
    expect(await repositorio.listarArquivos(usuario, criada.id)).toHaveLength(16);
    expect(repositorio.eventos.map((e) => e.acao)).toEqual(["triagem.iniciada", "triagem.concluida"]);
  });

  it("encerra com pendências quando falta arquivo", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-06");
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    const final = (await repositorio.obterExecucao(usuario, criada.id))!;
    expect(final.status).toBe("triagem_com_pendencias");
    expect(final.etapas[0].mensagem).toBe("Conferência concluída com 1 pendência impeditiva");
  });

  it("registra a falha quando o OneDrive recusa o acesso", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    const semAcesso: FonteArquivos = {
      tipo: "onedrive",
      listarRaiz: async () => {
        throw new ErroFonteArquivos("O aplicativo não tem leitura concedida na pasta.", "sem_permissao", 403);
      },
      listarFilhos: async () => [],
      baixar: async () => new Uint8Array(),
    };
    await processarExecucao(criada.id, { repositorio, fonte: semAcesso });

    const final = (await repositorio.obterExecucao(usuario, criada.id))!;
    expect(final.status).toBe("falhou");
    expect(final.erro).toBe("O aplicativo não tem leitura concedida na pasta.");
    expect(final.etapas[0].estado).toBe("falhou");
    expect(repositorio.eventos.at(-1)).toMatchObject({
      acao: "triagem.falhou",
      detalhes: { codigo: "sem_permissao" },
    });
  });

  it("não processa a mesma execução duas vezes", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    expect(repositorio.eventos.filter((e) => e.acao === "triagem.iniciada")).toHaveLength(1);
  });
});

describe("repositório em memória", () => {
  it("impede duas execuções ativas da mesma competência e libera após o término", async () => {
    const repositorio = new RepositorioMemoria();
    const cliente = (await repositorio.listarClientes())[0];
    const primeira = await criar(repositorio, 0, "2026-05");
    expect(await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia")).toEqual({
      tipo: "conflito",
      execucaoId: primeira.id,
    });
    // Outra competência do mesmo cliente não conflita.
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-04", "ficticia")).tipo).toBe("criada");

    await processarExecucao(primeira.id, { repositorio, fonte: new FonteFicticia() });
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia")).tipo).toBe("criada");
  });

  it("libera a competência quando a execução anterior ficou sem sinal de vida", async () => {
    let agora = new Date("2026-07-01T10:00:00Z");
    const repositorio = new RepositorioMemoria(undefined, () => agora);
    const cliente = (await repositorio.listarClientes())[0];
    const travada = await criar(repositorio, 0, "2026-05");

    agora = new Date("2026-07-01T10:16:00Z");
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia")).tipo).toBe("criada");
    expect((await repositorio.obterExecucao(usuario, travada.id))!.status).toBe("falhou");
  });

  it("não deixa a Retificação sair de aguardando aprovação", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    await expect(
      repositorio.sistemaAtualizarEtapa(criada.id, "retificacao", { estado: "em_andamento" }),
    ).rejects.toThrow(/aprovação humana/);
  });
});

describe("estado das estações", () => {
  it("mostra a Retificação aguardando aprovação mesmo sem execução", () => {
    const estacoes = situacaoDasEstacoes(null);
    expect(estacoes.map((e) => e.rotulo)).toEqual([
      "Disponível",
      "Disponível",
      "Disponível",
      "Aguardando aprovação",
    ]);
    expect(execucaoAtiva(null)).toBe(false);
  });

  it("reflete o registro da execução em cada estação", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-06");
    expect(situacaoDasEstacoes(criada).map((e) => e.rotulo)).toEqual([
      "Na fila",
      "Aguardando etapa anterior",
      "Aguardando etapa anterior",
      "Aguardando aprovação",
    ]);
    expect(execucaoAtiva(criada)).toBe(true);

    await repositorio.sistemaAtualizarEtapa(criada.id, "triagem", {
      estado: "em_andamento",
      mensagem: "Lendo arquivos: 3 de 10",
      progressoAtual: 3,
      progressoTotal: 10,
    });
    const andamento = situacaoDasEstacoes((await repositorio.obterExecucao(usuario, criada.id))!);
    expect(andamento[0]).toMatchObject({
      visual: "trabalhando",
      tarefa: "Lendo arquivos: 3 de 10",
      progressoAtual: 3,
      progressoTotal: 10,
    });
    expect(CODIGO_ESTADO_VISUAL[andamento[3].visual]).toBe(4);
  });

  it("indica pendências e as próximas etapas depois da triagem", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-06");
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    const final = (await repositorio.obterExecucao(usuario, criada.id))!;
    expect(situacaoDasEstacoes(final).map((e) => e.rotulo)).toEqual([
      "Concluído com pendências",
      "Próxima etapa do piloto",
      "Próxima etapa do piloto",
      "Aguardando aprovação",
    ]);
    expect(execucaoAtiva(final)).toBe(false);
  });
});

describe("configuração", () => {
  const supabase = {
    NEXT_PUBLIC_SUPABASE_URL: "https://projeto.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publica",
    SUPABASE_SECRET_KEY: "secreta",
  };
  const graph = {
    MS_TENANT_ID: "t",
    MS_CLIENT_ID: "c",
    MS_CLIENT_SECRET: "s",
    ONEDRIVE_DRIVE_ID: "d",
    ONEDRIVE_PASTA_RAIZ_ITEM_ID: "p",
  };

  it("sem variáveis, usa dados fictícios em memória", () => {
    expect(lerConfiguracao({})).toMatchObject({ fonte: "ficticia", armazenamento: "memoria", avisos: [] });
  });

  it("só lê o OneDrive quando também há autenticação", () => {
    const semAuth = lerConfiguracao(graph);
    expect(semAuth.fonte).toBe("ficticia");
    expect(semAuth.avisos[0]).toMatch(/ignorado/);

    expect(lerConfiguracao({ ...supabase, ...graph })).toMatchObject({
      fonte: "onedrive",
      armazenamento: "supabase",
      avisos: [],
    });
  });

  it("avisa sobre configuração parcial", () => {
    const parcial = lerConfiguracao({ ...supabase, MS_TENANT_ID: "t" });
    expect(parcial.fonte).toBe("ficticia");
    expect(parcial.avisos[0]).toMatch(/MS_CLIENT_ID, MS_CLIENT_SECRET, ONEDRIVE_DRIVE_ID/);
  });
});
