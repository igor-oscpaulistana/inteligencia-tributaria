"""Adaptadores reais (JUCESP / REDESIM) - esqueleto para automação com Playwright.

ATENÇÃO: os portais mudam com frequência e exigem login gov.br / certificado digital.
Os passos abaixo descrevem o roteiro que um analista executa; os seletores precisam ser
mapeados por quem tem acesso ao ambiente (idealmente gravando com `playwright codegen`).
Enquanto não forem mapeados, cada método levanta NotImplementedError com o roteiro,
para que o agente devolva a tarefa ao analista em vez de "fingir" o protocolo.

Requisitos de produção:
  - pip install "legalizacao-agent[portal]" && playwright install chromium
  - certificado digital A1 (.pfx) do responsável ou sessão gov.br já autenticada
  - LEGALIZACAO_MODO=producao
"""

from __future__ import annotations

from pathlib import Path

from legalizacao.config import Config
from legalizacao.models import Processo, ResultadoExterno


class _PortalNaoMapeado(NotImplementedError):
    pass


class JucespViabilidade:
    """Consulta prévia de viabilidade (nome + localização) no portal VRE/Integrador SP."""

    ROTEIRO = [
        "1. Acessar o portal de viabilidade da REDESIM-SP (VRE) com login gov.br.",
        "2. Escolher 'Pedido de viabilidade' > natureza jurídica 206-2 (Sociedade Empresária Limitada).",
        "3. Informar município, endereço completo e inscrição imobiliária (SQL) da sede.",
        "4. Informar CNAEs (principal e secundários) e forma de atuação (estabelecimento fixo etc.).",
        "5. Informar nome empresarial pretendido (ou opção pelo CNPJ como nome).",
        "6. Responder às perguntas de localização (área, uso residencial etc.) e transmitir.",
        "7. Capturar o número do protocolo da viabilidade e acompanhar até deferimento.",
    ]

    def __init__(self, config: Config):
        self.config = config

    def consultar(self, processo: Processo) -> ResultadoExterno:
        raise _PortalNaoMapeado(
            "Automação da viabilidade JUCESP ainda não mapeada. Roteiro manual:\n" + "\n".join(self.ROTEIRO)
        )


class DBEColetaNacional:
    """Documento Básico de Entrada (Coleta Nacional - Receita Federal)."""

    ROTEIRO = [
        "1. Acessar a Coleta Nacional da REDESIM (Receita Federal) com gov.br do responsável.",
        "2. Informar o protocolo de viabilidade deferido (os dados são importados).",
        "3. Preencher QSA (sócios, administrador, quotas), contador responsável e dados complementares.",
        "4. Transmitir e guardar o recibo e o número de identificação do DBE.",
    ]

    def __init__(self, config: Config):
        self.config = config

    def gerar(self, processo: Processo) -> ResultadoExterno:
        raise _PortalNaoMapeado("Automação do DBE ainda não mapeada. Roteiro manual:\n" + "\n".join(self.ROTEIRO))


class JucespProtocolo:
    """Protocolo digital do ato na JUCESP."""

    ROTEIRO = [
        "1. Acessar o sistema de protocolo digital da JUCESP com certificado digital/gov.br.",
        "2. Vincular viabilidade e DBE ao processo.",
        "3. Anexar o instrumento (PDF/A) assinado digitalmente por todos os signatários.",
        "4. Vincular o comprovante de pagamento do preço público (DARE).",
        "5. Conferir o resumo e transmitir; capturar o número do protocolo.",
    ]

    def __init__(self, config: Config):
        self.config = config

    def protocolar(self, processo: Processo, arquivos: list[Path]) -> ResultadoExterno:
        raise _PortalNaoMapeado(
            "Automação do protocolo JUCESP ainda não mapeada. Roteiro manual:\n" + "\n".join(self.ROTEIRO)
        )

    def consultar(self, processo: Processo) -> ResultadoExterno:
        raise _PortalNaoMapeado(
            "Consulta automática de andamento ainda não mapeada: registre o andamento com "
            "`legalizacao andamento <processo> --status ...`."
        )
