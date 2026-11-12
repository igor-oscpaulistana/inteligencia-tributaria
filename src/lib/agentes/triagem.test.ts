import { describe, expect, it } from "vitest";
import { CLIENTES_FICTICIOS } from "@/lib/arquivos/dados-ficticios";
import { FonteFicticia } from "@/lib/arquivos/ficticia";
import { listarCompetencias, localizarPastaCliente } from "@/lib/arquivos/leiaute";
import { executarTriagem, type ProgressoTriagem } from "./triagem";

const [horizonte, aurora] = CLIENTES_FICTICIOS;

function triar(cliente: (typeof CLIENTES_FICTICIOS)[number], competencia: string) {
  return executarTriagem(new FonteFicticia(), {
    pastaCliente: cliente.pasta,
    cnpjCadastro: cliente.cnpj,
    competencia,
  });
}

const codigos = (pendencias: { codigo: string; gravidade: string }[], gravidade: string) =>
  pendencias.filter((p) => p.gravidade === gravidade).map((p) => p.codigo);

describe("competências disponíveis", () => {
  it("lista os dois leiautes de pasta, da mais recente para a mais antiga", async () => {
    const fonte = new FonteFicticia();
    const raiz = await fonte.listarRaiz();
    expect(await listarCompetencias(fonte, localizarPastaCliente(raiz, "comercial horizonte")!)).toEqual([
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
    ]);
    expect(await listarCompetencias(fonte, localizarPastaCliente(raiz, "Distribuidora Aurora")!)).toEqual([
      "2026-06",
      "2026-05",
      "2026-04",
    ]);
  });
});

