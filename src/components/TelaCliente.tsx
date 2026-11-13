"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFINICOES_AGENTES } from "@/lib/agentes/definicoes";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import { formatarCnpj } from "@/lib/cnpj";
import { competenciasDoPeriodo, formatarCompetencia, formatarPeriodo } from "@/lib/competencia";
import { situacaoDasEstacoes } from "@/lib/execucoes/apresentacao";
import {
  STATUS_ATIVOS,
  type Cliente,
  type Execucao,
  type ResumoAuditoria,
  type SituacaoFila,
} from "@/lib/execucoes/tipos";
import { Cabecalho } from "./Cabecalho";
import { DialogoNovaAuditoria } from "./DialogoNovaAuditoria";
import { MarcaEalex } from "./MarcaEalex";
import { PainelTriagem } from "./PainelTriagem";
import { quando, resumoPendencias, SituacaoAuditoria } from "./TabelaAuditorias";
import { useAuditorias } from "./useAuditorias";

interface Props {
  cliente: Cliente;
  nomeUsuario: string;
  fonte: TipoFonte;
  auditoriasIniciais: ResumoAuditoria[];
  filaInicial: SituacaoFila;
  /** Competência pedida na URL ("AAAA-MM"), quando houver. */
  competenciaInicial: string | null;
  sair?: () => Promise<void>;
}

/** Competência que a tela abre: a pedida; sem ela, a que está ativa; sem ativa, a mais recente. */
function competenciaDeAbertura(auditorias: ResumoAuditoria[], pedida: string | null): string | null {
  if (pedida && auditorias.some((a) => a.competencia === pedida)) return pedida;
  const ativa = auditorias.find((a) => STATUS_ATIVOS.includes(a.status));
  return (ativa ?? auditorias[0])?.competencia ?? null;
}

/**
 * Tela do cliente: todas as competências auditadas, o consolidado do período
 * escolhido e a conferência completa da competência selecionada.
 */
