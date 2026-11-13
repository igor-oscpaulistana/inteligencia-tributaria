import { describe, expect, it } from "vitest";
import { FonteFicticia } from "@/lib/arquivos/ficticia";
import { ErroFonteArquivos, type FonteArquivos } from "@/lib/arquivos/tipos";
import { lerConfiguracao } from "@/lib/config";
import { execucaoAtiva, situacaoDasEstacoes } from "./apresentacao";
import { validarNovaSenha } from "@/lib/auth/senha";
import { competenciasDoPeriodo, formatarPeriodo } from "@/lib/competencia";
import { processarExecucao } from "./executor";
import { processarFila } from "./fila";
import { RepositorioMemoria } from "./repositorio-memoria";
import type { Lote, Usuario } from "./tipos";

const usuario: Usuario = { id: "u1", nome: "Analista Teste", email: null };

const PASTAS = ["Comercial Horizonte", "Distribuidora Aurora"];

/** Lote de uma competência só: o pedido de um único mês. */
const loteDe = (competencia: string, id = `lote-${competencia}`): Lote => ({
  id,
  periodoInicio: competencia,
  periodoFim: competencia,
});

async function criar(repositorio: RepositorioMemoria, indiceCliente: number, competencia: string) {
  const cliente = await repositorio.registrarCliente(usuario, PASTAS[indiceCliente]);
  const criacao = await repositorio.criarExecucao(usuario, cliente, competencia, "ficticia", loteDe(competencia));
  if (criacao.tipo !== "criada") throw new Error("execução não criada");
  return criacao.execucao;
}

