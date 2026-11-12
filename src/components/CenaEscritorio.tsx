"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { DEFINICOES_AGENTES, type DefinicaoAgente } from "@/lib/agentes/definicoes";
import type { EstadoVisual, SituacaoEstacao } from "@/lib/execucoes/apresentacao";
import type { AgenteId } from "@/lib/execucoes/tipos";
import { Caixa, FaceX, FaceY, FaceZ, linha, ponto, tom, type Vetor } from "./cena/iso";
import { origemDaEstacao, type Camada } from "./cena/movimento";
import { useAndarilhos, type Quadro } from "./cena/useAndarilhos";

interface Props {
  estacoes: SituacaoEstacao[];
  selecionada: AgenteId;
  aoSelecionar: (agente: AgenteId) => void;
}

/** Sala: largura em x, profundidade em y e altura das paredes. */
const SALA = { x: 12.4, y: 4.5, h: 3.3 };
const MARGEM = 14;
const VISTA = {
  x: ponto(0, SALA.y)[0] - MARGEM,
  y: ponto(0, 0, SALA.h)[1] - MARGEM,
  largura: ponto(SALA.x, 0)[0] - ponto(0, SALA.y)[0] + 2 * MARGEM,
  altura: ponto(SALA.x, SALA.y)[1] - ponto(0, 0, SALA.h)[1] + 2 * MARGEM,
};

interface Personagem {
  pele: string;
  cabelo: string;
  camisa: string;
  penteado: "curto" | "coque" | "grisalho" | "cacheado";
  oculos: boolean;
  barba: boolean;
  enfeite: "caneca" | "planta" | "livros" | "flor";
}

const PERSONAGENS: Record<AgenteId, Personagem> = {
  triagem: {
    pele: "#e9b990",
    cabelo: "#5b3a26",
    camisa: "#3f7fd0",
    penteado: "curto",
    oculos: false,
    barba: false,
    enfeite: "caneca",
  },
  auditoria: {
    pele: "#d8a27b",
    cabelo: "#2b1d18",
    camisa: "#2f9e80",
    penteado: "coque",
    oculos: true,
    barba: false,
    enfeite: "planta",
  },
  relatorio: {
    pele: "#eec5a1",
    cabelo: "#9a9da6",
    camisa: "#d9962f",
    penteado: "grisalho",
    oculos: true,
    barba: true,
    enfeite: "livros",
  },
  retificacao: {
    pele: "#a9704d",
    cabelo: "#2a1a13",
    camisa: "#8a6fd6",
    penteado: "cacheado",
    oculos: false,
    barba: false,
    enfeite: "flor",
  },
};

const OLHOS = "#1b2233";
const MADEIRA = "#8b5a3c";

