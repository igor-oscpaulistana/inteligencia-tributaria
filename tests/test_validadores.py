from legalizacao.contrato.extenso import formatar_reais, reais_por_extenso
from legalizacao.rules.validadores import validar_cnpj, validar_codigo_cnae, validar_cpf


def test_cpf():
    assert validar_cpf("529.982.247-25")
    assert not validar_cpf("529.982.247-24")
    assert not validar_cpf("111.111.111-11")


def test_cnpj():
    assert validar_cnpj("11.222.333/0001-81")
    assert not validar_cnpj("11.222.333/0001-80")


def test_cnae():
    assert validar_codigo_cnae("6202-3/00")
    assert not validar_codigo_cnae("6202300")


def test_extenso():
    assert reais_por_extenso("50000") == "cinquenta mil reais"
    assert reais_por_extenso("1000000") == "um milhão de reais"
    assert reais_por_extenso("2350.10") == "dois mil trezentos e cinquenta reais e dez centavos"
    assert reais_por_extenso("1") == "um real"
    assert formatar_reais("1234567.8") == "R$ 1.234.567,80"