/** Pede um período: uma execução por competência, todas no mesmo lote. */
async function criarPeriodo(repositorio: RepositorioMemoria, indiceCliente: number, inicio: string, fim: string) {
  const cliente = await repositorio.registrarCliente(usuario, PASTAS[indiceCliente]);
  const lote: Lote = { id: `lote-${indiceCliente}-${inicio}-${fim}`, periodoInicio: inicio, periodoFim: fim };
  const criadas = [];
  for (const competencia of competenciasDoPeriodo(inicio, fim)) {
    const criacao = await repositorio.criarExecucao(usuario, cliente, competencia, "ficticia", lote);
    if (criacao.tipo === "criada") criadas.push(criacao.execucao);
  }
  return { cliente, lote, criadas };
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
    expect(repositorio.eventos.map((e) => e.acao)).toEqual([
      "cliente.cadastrado",
      "triagem.iniciada",
      "cliente.cnpj_registrado",
      "triagem.concluida",
    ]);
  });

  it("cadastra o cliente pela pasta e grava o CNPJ lido na EFD-Contribuições", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    const antes = await repositorio.registrarCliente(usuario, "Comercial Horizonte");
    expect(antes).toMatchObject({ nome: "Comercial Horizonte", pastaOnedrive: "Comercial Horizonte", cnpj: null });

    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });

    // A mesma pasta devolve o mesmo cliente, agora com o CNPJ da escrituração.
    const depois = await repositorio.registrarCliente(usuario, "Comercial Horizonte");
    expect(depois.id).toBe(antes.id);
    expect(depois.cnpj).toBe("11222333000181");
    expect(repositorio.eventos.filter((e) => e.acao === "cliente.cadastrado")).toHaveLength(1);
  });

  it("não grava CNPJ quando a triagem tem pendência impeditiva", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-06");
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    expect((await repositorio.registrarCliente(usuario, "Comercial Horizonte")).cnpj).toBeNull();
    expect(repositorio.eventos.some((e) => e.acao === "cliente.cnpj_registrado")).toBe(false);
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
    const primeira = await criar(repositorio, 0, "2026-05");
    const cliente = await repositorio.registrarCliente(usuario, PASTAS[0]);
    expect(await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia", loteDe("2026-05", "b"))).toEqual({
      tipo: "conflito",
      execucaoId: primeira.id,
    });
    // Outra competência do mesmo cliente não conflita.
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-04", "ficticia", loteDe("2026-04"))).tipo).toBe(
      "criada",
    );

    await processarExecucao(primeira.id, { repositorio, fonte: new FonteFicticia() });
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia", loteDe("2026-05", "c"))).tipo).toBe(
      "criada",
    );
  });

  it("encerra a execução em andamento sem sinal de vida e libera a competência", async () => {
    let agora = new Date("2026-07-01T10:00:00Z");
    const repositorio = new RepositorioMemoria(() => agora);
    const travada = await criar(repositorio, 0, "2026-05");
    const naFila = await criar(repositorio, 0, "2026-04");
    const cliente = await repositorio.registrarCliente(usuario, PASTAS[0]);
    expect(await repositorio.sistemaReivindicar(travada.id)).toBe(true);
    await repositorio.sistemaAtualizarEtapa(travada.id, "triagem", { estado: "em_andamento" });

    // Dentro do prazo, nada muda.
    agora = new Date("2026-07-01T10:05:00Z");
    expect(await repositorio.sistemaEncerrarInterrompidas()).toBe(0);

    agora = new Date("2026-07-01T10:07:00Z");
    expect(await repositorio.sistemaEncerrarInterrompidas()).toBe(1);
    const encerrada = (await repositorio.obterExecucao(usuario, travada.id))!;
    expect(encerrada.status).toBe("falhou");
    expect(encerrada.erro).toMatch(/interrompida/);
    expect(encerrada.etapas.find((e) => e.agente === "triagem")!.estado).toBe("falhou");
    // Quem espera na fila não é encerrado por estar parado: só o que estava em andamento.
    expect((await repositorio.obterExecucao(usuario, naFila.id))!.status).toBe("na_fila");
    expect((await repositorio.criarExecucao(usuario, cliente, "2026-05", "ficticia", loteDe("2026-05", "d"))).tipo).toBe(
      "criada",
    );
  });

  it("só um processo consegue assumir a execução", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    expect(await repositorio.sistemaReivindicar(criada.id)).toBe(true);
    expect(await repositorio.sistemaReivindicar(criada.id)).toBe(false);
    expect(await repositorio.sistemaReivindicar("inexistente")).toBe(false);
  });

  it("lista a execução mais recente de cada cliente e competência", async () => {
    const repositorio = new RepositorioMemoria();
    const antiga = await criar(repositorio, 0, "2026-05");
    await processarExecucao(antiga.id, { repositorio, fonte: new FonteFicticia() });
    const nova = await criar(repositorio, 0, "2026-05");
    await criar(repositorio, 0, "2026-06");
    const outroCliente = await criar(repositorio, 1, "2026-05");

    const todas = await repositorio.listarAuditorias(usuario);
    // Cliente em ordem alfabética; dentro dele, a competência mais recente primeiro.
    expect(todas.map((a) => `${a.clienteNome} ${a.competencia}`)).toEqual([
      "Comercial Horizonte 2026-06",
      "Comercial Horizonte 2026-05",
      "Distribuidora Aurora 2026-05",
    ]);
    // A competência reauditada mostra a execução nova, não a antiga.
    expect(todas[1].id).toBe(nova.id);
    expect(todas[1].notasSaida).toBeNull();

    const doCliente = await repositorio.listarAuditorias(usuario, { clienteId: outroCliente.clienteId });
    expect(doCliente.map((a) => a.id)).toEqual([outroCliente.id]);
    expect(await repositorio.obterCliente(usuario, outroCliente.clienteId)).toMatchObject({
      nome: "Distribuidora Aurora",
    });
    expect(await repositorio.obterCliente(usuario, "inexistente")).toBeNull();
  });

  it("resume a triagem concluída com notas de saída e pendências", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    await processarExecucao(criada.id, { repositorio, fonte: new FonteFicticia() });
    const [resumo] = await repositorio.listarAuditorias(usuario);
    const completa = (await repositorio.obterExecucao(usuario, criada.id))!;
    expect(resumo.status).toBe("triagem_concluida");
    expect(resumo.notasSaida).toBe(completa.triagem!.xml.saidas);
    expect(resumo.pendenciasImpeditivas).toBe(0);
    expect(resumo.pendenciasAlerta).toBe(
      completa.triagem!.pendencias.filter((p) => p.gravidade === "alerta").length,
    );
  });

  it("não deixa a Retificação sair de aguardando aprovação", async () => {
    const repositorio = new RepositorioMemoria();
    const criada = await criar(repositorio, 0, "2026-05");
    await expect(
      repositorio.sistemaAtualizarEtapa(criada.id, "retificacao", { estado: "em_andamento" }),
    ).rejects.toThrow(/aprovação humana/);
  });
});