function Cabeca({ p }: { p: Personagem }) {
  // A face voltada para a câmera fica no plano y = 1.04.
  const frente = 1.04;
  return (
    <g className="iso-cabeca">
      <Caixa o={[0.6, 0.32, 1.62]} t={[0.8, 0.72, 0.72]} cor={p.pele} />
      {p.penteado === "cacheado" && (
        <>
          <Caixa o={[1.4, 0.3, 1.7]} t={[0.14, 0.72, 0.62]} cor={p.cabelo} />
          <FaceY y={frente + 0.001} x={[0.6, 0.72]} z={[1.7, 2.34]} cor={p.cabelo} />
        </>
      )}
      {/* Franja e lateral do cabelo */}
      <FaceY y={frente + 0.001} x={[0.6, 1.4]} z={[2.14, 2.34]} cor={p.cabelo} />
      <FaceX x={1.401} y={[0.32, 1.04]} z={[2.04, 2.34]} cor={tom(p.cabelo, 0.78)} />
      {p.barba && (
        <>
          <FaceY y={frente + 0.001} x={[0.6, 1.4]} z={[1.62, 1.84]} cor={p.cabelo} />
          <FaceX x={1.401} y={[0.6, 1.04]} z={[1.62, 1.84]} cor={tom(p.cabelo, 0.78)} />
        </>
      )}
      {/* Olhos e boca */}
      <FaceY y={frente + 0.002} x={[0.76, 0.9]} z={[1.93, 2.07]} cor={OLHOS} />
      <FaceY y={frente + 0.002} x={[1.1, 1.24]} z={[1.93, 2.07]} cor={OLHOS} />
      <FaceY y={frente + 0.002} x={[0.92, 1.08]} z={[1.72, 1.77]} cor={tom(p.pele, 0.62)} />
      {p.oculos && (
        <polyline
          points={linha(
            [0.7, frente, 2.1],
            [0.7, frente, 1.9],
            [0.96, frente, 1.9],
            [0.96, frente, 2.1],
            [0.7, frente, 2.1],
            [0.96, frente, 2.02],
            [1.04, frente, 2.02],
            [1.04, frente, 2.1],
            [1.3, frente, 2.1],
            [1.3, frente, 1.9],
            [1.04, frente, 1.9],
            [1.04, frente, 2.02],
          )}
          fill="none"
          stroke="#111827"
          strokeWidth={1.1}
        />
      )}
      {/* Cabelo no topo da cabeça */}
      {p.penteado === "cacheado" ? (
        <Caixa o={[0.5, 0.22, 2.28]} t={[1.0, 0.9, 0.32]} cor={p.cabelo} />
      ) : (
        <Caixa o={[0.57, 0.29, 2.3]} t={[0.86, 0.78, 0.14]} cor={p.cabelo} />
      )}
      {p.penteado === "coque" && <Caixa o={[0.82, 0.32, 2.44]} t={[0.36, 0.36, 0.26]} cor={p.cabelo} />}
    </g>
  );
}

function Enfeite({ tipo }: { tipo: Personagem["enfeite"] }) {
  const z = 1.05;
  switch (tipo) {
    case "caneca":
      return <Caixa o={[1.68, 1.42, z]} t={[0.17, 0.17, 0.2]} cor="#f1f4f9" />;
    case "planta":
      return (
        <>
          <Caixa o={[1.66, 1.4, z]} t={[0.2, 0.2, 0.14]} cor="#c8774a" />
          <Caixa o={[1.62, 1.36, z + 0.14]} t={[0.28, 0.28, 0.24]} cor="#36a865" />
        </>
      );
    case "livros":
      return (
        <>
          <Caixa o={[1.56, 1.4, z]} t={[0.34, 0.26, 0.07]} cor="#c0503f" />
          <Caixa o={[1.58, 1.42, z + 0.07]} t={[0.3, 0.22, 0.07]} cor="#e7c35a" />
        </>
      );
    case "flor":
      return (
        <>
          <Caixa o={[1.68, 1.42, z]} t={[0.16, 0.16, 0.16]} cor="#eef1f6" />
          <Caixa o={[1.73, 1.47, z + 0.16]} t={[0.06, 0.06, 0.2]} cor="#3d9a5d" />
          <Caixa o={[1.66, 1.4, z + 0.34]} t={[0.2, 0.2, 0.12]} cor="#d86fc6" />
        </>
      );
  }
}

