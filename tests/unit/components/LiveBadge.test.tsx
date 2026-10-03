// @vitest-environment happy-dom
/**
 * tests/unit/components/LiveBadge.test.tsx — RF-028.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiveBadge } from "@/components/layout/LiveBadge";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("<LiveBadge />", () => {
  it("(a) active=true → texto 'AO VIVO' e ponto com animação pulse", () => {
    const doc = parse(<LiveBadge />);
    const status = doc.querySelector('[role="status"]');
    expect(status?.textContent).toContain("AO VIVO");
    const dot = doc.querySelector('[data-testid="live-badge-dot"]');
    expect(dot?.getAttribute("style")).toContain("atlasmenna-pulse");
  });

  it("(b) active=false → 'OFFLINE' e sem animação", () => {
    const doc = parse(<LiveBadge active={false} />);
    const status = doc.querySelector('[role="status"]');
    expect(status?.textContent).toContain("OFFLINE");
    const dot = doc.querySelector('[data-testid="live-badge-dot"]');
    expect(dot?.getAttribute("style") ?? "").not.toContain("atlasmenna-pulse");
  });

  it("(c) label custom override", () => {
    const doc = parse(<LiveBadge label="EM APURAÇÃO" />);
    expect(doc.querySelector('[role="status"]')?.textContent).toContain("EM APURAÇÃO");
  });

  it("(d) aria-label inclui o status legível", () => {
    const doc = parse(<LiveBadge />);
    expect(doc.querySelector('[role="status"]')?.getAttribute("aria-label")).toContain("ao vivo");
  });
});
