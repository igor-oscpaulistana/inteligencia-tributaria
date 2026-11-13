"use client";

import { useEffect, useState } from "react";
import { DEFINICOES_AGENTES } from "@/lib/agentes/definicoes";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import { formatarCompetencia, formatarPeriodo } from "@/lib/competencia";
import { execucaoAtiva, resumoDaExecucao, situacaoDasEstacoes } from "@/lib/execucoes/apresentacao";
import {
  STATUS_ATIVOS,
  type AgenteId,
  type Execucao,
  type ResumoAuditoria,
  type SituacaoFila,
} from "@/lib/execucoes/tipos";
import { Cabecalho } from "./Cabecalho";
import { CenaEscritorio } from "./CenaEscritorio";
import { DialogoNovaAuditoria } from "./DialogoNovaAuditoria";
import { MarcaEalex } from "./MarcaEalex";
import { TabelaAuditorias } from "./TabelaAuditorias";
import { useAuditorias } from "./useAuditorias";

export interface AmbientePainel {
  fonte: TipoFonte;
  avisos: string[];
}

interface Props {
  nomeUsuario: string;
  /** Execução que o escritório mostra ao abrir: a ativa ou, sem ela, a mais recente. */
  execucaoInicial: Execucao | null;
  auditoriasIniciais: ResumoAuditoria[];
  filaInicial: SituacaoFila;
  ambiente: AmbientePainel;
  /** Ação de saída; ausente no modo de demonstração. */
  sair?: () => Promise<void>;
}

const INTERVALO_CONSULTA_MS = 1000;

function horario(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Execução que a sala deve mostrar entre as da lista: a que está em andamento
 * ou, sem ela, a próxima da fila. Sem nenhuma ativa, a sala fica como está.
 */
function escolherFoco(auditorias: ResumoAuditoria[]): ResumoAuditoria | null {
  const emAndamento = auditorias.find((a) => a.status === "em_andamento");
  if (emAndamento) return emAndamento;
  const fila = auditorias
    .filter((a) => a.status === "na_fila")
    .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.competencia.localeCompare(b.competencia));
  return fila[0] ?? null;
}