/** Painel translúcido sobre a mesa; o conteúdo acompanha o estado da estação. */
function Tela({ visual, cor }: { visual: EstadoVisual; cor: string }) {
  const y = 1.82;
  return (
    <g className="iso-tela">
      <Caixa o={[0.92, 1.74, 1.05]} t={[0.16, 0.1, 0.17]} cor="#1c2436" />
      <polygon
        points={linha([0.48, y, 1.22], [1.52, y, 1.22], [1.52, y, 1.86], [0.48, y, 1.86])}
        fill={cor}
        fillOpacity={visual === "aguardando_aprovacao" ? 0.1 : 0.22}
        stroke={cor}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {visual === "ocioso" && (
        <>
          <FaceY y={y} x={[0.6, 1.2]} z={[1.6, 1.66]} cor={cor} opacidade={0.6} />
          <FaceY y={y} x={[0.6, 1.0]} z={[1.44, 1.5]} cor={cor} opacidade={0.4} />
        </>
      )}
      {visual === "trabalhando" &&
        [0.42, 0.26, 0.5, 0.34, 0.46].map((altura, i) => (
          <FaceY
            key={i}
            className="iso-barra"
            y={y}
            x={[0.58 + i * 0.18, 0.7 + i * 0.18]}
            z={[1.28, 1.28 + altura]}
            cor="#ffffff"
            opacidade={0.92}
          />
        ))}
      {visual === "concluido" && (
        <polyline
          points={linha([0.7, y, 1.56], [0.9, y, 1.38], [1.3, y, 1.72])}
          fill="none"
          stroke="#8dfcc4"
          strokeWidth={3.2}
          strokeLinecap="square"
        />
      )}
      {visual === "falhou" && (
        <g fill="none" stroke="#ff9d94" strokeWidth={3.2} strokeLinecap="square">
          <polyline points={linha([0.76, y, 1.72], [1.24, y, 1.36])} />
          <polyline points={linha([0.76, y, 1.36], [1.24, y, 1.72])} />
        </g>
      )}
      {visual === "aguardando_aprovacao" && (
        <>
          <polyline
            points={linha([0.9, y, 1.54], [0.9, y, 1.7], [1.1, y, 1.7], [1.1, y, 1.54])}
            fill="none"
            stroke={cor}
            strokeWidth={2}
          />
          <FaceY y={y} x={[0.84, 1.16]} z={[1.34, 1.56]} cor={cor} opacidade={0.9} />
        </>
      )}
    </g>
  );
}

/** Balão acima da cabeça, desenhado no plano da tela. */
function Balao({ visual, cor, ancora }: { visual: EstadoVisual; cor: string; ancora: Vetor }) {
  if (visual === "ocioso") return null;
  const [x, y] = ponto(...ancora);
  return (
    // O deslocamento fica no grupo externo: a animação CSS do balão substituiria o atributo.
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <g className="iso-balao">
        <path
          d="M-14 -22 h28 v19 h-10 l-4 5 l-4 -5 h-10 z"
          fill="#ffffff"
          stroke="#0a1224"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        {visual === "trabalhando" &&
          [-8, -2, 4].map((dx, i) => (
            <rect
              key={dx}
              className="iso-ponto"
              style={{ animationDelay: `${i * 0.18}s` }}
              x={dx}
              y={-14.5}
              width={4}
              height={4}
              fill="#1e3a6e"
            />
          ))}
        {visual === "concluido" && (
          <polyline
            points="-7,-12 -2,-7.5 7,-17"
            fill="none"
            stroke="#12925f"
            strokeWidth={3}
            strokeLinecap="square"
          />
        )}
        {visual === "falhou" && (
          <>
            <rect x={-1.6} y={-19} width={3.2} height={8.5} fill="#c8352b" />
            <rect x={-1.6} y={-8.6} width={3.2} height={3.2} fill="#c8352b" />
          </>
        )}
        {visual === "aguardando_aprovacao" && (
          <>
            <path
              d="M-3.5 -13 v-2.6 a3.5 3.5 0 0 1 7 0 v2.6"
              fill="none"
              stroke={tom(cor, 0.62)}
              strokeWidth={2}
            />
            <rect x={-5.5} y={-13} width={11} height={8} rx={1} fill={tom(cor, 0.62)} />
          </>
        )}
      </g>
    </g>
  );
}

interface PropsEstacao {
  definicao: DefinicaoAgente;
  indice: number;
  visual: EstadoVisual;
}

function grupoDaEstacao(definicao: DefinicaoAgente, indice: number, visual: EstadoVisual) {
  const origem = origemDaEstacao(indice);
  const [tx, ty] = ponto(origem.x, origem.y);
  return {
    className: `iso-estacao ${visual}`,
    transform: `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`,
    style: { "--cor-estacao": definicao.cor } as CSSProperties,
  };
}