export function TelaCliente({
  cliente,
  nomeUsuario,
  fonte,
  auditoriasIniciais,
  filaInicial,
  competenciaInicial,
  sair,
}: Props) {
  const { auditorias, falha, atualizar } = useAuditorias(auditoriasIniciais, filaInicial, cliente.id);
  const [selecionada, setSelecionada] = useState(() => competenciaDeAbertura(auditoriasIniciais, competenciaInicial));
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [detalhe, setDetalhe] = useState<Execucao | null>(null);
  const [falhaDetalhe, setFalhaDetalhe] = useState(false);
  const ficticio = fonte === "ficticia";

  // Em ordem crescente: é assim que um período se lê (de janeiro a dezembro).
  const emOrdem = [...auditorias].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const competencias = emOrdem.map((a) => a.competencia);
  const atual = emOrdem.find((a) => a.competencia === selecionada) ?? null;

  // Período do consolidado: por padrão, o do pedido que criou a competência
  // selecionada; o analista pode mudar as duas pontas.
  const [periodo, setPeriodo] = useState<{ de: string; ate: string } | null>(null);
  const padrao = atual
    ? { de: atual.periodoInicio, ate: atual.periodoFim }
    : competencias.length > 0
      ? { de: competencias[0], ate: competencias[competencias.length - 1] }
      : null;
  const de = periodo?.de ?? padrao?.de ?? "";
  const ate = periodo?.ate ?? padrao?.ate ?? "";
  // As pontas do pedido entram nas opções mesmo que a competência ainda não tenha sido auditada.
  const opcoes = [...new Set([...competencias, de, ate].filter(Boolean))].sort();

  const noPeriodo = emOrdem.filter((a) => a.competencia >= de && a.competencia <= ate);
  const mesesDoPeriodo = de && ate ? competenciasDoPeriodo(de, ate).length : 0;
  const aptas = noPeriodo.filter((a) => a.status === "triagem_concluida").length;
  const comPendencias = noPeriodo.filter((a) => a.status === "triagem_com_pendencias").length;
  const falharam = noPeriodo.filter((a) => a.status === "falhou").length;
  const ativas = noPeriodo.filter((a) => STATUS_ATIVOS.includes(a.status)).length;
  const notas = noPeriodo.reduce((soma, a) => soma + (a.notasSaida ?? 0), 0);

  function selecionar(competencia: string) {
    setSelecionada(competencia);
    window.history.replaceState(null, "", `?competencia=${competencia}`);
  }

  // Conferência completa da competência selecionada. A lista muda a cada passo
  // de uma execução ativa (atualizadaEm), e isso traz o detalhe de novo.
  const atualId = atual?.id ?? null;
  const atualizadaEm = atual?.atualizadaEm ?? null;
  useEffect(() => {
    if (!atualId) return;
    let cancelado = false;
    fetch(`/api/execucoes/${atualId}`, { cache: "no-store" })
      .then((resposta) => {
        if (!resposta.ok) throw new Error();
        return resposta.json() as Promise<{ execucao: Execucao }>;
      })
      .then((corpo) => {
        if (cancelado) return;
        setDetalhe(corpo.execucao);
        setFalhaDetalhe(false);
      })
      .catch(() => {
        if (!cancelado) setFalhaDetalhe(true);
      });
    return () => {
      cancelado = true;
    };
  }, [atualId, atualizadaEm]);
  const execucao = detalhe && detalhe.id === atualId ? detalhe : null;

  async function iniciar(pasta: string, competenciaInicial: string, competenciaFinal: string): Promise<string | null> {
    try {
      const resposta = await fetch("/api/execucoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pasta, competenciaInicial, competenciaFinal }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) return corpo.erro ?? "Não foi possível iniciar a auditoria.";
      setDialogoAberto(false);
      setPeriodo({ de: competenciaInicial, ate: competenciaFinal });
      selecionar(competenciaInicial);
      atualizar();
      return null;
    } catch {
      return "Sem conexão com o servidor. Tente novamente.";
    }
  }

  return (
    <>
      <a className="skip-link" href="#titulo-competencias">
        Ir para as competências
      </a>
      <Cabecalho nomeUsuario={nomeUsuario} dadosFicticios={ficticio} sair={sair} />

      <main>
        <Link className="crumb" href="/">
          ← Escritório
        </Link>
        <div className="intro client-head">
          <div>
            <span className="ea-kicker">Cliente</span>
            <h1>{cliente.nome}</h1>
            <p className="muted client-meta">
              {cliente.cnpj ? (
                <>CNPJ {formatarCnpj(cliente.cnpj)}</>
              ) : (
                <>CNPJ ainda não registrado: ele vem da EFD-Contribuições na primeira triagem sem pendência impeditiva</>
              )}
              {" · "}Pasta {cliente.pastaOnedrive}
            </p>
          </div>
          <button className="primary" type="button" onClick={() => setDialogoAberto(true)}>
            + Nova auditoria
          </button>
        </div>

        {falha && (
          <p className="notice error app-notice" role="alert">
            Não foi possível atualizar a lista. Nova tentativa em instantes.
          </p>
        )}

        <section className="report" aria-labelledby="titulo-competencias">
          <div className="section-head period-head">
            <div>
              <span className="ea-kicker">Período acumulado</span>
              <h2 id="titulo-competencias" tabIndex={-1}>
                Competências auditadas
              </h2>
              <p className="muted small">
                {de && ate ? `Consolidado de ${formatarPeriodo(de, ate)}. ` : ""}A conferência e a retificação são
                feitas mês a mês; o período reúne os resultados.
              </p>
            </div>
            {opcoes.length > 0 && (
              <div className="filters period-filters" role="group" aria-label="Período do consolidado">
                <label>
                  De
                  <select
                    value={de}
                    onChange={(e) => setPeriodo({ de: e.target.value, ate: ate < e.target.value ? e.target.value : ate })}
                  >
                    {opcoes.map((c) => (
                      <option key={c} value={c}>
                        {formatarCompetencia(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Até
                  <select
                    value={ate}
                    onChange={(e) => setPeriodo({ de: de > e.target.value ? e.target.value : de, ate: e.target.value })}
                  >
                    {opcoes.map((c) => (
                      <option key={c} value={c}>
                        {formatarCompetencia(c)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {auditorias.length === 0 ? (
            <div className="card empty">
              <span className="empty-symbol" aria-hidden="true">
                ▤
              </span>
              <h3>Nenhuma auditoria deste cliente</h3>
              <p>Use “Nova auditoria” para escolher o período. Cada competência auditada aparece aqui.</p>
            </div>
          ) : (
            <>
              <dl className="kpis">
                <div className="card kpi">
                  <dt>Competências auditadas</dt>
                  <dd>
                    {noPeriodo.length}
                    <span className="kpi-note">
                      de {mesesDoPeriodo} {mesesDoPeriodo === 1 ? "mês" : "meses"} do período
                      {ativas > 0 ? ` · ${ativas} em fila ou andamento` : ""}
                    </span>
                  </dd>
                </div>
                <div className="card kpi">
                  <dt>Aptas para auditoria</dt>
                  <dd>
                    {aptas}
                    <span className="kpi-note">triagem sem pendência impeditiva</span>
                  </dd>
                </div>
                <div className="card kpi">
                  <dt>Com pendências</dt>
                  <dd>
                    {comPendencias + falharam}
                    <span className="kpi-note">
                      {falharam > 0 ? `${falharam} com falha de leitura` : "ajuste os arquivos e audite de novo"}
                    </span>
                  </dd>
                </div>
                <div className="card kpi">
                  <dt>Notas de saída</dt>
                  <dd>
                    {notas.toLocaleString("pt-BR")}
                    <span className="kpi-note">somadas no período</span>
                  </dd>
                </div>
              </dl>

              {noPeriodo.length === 0 ? (
                <p className="card empty-filter">Nenhuma competência auditada neste período.</p>
              ) : (
                <div
                  className="card table-wrap audits"
                  tabIndex={0}
                  role="region"
                  aria-label="Competências do período; role para ver todas as colunas"
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Competência</th>
                        <th scope="col">Situação</th>
                        <th scope="col" className="num">
                          Notas de saída
                        </th>
                        <th scope="col">Pendências</th>
                        <th scope="col">Atualizada em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {noPeriodo.map((a) => (
                        <tr key={a.id} className={a.competencia === selecionada ? "selected" : undefined}>
                          <th scope="row">
                            <button
                              type="button"
                              className="row-link"
                              aria-pressed={a.competencia === selecionada}
                              onClick={() => selecionar(a.competencia)}
                            >
                              {formatarCompetencia(a.competencia)}
                            </button>
                          </th>
                          <td>
                            <SituacaoAuditoria status={a.status} />
                          </td>
                          <td className="num">{a.notasSaida ?? "—"}</td>
                          <td>{resumoPendencias(a)}</td>
                          <td>{quando(a.atualizadaEm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {atual && (
          <section className="detail" aria-labelledby="titulo-detalhe">
            <div className="detail-head">
              <div>
                <span className="ea-kicker">Competência selecionada</span>
                <h2 id="titulo-detalhe">{formatarCompetencia(atual.competencia)}</h2>
                <p className="muted small">
                  Pedida por {atual.criadaPorNome} em {quando(atual.criadaEm)}
                  {atual.periodoInicio !== atual.periodoFim
                    ? ` · no período ${formatarPeriodo(atual.periodoInicio, atual.periodoFim)}`
                    : ""}
                </p>
              </div>
              <SituacaoAuditoria status={atual.status} />
            </div>
            {execucao && (
              <ol className="stage-strip" aria-label="Etapas desta competência">
                {situacaoDasEstacoes(execucao).map((estacao, indice) => (
                  <li key={estacao.agente} className={estacao.visual}>
                    <span className="stage-index" aria-hidden="true">
                      {estacao.visual === "concluido" ? "✓" : estacao.visual === "falhou" ? "!" : indice + 1}
                    </span>
                    <span>
                      <strong>{DEFINICOES_AGENTES.find((d) => d.id === estacao.agente)!.nome}</strong>
                      <span className="muted">{estacao.rotulo}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {falhaDetalhe && !execucao && (
              <p className="notice error app-notice" role="alert">
                Não foi possível carregar a conferência desta competência.
              </p>
            )}
            {execucao ? (
              <PainelTriagem key={execucao.id} execucao={execucao} />
            ) : (
              !falhaDetalhe && (
                <p className="muted" role="status">
                  Carregando a conferência…
                </p>
              )
            )}
          </section>
        )}
      </main>

      <footer className="app-footer">
        <MarcaEalex />
        <span>Inteligência tributária · Conferência e acompanhamento documental</span>
      </footer>

      <DialogoNovaAuditoria
        aberto={dialogoAberto}
        dadosFicticios={ficticio}
        pastaInicial={cliente.pastaOnedrive}
        aoFechar={() => setDialogoAberto(false)}
        aoIniciar={iniciar}
      />
    </>
  );
}
