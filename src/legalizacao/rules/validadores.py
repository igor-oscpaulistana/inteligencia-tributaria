"""Validadores determinísticos (CPF, CNPJ, CEP, CNAE) e formatação."""

from __future__ import annotations

import re


def so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", valor or "")


def validar_cpf(cpf: str | None) -> bool:
    d = so_digitos(cpf)
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        dv = (soma * 10) % 11 % 10
        if dv != int(d[n]):
            return False
    return True


def validar_cnpj(cnpj: str | None) -> bool:
    d = so_digitos(cnpj)
    if len(d) != 14 or d == d[0] * 14:
        return False
    pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    pesos2 = [6] + pesos1
    for pesos, pos in ((pesos1, 12), (pesos2, 13)):
        soma = sum(int(d[i]) * pesos[i] for i in range(pos))
        resto = soma % 11
        dv = 0 if resto < 2 else 11 - resto
        if dv != int(d[pos]):
            return False
    return True


def validar_cep(cep: str | None) -> bool:
    return len(so_digitos(cep)) == 8


_CNAE_RE = re.compile(r"^\d{4}-\d/\d{2}$")


def validar_codigo_cnae(codigo: str | None) -> bool:
    return bool(codigo and _CNAE_RE.match(codigo.strip()))


def formatar_cpf(cpf: str) -> str:
    d = so_digitos(cpf)
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}" if len(d) == 11 else cpf


def formatar_cnpj(cnpj: str) -> str:
    d = so_digitos(cnpj)
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}" if len(d) == 14 else cnpj


def formatar_cep(cep: str) -> str:
    d = so_digitos(cep)
    return f"{d[:5]}-{d[5:]}" if len(d) == 8 else cep
