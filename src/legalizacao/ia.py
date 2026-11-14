"""Chamadas pontuais ao Claude: extração de documentos e revisão da minuta.

Ambas usam saída estruturada (Pydantic) para que o resultado seja validado antes de
entrar no processo. O modelo e o esforço vêm da configuração.
"""

from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from legalizacao.config import Config

# Refusal fallback do lado do servidor: se o modelo principal recusar, a API repete a
# chamada num modelo de reserva escolhido pela categoria da recusa.
BETAS = ["server-side-fallback-2026-07-01"]
FALLBACKS = "default"

TIPOS_IMAGEM = {"image/jpeg", "image/png", "image/gif", "image/webp"}


class EnderecoExtraido(BaseModel):
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    municipio: str | None = None
    uf: str | None = None
    cep: str | None = None


class DadosDocumento(BaseModel):
    tipo_documento: Literal[
        "rg", "cnh", "cin", "cpf", "comprovante_endereco", "certidao_casamento", "certidao_nascimento",
        "iptu", "contrato_social_vigente", "cartao_cnpj", "outro",
    ]
    legivel: bool = Field(description="false se o documento estiver ilegível, cortado ou com baixa qualidade")
    nome_titular: str | None = Field(None, description="Nome completo do titular/pessoa principal do documento")
    cpf: str | None = None
    rg: str | None = None
    orgao_emissor: str | None = Field(None, description="Ex.: SSP/SP")
    data_nascimento: str | None = Field(None, description="AAAA-MM-DD")
    data_emissao: str | None = Field(None, description="AAAA-MM-DD; para contas de consumo, a data de emissão/vencimento")
    data_validade: str | None = Field(None, description="AAAA-MM-DD")
    nome_mae: str | None = None
    nacionalidade: str | None = None
    estado_civil: str | None = None
    regime_bens: str | None = Field(None, description="Somente em certidão de casamento")
    nome_conjuge: str | None = None
    averbacoes: str | None = Field(None, description="Divórcio, separação etc., em certidões")
    endereco: EnderecoExtraido | None = None
    inscricao_imobiliaria: str | None = Field(None, description="SQL/número do contribuinte no IPTU")
    cnpj: str | None = None
    nire: str | None = None
    razao_social: str | None = None
    observacoes: str | None = Field(None, description="Rasuras, divergências, indícios de adulteração, partes ilegíveis")


SISTEMA_EXTRACAO = """Você extrai dados de documentos brasileiros enviados a um escritório de legalização de empresas.
Transcreva exatamente o que está no documento; não complete nem deduza campos ausentes (deixe null).
Datas em AAAA-MM-DD. CPF/CNPJ como aparecem. Aponte em `observacoes` qualquer rasura, divergência,
baixa qualidade ou indício de adulteração. Se o documento for de terceiro (ex.: conta de luz em nome
de outra pessoa), registre o nome que aparece e anote em observações."""


def _bloco_arquivo(caminho: Path) -> dict:
    mime = mimetypes.guess_type(caminho.name)[0] or ""
    dados = base64.standard_b64encode(caminho.read_bytes()).decode("ascii")
    if mime == "application/pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": mime, "data": dados}}
    if mime in TIPOS_IMAGEM:
        return {"type": "image", "source": {"type": "base64", "media_type": mime, "data": dados}}
    raise ValueError(f"Formato não suportado para extração: {caminho.name} ({mime or 'desconhecido'}). Use PDF, JPG, PNG ou WEBP.")


def _checar_parada(resposta) -> None:
    if resposta.stop_reason == "refusal":
        detalhe = getattr(resposta.stop_details, "explanation", None) if resposta.stop_details else None
        raise RuntimeError(f"O modelo recusou a solicitação. {detalhe or ''}".strip())
    if resposta.stop_reason == "max_tokens":
        raise RuntimeError("Resposta truncada (max_tokens).")


def extrair_documento(client: anthropic.Anthropic, config: Config, caminho: Path) -> DadosDocumento:
    resposta = client.beta.messages.parse(
        model=config.modelo,
        max_tokens=8000,
        betas=BETAS,
        fallbacks=FALLBACKS,
        output_config={"effort": "medium"},
        system=SISTEMA_EXTRACAO,
        messages=[
            {
                "role": "user",
                "content": [_bloco_arquivo(caminho), {"type": "text", "text": "Extraia os dados deste documento."}],
            }
        ],
        output_format=DadosDocumento,
    )
    _checar_parada(resposta)
    return resposta.parsed_output


# ----------------------------------------------------------------------------- revisão


class AchadoRevisao(BaseModel):
    gravidade: Literal["critico", "importante", "sugestao"]
    clausula: str
    problema: str
    sugestao: str
    fundamento: str | None = None


class RevisaoContrato(BaseModel):
    pronto_para_revisao_humana: bool = Field(description="false se houver achado crítico")
    achados: list[AchadoRevisao]
    resumo: str


SISTEMA_REVISAO = """Você é revisor(a) jurídico-societário(a) sênior de um escritório de legalização em São Paulo.
Revise a minuta de contrato social (sociedade limitada) frente aos dados cadastrais do processo e às
normas aplicáveis: Código Civil (arts. 997, 1.052 a 1.087, 1.158), Lei 8.934/1994, IN DREI 81/2020 e
LC 123/2006. Verifique em especial:
- consistência entre a minuta e os dados (nomes, CPFs, quotas, valores, endereço, administradores);
- valores numéricos x por extenso; soma das quotas = capital;
- cláusulas obrigatórias presentes; redação do objeto social clara, precisa e compatível com os CNAEs;
- coerência entre tipo de ato (LTDA, SLU, alteração) e redação;
- problemas que gerariam exigência na JUCESP.
Não reescreva o contrato. Seja objetivo; marque como "critico" apenas o que impediria o registro ou
tornaria o ato inválido."""


def revisar_contrato(
    client: anthropic.Anthropic, config: Config, minuta: str, dados: dict, achados_regras: list[dict]
) -> RevisaoContrato:
    conteudo = (
        "<dados_do_processo>\n" + json.dumps(dados, ensure_ascii=False, indent=2, default=str) + "\n</dados_do_processo>\n\n"
        "<achados_das_regras_deterministicas>\n" + json.dumps(achados_regras, ensure_ascii=False, indent=2)
        + "\n</achados_das_regras_deterministicas>\n\n<minuta>\n" + minuta + "\n</minuta>"
    )
    resposta = client.beta.messages.parse(
        model=config.modelo,
        max_tokens=16000,
        betas=BETAS,
        fallbacks=FALLBACKS,
        output_config={"effort": "high"},
        system=SISTEMA_REVISAO,
        messages=[{"role": "user", "content": conteudo}],
        output_format=RevisaoContrato,
    )
    _checar_parada(resposta)
    return resposta.parsed_output
