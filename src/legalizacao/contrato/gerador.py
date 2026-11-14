"""Geração da minuta do contrato social a partir de modelos Jinja2 revisados pelo jurídico.

Decisão de projeto: o texto jurídico vem de MODELOS fixos, não de geração livre do LLM.
O agente só preenche dados estruturados (e, na alteração, o texto de cada cláusula
alterada), o que reduz o risco de cláusulas inventadas e facilita a revisão humana.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from legalizacao.contrato.extenso import formatar_reais, inteiro_por_extenso, reais_por_extenso
from legalizacao.models import EstadoCivil, Processo, RegimeBens, Socio, TipoAto
from legalizacao.rules.validadores import formatar_cnpj, formatar_cpf

TEMPLATES_DIR = Path(__file__).parent / "templates"

_ORDINAIS = [
    "", "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA",
]
_DEZENAS_ORD = {10: "DÉCIMA", 20: "VIGÉSIMA", 30: "TRIGÉSIMA"}
_ORD_MASC = ["", "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA"]
_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
          "outubro", "novembro", "dezembro"]

_ESTADO_CIVIL = {
    EstadoCivil.SOLTEIRO: "solteiro(a)",
    EstadoCivil.CASADO: "casado(a)",
    EstadoCivil.UNIAO_ESTAVEL: "convivente em união estável",
    EstadoCivil.DIVORCIADO: "divorciado(a)",
    EstadoCivil.SEPARADO: "separado(a) judicialmente",
    EstadoCivil.VIUVO: "viúvo(a)",
}
_REGIME = {
    RegimeBens.COMUNHAO_PARCIAL: "comunhão parcial de bens",
    RegimeBens.COMUNHAO_UNIVERSAL: "comunhão universal de bens",
    RegimeBens.SEPARACAO_TOTAL: "separação total de bens",
    RegimeBens.SEPARACAO_OBRIGATORIA: "separação obrigatória de bens",
    RegimeBens.PARTICIPACAO_FINAL_AQUESTOS: "participação final nos aquestos",
}


def ordinal(n: int) -> str:
    if n < 1 or n > 39:
        return f"{n}ª"
    if n <= 10:
        return _ORDINAIS[n]
    dez, uni = divmod(n, 10)
    base = _DEZENAS_ORD[dez * 10]
    return base if uni == 0 else f"{base} {_ORD_MASC[uni]}"


def ordinal_alteracao(n: int | None) -> str:
    return ordinal(n) if n else ""


def data_br(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else "___/___/______"


def data_extenso(d: date) -> str:
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def qualificacao(s: Socio) -> str:
    partes = [f"**{s.nome.upper()}**", s.nacionalidade]
    if s.estado_civil:
        ec = _ESTADO_CIVIL[s.estado_civil]
        if s.estado_civil == EstadoCivil.CASADO and s.regime_bens:
            ec += f" sob o regime de {_REGIME[s.regime_bens]}"
        partes.append(ec)
    if s.profissao:
        partes.append(s.profissao)
    if s.data_nascimento:
        partes.append(f"nascido(a) em {data_br(s.data_nascimento)}")
    if s.rg:
        partes.append(f"portador(a) da cédula de identidade nº {s.rg}{' ' + s.orgao_emissor if s.orgao_emissor else ''}")
    partes.append(f"inscrito(a) no CPF sob o nº {formatar_cpf(s.cpf)}")
    if s.endereco:
        partes.append(f"residente e domiciliado(a) na {s.endereco.formatado()}")
    return ", ".join(partes)


def _milhar(n: int) -> str:
    return f"{int(n):,}".replace(",", ".")


def _ambiente() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        undefined=StrictUndefined,
        trim_blocks=False,
        lstrip_blocks=False,
        keep_trailing_newline=True,
    )
    env.filters.update(
        ordinal=ordinal,
        ordinal_alteracao=ordinal_alteracao,
        reais=formatar_reais,
        extenso=reais_por_extenso,
        inteiro_extenso=lambda n: inteiro_por_extenso(int(n)),
        milhar=_milhar,
        data=data_br,
        data_extenso=data_extenso,
        qualificacao=qualificacao,
        cpf=formatar_cpf,
        cnpj=lambda v: formatar_cnpj(v or ""),
    )
    return env


_TEMPLATE_POR_ATO = {
    TipoAto.CONSTITUICAO_LTDA: "constituicao_ltda.md.j2",
    TipoAto.CONSTITUICAO_SLU: "constituicao_slu.md.j2",
    TipoAto.ALTERACAO_LTDA: "alteracao_ltda.md.j2",
}


@dataclass
class ContratoGerado:
    markdown: str
    caminho_md: Path
    caminho_docx: Path
    sha256: str


def renderizar(processo: Processo, data_assinatura: date | None = None) -> str:
    """Renderiza a minuta em Markdown. Pressupõe que as regras societárias não têm ERROS."""
    emp = processo.empresa
    socios = processo.socios_ativos()
    if not emp.endereco_sede or emp.capital_social is None or emp.valor_quota is None:
        raise ValueError("Dados da empresa incompletos para gerar o contrato (sede, capital e quota).")
    total_quotas = int(Decimal(emp.capital_social) / Decimal(emp.valor_quota))
    nome = emp.nome_empresarial or "[NÚMERO DO CNPJ] LTDA"
    if emp.usar_cnpj_como_nome:
        nome = f"{formatar_cnpj(emp.cnpj)} LTDA" if emp.cnpj else "[NÚMERO DO CNPJ A SER ATRIBUÍDO] LTDA"
    campos = {k: getattr(emp, k) for k in type(emp).model_fields}
    e = SimpleNamespace(
        **campos,
        total_quotas=total_quotas,
        administradores=[s for s in socios if s.administrador],
        nome_exibicao=nome.upper(),
    )
    template = _ambiente().get_template(_TEMPLATE_POR_ATO[processo.tipo_ato])
    texto = template.render(
        e=e,
        socios=socios,
        signatarios=processo.socios,
        alteracoes=processo.alteracoes,
        numero_alteracao=processo.numero_alteracao,
        local=f"{emp.endereco_sede.municipio}/{emp.endereco_sede.uf}",
        data=data_assinatura or date.today(),
    )
    return re.sub(r"\n{3,}", "\n\n", texto).strip() + "\n"


def gerar(processo: Processo, pasta_saida: Path, data_assinatura: date | None = None) -> ContratoGerado:
    texto = renderizar(processo, data_assinatura)
    pasta_saida.mkdir(parents=True, exist_ok=True)
    base = f"minuta_{processo.tipo_ato.value}"
    md = pasta_saida / f"{base}.md"
    md.write_text(texto, encoding="utf-8")
    docx = pasta_saida / f"{base}.docx"
    markdown_para_docx(texto, docx)
    return ContratoGerado(texto, md, docx, hashlib.sha256(texto.encode("utf-8")).hexdigest())


# --------------------------------------------------------------------------- DOCX
_NEGRITO = re.compile(r"\*\*(.+?)\*\*")


def _adicionar_runs(paragrafo, texto: str) -> None:
    texto = texto.replace("\\_", "_")
    pos = 0
    for m in _NEGRITO.finditer(texto):
        if m.start() > pos:
            paragrafo.add_run(texto[pos:m.start()])
        paragrafo.add_run(m.group(1)).bold = True
        pos = m.end()
    if pos < len(texto):
        paragrafo.add_run(texto[pos:])


def markdown_para_docx(markdown: str, destino: Path) -> None:
    """Conversão simples do subconjunto de Markdown usado nos modelos (títulos, negrito, tabelas)."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    doc = Document()
    estilo = doc.styles["Normal"]
    estilo.font.name = "Arial"
    estilo.font.size = Pt(11)

    linhas = markdown.splitlines()
    i = 0
    while i < len(linhas):
        linha = linhas[i].rstrip()
        if not linha or linha == "---":
            i += 1
            continue
        if linha.startswith("|"):
            bloco = []
            while i < len(linhas) and linhas[i].startswith("|"):
                bloco.append(linhas[i])
                i += 1
            celulas = [[c.strip() for c in l.strip("|").split("|")] for l in bloco if not re.match(r"^\|[\s:|-]+\|$", l)]
            tabela = doc.add_table(rows=len(celulas), cols=len(celulas[0]))
            tabela.style = "Table Grid"
            for r, linha_cel in enumerate(celulas):
                for c, valor in enumerate(linha_cel):
                    p = tabela.cell(r, c).paragraphs[0]
                    _adicionar_runs(p, valor)
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", linha)
        if m:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(m.group(2).replace("**", ""))
            run.bold = True
            run.font.size = Pt(13 if len(m.group(1)) == 1 else 12)
        elif linha.startswith("_") and linha.endswith("_") and not linha.startswith("\\_"):
            p = doc.add_paragraph()
            p.add_run(linha.strip("_")).italic = True
        else:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            _adicionar_runs(p, linha)
        i += 1
    doc.save(str(destino))