/** Parte da estação que fica atrás de quem está na mesa: piso e cadeira. */
function EstacaoFundo({ definicao, indice, visual, selecionada }: PropsEstacao & { selecionada: boolean }) {
  return (
    <g {...grupoDaEstacao(definicao, indice, visual)}>
      <FaceZ
        className="iso-piso"
        x={[-0.18, 2.18]}
        y={[-0.12, 2.5]}
        cor={definicao.cor}
        opacidade={selecionada ? 0.26 : 0.1}
        bordaCor={selecionada ? definicao.cor : undefined}
      />
      <Caixa o={[0.55, 0.25, 0.5]} t={[0.9, 0.75, 0.14]} cor="#2a3653" />
      <Caixa o={[0.55, 0.05, 0.5]} t={[0.9, 0.2, 1.3]} cor="#2a3653" />
    </g>
  );
}

/** Mesa, tela e, quando ele não saiu para circular, o personagem sentado. */
function EstacaoFrente({ definicao, indice, visual, ausente }: PropsEstacao & { ausente: boolean }) {
  const p = PERSONAGENS[definicao.id];
  const [rx, ry] = ponto(0.16, 2.131, 0.62);
  const manga = tom(p.camisa, 0.86);

  return (
    <g {...grupoDaEstacao(definicao, indice, visual)}>
      {/* Tronco e cabeça ficam atrás da mesa */}
      {!ausente && (
        <g className="iso-personagem">
          <Caixa o={[0.66, 0.42, 0.64]} t={[0.68, 0.42, 0.98]} cor={p.camisa} />
          <Cabeca p={p} />
        </g>
      )}

      {/* Mesa */}
      <Caixa o={[1.84, 1.3, 0]} t={[0.1, 0.83, 0.95]} cor={tom(MADEIRA, 0.72)} />
      <Caixa o={[0.06, 2.03, 0]} t={[1.88, 0.1, 0.95]} cor={tom(MADEIRA, 0.8)} />
      <Caixa o={[0, 1.25, 0.95]} t={[2.0, 0.9, 0.1]} cor={MADEIRA} />
      <FaceY className="iso-led" y={2.131} x={[0.1, 1.9]} z={[0.8, 0.88]} cor={definicao.cor} />
      <text
        transform={`matrix(1 0.5 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)})`}
        fontFamily="ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace"
        fontSize={7.4}
        fontWeight={700}
        letterSpacing={0.4}
        fill={definicao.cor}
      >
        {indice + 1} {definicao.nome.toUpperCase()}
      </text>

      {/* Teclado, braços e objetos sobre a mesa */}
      <Caixa o={[0.62, 1.34, 1.05]} t={[0.76, 0.3, 0.04]} cor="#222b3d" />
      {!ausente && (
        <g className="iso-personagem">
          <g className="iso-braco-e">
            <Caixa o={[0.5, 0.6, 1.12]} t={[0.16, 0.74, 0.16]} cor={manga} />
            <Caixa o={[0.5, 1.34, 1.12]} t={[0.16, 0.12, 0.16]} cor={p.pele} />
          </g>
          <g className="iso-braco-d">
            <Caixa o={[1.34, 0.6, 1.12]} t={[0.16, 0.74, 0.16]} cor={manga} />
            <Caixa o={[1.34, 1.34, 1.12]} t={[0.16, 0.12, 0.16]} cor={p.pele} />
          </g>
        </g>
      )}
      <Enfeite tipo={p.enfeite} />
      <Tela visual={visual} cor={definicao.cor} />
      {!ausente && <Balao visual={visual} cor={definicao.cor} ancora={[1.0, 0.68, 3.05]} />}
    </g>
  );
}

const CALCA = "#27324d";

/**
 * Personagem em pé, circulando pela sala. O deslocamento do trecho é uma
 * animação CSS entre os dois pontos; trocar a chave reinicia a animação.
 */
