/**
 * components/blocks/DeputadoRegras.tsx — spec 026 (RF-274), design 026 § 2.6.
 *
 * "Regras com os números de {UF}": as regras do ADR-0027 (Código Eleitoral
 * arts. 106–109, com a interpretação do STF nas ADIs 7228/7263/7325) escritas
 * com os números DESTE estado, agora.
 *
 * 🔴 **Todo número vem do payload** (`regras`), inclusive os pisos. O
 * componente não calcula `⌈QE/10⌉`: se calculasse, um arredondamento diferente
 * do do modelo publicaria um piso que não é o que decidiu a cadeira. O teste
 * injeta um QE e pisos que só batem se lidos do dado (QE 1.003 ⇒ 101, 803,
 * 201 — design 017 § D8: prosa derivada, nunca literal). Os percentuais 10%,
 * 80% e 20% são a regra da lei, não dado — por isso são texto.
 *
 * Sem `regras` (sem vagas publicadas ou sem voto): o bloco fica e diz quando
 * os números aparecem — nunca zeros (decisão de 14/09, três estados).
 *
 * Server Component, zero JS.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import type { DeputadoRegras as RegrasDados } from "@/lib/blob/deputado-uf";
import { formatVotes } from "@/lib/utils/format";
import { TERMO_ESTADO, type TermoDoTerritorio } from "@/lib/utils/termo-territorio";

export interface DeputadoRegrasProps {
  uf: string;
  regras: RegrasDados | undefined;
  /** Spec 027 — "o estado" · "o Distrito Federal". Ausente ⇒ o termo dos estados. */
  territorio?: TermoDoTerritorio;
  titleId: string;
}

const TEXTO: React.CSSProperties = {
  margin: 0,
  font: "var(--type-body-sm)",
  color: "var(--text-secondary)",
  textWrap: "pretty",
};

export function DeputadoRegras({
  uf,
  regras,
  territorio = TERMO_ESTADO,
  titleId,
}: DeputadoRegrasProps) {
  return (
    <Panel
      kicker="Como as cadeiras são distribuídas"
      title={`Regras com os números de ${uf}`}
      titleId={titleId}
    >
      {regras ? (
        <div className="flex flex-col" style={{ gap: "var(--space-3)" }} data-testid="dep-regras">
          <p className="max-w-prose" style={TEXTO}>
            Os números abaixo são de agora: o quociente eleitoral muda a cada boletim, porque
            depende dos votos válidos já apurados em {uf}.
          </p>
          <dl
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
              gap: "var(--space-3)",
              margin: 0,
            }}
          >
            <Item
              rotulo="Cadeiras em disputa"
              valor={regras.lugares_a_preencher.toLocaleString("pt-BR")}
              nota={`o número que o TSE publicou para ${uf}`}
              testid="dep-regras-lugares"
            />
            <Item
              rotulo="Quociente eleitoral"
              valor={`${formatVotes(regras.quociente_eleitoral)} votos`}
              nota={`${formatVotes(regras.votos_validos)} votos válidos divididos pelas cadeiras`}
              testid="dep-regras-qe"
            />
            <Item
              rotulo="Piso do candidato (10% do quociente)"
              valor={`${formatVotes(regras.piso_candidato)} votos`}
              nota="o mínimo para ocupar uma cadeira que a agremiação ganhou pelo quociente"
              testid="dep-regras-piso-candidato"
            />
            <Item
              rotulo="Agremiação nas sobras (80% do quociente)"
              valor={`${formatVotes(regras.piso_agremiacao_sobras)} votos`}
              nota="o mínimo da agremiação para disputar as cadeiras que sobram"
              testid="dep-regras-piso-agremiacao"
            />
            <Item
              rotulo="Candidato nas sobras (20% do quociente)"
              valor={`${formatVotes(regras.piso_candidato_sobras)} votos`}
              nota="o mínimo do candidato para ocupar uma dessas cadeiras"
              testid="dep-regras-piso-sobras"
            />
          </dl>
          <p className="max-w-prose" style={TEXTO}>
            <strong>Primeiro, o quociente.</strong> Cada agremiação — partido ou federação — leva
            uma cadeira para cada quociente eleitoral inteiro que somar (é o quociente partidário).
            Essas cadeiras vão para os seus candidatos mais votados que tenham pelo menos o piso de
            10%.
          </p>
          <p className="max-w-prose" style={TEXTO}>
            <strong>Depois, as sobras.</strong> As cadeiras que restam são distribuídas uma a uma
            pela maior média — os votos da agremiação divididos pelas cadeiras que ela já tem, mais
            uma. Nessa rodada só entram agremiações com 80% do quociente e candidatos com 20% dele.
            Se ainda sobrar cadeira e ninguém mais cumprir esses pisos, a rodada final é aberta a
            todas as agremiações, sem piso, pela mesma maior média.
          </p>
        </div>
      ) : (
        <p className="max-w-prose" style={TEXTO} data-testid="dep-regras-aguardando">
          As regras com os números de {uf} aparecem aqui quando o TSE publicar quantas cadeiras{" "}
          {territorio.o} elege e houver votos apurados — o quociente eleitoral depende das duas
          coisas.
        </p>
      )}
    </Panel>
  );
}

function Item({
  rotulo,
  valor,
  nota,
  testid,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  testid: string;
}) {
  return (
    <div>
      <dt
        style={{
          font: "var(--type-kicker)",
          letterSpacing: "var(--tracking-caps)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {rotulo}
      </dt>
      <dd style={{ margin: 0, font: "var(--type-figure-sm)" }} data-testid={testid}>
        {valor}
      </dd>
      <dd
        style={{
          margin: 0,
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        {nota}
      </dd>
    </div>
  );
}
