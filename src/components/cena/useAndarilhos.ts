"use client";

import { useEffect, useRef, useState } from "react";
import type { EstadoVisual } from "@/lib/execucoes/apresentacao";
import { AGENTES, type AgenteId } from "@/lib/execucoes/tipos";
import {
  acessoDaMesa,
  entradaNaMesa,
  parada,
  PONTOS_DE_INTERESSE,
  rota,
  saidaDaMesa,
  type Ponto,
  type Trecho,
} from "./movimento";

/** Unidades do piso por segundo. */
const VELOCIDADE_PASSEIO = 1.5;

/** O que desenhar para um personagem neste momento. */
export type Quadro =
  | { sentado: true }
  | {
      sentado: false;
      /** Muda a cada trecho; reinicia a animação de deslocamento. */
      chave: number;
      trecho: Trecho;
      /** Duração do trecho em segundos. */
      duracao: number;
      andando: boolean;
    };

type Quadros = Record<AgenteId, Quadro>;

interface Controle {
  fila: Array<{ trecho: Trecho; duracao: number }>;
  atual: { trecho: Trecho; duracao: number; inicio: number } | null;
  temporizador: number | null;
  /** Ponto de interesse reservado enquanto o personagem vai até ele ou está nele. */
  reserva: string | null;
  voltando: boolean;
}

const TODOS_SENTADOS = Object.fromEntries(AGENTES.map((a) => [a, { sentado: true }])) as Quadros;
const entre = (minimo: number, maximo: number) => minimo + Math.random() * (maximo - minimo);

/**
 * Faz os personagens circularem pela sala enquanto a estação deles não está
 * trabalhando. Quando a etapa entra em andamento, o personagem aparece sentado
 * na mesa na mesma hora e fica lá até a etapa terminar. Com "movimento reduzido" ativado no sistema, todos ficam sentados.
 */
export function useAndarilhos(visuais: Record<AgenteId, EstadoVisual>): Quadros {
  const [quadros, setQuadros] = useState<Quadros>(TODOS_SENTADOS);
  const visuaisAtuais = useRef(visuais);
  const controles = useRef<Record<AgenteId, Controle> | null>(null);
  const chave = useRef(0);
  const acoes = useRef<{ sentarAgora: (agente: AgenteId) => void } | null>(null);

  useEffect(() => {
    visuaisAtuais.current = visuais;
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const novoControle = (): Controle => ({
      fila: [],
      atual: null,
      temporizador: null,
      reserva: null,
      voltando: false,
    });
    const estado: Record<AgenteId, Controle> = {
      triagem: novoControle(),
      auditoria: novoControle(),
      relatorio: novoControle(),
      retificacao: novoControle(),
    };
    controles.current = estado;
    const reservados = () => new Set(AGENTES.map((a) => estado[a].reserva).filter(Boolean));

    const mostrar = (agente: AgenteId, quadro: Quadro) =>
      setQuadros((anteriores) => ({ ...anteriores, [agente]: quadro }));
    const limpar = (agente: AgenteId) => {
      const c = estado[agente];
      if (c.temporizador !== null) window.clearTimeout(c.temporizador);
      c.temporizador = null;
    };
    const comDuracao = (trechos: Trecho[], velocidade: number) =>
      trechos.map((trecho) => ({ trecho, duracao: Math.max(trecho.distancia / velocidade, 0.05) }));

    function sentar(agente: AgenteId): void {
      const c = estado[agente];
      c.atual = null;
      c.fila = [];
      c.reserva = null;
      c.voltando = false;
      mostrar(agente, { sentado: true });
      agendar(agente);
    }

    /** Executa o próximo trecho da fila; com a fila vazia, decide o que fazer depois. */
    function avancar(agente: AgenteId): void {
      const c = estado[agente];
      const proximo = c.fila.shift();
      if (!proximo) {
        if (c.voltando) sentar(agente);
        else passear(agente, c.atual?.trecho.para ?? null);
        return;
      }
      c.atual = { ...proximo, inicio: performance.now() };
      mostrar(agente, {
        sentado: false,
        chave: ++chave.current,
        trecho: proximo.trecho,
        duracao: proximo.duracao,
        andando: proximo.trecho.distancia > 0,
      });
      c.temporizador = window.setTimeout(() => avancar(agente), proximo.duracao * 1000);
    }

    /** Monta o caminho de volta à mesa a partir de um ponto das linhas de circulação. */
    function voltarDe(agente: AgenteId, ponto: Ponto, velocidade: number): void {
      const c = estado[agente];
      const indice = AGENTES.indexOf(agente);
      c.reserva = null;
      c.voltando = true;
      c.fila = comDuracao([...rota(ponto, acessoDaMesa(indice)), ...entradaNaMesa(indice)], velocidade);
    }

    /** Escolhe o próximo destino: outro ponto da sala ou a própria mesa. */
    function passear(agente: AgenteId, ponto: Ponto | null): void {
      const c = estado[agente];
      const indice = AGENTES.indexOf(agente);
      if (visuaisAtuais.current[agente] === "trabalhando") {
        sentar(agente);
        return;
      }

      if (ponto && Math.random() < 0.3) {
        voltarDe(agente, ponto, VELOCIDADE_PASSEIO);
        avancar(agente);
        return;
      }
      const ocupados = reservados();
      const livres = PONTOS_DE_INTERESSE.filter(
        (p) => !ocupados.has(p.id) && p.id !== c.reserva && p.id !== `mesa-${indice}`,
      );
      const destino = livres[Math.floor(Math.random() * livres.length)];
      if (!destino) {
        if (ponto) voltarDe(agente, ponto, VELOCIDADE_PASSEIO);
        if (ponto) avancar(agente);
        else agendar(agente);
        return;
      }

      const partida = ponto ? [] : saidaDaMesa(indice);
      const caminho = rota(ponto ?? acessoDaMesa(indice), destino.ponto);
      const chegada = caminho.at(-1) ?? partida.at(-1);
      c.reserva = destino.id;
      c.voltando = false;
      c.fila = [
        ...comDuracao([...partida, ...caminho], VELOCIDADE_PASSEIO),
        {
          trecho: parada(destino.ponto, chegada?.camada ?? "fundo", destino.direcao),
          duracao: entre(2.5, 6),
        },
      ];
      avancar(agente);
    }

    /** Quem está trabalhando fica sentado: interrompe o passeio e põe o personagem na mesa na hora. */
    function sentarAgora(agente: AgenteId): void {
      limpar(agente);
      sentar(agente);
    }

    /** Depois de um tempo sentado, o personagem sai para circular. */
    function agendar(agente: AgenteId, espera = entre(5, 11)): void {
      limpar(agente);
      estado[agente].temporizador = window.setTimeout(() => {
        if (visuaisAtuais.current[agente] === "trabalhando") agendar(agente);
        else passear(agente, null);
      }, espera * 1000);
    }

    acoes.current = { sentarAgora };
    // Saídas escalonadas, para a sala ganhar movimento logo e não todos de uma vez.
    AGENTES.forEach((agente, i) => agendar(agente, 1.2 + i * 1.6 + Math.random()));

    return () => {
      AGENTES.forEach(limpar);
      controles.current = null;
      acoes.current = null;
    };
  }, []);

  // Quem entra em andamento senta na hora: agente trabalhando não fica em pé.
  const trabalhando = AGENTES.filter((a) => visuais[a] === "trabalhando").join(",");
  useEffect(() => {
    for (const agente of AGENTES) {
      if (visuaisAtuais.current[agente] === "trabalhando") acoes.current?.sentarAgora(agente);
    }
  }, [trabalhando]);

  return quadros;
}
