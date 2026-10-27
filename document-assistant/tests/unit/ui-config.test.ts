import { describe, expect, it } from "vitest";
import { contrastRatio, defaultUiConfig, UiConfig } from "@/lib/ui-config";

describe("interface configuration guardrails", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#1F3A5F", "#FFFFFF")).toBeGreaterThan(4.5);
  });

  it("rejects colours that make button text unreadable", () => {
    const cfg = defaultUiConfig();
    const r = UiConfig.safeParse({ ...cfg, branding: { ...cfg.branding, accentColor: "#FFE066" } });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toMatch(/too light/);
  });

  it("requires essential navigation labels and blocks markup", () => {
    const cfg = defaultUiConfig();
    expect(UiConfig.safeParse({ ...cfg, navigation: { ...cfg.navigation, homeLabel: "" } }).success).toBe(false);
    expect(UiConfig.safeParse({ ...cfg, home: { ...cfg.home, heading: "<script>x</script>" } }).success).toBe(false);
  });

  it("has no setting for hiding legal warnings or attorney review", () => {
    const parsed = UiConfig.parse({ ...defaultUiConfig(), hideLegalWarnings: true, attorneyReview: false } as never);
    expect(JSON.stringify(parsed)).not.toMatch(/hideLegalWarnings|attorneyReview/);
  });
});
