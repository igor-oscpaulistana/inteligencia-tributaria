"""Checklist de documentos por tipo de ato.

A lista reflete a prática de escritórios de legalização em SP. Itens marcados como
"politica_interna" não são exigidos pela JUCESP para o registro, mas o escritório os
pede para conferência de dados (KYC). Ajuste conforme a política do escritório.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from legalizacao.config import Config, carregar_config
from legalizacao.models import (
    Documento,
    EstadoCivil,
    Processo,
    StatusDocumento,
    TipoAto,
    TipoDocumento,
)
from legalizacao.rules.validadores import so_digitos

DOCS_IDENTIFICACAO = {TipoDocumento.RG, TipoDocumento.CNH, TipoDocumento.CIN}


@dataclass
class ItemChecklist:
    item: str
    satisfeito: bool
    titular: str | None = None
    politica_interna: bool = False
    observacao: str | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def _docs_do_socio(processo: Processo, cpf: str) -> list[Documento]:
    alvo = so_digitos(cpf)
    return [
        d
        for d in processo.documentos
        if so_digitos(d.cpf_titular) == alvo and d.status != StatusDocumento.REJEITADO
    ]


def _data(valor) -> date | None:
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        try:
            return date.fromisoformat(valor[:10])
        except ValueError:
            return None
    return None


def checklist(processo: Processo, config: Config | None = None, hoje: date | None = None) -> list[ItemChecklist]:
    config = config or carregar_config()
    hoje = hoje or date.today()
    itens: list[ItemChecklist] = []

    if not processo.socios_ativos():
        itens.append(ItemChecklist("Qualificação de ao menos um sócio", False))

    for socio in processo.socios_ativos():
        docs = _docs_do_socio(processo, socio.cpf)
        tipos = {d.tipo for d in docs}

        ident = [d for d in docs if d.tipo in DOCS_IDENTIFICACAO]
        itens.append(
            ItemChecklist(
                "Documento de identificação com foto (RG, CIN ou CNH)",
                bool(ident),
                titular=socio.nome,
            )
        )

        comp = [d for d in docs if d.tipo == TipoDocumento.COMPROVANTE_ENDERECO]
        recente = False
        obs = None
        for d in comp:
            emissao = _data(d.dados_extraidos.get("data_emissao"))
            if emissao and hoje - emissao <= timedelta(days=config.validade_comprovante_endereco_dias):
                recente = True
            elif emissao:
                obs = f"Comprovante emitido em {emissao.isoformat()} (mais de {config.validade_comprovante_endereco_dias} dias)"
            else:
                obs = "Data de emissão do comprovante não identificada"
        itens.append(
            ItemChecklist(
                f"Comprovante de endereço emitido há até {config.validade_comprovante_endereco_dias} dias",
                recente,
                titular=socio.nome,
                politica_interna=True,
                observacao=obs,
            )
        )

        if socio.estado_civil in (EstadoCivil.CASADO, EstadoCivil.SEPARADO, EstadoCivil.DIVORCIADO, EstadoCivil.VIUVO):
            itens.append(
                ItemChecklist(
                    "Certidão de casamento (confirma estado civil e regime de bens)",
                    TipoDocumento.CERTIDAO_CASAMENTO in tipos,
                    titular=socio.nome,
                    politica_interna=True,
                )
            )

    if processo.tipo_ato in (TipoAto.CONSTITUICAO_LTDA, TipoAto.CONSTITUICAO_SLU):
        tem_iptu = any(d.tipo == TipoDocumento.IPTU for d in processo.documentos) or bool(
            processo.empresa.inscricao_imobiliaria
        )
        itens.append(
            ItemChecklist(
                "IPTU / inscrição imobiliária (SQL) do imóvel da sede - usada na viabilidade municipal",
                tem_iptu,
            )
        )

    if processo.tipo_ato == TipoAto.ALTERACAO_LTDA:
        tipos_proc = {d.tipo for d in processo.documentos}
        itens.append(
            ItemChecklist(
                "Contrato social consolidado vigente (e alterações posteriores)",
                TipoDocumento.CONTRATO_SOCIAL_VIGENTE in tipos_proc,
            )
        )
        itens.append(
            ItemChecklist(
                "Cartão CNPJ atualizado",
                TipoDocumento.CARTAO_CNPJ in tipos_proc or bool(processo.empresa.cnpj),
            )
        )

    nao_classificados = [d.nome_arquivo for d in processo.documentos if d.tipo == TipoDocumento.NAO_IDENTIFICADO]
    if nao_classificados:
        itens.append(
            ItemChecklist(
                "Todos os documentos recebidos foram classificados",
                False,
                observacao="Pendentes de extração: " + ", ".join(nao_classificados),
            )
        )
    return itens


def checklist_completo(processo: Processo, config: Config | None = None) -> bool:
    """Itens obrigatórios satisfeitos. Itens de política interna são reportados, mas não bloqueiam."""
    return all(i.satisfeito for i in checklist(processo, config) if not i.politica_interna)
