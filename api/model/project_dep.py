"""Mesma função do modelo (`api/model/project.py`), outro endereço — só para os
cargos proporcionais (6, 7, 8).

🔴 04/10/2026 ~20h15, noite do 1º turno: com os sete cargos na MESMA função, o
cálculo do Deputado Federal (o mais pesado — milhares de candidaturas por
zona) dividia instância com Presidente, Governador e Senado. Das 18h30 às
20h10 os registros mostram, sempre com o cargo 6 em voo: "ran out of
available memory" no Senado e no Presidente, e "Task timed out after 300
seconds" no Presidente (que leva ~20 s sozinho). Presidente ficou 30 min sem
publicar. Função separada = instâncias separadas: o Deputado não derruba
mais os majoritários.

O código é o MESMO — este arquivo só reexporta o `handler`. O endereço é
escolhido em `lib/tse/ingest-handler.ts` (`triggerModel`).
"""

from api.model.project import handler as _ProjectHandler


class handler(_ProjectHandler):  # noqa: N801 — nome exigido pelo runtime Python da Vercel
    pass