function Andarilho({
  agente,
  quadro,
  visual,
  cor,
}: {
  agente: AgenteId;
  quadro: Extract<Quadro, { sentado: false }>;
  visual: EstadoVisual;
  cor: string;
}) {
  const p = PERSONAGENS[agente];
  const { trecho, duracao, andando } = quadro;
  const [x0, y0] = ponto(trecho.de[0], trecho.de[1]);
  const [x1, y1] = ponto(trecho.para[0], trecho.para[1]);
  // O corpo é desenhado em torno dos pés. "lado" é o eixo dos ombros e "olhar",
  // o eixo para onde o personagem está virado.
  const olhaNoEixoX = trecho.direcao === "+x" || trecho.direcao === "-x";
  const deFrente = trecho.direcao === "+x" || trecho.direcao === "+y";
  const manga = tom(p.camisa, 0.86);
  const cabeloEscuro = tom(p.cabelo, 0.78);

  const caixa = (
    lado: number,
    olhar: number,
    z: number,
    largura: number,
    fundura: number,
    altura: number,
    corDaCaixa: string,
    className?: string,
  ) => (
    <Caixa
      className={className}
      o={
        olhaNoEixoX
          ? [olhar - fundura / 2, lado - largura / 2, z]
          : [lado - largura / 2, olhar - fundura / 2, z]
      }
      t={olhaNoEixoX ? [fundura, largura, altura] : [largura, fundura, altura]}
      cor={corDaCaixa}
    />
  );

  // Cabeça: 0,8 de ombro a ombro, 0,72 de fundura, base em z = 1,44.
  const L = 0.4;
  const F = 0.36;
  const base = 1.44;
  /** Retângulo na face visível do eixo do olhar (o rosto, ou a nuca quando está de costas). */
  const noOlhar = (u: readonly [number, number], z: readonly [number, number], corDaFace: string) =>
    olhaNoEixoX ? (
      <FaceX x={F + 0.002} y={u} z={[base + z[0], base + z[1]]} cor={corDaFace} />
    ) : (
      <FaceY y={F + 0.002} x={u} z={[base + z[0], base + z[1]]} cor={corDaFace} />
    );
  /** Faixa na outra face visível (a lateral da cabeça). */
  const naLateral = (z: readonly [number, number], corDaFace: string) =>
    olhaNoEixoX ? (
      <FaceY y={L + 0.002} x={[-F, F]} z={[base + z[0], base + z[1]]} cor={corDaFace} />
    ) : (
      <FaceX x={L + 0.002} y={[-F, F]} z={[base + z[0], base + z[1]]} cor={corDaFace} />
    );
  const noRosto = (u: number, z: number): Vetor =>
    olhaNoEixoX ? [F + 0.003, u, base + z] : [u, F + 0.003, base + z];

  return (
    <g
      className={`iso-andarilho ${andando ? "andando" : ""} ${visual}`}
      style={
        {
          "--x0": `${x0.toFixed(1)}px`,
          "--y0": `${y0.toFixed(1)}px`,
          "--x1": `${x1.toFixed(1)}px`,
          "--y1": `${y1.toFixed(1)}px`,
          "--dur": `${duracao.toFixed(2)}s`,
        } as CSSProperties
      }
    >
      <ellipse cx={0} cy={0} rx={13} ry={6.5} fill="#0a1224" opacity={0.28} />
      <g className="iso-corpo">
        <g className="iso-braco-a">
          {caixa(-0.38, 0, 0.84, 0.14, 0.22, 0.58, manga)}
          {caixa(-0.38, 0, 0.72, 0.14, 0.22, 0.12, p.pele)}
        </g>
        {caixa(-0.15, 0, 0, 0.22, 0.26, 0.62, CALCA, "iso-perna-a")}
        {caixa(0.15, 0, 0, 0.22, 0.26, 0.62, CALCA, "iso-perna-b")}
        {caixa(0, 0, 0.62, 0.6, 0.36, 0.82, p.camisa)}
        <g className="iso-braco-b">
          {caixa(0.38, 0, 0.84, 0.14, 0.22, 0.58, manga)}
          {caixa(0.38, 0, 0.72, 0.14, 0.22, 0.12, p.pele)}
        </g>

        {caixa(0, 0, base, 0.8, 0.72, 0.72, p.pele)}
        {naLateral([0.42, 0.72], cabeloEscuro)}
        {deFrente ? (
          <>
            {noOlhar([-L, L], [0.52, 0.72], p.cabelo)}
            {p.penteado === "cacheado" && noOlhar([-L, -L + 0.12], [0.08, 0.72], p.cabelo)}
            {p.barba && noOlhar([-L, L], [0, 0.22], p.cabelo)}
            {p.barba && naLateral([0, 0.22], cabeloEscuro)}
            {noOlhar([-0.24, -0.1], [0.31, 0.45], OLHOS)}
            {noOlhar([0.1, 0.24], [0.31, 0.45], OLHOS)}
            {noOlhar([-0.08, 0.08], [0.1, 0.15], tom(p.pele, 0.62))}
            {p.oculos && (
              <polyline
                points={linha(
                  noRosto(-0.3, 0.48),
                  noRosto(-0.3, 0.28),
                  noRosto(-0.04, 0.28),
                  noRosto(-0.04, 0.48),
                  noRosto(-0.3, 0.48),
                  noRosto(-0.04, 0.4),
                  noRosto(0.04, 0.4),
                  noRosto(0.04, 0.48),
                  noRosto(0.3, 0.48),
                  noRosto(0.3, 0.28),
                  noRosto(0.04, 0.28),
                  noRosto(0.04, 0.4),
                )}
                fill="none"
                stroke="#111827"
                strokeWidth={1.1}
              />
            )}
          </>
        ) : (
          noOlhar([-L, L], [0.16, 0.72], p.cabelo)
        )}
        {p.penteado === "cacheado"
          ? caixa(0, 0, base + 0.66, 1.0, 0.9, 0.32, p.cabelo)
          : caixa(0, 0, base + 0.68, 0.86, 0.78, 0.14, p.cabelo)}
        {p.penteado === "coque" && caixa(0, -0.08, base + 0.82, 0.36, 0.36, 0.26, p.cabelo)}
      </g>
      <Balao visual={visual} cor={cor} ancora={[0, 0, 2.95]} />
    </g>
  );
}

