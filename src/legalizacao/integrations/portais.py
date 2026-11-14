"""Interfaces dos portais públicos e implementações simuladas.

Fluxo real em SP (REDESIM):
  1. Viabilidade (nome empresarial + localização) no portal VRE / Integrador Estadual.
  2. DBE na Coleta Nacional da Receita Federal (login gov.br do responsável).
  3. Protocolo do ato na JUCESP (processo digital: PDF assinado + DBE + taxa paga).
  4. Acompanhamento: deferimento (NIRE/CNPJ) ou exigências.

Os portais não oferecem API pública estável para escritórios: a integração real é feita
por automação de navegador (Playwright) com certificado digital e SEMPRE após aprovação
humana. Por padrão (LEGALIZACAO_MODO=simulacao) nada é enviado a órgão público.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol

from legalizacao.config import Config
from legalizacao.models import Processo, ResultadoExterno, TipoAlteracao, TipoAto


class PortalViabilidade(Protocol):
    def consultar(self, processo: Processo) -> ResultadoExterno: ...


class PortalDBE(Protocol):
    def gerar(self, processo: Processo) -> ResultadoExterno: ...


class PortalJunta(Protocol):
    def protocolar(self, processo: Processo, arquivos: list[Path]) -> ResultadoExterno: ...

    def consultar(self, processo: Processo) -> ResultadoExterno: ...


def _num(prefixo: str) -> str:
    return f"{prefixo}-SIM-{uuid.uuid4().hex[:10].upper()}"


class ViabilidadeSimulada:
    """Defere quando há nome (ou opção por CNPJ) e sede em SP com inscrição imobiliária."""

    def consultar(self, processo: Processo) -> ResultadoExterno:
        emp = processo.empresa
        motivos = []
        if not (emp.nome_empresarial or emp.usar_cnpj_como_nome):
            motivos.append("nome empresarial não informado")
        if not emp.endereco_sede or emp.endereco_sede.uf.upper() != "SP":
            motivos.append("sede fora de SP")
        if processo.tipo_ato != TipoAto.ALTERACAO_LTDA and not emp.inscricao_imobiliaria:
            motivos.append("inscrição imobiliária (SQL) não informada")
        status = "indeferida" if motivos else "deferida"
        return ResultadoExterno(
            numero=_num("VIAB"),
            status=status,
            simulado=True,
            detalhes={"motivos": motivos, "cnaes": [c.codigo for c in emp.cnaes]},
        )


class DBESimulado:
    def gerar(self, processo: Processo) -> ResultadoExterno:
        return ResultadoExterno(
            numero=_num("DBE"),
            status="transmitido",
            simulado=True,
            detalhes={"observacao": "Recibo e identificação do DBE simulados."},
        )


class JuntaSimulada:
    def protocolar(self, processo: Processo, arquivos: list[Path]) -> ResultadoExterno:
        return ResultadoExterno(
            numero=_num("JUCESP"),
            status="em_analise",
            simulado=True,
            detalhes={"arquivos": [p.name for p in arquivos]},
        )

    def consultar(self, processo: Processo) -> ResultadoExterno:
        if not processo.protocolo:
            raise ValueError("Processo ainda não protocolado.")
        return processo.protocolo


def viabilidade_necessaria(processo: Processo) -> bool:
    """Constituição sempre; alteração apenas se mexe em nome, endereço ou atividade."""
    if processo.tipo_ato != TipoAto.ALTERACAO_LTDA:
        return True
    tipos = {a.tipo for a in processo.alteracoes}
    return bool(tipos & {TipoAlteracao.NOME, TipoAlteracao.ENDERECO, TipoAlteracao.OBJETO})


class Portais:
    def __init__(self, viabilidade: PortalViabilidade, dbe: PortalDBE, junta: PortalJunta):
        self.viabilidade = viabilidade
        self.dbe = dbe
        self.junta = junta


def obter_portais(config: Config) -> Portais:
    if config.em_producao:
        from legalizacao.integrations.junta.jucesp import DBEColetaNacional, JucespProtocolo, JucespViabilidade

        return Portais(JucespViabilidade(config), DBEColetaNacional(config), JucespProtocolo(config))
    return Portais(ViabilidadeSimulada(), DBESimulado(), JuntaSimulada())
