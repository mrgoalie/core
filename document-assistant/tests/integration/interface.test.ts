import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { getDraftUi, homeFor, listUiVersions, previewHome, publishUi, restoreUi, saveDraftUi } from "@/server/services/ui";
import { actor, DEMO, freshDb, skillId } from "../helpers";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await freshDb()));
afterAll(async () => close());

describe("Interface Editor (administrator task C)", () => {
  it("renames, re-icons and reorders a skill in a draft without affecting employees until published", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const maria = await actor(db, DEMO.maria);
    const demand = await skillId(db, "demand-letter");
    const arb = await skillId(db, "arbitration-package");
    const { config } = await getDraftUi(db, jordan);
    config.skills = [
      { skillId: arb, featured: true },
      { skillId: demand, featured: true, label: "Prepare Insurance Demand", icon: "gavel" },
    ];
    config.home.heading = "What would you like to work on?";
    await saveDraftUi(db, jordan, config);
    expect((await homeFor(db, maria)).tiles[0].label).toBe("Write a Demand Letter");
    const preview = await previewHome(db, jordan, { asUserId: maria.id, source: "draft" });
    expect(preview.tiles.map((t) => t.label)).toEqual(["Create an Arbitration Package", "Prepare Insurance Demand"]);
    expect(preview.recent.every((r) => r.matter?.includes("preview only"))).toBe(true);

    // Move the renamed skill to the top, then publish.
    config.skills.reverse();
    await saveDraftUi(db, jordan, config);
    await publishUi(db, jordan, "Renamed demand letter");
    const home = await homeFor(db, maria);
    expect(home.ui.home.heading).toBe("What would you like to work on?");
    expect(home.tiles.map((t) => [t.label, t.icon])).toEqual([
      ["Prepare Insurance Demand", "gavel"],
      ["Create an Arbitration Package", "scale"],
    ]);
  });

  it("never shows a skill to someone who isn't permitted to use it, whatever the layout says", async () => {
    const daniel = await actor(db, DEMO.daniel);
    const home = await homeFor(db, daniel);
    expect(home.tiles.map((t) => t.label)).toEqual(["Prepare Insurance Demand"]);
  });

  it("rejects unreadable colours and empty essential navigation", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const { config } = await getDraftUi(db, jordan);
    await expect(saveDraftUi(db, jordan, { ...config, branding: { ...config.branding, accentColor: "#F5F5F5" } })).rejects.toThrow(/need attention/);
    await expect(saveDraftUi(db, jordan, { ...config, navigation: { ...config.navigation, myWorkLabel: "" } })).rejects.toThrow();
  });

  it("only firm administrators can edit the interface", async () => {
    const maria = await actor(db, DEMO.maria);
    const taylor = await actor(db, DEMO.taylor);
    await expect(getDraftUi(db, maria)).rejects.toThrow();
    await expect(publishUi(db, taylor, undefined)).rejects.toThrow();
  });

  it("restores a previous published layout", async () => {
    const jordan = await actor(db, DEMO.jordan);
    const maria = await actor(db, DEMO.maria);
    const versions = await listUiVersions(db);
    const original = versions.find((v) => v.number === 1)!;
    await restoreUi(db, jordan, original.id);
    const home = await homeFor(db, maria);
    expect(home.ui.home.heading).toBe("What do you need to prepare?");
    expect(home.tiles[0].label).toBe("Write a Demand Letter");
    expect((await listUiVersions(db)).filter((v) => v.status === "published")).toHaveLength(1);
  });
});