/** Janela da parede do fundo, com a cidade à noite. */
function Janela() {
  const predios = [
    { x: [1.3, 2.0], h: 0.9 },
    { x: [2.1, 2.7], h: 1.4 },
    { x: [2.9, 3.5], h: 0.7 },
    { x: [3.9, 4.8], h: 1.25 },
    { x: [5.0, 5.5], h: 0.85 },
    { x: [5.6, 6.1], h: 1.55 },
    { x: [6.5, 7.4], h: 1.0 },
    { x: [7.6, 8.1], h: 1.35 },
    { x: [8.9, 9.6], h: 0.75 },
    { x: [9.8, 10.4], h: 1.15 },
    { x: [10.5, 11.2], h: 0.6 },
  ] as const;
  const base = 1.35;
  const [lx, ly] = ponto(9.3, 0, 2.62);
  return (
    <g>
      <FaceY y={0} x={[1.0, 11.4]} z={[1.25, 3.0]} cor="#c7d3e8" contorno />
      <FaceY y={0} x={[1.1, 11.3]} z={[base, 2.9]} cor="#0e1b3d" />
      <FaceY y={0} x={[1.1, 11.3]} z={[base, 2.0]} cor="#16285a" opacidade={0.55} />
      <circle cx={lx} cy={ly} r={6.5} fill="#f6f0c8" />
      {[
        [1.8, 2.7],
        [3.3, 2.78],
        [4.6, 2.55],
        [6.9, 2.75],
        [8.3, 2.5],
        [10.6, 2.62],
      ].map(([x, z]) => (
        <FaceY key={`${x}-${z}`} y={0} x={[x, x + 0.05]} z={[z, z + 0.05]} cor="#dfe8ff" />
      ))}
      {predios.map((predio, i) => (
        <g key={predio.x[0]}>
          <FaceY y={0} x={predio.x} z={[base, base + predio.h]} cor={i % 2 ? "#1d315f" : "#182a52"} />
          {Array.from({ length: Math.floor(predio.h / 0.22) }, (_, andar) =>
            [0.12, 0.34].map((dx) =>
              (andar * 3 + i + Math.round(dx * 10)) % 3 === 0 ? null : (
                <FaceY
                  key={`${andar}-${dx}`}
                  y={0}
                  x={[predio.x[0] + dx, predio.x[0] + dx + 0.1]}
                  z={[base + 0.1 + andar * 0.22, base + 0.19 + andar * 0.22]}
                  cor="#ffd98a"
                  opacidade={0.9}
                />
              ),
            ),
          )}
        </g>
      ))}
      {[3.65, 6.2, 8.75].map((x) => (
        <FaceY key={x} y={0} x={[x, x + 0.1]} z={[base, 2.9]} cor="#c7d3e8" />
      ))}
    </g>
  );
}

