from datetime import date

from conftest import socio

from legalizacao.contrato.gerador import gerar, ordinal, renderizar
from legalizacao.models import Alteracao, TipoAlteracao, TipoAto


def test_ordinal():
    assert ordinal(1) == "PRIMEIRA"
    assert ordinal(13) == "DÉCIMA TERCEIRA"
    assert ordinal(20) == "VIGÉSIMA"


def test_constituicao_ltda(processo_ltda):
    texto = renderizar(processo_ltda, date(2026, 11, 13))
    assert "INSTRUMENTO PARTICULAR DE CONSTITUIÇÃO" in texto
    assert "ALFA TECNOLOGIA LTDA" in texto
    assert "R$ 50.000,00 (cinquenta mil reais)" in texto
    assert "529.982.247-25" in texto
    assert "comunhão parcial de bens" in texto
    assert "DA CESSÃO E TRANSFERÊNCIA DE QUOTAS" in texto
    assert "Microempresa – ME" in texto
    assert "13 de novembro de 2026" in texto
    assert ", ," not in texto


def test_constituicao_slu(processo_ltda):
    processo_ltda.tipo_ato = TipoAto.CONSTITUICAO_SLU
    processo_ltda.socios = [socio("Ana Souza", "529.982.247-25", 50000)]
    texto = renderizar(processo_ltda)
    assert "SOCIEDADE LIMITADA UNIPESSOAL" in texto
    assert "CESSÃO E TRANSFERÊNCIA" not in texto
    assert "sócio único" in texto


def test_alteracao(processo_ltda):
    processo_ltda.tipo_ato = TipoAto.ALTERACAO_LTDA
    processo_ltda.numero_alteracao = 2
    processo_ltda.empresa.cnpj = "11222333000181"
    processo_ltda.empresa.nire = "35212345678"
    processo_ltda.socios.append(socio("Carlos Retirante", "390.533.447-05", 0, admin=False, retirante=True))
    processo_ltda.alteracoes = [Alteracao(tipo=TipoAlteracao.SAIDA_SOCIO, descricao="Retira-se da sociedade o sócio CARLOS RETIRANTE...")]
    texto = renderizar(processo_ltda)
    assert texto.startswith("# SEGUNDA ALTERAÇÃO CONTRATUAL")
    assert "11.222.333/0001-81" in texto
    assert "(sócio(a) retirante)" in texto
    consolidacao = texto.split("CONSOLIDAÇÃO DO CONTRATO SOCIAL")[1]
    assert "CARLOS RETIRANTE" not in consolidacao.split("assinam")[0]


def test_gera_docx(processo_ltda, tmp_path):
    g = gerar(processo_ltda, tmp_path)
    assert g.caminho_docx.exists() and g.caminho_md.exists() and len(g.sha256) == 64