describe("triagem", () => {
  it("lê os três conjuntos no leiaute MM-AAAA e separa as saídas", async () => {
    const { resultado, arquivos } = await triar(horizonte, "2026-05");

    expect(resultado.apta).toBe(true);
    expect(resultado.leiaute).toBe("mm-aaaa");
    expect(resultado.caminhoCompetencia).toBe("Comercial Horizonte/05-2026");
    expect(resultado.cnpjsDoCliente).toEqual([horizonte.cnpj]);
    expect(resultado.escrituracoes.map((e) => [e.tipo, e.compativel, e.regime])).toEqual([
      ["efd_contribuicoes", true, "Regime não cumulativo"],
      ["efd_icms_ipi", true, null],
    ]);
    expect(resultado.xml).toMatchObject({
      lidos: 14,
      saidas: 9,
      saidasPorModelo: { "55": 7, "65": 2, "59": 0 },
      canceladas: 1,
      eventos: 1,
      terceiros: 2,
      entradasProprias: 1,
      foraDoPeriodo: 0,
    });
    expect(codigos(resultado.pendencias, "impeditiva")).toEqual([]);
    expect(codigos(resultado.pendencias, "alerta")).toEqual([]);

    const saidas = arquivos.filter((a) => a.categoria === "xml_saida");
    expect(saidas).toHaveLength(9);
    expect(saidas.every((a) => a.situacao === "considerado" && /^[0-9a-f]{64}$/.test(a.sha256))).toBe(true);
    expect(arquivos.filter((a) => a.situacao === "considerado")).toHaveLength(11);
  });

  it("aponta escrituração ausente e nota fora da competência", async () => {
    const { resultado } = await triar(horizonte, "2026-06");
    expect(resultado.apta).toBe(false);
    expect(codigos(resultado.pendencias, "impeditiva")).toEqual(["EFD_FISCAL_AUSENTE"]);
    expect(codigos(resultado.pendencias, "alerta")).toEqual(["XML_FORA_DO_PERIODO"]);
    expect(resultado.xml).toMatchObject({ saidas: 7, foraDoPeriodo: 1 });
  });

  it("lê o leiaute AAAA/MM com vários estabelecimentos, ZIP e XML repetido", async () => {
    const { resultado, arquivos } = await triar(aurora, "2026-05");

    expect(resultado.apta).toBe(true);
    expect(resultado.leiaute).toBe("aaaa/mm");
    expect(resultado.caminhoCompetencia).toBe("Distribuidora Aurora/2026/05");
    expect(resultado.cnpjsDoCliente).toHaveLength(2);
    expect(resultado.escrituracoes.map((e) => e.tipo)).toEqual([
      "efd_contribuicoes",
      "efd_icms_ipi",
      "efd_icms_ipi",
    ]);
    expect(resultado.xml).toMatchObject({
      lidos: 24,
      saidas: 12,
      duplicados: 1,
      canceladas: 2,
      eventos: 2,
      terceiros: 4,
      entradasProprias: 2,
      foraDoEscopo: 1,
    });
    expect(codigos(resultado.pendencias, "impeditiva")).toEqual([]);
    expect(codigos(resultado.pendencias, "alerta")).toEqual(["XML_DUPLICADO"]);
    expect(arquivos.some((a) => a.caminho.includes("filial.zip!/") && a.categoria === "xml_saida")).toBe(true);
  });

  it("aponta período e CNPJ incompatíveis", async () => {
    const { resultado, arquivos } = await triar(aurora, "2026-06");
    expect(resultado.apta).toBe(false);
    expect(codigos(resultado.pendencias, "impeditiva").sort()).toEqual([
      "CNPJ_INCOMPATIVEL",
      "EFD_CONTRIBUICOES_AUSENTE",
      "EFD_FISCAL_AUSENTE",
      "PERIODO_INCOMPATIVEL",
    ]);
    expect(arquivos.filter((a) => a.situacao === "incompativel")).toHaveLength(2);
    expect(resultado.xml.saidas).toBe(6);
  });

  it("aponta os três conjuntos ausentes quando as pastas estão vazias", async () => {
    const { resultado, arquivos } = await triar(aurora, "2026-04");
    expect(arquivos).toEqual([]);
    expect(codigos(resultado.pendencias, "impeditiva").sort()).toEqual([
      "EFD_CONTRIBUICOES_AUSENTE",
      "EFD_FISCAL_AUSENTE",
      "XML_DE_SAIDA_AUSENTE",
    ]);
  });

  it("aponta pasta de competência e de cliente inexistentes", async () => {
    const semCompetencia = await triar(aurora, "2026-03");
    expect(codigos(semCompetencia.resultado.pendencias, "impeditiva")).toEqual(["PASTA_COMPETENCIA_AUSENTE"]);

    const semCliente = await executarTriagem(new FonteFicticia(), {
      pastaCliente: "Cliente Inexistente",
      cnpjCadastro: null,
      competencia: "2026-05",
    });
    expect(codigos(semCliente.resultado.pendencias, "impeditiva")).toEqual(["PASTA_CLIENTE_AUSENTE"]);
  });

  it("separa as saídas mesmo sem CNPJ no cadastro, usando a escrituração", async () => {
    const { resultado } = await executarTriagem(new FonteFicticia(), {
      pastaCliente: horizonte.pasta,
      cnpjCadastro: null,
      competencia: "2026-05",
    });
    expect(resultado.xml).toMatchObject({ saidas: 9, terceiros: 2 });
    expect(resultado.apta).toBe(true);
  });

  it("informa o andamento da leitura", async () => {
    const progresso: ProgressoTriagem[] = [];
    await executarTriagem(
      new FonteFicticia(),
      { pastaCliente: horizonte.pasta, cnpjCadastro: horizonte.cnpj, competencia: "2026-05" },
      { aoProgredir: (p) => void progresso.push(p) },
    );
    const leitura = progresso.filter((p) => p.total === 16);
    expect(leitura.map((p) => p.atual).slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(progresso.at(-1)?.mensagem).toBe("Conferindo CNPJ e período");
  });

  it("não lê itens que não vieram de uma listagem", async () => {
    const fonte = new FonteFicticia();
    await expect(fonte.baixar("raiz/0/0/1")).rejects.toMatchObject({ codigo: "fora_da_arvore" });
  });
});
