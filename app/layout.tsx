import type { ReactNode } from "react";

export const metadata = {
  title: "Assistente executivo",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "3rem auto", maxWidth: 560, padding: "0 1rem" }}>
        {children}
      </body>
    </html>
  );
}
