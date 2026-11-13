"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumoAuditoria, SituacaoFila } from "@/lib/execucoes/tipos";

const INTERVALO_COM_ATIVIDADE_MS = 3000;
const INTERVALO_OCIOSO_MS = 30000;
/** Enquanto houver execução ativa, a tela pede a continuação da fila neste intervalo. */
const INTERVALO_RETOMADA_MS = 20000;
const INTERVALO_MINIMO_RETOMADA_MS = 5000;

export interface EstadoAuditorias {
  auditorias: ResumoAuditoria[];
  fila: SituacaoFila;
  /** true quando a última consulta falhou; a tela continua com os dados anteriores. */
  falha: boolean;
  /** Consulta a lista agora, sem esperar o próximo intervalo. */
  atualizar: () => void;
}

/**
 * Lista de auditorias acompanhada pelo servidor. Consulta mais vezes enquanto
 * há execução ativa e pede a continuação da fila quando há competências
 * aguardando: um período longo pode não caber no tempo de uma única função.
 */
export function useAuditorias(
  iniciais: ResumoAuditoria[],
  filaInicial: SituacaoFila,
  clienteId?: string,
): EstadoAuditorias {
  const [auditorias, setAuditorias] = useState(iniciais);
  const [fila, setFila] = useState(filaInicial);
  const [falha, setFalha] = useState(false);
  const [pedido, setPedido] = useState(0);
  const ultimaRetomada = useRef(0);

  const ativa = fila.naFila + fila.emAndamento > 0;
  const atualizar = useCallback(() => setPedido((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;
    const consultar = async () => {
      if (document.hidden) return;
      try {
        const url = clienteId ? `/api/execucoes?cliente=${clienteId}` : "/api/execucoes";
        const resposta = await fetch(url, { cache: "no-store" });
        if (!resposta.ok) throw new Error();
        const corpo = (await resposta.json()) as { auditorias: ResumoAuditoria[]; fila: SituacaoFila };
        if (cancelado) return;
        setAuditorias(corpo.auditorias);
        setFila(corpo.fila);
        setFalha(false);
      } catch {
        if (!cancelado) setFalha(true);
      }
    };
    // `pedido` muda quando alguém chama atualizar(): a consulta sai na hora.
    if (pedido > 0) void consultar();
    const intervalo = window.setInterval(consultar, ativa ? INTERVALO_COM_ATIVIDADE_MS : INTERVALO_OCIOSO_MS);
    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [ativa, clienteId, pedido]);

  // Retomada da fila. Sem nada em andamento, pede logo; com algo em andamento,
  // pede de tempos em tempos — é o que encerra uma execução que parou no meio.
  const { naFila, emAndamento } = fila;
  useEffect(() => {
    if (naFila + emAndamento === 0) return;
    const retomar = () => {
      if (document.hidden) return;
      const agora = Date.now();
      if (agora - ultimaRetomada.current < INTERVALO_MINIMO_RETOMADA_MS) return;
      ultimaRetomada.current = agora;
      fetch("/api/execucoes/fila", { method: "POST" }).catch(() => undefined);
    };
    if (naFila > 0 && emAndamento === 0) retomar();
    const intervalo = window.setInterval(retomar, INTERVALO_RETOMADA_MS);
    return () => window.clearInterval(intervalo);
  }, [naFila, emAndamento]);

  return { auditorias, fila, falha, atualizar };
}
