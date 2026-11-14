"""Modelo de domínio do processo de legalização (constituição e alteração de LTDA/SLU)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


def _agora() -> datetime:
    return datetime.now().replace(microsecond=0)


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}-{uuid.uuid4().hex[:8]}"


class TipoAto(str, Enum):
    CONSTITUICAO_LTDA = "constituicao_ltda"
    CONSTITUICAO_SLU = "constituicao_slu"
    ALTERACAO_LTDA = "alteracao_ltda"


class Etapa(str, Enum):
    """Etapas do trabalho do analista, na ordem em que acontecem."""

    RECEPCAO_DOCUMENTOS = "recepcao_documentos"
    COLETA_DADOS = "coleta_dados"
    ANALISE_SOCIETARIA = "analise_societaria"
    VIABILIDADE = "viabilidade"
    ELABORACAO_CONTRATO = "elaboracao_contrato"
    REVISAO_HUMANA = "revisao_humana"
    DBE = "dbe"
    ASSINATURAS = "assinaturas"
    PAGAMENTO_TAXAS = "pagamento_taxas"
    PROTOCOLO = "protocolo"
    ACOMPANHAMENTO = "acompanhamento"
    CONCLUIDO = "concluido"


class Gate(str, Enum):
    """Pontos em que só um humano pode autorizar o avanço."""

    REVISAO_CONTRATO = "revisao_contrato"  # analista/advogado revisou a minuta
    ASSINATURAS = "assinaturas"  # sócios assinaram (gov.br / ICP-Brasil)
    PAGAMENTO = "pagamento"  # DARE/taxa da Junta paga
    ENVIO_PROTOCOLO = "envio_protocolo"  # autorização final para protocolar


class TipoDocumento(str, Enum):
    RG = "rg"
    CNH = "cnh"
    CIN = "cin"  # Carteira de Identidade Nacional
    CPF = "cpf"
    COMPROVANTE_ENDERECO = "comprovante_endereco"
    CERTIDAO_CASAMENTO = "certidao_casamento"
    CERTIDAO_NASCIMENTO = "certidao_nascimento"
    IPTU = "iptu"
    CONTRATO_SOCIAL_VIGENTE = "contrato_social_vigente"
    CARTAO_CNPJ = "cartao_cnpj"
    OUTRO = "outro"
    NAO_IDENTIFICADO = "nao_identificado"


class StatusDocumento(str, Enum):
    RECEBIDO = "recebido"
    EXTRAIDO = "extraido"
    VALIDO = "valido"
    REJEITADO = "rejeitado"


class EstadoCivil(str, Enum):
    SOLTEIRO = "solteiro"
    CASADO = "casado"
    UNIAO_ESTAVEL = "uniao_estavel"
    DIVORCIADO = "divorciado"
    SEPARADO = "separado_judicialmente"
    VIUVO = "viuvo"


class RegimeBens(str, Enum):
    COMUNHAO_PARCIAL = "comunhao_parcial"
    COMUNHAO_UNIVERSAL = "comunhao_universal"
    SEPARACAO_TOTAL = "separacao_total"  # separação convencional
    SEPARACAO_OBRIGATORIA = "separacao_obrigatoria"
    PARTICIPACAO_FINAL_AQUESTOS = "participacao_final_aquestos"


class Porte(str, Enum):
    ME = "ME"
    EPP = "EPP"
    DEMAIS = "DEMAIS"


class Endereco(BaseModel):
    logradouro: str
    numero: str
    complemento: str | None = None
    bairro: str
    municipio: str
    uf: str
    cep: str

    def formatado(self) -> str:
        comp = f", {self.complemento}" if self.complemento else ""
        return (
            f"{self.logradouro}, nº {self.numero}{comp}, {self.bairro}, "
            f"{self.municipio}/{self.uf}, CEP {self.cep}"
        )


class Socio(BaseModel):
    nome: str
    cpf: str
    rg: str | None = None
    orgao_emissor: str | None = None
    data_nascimento: date | None = None
    nacionalidade: str = "brasileiro(a)"
    estado_civil: EstadoCivil | None = None
    regime_bens: RegimeBens | None = None
    cpf_conjuge: str | None = None
    profissao: str | None = None
    endereco: Endereco | None = None
    email: str | None = None
    quotas: int = 0
    administrador: bool = False
    # Em alteração contratual: sócio que se retira continua no histórico com retirante=True.
    retirante: bool = False
    ingressante: bool = False


class Cnae(BaseModel):
    codigo: str  # formato 0000-0/00
    descricao: str
    principal: bool = False


class Empresa(BaseModel):
    nome_empresarial: str | None = None
    nome_fantasia: str | None = None
    usar_cnpj_como_nome: bool = False  # Lei 8.934/1994, art. 35-A (Lei 14.195/2021)
    objeto_social: str | None = None
    cnaes: list[Cnae] = Field(default_factory=list)
    capital_social: Decimal | None = None
    valor_quota: Decimal | None = None
    capital_integralizado_no_ato: bool = True
    prazo_integralizacao: date | None = None
    endereco_sede: Endereco | None = None
    inscricao_imobiliaria: str | None = None  # SQL/IPTU do imóvel da sede
    area_utilizada_m2: Decimal | None = None
    porte: Porte = Porte.ME
    administracao_conjunta: bool = False
    pro_labore: bool = True
    data_inicio_atividades: date | None = None  # None = data do registro
    # Dados da sociedade já registrada (alteração contratual)
    cnpj: str | None = None
    nire: str | None = None


class TipoAlteracao(str, Enum):
    NOME = "nome"
    ENDERECO = "endereco"
    OBJETO = "objeto"
    CAPITAL = "capital"
    ENTRADA_SOCIO = "entrada_socio"
    SAIDA_SOCIO = "saida_socio"
    CESSAO_QUOTAS = "cessao_quotas"
    ADMINISTRACAO = "administracao"
    OUTRA = "outra"


class Alteracao(BaseModel):
    tipo: TipoAlteracao
    descricao: str  # texto da cláusula de alteração


class Documento(BaseModel):
    id: str = Field(default_factory=lambda: _novo_id("doc"))
    nome_arquivo: str
    caminho: str
    tipo: TipoDocumento = TipoDocumento.NAO_IDENTIFICADO
    cpf_titular: str | None = None
    status: StatusDocumento = StatusDocumento.RECEBIDO
    dados_extraidos: dict = Field(default_factory=dict)
    observacoes: str | None = None
    recebido_em: datetime = Field(default_factory=_agora)


class Responsavel(str, Enum):
    CLIENTE = "cliente"
    ANALISTA = "analista"
    AGENTE = "agente"


class Pendencia(BaseModel):
    id: str = Field(default_factory=lambda: _novo_id("pend"))
    descricao: str
    responsavel: Responsavel
    etapa: Etapa
    resolvida: bool = False
    criada_em: datetime = Field(default_factory=_agora)


class Aprovacao(BaseModel):
    gate: Gate
    aprovado_por: str
    em: datetime = Field(default_factory=_agora)
    observacao: str | None = None


class SolicitacaoAprovacao(BaseModel):
    gate: Gate
    resumo: str
    em: datetime = Field(default_factory=_agora)


class Evento(BaseModel):
    em: datetime = Field(default_factory=_agora)
    ator: str
    acao: str
    detalhe: str | None = None


class ResultadoExterno(BaseModel):
    """Resultado de uma interação com portal público (viabilidade, DBE, Junta)."""

    numero: str
    status: str
    simulado: bool
    detalhes: dict = Field(default_factory=dict)
    em: datetime = Field(default_factory=_agora)


class Exigencia(BaseModel):
    id: str = Field(default_factory=lambda: _novo_id("exig"))
    texto: str
    recebida_em: datetime = Field(default_factory=_agora)
    cumprida: bool = False


class Processo(BaseModel):
    id: str = Field(default_factory=lambda: _novo_id("proc"))
    tipo_ato: TipoAto
    etapa: Etapa = Etapa.RECEPCAO_DOCUMENTOS
    cliente_nome: str
    cliente_email: str | None = None
    empresa: Empresa = Field(default_factory=Empresa)
    socios: list[Socio] = Field(default_factory=list)
    alteracoes: list[Alteracao] = Field(default_factory=list)
    numero_alteracao: int | None = None
    documentos: list[Documento] = Field(default_factory=list)
    pendencias: list[Pendencia] = Field(default_factory=list)
    aprovacoes: list[Aprovacao] = Field(default_factory=list)
    solicitacoes_aprovacao: list[SolicitacaoAprovacao] = Field(default_factory=list)
    viabilidade: ResultadoExterno | None = None
    dbe: ResultadoExterno | None = None
    protocolo: ResultadoExterno | None = None
    exigencias: list[Exigencia] = Field(default_factory=list)
    contrato_md: str | None = None  # caminho da minuta gerada
    contrato_docx: str | None = None
    revisao_ia: dict | None = None
    contrato_assinado: str | None = None  # PDF assinado pelos sócios (enviado pelo humano)
    comprovante_pagamento: str | None = None  # DARE pago (enviado pelo humano)
    hash_contrato_aprovado: str | None = None
    historico: list[Evento] = Field(default_factory=list)
    criado_em: datetime = Field(default_factory=_agora)

    # --- utilitários ---
    def registrar(self, ator: str, acao: str, detalhe: str | None = None) -> None:
        self.historico.append(Evento(ator=ator, acao=acao, detalhe=detalhe))

    def socios_ativos(self) -> list[Socio]:
        return [s for s in self.socios if not s.retirante]

    def socio_por_cpf(self, cpf: str) -> Socio | None:
        from legalizacao.rules.validadores import so_digitos

        alvo = so_digitos(cpf)
        return next((s for s in self.socios if so_digitos(s.cpf) == alvo), None)

    def aprovado(self, gate: Gate) -> bool:
        return any(a.gate == gate for a in self.aprovacoes)

    def pendencias_abertas(self) -> list[Pendencia]:
        return [p for p in self.pendencias if not p.resolvida]
