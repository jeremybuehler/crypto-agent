import { describe, expect, it } from "vitest";
import { InMemoryOpsState } from "@agent/risk";

describe("InMemoryOpsState", () => {
  it("starts with kill switch disabled and not paused", async () => {
    const state = new InMemoryOpsState();
    expect(await state.getKillSwitchEnabled()).toBe(false);
    expect(await state.getPaused()).toBe(false);
  });

  it("enables and disables the kill switch", async () => {
    const state = new InMemoryOpsState();
    await state.setKillSwitchEnabled(true);
    expect(await state.getKillSwitchEnabled()).toBe(true);
    await state.setKillSwitchEnabled(false);
    expect(await state.getKillSwitchEnabled()).toBe(false);
  });

  it("sets and clears pause", async () => {
    const state = new InMemoryOpsState();
    await state.setPaused(true);
    expect(await state.getPaused()).toBe(true);
    await state.setPaused(false);
    expect(await state.getPaused()).toBe(false);
  });
});