function Sala() {
  const pisos = [];
  for (let i = 0; i < SALA.x; i++) {
    for (let j = 0; j < SALA.y; j++) {
      pisos.push(
        <FaceZ
          key={`${i}-${j}`}
          x={[i, Math.min(i + 1, SALA.x)]}
          y={[j, Math.min(j + 1, SALA.y)]}
          cor={(i + j) % 2 ? "#324a7c" : "#2d4372"}
          bordaCor="#283c66"
        />,
      );
    }
  }
  const cores = DEFINICOES_AGENTES.map((d) => d.cor);
  return (
    <g>
      {/* Paredes */}
      <FaceY y={0} x={[0, SALA.x]} z={[0, SALA.h]} cor="#3b5789" contorno />
      <FaceX x={0} y={[0, SALA.y]} z={[0, SALA.h]} cor="#2f4875" contorno />
      <FaceY y={0} x={[0, SALA.x]} z={[0, 0.22]} cor="#24385f" />
      <FaceX x={0} y={[0, SALA.y]} z={[0, 0.22]} cor="#1e3054" />
      <Janela />

      {/* Quadro de etapas na parede da esquerda */}
      <FaceX x={0} y={[1.0, 3.1]} z={[1.4, 2.85]} cor="#8b5a3c" contorno />
      <FaceX x={0} y={[1.1, 3.0]} z={[1.5, 2.75]} cor="#eef2f8" />
      {cores.map((cor, i) => (
        <g key={cor}>
          <FaceX x={0} y={[1.22 + i * 0.44, 1.52 + i * 0.44]} z={[2.2, 2.56]} cor={cor} />
          <FaceX x={0} y={[1.22 + i * 0.44, 1.52 + i * 0.44]} z={[2.0, 2.05]} cor="#b7c3d6" />
          <FaceX x={0} y={[1.22 + i * 0.44, 1.44 + i * 0.44]} z={[1.85, 1.9]} cor="#b7c3d6" />
        </g>
      ))}

      {pisos}

      {/* Estante e bebedouro */}
      <Caixa o={[0.02, 3.3, 0]} t={[0.42, 1.1, 2.3]} cor="#7a4f36" />
      {[0.25, 0.95, 1.65].map((z, prateleira) => (
        <g key={z}>
          <FaceX x={0.441} y={[3.37, 4.33]} z={[z, z + 0.52]} cor="#3c261a" />
          {["#c0503f", "#e7c35a", "#4f8fd9", "#36a865", "#d86fc6", "#eef1f6", "#e08a3c"].map((cor, k) =>
            (k + prateleira) % 4 === 3 ? null : (
              <FaceX
                key={cor}
                x={0.442}
                y={[3.4 + k * 0.13, 3.5 + k * 0.13]}
                z={[z, z + 0.3 + ((k + prateleira) % 3) * 0.07]}
                cor={cor}
              />
            ),
          )}
        </g>
      ))}
      <Caixa o={[11.55, 0.15, 0]} t={[0.6, 0.6, 1.25]} cor="#dfe6f0" />
      <Caixa o={[11.66, 0.26, 1.25]} t={[0.38, 0.38, 0.55]} cor="#7cc4ff" />
      {/* Planta sobre a estante: o piso fica livre para a circulação. */}
      <Caixa o={[0.09, 3.64, 2.3]} t={[0.26, 0.26, 0.2]} cor="#c8774a" />
      <Caixa o={[0.04, 3.59, 2.5]} t={[0.36, 0.36, 0.3]} cor="#2f9e63" />
      <Caixa o={[0.12, 3.67, 2.8]} t={[0.2, 0.2, 0.22]} cor="#3bb673" />
    </g>
  );
}