export function Escritorio({
  nomeUsuario,
  execucaoInicial,
  auditoriasIniciais,
  filaInicial,
  ambiente,
  sair,
}: Props) {
  const [execucao, setExecucao] = useState(execucaoInicial);
  const { auditorias, falha: falhaLista, atualizar } = useAuditorias(auditoriasIniciais, filaInicial);
  const [selecionada, setSelecionada] = useState<AgenteId>("triagem");
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [falhaConsulta, setFalhaConsulta] = useState(false);

  const ativa = execucaoAtiva(execucao);
  const execucaoId = execucao?.id ?? null;
  const estacoes = situacaoDasEstacoes(execucao);
  const emAtividade = estacoes.find((e) => e.visual === "trabalhando");
  const concluidas = execucao?.etapas.filter((e) => e.estado === "concluida").length ?? 0;
  const ficticio = ambiente.fonte === "ficticia";

  // Enquanto a execução está ativa, a tela acompanha o que foi registrado no servidor.
  useEffect(() => {
    if (!ativa || !execucaoId) return;
    let cancelado = false;
    const consultar = async () => {
      try {
        const resposta = await fetch(`/api/execucoes/${execucaoId}`, { cache: "no-store" });
        if (!resposta.ok) throw new Error();
        const corpo = (await resposta.json()) as { execucao: Execucao };
        if (!cancelado) {
          setExecucao(corpo.execucao);
          setFalhaConsulta(false);
          // Terminou: a lista é consultada na hora, para a sala passar à próxima da fila.
          if (!STATUS_ATIVOS.includes(corpo.execucao.status)) atualizar();
        }
      } catch {
        if (!cancelado) setFalhaConsulta(true);
      }
    };
    const intervalo = window.setInterval(consultar, INTERVALO_CONSULTA_MS);
    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [ativa, execucaoId, atualizar]);

  // A sala acompanha a fila: quando a execução em foco termina e há outra
  // ativa na lista, passa a mostrar essa.
  const desejado = escolherFoco(auditorias);
  const trocarFoco =
    desejado !== null &&
    (!ativa || (execucao?.status === "na_fila" && desejado.status === "em_andamento"));
  const proximoFocoId = trocarFoco ? desejado.id : null;
  useEffect(() => {
    if (!proximoFocoId || proximoFocoId === execucaoId) return;
    let cancelado = false;
    fetch(`/api/execucoes/${proximoFocoId}`, { cache: "no-store" })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { execucao: Execucao } | null) => {
        if (!cancelado && corpo) setExecucao(corpo.execucao);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [proximoFocoId, execucaoId]);

  async function iniciar(pasta: string, competenciaInicial: string, competenciaFinal: string): Promise<string | null> {
    try {
      const resposta = await fetch("/api/execucoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pasta, competenciaInicial, competenciaFinal }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) return corpo.erro ?? "Não foi possível iniciar a auditoria.";
      // Sem nada em andamento, a sala já mostra a primeira competência do pedido.
      if (!ativa) setExecucao(corpo.execucao);
      setSelecionada("triagem");
      setDialogoAberto(false);
      atualizar();
      return null;
    } catch {
      return "Sem conexão com o servidor. Tente novamente.";
    }
  }

  // Andamento do pedido (lote) da execução em foco, quando ele tem mais de uma competência.
  const doLote = execucao ? auditorias.filter((a) => a.loteId === execucao.loteId) : [];
  const encerradasDoLote = doLote.filter((a) => !STATUS_ATIVOS.includes(a.status)).length;

  const definicao = DEFINICOES_AGENTES.find((d) => d.id === selecionada)!;
  const estacao = estacoes.find((e) => e.agente === selecionada)!;
  const etapa = execucao?.etapas.find((e) => e.agente === selecionada);

  return (
    <>
      <a className="skip-link" href="#titulo-auditorias">Ir para as auditorias</a>
      <Cabecalho nomeUsuario={nomeUsuario} dadosFicticios={ficticio} sair={sair} />

      <main>
        <div className="intro">
          <div>
            <h1><MarcaEalex /></h1>
            <p className="muted">Auditoria de PIS e COFINS sobre notas de saída</p>
          </div>
          <button className="primary" type="button" onClick={() => setDialogoAberto(true)}>
            + Nova auditoria
          </button>
        </div>

        {ambiente.avisos.length > 0 && (
          <div className="notice app-notice" role="status">
            <strong>Configuração do ambiente</strong>
            <ul>
              {ambiente.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          </div>
        )}
        {(falhaConsulta || falhaLista) && (
          <p className="notice error app-notice" role="alert">
            Não foi possível atualizar o andamento. Nova tentativa em instantes.
          </p>
        )}

        <div className="office-layout">
          <section className="office" aria-label="Estações de trabalho">
            <div className="office-head">
              <strong>Sala de operações</strong>
              <span className="office-status" role="status">
                <span className={`dot ${emAtividade ? "live" : ""}`} />
                {emAtividade
                  ? `${DEFINICOES_AGENTES.find((d) => d.id === emAtividade.agente)!.nome} em atividade`
                  : "Equipe disponível"}
              </span>
            </div>
            <CenaEscritorio
              estacoes={estacoes}
              selecionada={selecionada}
              aoSelecionar={setSelecionada}
            />
            <div className="station-list" role="group" aria-label="Selecionar estação">
              {DEFINICOES_AGENTES.map((d, indice) => {
                const situacao = estacoes.find((e) => e.agente === d.id)!;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`station ${situacao.visual}`}
                    aria-pressed={selecionada === d.id}
                    onClick={() => setSelecionada(d.id)}
                  >
                    <span className="station-index" style={{ background: d.cor }} aria-hidden="true">
                      {indice + 1}
                    </span>
                    <span>
                      {d.nome}
                      <span className="station-status">{situacao.rotulo}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="activity" aria-label="Andamento da auditoria">
            <h3>Atividade da equipe</h3>
            <p className="muted small" role="status">
              {resumoDaExecucao(execucao)}
            </p>
            <p className="run-title small">
              {execucao
                ? `${execucao.clienteNome} · ${formatarCompetencia(execucao.competencia)}`
                : "Escolha um cliente e um período para começar."}
            </p>
            {execucao && doLote.length > 1 && (
              <p className="muted small lote-progress" role="status">
                Período {formatarPeriodo(execucao.periodoInicio, execucao.periodoFim)} · {encerradasDoLote} de{" "}
                {doLote.length} competências conferidas
              </p>
            )}
            <progress className="progress" value={concluidas} max={4} aria-label="Etapas concluídas" />
            <ol className="steps">
              {DEFINICOES_AGENTES.map((d, indice) => {
                const situacao = estacoes.find((e) => e.agente === d.id)!;
                return (
                  <li key={d.id} className={situacao.visual}>
                    <span className="step-icon" aria-hidden="true">
                      {situacao.visual === "concluido" ? "✓" : situacao.visual === "falhou" ? "!" : indice + 1}
                    </span>
                    <div>
                      <strong>{d.nome}</strong>
                      <span className="muted">
                        {situacao.visual === "trabalhando" || situacao.visual === "falhou"
                          ? (situacao.tarefa ?? situacao.rotulo)
                          : situacao.rotulo}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="agent-detail" aria-live="polite">
              <strong>Estação {definicao.nome}</strong>
              {definicao.descricao}
              <dl>
                <dt>Situação</dt>
                <dd>{estacao.rotulo}</dd>
                <dt>Tarefa atual</dt>
                <dd>
                  {estacao.visual === "aguardando_aprovacao"
                    ? "Só inicia depois que um analista aprovar o relatório."
                    : (estacao.tarefa ?? (execucao ? definicao.tarefaPadrao : "Nenhuma tarefa em andamento"))}
                </dd>
                {estacao.progressoTotal !== null && estacao.progressoTotal > 0 && (
                  <>
                    <dt>Andamento</dt>
                    <dd>
                      {estacao.progressoAtual} de {estacao.progressoTotal} arquivos
                    </dd>
                  </>
                )}
                {etapa?.iniciadaEm && (
                  <>
                    <dt>Início</dt>
                    <dd>{horario(etapa.iniciadaEm)}</dd>
                  </>
                )}
                {etapa?.concluidaEm && (
                  <>
                    <dt>Término</dt>
                    <dd>{horario(etapa.concluidaEm)}</dd>
                  </>
                )}
              </dl>
              {estacao.progressoTotal !== null && estacao.progressoTotal > 0 && (
                <progress
                  className="progress"
                  value={estacao.progressoAtual}
                  max={estacao.progressoTotal}
                  aria-label={`Andamento da estação ${definicao.nome}`}
                />
              )}
            </div>
          </aside>
        </div>

        <section className="report" aria-labelledby="titulo-auditorias">
          <div className="section-head">
            <div>
              <span className="ea-kicker">Clientes e competências</span>
              <h2 id="titulo-auditorias" tabIndex={-1}>
                Auditorias
              </h2>
              <p className="muted small">
                Situação mais recente de cada competência. Clique no cliente para abrir a conferência completa.
              </p>
            </div>
          </div>
          {auditorias.length === 0 ? (
            <div className="card empty">
              <span className="empty-symbol" aria-hidden="true">
                ▤
              </span>
              <h3>Seu próximo passo começa aqui</h3>
              <p>
                Nenhuma auditoria foi iniciada. Use “Nova auditoria” para escolher o cliente e o período. Cada
                competência auditada aparece nesta lista.
              </p>
            </div>
          ) : (
            <TabelaAuditorias auditorias={auditorias} />
          )}
        </section>
      </main>

      <footer className="app-footer">
        <MarcaEalex />
        <span>Inteligência tributária · Conferência e acompanhamento documental</span>
      </footer>

      <DialogoNovaAuditoria
        aberto={dialogoAberto}
        dadosFicticios={ficticio}
        aoFechar={() => setDialogoAberto(false)}
        aoIniciar={iniciar}
      />
    </>
  );
}
