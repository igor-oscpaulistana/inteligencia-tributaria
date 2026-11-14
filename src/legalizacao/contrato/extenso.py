"""Valores por extenso em português (reais e números inteiros), usados no contrato social."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

_UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
             "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
             "dezoito", "dezenove"]
_DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
             "setecentos", "oitocentos", "novecentos"]
_ESCALAS = [("", ""), ("mil", "mil"), ("milhão", "milhões"), ("bilhão", "bilhões"), ("trilhão", "trilhões")]


def _ate_999(n: int) -> str:
    if n == 0:
        return ""
    if n == 100:
        return "cem"
    c, resto = divmod(n, 100)
    partes = []
    if c:
        partes.append(_CENTENAS[c])
    if resto:
        if resto < 20:
            partes.append(_UNIDADES[resto])
        else:
            d, u = divmod(resto, 10)
            partes.append(_DEZENAS[d] + (f" e {_UNIDADES[u]}" if u else ""))
    return " e ".join(partes)


def inteiro_por_extenso(n: int) -> str:
    if n < 0:
        raise ValueError("Somente números não negativos")
    if n == 0:
        return "zero"
    grupos = []
    while n:
        n, g = divmod(n, 1000)
        grupos.append(g)
    partes: list[tuple[int, str]] = []
    for i, g in enumerate(grupos):
        if g == 0:
            continue
        sing, plur = _ESCALAS[i]
        if i == 1:
            texto = "mil" if g == 1 else f"{_ate_999(g)} mil"
        elif i >= 2:
            texto = f"{_ate_999(g)} {sing if g == 1 else plur}"
        else:
            texto = _ate_999(g)
        partes.append((g, texto))
    partes.reverse()
    # Regra do "e": usa-se "e" antes do último grupo quando ele é < 100 ou centena exata.
    resultado = partes[0][1]
    for g, texto in partes[1:]:
        conj = " e " if (g < 100 or g % 100 == 0) else " "
        resultado += conj + texto
    return resultado


def reais_por_extenso(valor: Decimal | int | float | str) -> str:
    v = Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    inteiro = int(v)
    centavos = int((v - inteiro) * 100)
    partes = []
    if inteiro:
        txt = inteiro_por_extenso(inteiro)
        # "um milhão de reais", "dois milhões de reais" (sem grupos menores)
        if inteiro >= 1_000_000 and inteiro % 1_000_000 == 0:
            txt += " de"
        partes.append(f"{txt} {'real' if inteiro == 1 else 'reais'}")
    if centavos:
        partes.append(f"{inteiro_por_extenso(centavos)} {'centavo' if centavos == 1 else 'centavos'}")
    if not partes:
        return "zero real"
    return " e ".join(partes)


def formatar_reais(valor: Decimal | int | float | str) -> str:
    v = Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    inteiro, dec = f"{v:.2f}".split(".")
    inteiro = f"{int(inteiro):,}".replace(",", ".")
    return f"R$ {inteiro},{dec}"
