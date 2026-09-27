#!/usr/bin/env python3
"""
Gera `index.html` (protótipo autônomo) a partir de `template.html`, das
fixtures do simulado e das cores de partido do site.

Rodar da raiz do repositório:

    python3 docs/design-system/prototipos/apuracao-2026-09-27/gerar.py

Lê só arquivos locais (nada de banco, nada de rede):
  - tests/fixtures/simulacao/{presidente,presidente-uf,governador-uf,senador-uf}.json
  - app/tokens-party.css (bloco claro: --party-<slug>, -chip, -ink, -text)
"""
import json
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parents[4]
AQUI = pathlib.Path(__file__).resolve().parent
FIX = RAIZ / "tests" / "fixtures" / "simulacao"
CAMPOS = ["id", "nome", "partido", "destino", "votos_atuais", "votos_projetados",
          "pct_atual", "pct_projetado", "sqcand"]


def cands(lista):
    return [{k: c.get(k) for k in CAMPOS} for c in lista]


def dados():
    out = {}
    p = json.loads((FIX / "presidente.json").read_text())
    out["pres-br"] = {"titulo": "Presidente · Brasil", "uf": "BR",
                      "pct_apurado": p["pct_apurado_total"], "vagas": 1,
                      "cands": cands(p["national"]["candidatos"])}
    for arq, chave, titulo, vagas, uf_foto in [
        ("presidente-uf.json", "pres-sp", "Presidente · São Paulo", 1, "BR"),
        ("governador-uf.json", "gov-sp", "Governador · São Paulo", 1, "SP"),
        ("senador-uf.json", "sen-sp", "Senador · São Paulo", 2, "SP"),
    ]:
        d = json.loads((FIX / arq).read_text())["SP"]
        out[chave] = {"titulo": titulo, "uf": uf_foto, "pct_apurado": d.get("pct_apurado"),
                      "vagas": vagas, "cands": cands(d["candidatos"])}
    return out


def cores():
    css = (RAIZ / "app" / "tokens-party.css").read_text()
    # O bloco claro vem antes do escuro; o escuro começa na 2ª definição de --party-pt.
    primeira = css.index("--party-pt:")
    claro = css[: css.index("--party-pt:", primeira + 1)]
    res = {}
    for slug, suf, hexa in re.findall(r"--party-([a-z0-9]+)(-chip|-ink|-text)?: (#[0-9a-f]{6})", claro):
        res.setdefault(slug, {})[(suf or "-base")[1:]] = hexa
    return res


if __name__ == "__main__":
    bundle = json.dumps({"dados": dados(), "cores": cores()}, ensure_ascii=False)
    tpl = (AQUI / "template.html").read_text()
    (AQUI / "index.html").write_text(tpl.replace("__BUNDLE__", bundle))
    print(f"ok — {AQUI / 'index.html'}")