/** Área clicável de cada estação, em % da cena. */
function areaDaEstacao(indice: number): CSSProperties {
  const { x, y } = origemDaEstacao(indice);
  const esquerda = ponto(x, y + 2.5)[0] + 16;
  const direita = ponto(x + 2.18, y)[0] - 10;
  const topo = ponto(x + 1, y + 0.68, 3.05)[1] - 26;
  const base = ponto(x + 2.18, y + 2.5)[1];
  return {
    left: `${((esquerda - VISTA.x) / VISTA.largura) * 100}%`,
    top: `${((topo - VISTA.y) / VISTA.altura) * 100}%`,
    width: `${((direita - esquerda) / VISTA.largura) * 100}%`,
    height: `${((base - topo) / VISTA.altura) * 100}%`,
  };
}

/**
 * Sala isométrica em blocos com as quatro estações. Quem não está trabalhando
 * circula pela sala e volta para a mesa quando a etapa entra em andamento. O
 * desenho é decorativo para leitores de tela; cada estação tem um botão
 * sobreposto, e a lista de estações logo abaixo da cena oferece o mesmo acesso.
 */
export function CenaEscritorio({ estacoes, selecionada, aoSelecionar }: Props) {
  const visualDe = (agente: AgenteId) => estacoes.find((e) => e.agente === agente)!.visual;
  const quadros = useAndarilhos({
    triagem: visualDe("triagem"),
    auditoria: visualDe("auditoria"),
    relatorio: visualDe("relatorio"),
    retificacao: visualDe("retificacao"),
  });

  /** Personagens em pé que pertencem a uma camada de desenho, do mais ao fundo para o mais à frente. */
  const emPe = (camada: Camada, somente?: AgenteId): ReactNode =>
    DEFINICOES_AGENTES.flatMap((definicao) => {
      const quadro = quadros[definicao.id];
      if (quadro.sentado || quadro.trecho.camada !== camada) return [];
      if (somente && definicao.id !== somente) return [];
      return [{ definicao, quadro, fundo: quadro.trecho.para[0] + quadro.trecho.para[1] }];
    })
      .sort((a, b) => a.fundo - b.fundo)
      .map(({ definicao, quadro }) => (
        <Andarilho
          key={`${definicao.id}-${quadro.chave}`}
          agente={definicao.id}
          quadro={quadro}
          visual={visualDe(definicao.id)}
          cor={definicao.cor}
        />
      ));

  return (
    <div className="scene">
      <div className="scene-stage" style={{ aspectRatio: `${VISTA.largura} / ${VISTA.altura}` }}>
        <svg
          viewBox={`${VISTA.x} ${VISTA.y} ${VISTA.largura} ${VISTA.altura}`}
          aria-hidden="true"
          focusable="false"
        >
          <Sala />
          {emPe("fundo")}
          {emPe("corredor:-1")}
          {DEFINICOES_AGENTES.map((definicao, indice) => {
            const visual = visualDe(definicao.id);
            return (
              <Fragment key={definicao.id}>
                <EstacaoFundo
                  definicao={definicao}
                  indice={indice}
                  visual={visual}
                  selecionada={selecionada === definicao.id}
                />
                {emPe("interno", definicao.id)}
                <EstacaoFrente
                  definicao={definicao}
                  indice={indice}
                  visual={visual}
                  ausente={!quadros[definicao.id].sentado}
                />
                {emPe(`corredor:${indice}`)}
              </Fragment>
            );
          })}
          {emPe("frente")}
        </svg>
        {DEFINICOES_AGENTES.map((definicao, indice) => {
          const estacao = estacoes.find((e) => e.agente === definicao.id)!;
          return (
            <button
              key={definicao.id}
              type="button"
              className="scene-hit"
              style={areaDaEstacao(indice)}
              aria-label={`Estação ${definicao.nome}: ${estacao.rotulo}`}
              aria-pressed={selecionada === definicao.id}
              onClick={() => aoSelecionar(definicao.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
