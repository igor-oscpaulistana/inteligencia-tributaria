"use client";

import { useState } from "react";
import type { CategoriaArquivo, Pendencia } from "@/lib/agentes/triagem";
import { formatarCnpj } from "@/lib/cnpj";
import { formatarCompetencia } from "@/lib/competencia";
import type { Execucao } from "@/lib/execucoes/tipos";
import { NOME_TIPO_SPED } from "@/lib/fiscal/sped";

interface ArquivoListado {
  caminho: string;
  categoria: CategoriaArquivo;
  situacao: string;
  detalhe: string | null;
}

const NOME_GRAVIDADE: Record<Pendencia["gravidade"], string> = {
  impeditiva: "Impeditiva",
  alerta: "Alerta",
  informativa: "Informação",
};

const NOME_CATEGORIA: Record<CategoriaArquivo, string> = {
  efd_contribuicoes: "EFD-Contribuições",
  efd_icms_ipi: "EFD ICMS/IPI",
  xml_saida: "Nota de saída",
  xml_entrada_propria: "Entrada de emissão própria",
  xml_terceiros: "Emitido por terceiro",
  xml_evento: "Evento",
  xml_cancelado: "Nota cancelada",
  xml_nao_autorizado: "Sem autorização de uso",
  xml_fora_do_periodo: "Fora da competência",
  xml_duplicado: "XML repetido",
  xml_invalido: "XML ilegível",
  fora_do_escopo: "Fora do escopo",
};

