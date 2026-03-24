import { describe, it, expect } from "bun:test";
import {
  type AgentConfig,
  type ProfileConfig,
  type DomainConfig,
  type ConstraintState,
  type AgentResponse,
  type AuthMode,
  type ModelCost,
  type DelegationTarget,
  isConstraintConflict,
  isMetered,
  createDefaultConstraintState,
} from "../src/types";

describe("ConstraintState", () => {
  it("createDefaultConstraintState returns zeroed state", () => {
    const state = createDefaultConstraintState();
    expect(state.elapsed_minutes).toBe(0);
    expect(state.budget_spent).toBe(0);
    expect(state.rounds_completed).toBe(0);
    expect(state.past_all_minimums).toBe(false);
    expect(state.hit_maximum).toBe(false);
    expect(state.can_end).toBe(false);
    expect(state.bias_ratio).toBe(0);
    expect(state.bias_blocked).toBe(false);
    expect(state.metered).toBe(true);
  });

  it("isConstraintConflict detects budget max before time min", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "constraint_conflict";
    state.conflict_detail = "budget_max hit before time_min met";
    expect(isConstraintConflict(state)).toBe(true);
  });

  it("isConstraintConflict returns false for normal hit", () => {
    const state = createDefaultConstraintState();
    state.hit_maximum = true;
    state.hit_reason = "time";
    expect(isConstraintConflict(state)).toBe(false);
  });
});

describe("AuthMode", () => {
  it("isMetered returns true for api_key auth", () => {
    const auth: AuthMode = { type: "api_key", metered: true };
    expect(isMetered(auth)).toBe(true);
  });

  it("isMetered returns false for subscription auth", () => {
    const auth: AuthMode = { type: "subscription", metered: false, subscription_tier: "max" };
    expect(isMetered(auth)).toBe(false);
  });
});
