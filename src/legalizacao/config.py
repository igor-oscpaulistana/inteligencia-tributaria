"""Configuração do agente (variáveis de ambiente com valores padrão seguros)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Config:
    dados_dir: Path = field(default_factory=lambda: Path(os.getenv("LEGALIZACAO_DADOS", "./dados")))
    # "simulacao" (padrão) nunca envia nada a portais públicos; "producao" usa os adaptadores reais.
    modo: str = field(default_factory=lambda: os.getenv("LEGALIZACAO_MODO", "simulacao"))
    modelo: str = field(default_factory=lambda: os.getenv("LEGALIZACAO_MODELO", "claude-opus-5-5"))
    esforco: str = field(default_factory=lambda: os.getenv("LEGALIZACAO_ESFORCO", "high"))
    # Política interna do escritório: idade máxima do comprovante de endereço (dias).
    validade_comprovante_endereco_dias: int = 90
    # Junta Comercial atendida (por ora só SP / JUCESP).
    uf_junta: str = "SP"

    @property
    def em_producao(self) -> bool:
        return self.modo == "producao"


def carregar_config() -> Config:
    return Config()
