"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatarCompetencia } from "@/lib/competencia";
import { SITUACAO_DA_AUDITORIA } from "@/lib/execucoes/apresentacao";
import type { ResumoAuditoria, StatusExecucao } from "@/lib/execucoes/tipos";

const LIMITE_DE_LINHAS = 300;
const ORDEM_STATUS: StatusExecucao[] = [
  "em_andamento",
  "na_fila",
  "triagem_concluida",
  "triagem_com_pendencias",
  "falhou",
];

export function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SituacaoAuditoria({ status }: { status: StatusExecucao }) {
  const { rotulo, tom } = SITUACAO_DA_AUDITORIA[status];
  return <span className={`pill situacao-${tom}`}>{rotulo}</span>;
}

/** Texto da coluna de pendências: só as impeditivas travam a auditoria. */
export function resumoPendencias(a: ResumoAuditoria): string {
  if (a.status === "falhou") return "—";
  if (a.pendenciasImpeditivas === null) return "—";
  const partes: string[] = [];
  if (a.pendenciasImpeditivas > 0) {
    partes.push(`${a.pendenciasImpeditivas} ${a.pendenciasImpeditivas === 1 ? "impeditiva" : "impeditivas"}`);
  }
  if (a.pendenciasAlerta) partes.push(`${a.pendenciasAlerta} ${a.pendenciasAlerta === 1 ? "alerta" : "alertas"}`);
  return partes.length > 0 ? partes.join(" · ") : "Nenhuma";
}

/**
 * Auditorias de todos os clientes: uma linha por cliente e competência, com a
 * situação da execução mais recente. O nome do cliente abre a tela dele já na
 * competência da linha.
 */
export function TabelaAuditorias({ auditorias }: { auditorias: ResumoAuditoria[] }) {
  const [cliente, setCliente] = useState("");
  const [ano, setAno] = useState("");
  const [status, setStatus] = useState("");

  const clientes = useMemo(() => {
    const porId = new Map(auditorias.map((a) => [a.clienteId, a.clienteNome]));
    return [...porId].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [auditorias]);
  const anos = useMemo(
    () => [...new Set(auditorias.map((a) => a.competencia.slice(0, 4)))].sort().reverse(),
    [auditorias],
  );
  const situacoes = ORDEM_STATUS.filter((s) => auditorias.some((a) => a.status === s));

  const filtradas = auditorias.filter(
    (a) =>
      (!cliente || a.clienteId === cliente) &&
      (!ano || a.competencia.startsWith(ano)) &&
      (!status || a.status === status),
  );
  const visiveis = filtradas.slice(0, LIMITE_DE_LINHAS);

  return (
    <>
      <div className="filters" role="group" aria-label="Filtrar auditorias">
        <label>
          Cliente
          <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ano
          <select value={ano} onChange={(e) => setAno(e.target.value)}>
            <option value="">Todos</option>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Situação
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {situacoes.map((s) => (
              <option key={s} value={s}>
                {SITUACAO_DA_AUDITORIA[s].rotulo}
              </option>
            ))}
          </select>
        </label>
        <p className="filters-count" role="status">
          {filtradas.length} {filtradas.length === 1 ? "competência" : "competências"}
          {filtradas.length !== auditorias.length ? ` de ${auditorias.length}` : ""}
        </p>
      </div>

      {filtradas.length === 0 ? (
        <p className="card empty-filter">Nenhuma auditoria corresponde aos filtros.</p>
      ) : (
        <div
          className="card table-wrap audits"
          tabIndex={0}
          role="region"
          aria-label="Auditorias por cliente e competência; role para ver todas as colunas"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
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
              {visiveis.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <Link className="row-link" href={`/clientes/${a.clienteId}?competencia=${a.competencia}`}>
                      {a.clienteNome}
                    </Link>
                  </th>
                  <td>{formatarCompetencia(a.competencia)}</td>
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
      {filtradas.length > visiveis.length && (
        <p className="muted small filters-more">
          Mostrando as primeiras {visiveis.length} de {filtradas.length}. Use os filtros para ver as demais.
        </p>
      )}
    </>
  );
}