describe("auditoria por período", () => {
  it("lista as competências de um período, inclusive na virada do ano", () => {
    expect(competenciasDoPeriodo("2023-01", "2023-12")).toHaveLength(12);
    expect(competenciasDoPeriodo("2023-11", "2024-02")).toEqual(["2023-11", "2023-12", "2024-01", "2024-02"]);
    expect(competenciasDoPeriodo("2023-05", "2023-05")).toEqual(["2023-05"]);
    expect(competenciasDoPeriodo("2023-06", "2023-05")).toEqual([]);
    expect(competenciasDoPeriodo("2023-13", "2023-14")).toEqual([]);
    expect(formatarPeriodo("2023-01", "2023-12")).toBe("01/2023 a 12/2023");
    expect(formatarPeriodo("2023-05", "2023-05")).toBe("05/2023");
  });

  it("cria uma execução por competência no mesmo lote e processa a fila em ordem", async () => {
    const repositorio = new RepositorioMemoria();
    const { lote, criadas } = await criarPeriodo(repositorio, 0, "2026-04", "2026-06");
    expect(criadas.map((e) => e.competencia)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(new Set(criadas.map((e) => e.loteId))).toEqual(new Set([lote.id]));
    expect(criadas[1]).toMatchObject({ periodoInicio: "2026-04", periodoFim: "2026-06", status: "na_fila" });
    expect(await repositorio.situacaoDaFila()).toEqual({ naFila: 3, emAndamento: 0 });
    // Com fila e nada em andamento, o escritório mostra a próxima da fila.
    expect((await repositorio.execucaoEmFoco())!.id).toBe(criadas[0].id);

    const resultado = await processarFila({ repositorio, criarFonte: () => new FonteFicticia() });
    expect(resultado).toEqual({ processadas: 3, restam: false });
    expect(await repositorio.situacaoDaFila()).toEqual({ naFila: 0, emAndamento: 0 });

    const iniciadas = repositorio.eventos.filter((e) => e.acao === "triagem.iniciada").map((e) => e.execucaoId);
    expect(iniciadas).toEqual(criadas.map((e) => e.id));
    // Cada mês tem a sua conferência e a sua Retificação, bloqueada até a aprovação.
    for (const criada of criadas) {
      const final = (await repositorio.obterExecucao(usuario, criada.id))!;
      expect(["triagem_concluida", "triagem_com_pendencias"]).toContain(final.status);
      expect(final.etapas.find((e) => e.agente === "retificacao")!.estado).toBe("aguardando_aprovacao");
    }
  });

  it("para quando o tempo útil acaba e deixa o restante na fila", async () => {
    let agora = new Date("2026-07-01T10:00:00Z");
    const repositorio = new RepositorioMemoria(() => agora);
    await criarPeriodo(repositorio, 0, "2026-01", "2026-06");
    // Cada leitura "leva" 100 s: a origem adianta o relógio ao listar a raiz.
    const criarFonte = (): FonteArquivos => {
      const fonte = new FonteFicticia();
      const listarRaiz = fonte.listarRaiz.bind(fonte);
      fonte.listarRaiz = async () => {
        agora = new Date(agora.getTime() + 100_000);
        return listarRaiz();
      };
      return fonte;
    };

    // 1ª: 100 s. 2ª começa (100 + 150 ≤ 270) e termina em 200 s. 3ª não começa (200 + 150 > 270).
    const primeira = await processarFila({ repositorio, criarFonte, agora: () => agora });
    expect(primeira).toEqual({ processadas: 2, restam: true });
    expect(await repositorio.situacaoDaFila()).toEqual({ naFila: 4, emAndamento: 0 });

    // A retomada continua de onde parou.
    const segunda = await processarFila({ repositorio, criarFonte, agora: () => agora });
    expect(segunda).toEqual({ processadas: 2, restam: true });
    const terceira = await processarFila({ repositorio, criarFonte, agora: () => agora });
    expect(terceira).toEqual({ processadas: 2, restam: false });
  });

  it("não inicia outra competência enquanto houver uma em andamento", async () => {
    const repositorio = new RepositorioMemoria();
    const { criadas } = await criarPeriodo(repositorio, 0, "2026-05", "2026-06");
    await repositorio.sistemaReivindicar(criadas[0].id);
    expect(await processarFila({ repositorio, criarFonte: () => new FonteFicticia() })).toEqual({
      processadas: 0,
      restam: true,
    });
    expect(await repositorio.situacaoDaFila()).toEqual({ naFila: 1, emAndamento: 1 });
    // O escritório mostra a que está em andamento, não a da fila.
    expect((await repositorio.execucaoEmFoco())!.id).toBe(criadas[0].id);
  });

  it("pula as competências do período que já estão ativas", async () => {
    const repositorio = new RepositorioMemoria();
    const jaNaFila = await criar(repositorio, 0, "2026-05");
    const { criadas } = await criarPeriodo(repositorio, 0, "2026-04", "2026-06");
    expect(criadas.map((e) => e.competencia)).toEqual(["2026-04", "2026-06"]);
    expect((await repositorio.listarAuditorias(usuario)).find((a) => a.competencia === "2026-05")!.id).toBe(
      jaNaFila.id,
    );
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
    expect(andamento[3].visual).toBe("aguardando_aprovacao");
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

describe("regra de senha", () => {
  it("exige pelo menos 8 caracteres e confirmação igual", () => {
    expect(validarNovaSenha("1234567", "1234567")).toMatch(/pelo menos 8/);
    expect(validarNovaSenha("12345678", "12345679")).toMatch(/não confere/);
    expect(validarNovaSenha("12345678", "12345678")).toBeNull();
  });
});