function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function PainelTriagem({ execucao }: { execucao: Execucao }) {
  const [arquivos, setArquivos] = useState<ArquivoListado[] | "carregando" | "erro" | null>(null);
  const triagem = execucao.triagem;
  const competencia = formatarCompetencia(execucao.competencia);
  const origem = execucao.origemDados === "ficticia" ? "Dados fictícios" : "OneDrive";

  async function carregarArquivos() {
    if (arquivos !== null) return;
    setArquivos("carregando");
    try {
      const resposta = await fetch(`/api/execucoes/${execucao.id}/arquivos`);
      if (!resposta.ok) throw new Error();
      setArquivos((await resposta.json()).arquivos);
    } catch {
      setArquivos("erro");
    }
  }

  if (!triagem) {
    return (
      <section className="report" aria-labelledby="titulo-triagem">
        <div className="section-head">
          <div>
            <h2 id="titulo-triagem">Triagem dos arquivos</h2>
            <p className="muted small">
              {execucao.clienteNome} · {competencia} · {origem}
            </p>
          </div>
        </div>
        <div className="card empty" role="status">
          {execucao.status === "falhou"
            ? (execucao.erro ?? "A triagem falhou.")
            : "A conferência aparece aqui quando a Triagem terminar."}
        </div>
      </section>
    );
  }

  const { xml, pendencias, escrituracoes } = triagem;
  const impeditivas = pendencias.filter((p) => p.gravidade === "impeditiva").length;
  const contribuicoes = escrituracoes.filter((e) => e.tipo === "efd_contribuicoes" && e.compativel);
  const fiscais = escrituracoes.filter((e) => e.tipo === "efd_icms_ipi" && e.compativel);
  const modelos = [
    xml.saidasPorModelo["55"] > 0 ? `${xml.saidasPorModelo["55"]} NF-e` : null,
    xml.saidasPorModelo["65"] > 0 ? `${xml.saidasPorModelo["65"]} NFC-e` : null,
    xml.saidasPorModelo["59"] > 0 ? `${xml.saidasPorModelo["59"]} CF-e SAT` : null,
  ].filter(Boolean);
  const contagens: Array<[string, number, boolean]> = [
    ["Notas de saída consideradas", xml.saidas, true],
    ["Emitidos por terceiros (entradas)", xml.terceiros, false],
    ["Entradas de emissão própria", xml.entradasProprias, false],
    ["Notas canceladas", xml.canceladas, false],
    ["Fora da competência", xml.foraDoPeriodo, false],
    ["Sem autorização de uso", xml.naoAutorizadas, false],
    ["XMLs repetidos", xml.duplicados, false],
    ["Eventos", xml.eventos, false],
    ["XMLs ilegíveis", xml.invalidos, false],
    ["Fora do escopo", xml.foraDoEscopo, false],
  ];

  return (
    <section className="report" aria-labelledby="titulo-triagem">
      <div className="section-head">
        <div>
          <h2 id="titulo-triagem">Triagem dos arquivos</h2>
          <p className="muted small">
            {execucao.clienteNome} · {competencia} · {origem}
            {triagem.caminhoCompetencia ? ` · ${triagem.caminhoCompetencia}` : ""}
          </p>
        </div>
      </div>

      <div className={`card review ${triagem.apta ? "ok" : "blocked"}`} role="status">
        <div>
          <h3>{triagem.apta ? "Arquivos conferidos" : "Triagem com pendências"}</h3>
          <p className="review-meta">
            {triagem.apta
              ? "Os três conjuntos de arquivos foram lidos e são compatíveis com o cliente e a competência. A Auditoria entra na próxima etapa do piloto."
              : `${impeditivas} ${impeditivas === 1 ? "pendência impede" : "pendências impedem"} a auditoria. Ajuste os arquivos na pasta e inicie uma nova auditoria.`}
          </p>
        </div>
        <span className={`pill ${triagem.apta ? "ok" : "impeditiva"}`}>
          {triagem.apta ? "Apta para auditoria" : "Não apta"}
        </span>
      </div>

      <dl className="kpis">
        <div className="card kpi">
          <dt>Notas de saída</dt>
          <dd>
            {xml.saidas}
            <span className="kpi-note">{modelos.length > 0 ? modelos.join(" · ") : "nenhuma considerada"}</span>
          </dd>
        </div>
        <div className="card kpi">
          <dt>EFD-Contribuições</dt>
          <dd>
            {contribuicoes.length === 1 ? "Conferida" : contribuicoes.length === 0 ? "Ausente" : "Duplicada"}
            <span className="kpi-note">{contribuicoes[0]?.regime ?? "regime não identificado"}</span>
          </dd>
        </div>
        <div className="card kpi">
          <dt>EFD ICMS/IPI</dt>
          <dd>
            {fiscais.length === 0 ? "Ausente" : fiscais.length}
            <span className="kpi-note">
              {fiscais.length === 1 ? "estabelecimento" : fiscais.length > 1 ? "estabelecimentos" : "nenhuma compatível"}
            </span>
          </dd>
        </div>
        <div className="card kpi">
          <dt>XMLs lidos</dt>
          <dd>
            {xml.lidos}
            <span className="kpi-note">{xml.lidos - xml.saidas} fora do cálculo</span>
          </dd>
        </div>
      </dl>

      <div className="report-body">
        <section className="card panel" aria-labelledby="titulo-xml">
          <h3 id="titulo-xml">Separação dos XMLs</h3>
          <ul className="counts">
            {contagens
              .filter(([, quantidade, sempre]) => sempre || quantidade > 0)
              .map(([rotulo, quantidade, considerado]) => (
                <li key={rotulo} className={considerado ? "considered" : undefined}>
                  <span>{rotulo}</span>
                  <strong>{quantidade}</strong>
                </li>
              ))}
          </ul>
          <p className="note">Só as notas de saída do cliente emitidas na competência, sem cancelamento, seguem para a Auditoria.</p>
        </section>

        <div className="stack">
          <section className="card panel" aria-labelledby="titulo-conferencia">
            <h3 id="titulo-conferencia">Conferência de CNPJ e período</h3>
            {escrituracoes.length === 0 ? (
              <p className="muted small">Nenhuma escrituração foi encontrada na pasta.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Arquivo</th>
                      <th scope="col">Escrituração</th>
                      <th scope="col">CNPJ</th>
                      <th scope="col">Período</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escrituracoes.map((e) => (
                      <tr key={e.caminho}>
                        <td className="path">{e.caminho.split("/").pop()}</td>
                        <td>
                          {NOME_TIPO_SPED[e.tipo]}
                          {e.retificadora ? " (retificadora)" : ""}
                        </td>
                        <td>{formatarCnpj(e.cnpj)}</td>
                        <td>
                          {dataBr(e.dataInicial)} a {dataBr(e.dataFinal)}
                        </td>
                        <td>
                          <span className={`pill ${e.compativel ? "ok" : "impeditiva"}`}>
                            {e.compativel ? "Compatível" : "Incompatível"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card panel" aria-labelledby="titulo-pendencias">
            <h3 id="titulo-pendencias">Pendências e avisos</h3>
            {pendencias.length === 0 ? (
              <p className="muted small">Nenhuma pendência registrada.</p>
            ) : (
              <ul className="findings">
                {pendencias.map((p, indice) => (
                  <li key={`${p.codigo}-${indice}`}>
                    <span className={`pill ${p.gravidade}`}>{NOME_GRAVIDADE[p.gravidade]}</span>
                    <span>{p.mensagem}</span>
                    {p.arquivo && <span className="file">{p.arquivo}</span>}
                  </li>
                ))}
              </ul>
            )}

            <details className="files" onToggle={(e) => e.currentTarget.open && carregarArquivos()}>
              <summary>Arquivos fora do cálculo</summary>
              {arquivos === "carregando" && <p className="note" role="status">Carregando…</p>}
              {arquivos === "erro" && <p className="note" role="alert">Não foi possível carregar a lista.</p>}
              {Array.isArray(arquivos) &&
                (arquivos.filter((a) => a.situacao !== "considerado").length === 0 ? (
                  <p className="note">Todos os arquivos da pasta foram considerados.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Arquivo</th>
                          <th scope="col">Classificação</th>
                          <th scope="col">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arquivos
                          .filter((a) => a.situacao !== "considerado")
                          .map((a) => (
                            <tr key={a.caminho}>
                              <td className="path">{a.caminho.split("/").slice(-1)[0]}</td>
                              <td>{NOME_CATEGORIA[a.categoria]}</td>
                              <td>{a.detalhe ?? "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </details>
          </section>
        </div>
      </div>
    </section>
  );
}
