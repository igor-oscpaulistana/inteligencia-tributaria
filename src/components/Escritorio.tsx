"use client";

import { useEffect, useState } from "react";
import { DEFINICOES_AGENTES } from "@/lib/agentes/definicoes";
import type { TipoFonte } from "@/lib/arquivos/tipos";
import { formatarCompetencia } from "@/lib/competencia";
import { execucaoAtiva, resumoDaExecucao, situacaoDasEstacoes } from "@/lib/execucoes/apresentacao";
import type { AgenteId, Execucao } from "@/lib/execucoes/tipos";
import { CenaEscritorio } from "./CenaEscritorio";
import { DialogoNovaAuditoria, type ClienteDoPainel } from "./DialogoNovaAuditoria";
import { PainelTriagem } from "./PainelTriagem";

export interface AmbientePainel {
  fonte: TipoFonte;
  cenaSpline: string | null;
  avisos: string[];
}

interface Props {
  nomeUsuario: string;
  clientes: ClienteDoPainel[];
  execucaoInicial: Execucao | null;
  ambiente: AmbientePainel;
  /** Ação de saída; ausente no modo de demonstração. */
  sair?: () => Promise<void>;
}

const INTERVALO_CONSULTA_MS = 1000;

function horario(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Escritorio({ nomeUsuario, clientes, execucaoInicial, ambiente, sair }: Props) {
  const [execucao, setExecucao] = useState(execucaoInicial);
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
  }, [ativa, execucaoId]);

  async function iniciar(clienteId: string, competencia: string): Promise<string | null> {
    try {
      const resposta = await fetch("/api/execucoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clienteId, competencia }),
      });
      const corpo = await resposta.json();
      if (resposta.status === 409 && corpo.execucaoId) {
        // Já há uma auditoria em andamento para essa competência: acompanha a existente.
        const existente = await fetch(`/api/execucoes/${corpo.execucaoId}`, { cache: "no-store" });
        if (existente.ok) setExecucao((await existente.json()).execucao);
        setSelecionada("triagem");
        setDialogoAberto(false);
        return null;
      }
      if (!resposta.ok) return corpo.erro ?? "Não foi possível iniciar a auditoria.";
      setExecucao(corpo.execucao);
      setSelecionada("triagem");
      setDialogoAberto(false);
      return null;
    } catch {
      return "Sem conexão com o servidor. Tente novamente.";
    }
  }

  const definicao = DEFINICOES_AGENTES.find((d) => d.id === selecionada)!;
  const estacao = estacoes.find((e) => e.agente === selecionada)!;
  const etapa = execucao?.etapas.find((e) => e.agente === selecionada);

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ▦
            </span>
            Inteligência Tributária
          </div>
          <div className="top-side">
            {ficticio && <span className="demo">Dados demonstrativos</span>}
            <span className="user">{nomeUsuario}</span>
            {sair && (
              <form action={sair}>
                <button className="secondary" type="submit">
                  Sair
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main>
        <div className="intro">
          <div>
            <h1>Escritório virtual</h1>
            <p className="muted">Auditoria de PIS e COFINS sobre notas de saída</p>
          </div>
          <button className="primary" type="button" onClick={() => setDialogoAberto(true)} disabled={ativa}>
            + Nova auditoria
          </button>
        </div>

        {ambiente.avisos.length > 0 && (
          <div className="notice" role="status">
            <strong>Configuração do ambiente</strong>
            <ul>
              {ambiente.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          </div>
        )}
        {falhaConsulta && (
          <p className="notice error" role="alert">
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
              urlCena={ambiente.cenaSpline}
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
                : "Escolha um cliente e uma competência para começar."}
            </p>
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

        {execucao ? (
          <PainelTriagem key={execucao.id} execucao={execucao} />
        ) : (
          <section className="report" aria-labelledby="titulo-triagem">
            <div className="section-head">
              <h2 id="titulo-triagem">Triagem dos arquivos</h2>
            </div>
            <div className="card empty">
              Nenhuma auditoria foi iniciada. Use “Nova auditoria” para escolher o cliente e a competência.
            </div>
          </section>
        )}
      </main>

      <DialogoNovaAuditoria
        aberto={dialogoAberto}
        clientes={clientes}
        dadosFicticios={ficticio}
        aoFechar={() => setDialogoAberto(false)}
        aoIniciar={iniciar}
      />
    </>
  );
}
