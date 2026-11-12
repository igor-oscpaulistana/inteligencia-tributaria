"use client";

import { useSyncExternalStore } from "react";

/** A cena só precisa acompanhar a hora em passos de alguns minutos. */
const PASSO_MINUTOS = 5;

function horaDoRelogio(): number {
  const agora = new Date();
  return agora.getHours() + (Math.floor(agora.getMinutes() / PASSO_MINUTOS) * PASSO_MINUTOS) / 60;
}

function assinar(aoMudar: () => void): () => void {
  const intervalo = window.setInterval(aoMudar, 60_000);
  return () => window.clearInterval(intervalo);
}

/**
 * Hora local do computador de quem está usando o sistema, em fração (14,5 = 14h30).
 * No servidor é null: o servidor não sabe o fuso de quem acessa.
 */
export function useHoraLocal(): number | null {
  return useSyncExternalStore(assinar, horaDoRelogio, () => null);
}
