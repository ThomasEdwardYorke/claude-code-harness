/**
 * config.test.ts
 * Unit tests for harness.config.json loader.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadConfigSafe,
} from "../config.js";

function mkTmp(): string {
  const dir = join(
    tmpdir(),
    `harness-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig / loadConfigSafe", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkTmp();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns defaults when no file exists", () => {
    expect(loadConfig(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("merges user values over defaults (scalar fields)", () => {
    writeFileSync(
      join(projectRoot, "harness.config.json"),
      JSON.stringify({
        projectName: "my-app",
        language: "ja",
        protectedDirectories: ["training-data"],
      }),
    );
    const cfg = loadConfig(projectRoot);
    expect(cfg.projectName).toBe("my-app");
    expect(cfg.language).toBe("ja");
    expect(cfg.protectedDirectories).toEqual(["training-data"]);
    // Fields the user didn't touch still come from DEFAULT_CONFIG.
    expect(cfg.protectedEnvVarNames).toEqual(DEFAULT_CONFIG.protectedEnvVarNames);
  });

  it("deep-merges nested objects (workMode, codex, tampering)", () => {
    writeFileSync(
      join(projectRoot, "harness.config.json"),
      JSON.stringify({
        workMode: { bypassRmRf: true },
        tampering: { severity: "deny" },
      }),
    );
    const cfg = loadConfig(projectRoot);
    expect(cfg.workMode.bypassRmRf).toBe(true);
    // bypassGitPush still inherits the default.
    expect(cfg.workMode.bypassGitPush).toBe(false);
    expect(cfg.tampering.severity).toBe("deny");
  });

  it("loadConfig throws on malformed JSON", () => {
    writeFileSync(join(projectRoot, "harness.config.json"), "{not-json}");
    expect(() => loadConfig(projectRoot)).toThrow();
  });

  it("loadConfigSafe returns defaults on malformed JSON", () => {
    writeFileSync(join(projectRoot, "harness.config.json"), "{not-json}");
    expect(loadConfigSafe(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("loadConfigSafe returns defaults when file is missing", () => {
    expect(loadConfigSafe(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("default config is safe: R10 / R11 / R13 all no-op or minimal", () => {
    expect(DEFAULT_CONFIG.protectedDirectories).toEqual([]);
    expect(DEFAULT_CONFIG.protectedFileSuffixes).toEqual([".env"]);
    // The default env-var name list is non-empty but only contains globally
    // known secret names, so it is safe to enable for any project.
    expect(DEFAULT_CONFIG.protectedEnvVarNames.length).toBeGreaterThan(0);
  });
});
