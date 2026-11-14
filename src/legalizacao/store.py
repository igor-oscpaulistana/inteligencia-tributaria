"""Persistência simples em disco: uma pasta por processo.

dados/processos/<id>/
    processo.json   estado completo do processo
    documentos/     arquivos recebidos do cliente
    saida/          minutas, DOCX, mensagens geradas
"""

from __future__ import annotations

import shutil
from pathlib import Path

from legalizacao.config import Config, carregar_config
from legalizacao.models import Documento, Processo


class ProcessoStore:
    def __init__(self, config: Config | None = None):
        self.config = config or carregar_config()
        self.raiz = self.config.dados_dir / "processos"
        self.raiz.mkdir(parents=True, exist_ok=True)

    def pasta(self, processo_id: str) -> Path:
        return self.raiz / processo_id

    def pasta_saida(self, processo_id: str) -> Path:
        p = self.pasta(processo_id) / "saida"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def salvar(self, processo: Processo) -> None:
        pasta = self.pasta(processo.id)
        pasta.mkdir(parents=True, exist_ok=True)
        tmp = pasta / "processo.json.tmp"
        tmp.write_text(processo.model_dump_json(indent=2), encoding="utf-8")
        tmp.replace(pasta / "processo.json")

    def carregar(self, processo_id: str) -> Processo:
        arquivo = self.pasta(processo_id) / "processo.json"
        if not arquivo.exists():
            raise FileNotFoundError(f"Processo {processo_id} não encontrado em {arquivo}")
        return Processo.model_validate_json(arquivo.read_text(encoding="utf-8"))

    def listar(self) -> list[Processo]:
        return [
            Processo.model_validate_json((p / "processo.json").read_text(encoding="utf-8"))
            for p in sorted(self.raiz.iterdir())
            if (p / "processo.json").exists()
        ]

    def receber_documento(self, processo: Processo, origem: Path) -> Documento:
        """Copia o arquivo do cliente para a pasta do processo e registra-o."""
        destino_dir = self.pasta(processo.id) / "documentos"
        destino_dir.mkdir(parents=True, exist_ok=True)
        destino = destino_dir / origem.name
        n = 1
        while destino.exists():
            destino = destino_dir / f"{origem.stem}_{n}{origem.suffix}"
            n += 1
        shutil.copy2(origem, destino)
        doc = Documento(nome_arquivo=destino.name, caminho=str(destino))
        processo.documentos.append(doc)
        processo.registrar("sistema", "documento_recebido", destino.name)
        return doc
