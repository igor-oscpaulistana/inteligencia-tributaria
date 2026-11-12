import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inteligência Tributária · Escritório Virtual",
  description: "Auditoria de PIS e COFINS sobre notas fiscais de saída.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
