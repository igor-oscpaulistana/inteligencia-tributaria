/**
 * Desenho isométrico em blocos, em SVG.
 *
 * Coordenadas do mundo: x cresce para a direita e para baixo na tela, y para a
 * esquerda e para baixo, z para cima. A câmera enxerga o topo de cada bloco e
 * as faces voltadas para +x e +y. A projeção é linear, então um grupo pode ser
 * posicionado com `translate(ponto(x, y, 0))`.
 */

import type { ReactNode } from "react";

/** Pixels por unidade do mundo. */
export const ESCALA = 30;

export type Vetor = readonly [number, number, number];

export function ponto(x: number, y: number, z = 0): readonly [number, number] {
  return [(x - y) * ESCALA, ((x + y) * ESCALA) / 2 - z * ESCALA];
}

/** Vértices do mundo projetados, no formato do atributo `points`. */
export function linha(...vertices: Vetor[]): string {
  return vertices
    .map(([x, y, z]) => {
      const [px, py] = ponto(x, y, z);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

/** Clareia (fator > 1) ou escurece (fator < 1) uma cor #rrggbb. */
export function tom(cor: string, fator: number): string {
  const canais = [1, 3, 5].map((i) => {
    const valor = Math.round(parseInt(cor.slice(i, i + 2), 16) * fator);
    return Math.max(0, Math.min(255, valor)).toString(16).padStart(2, "0");
  });
  return `#${canais.join("")}`;
}

const CONTORNO = {
  stroke: "#0a1224",
  strokeOpacity: 0.55,
  strokeWidth: 0.7,
  strokeLinejoin: "round",
} as const;

interface PropsCaixa {
  /** Canto de menor x, y e z. */
  o: Vetor;
  /** Tamanho em x, y e z. */
  t: Vetor;
  cor: string;
  className?: string;
}

/** Bloco com as três faces visíveis: topo mais claro, face +x mais escura. */
export function Caixa({ o: [x, y, z], t: [dx, dy, dz], cor, className }: PropsCaixa) {
  return (
    <g className={className}>
      <polygon
        points={linha([x, y + dy, z], [x + dx, y + dy, z], [x + dx, y + dy, z + dz], [x, y + dy, z + dz])}
        fill={cor}
        {...CONTORNO}
      />
      <polygon
        points={linha([x + dx, y, z], [x + dx, y + dy, z], [x + dx, y + dy, z + dz], [x + dx, y, z + dz])}
        fill={tom(cor, 0.78)}
        {...CONTORNO}
      />
      <polygon
        points={linha([x, y, z + dz], [x + dx, y, z + dz], [x + dx, y + dy, z + dz], [x, y + dy, z + dz])}
        fill={tom(cor, 1.14)}
        {...CONTORNO}
      />
    </g>
  );
}

interface PropsFace {
  cor: string;
  opacidade?: number;
  className?: string;
  contorno?: boolean;
  children?: ReactNode;
}

/** Retângulo em um plano de y constante (parede do fundo ou face +y de um bloco). */
export function FaceY({
  y,
  x,
  z,
  cor,
  opacidade,
  className,
  contorno,
}: PropsFace & { y: number; x: readonly [number, number]; z: readonly [number, number] }) {
  return (
    <polygon
      className={className}
      points={linha([x[0], y, z[0]], [x[1], y, z[0]], [x[1], y, z[1]], [x[0], y, z[1]])}
      fill={cor}
      fillOpacity={opacidade}
      {...(contorno ? CONTORNO : {})}
    />
  );
}

/** Retângulo em um plano de x constante (parede da esquerda ou face +x de um bloco). */
export function FaceX({
  x,
  y,
  z,
  cor,
  opacidade,
  className,
  contorno,
}: PropsFace & { x: number; y: readonly [number, number]; z: readonly [number, number] }) {
  return (
    <polygon
      className={className}
      points={linha([x, y[0], z[0]], [x, y[1], z[0]], [x, y[1], z[1]], [x, y[0], z[1]])}
      fill={cor}
      fillOpacity={opacidade}
      {...(contorno ? CONTORNO : {})}
    />
  );
}

/** Retângulo deitado em um plano de z constante (piso ou tampo). */
export function FaceZ({
  z = 0,
  x,
  y,
  cor,
  opacidade,
  className,
  contorno,
  bordaCor,
}: PropsFace & {
  z?: number;
  x: readonly [number, number];
  y: readonly [number, number];
  bordaCor?: string;
}) {
  return (
    <polygon
      className={className}
      points={linha([x[0], y[0], z], [x[1], y[0], z], [x[1], y[1], z], [x[0], y[1], z])}
      fill={cor}
      fillOpacity={opacidade}
      {...(contorno ? CONTORNO : {})}
      {...(bordaCor ? { stroke: bordaCor, strokeWidth: 1.6, strokeLinejoin: "round" as const } : {})}
    />
  );
}

/**
 * Imagem aplicada sobre a parede do fundo (plano y = 0), acompanhando a
 * perspectiva da parede. `x` e `zTopo` posicionam o canto superior esquerdo.
 */
export function ImagemNoFundo({
  href,
  x,
  zTopo,
  largura,
  altura,
}: {
  href: string;
  x: number;
  zTopo: number;
  largura: number;
  altura: number;
}) {
  const [ox, oy] = ponto(x, 0, zTopo);
  // Uma unidade ao longo da parede anda (ESCALA, ESCALA / 2) na tela; uma unidade para baixo, (0, ESCALA).
  const matriz = [largura * ESCALA, (largura * ESCALA) / 2, 0, altura * ESCALA, ox, oy]
    .map((valor) => valor.toFixed(2))
    .join(" ");
  return (
    <image href={href} width={1} height={1} preserveAspectRatio="none" transform={`matrix(${matriz})`} />
  );
}
