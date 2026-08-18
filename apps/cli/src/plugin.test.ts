import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_FILENAME,
  findBundledPlugin,
  getPluginStatus,
  getRobloxPluginsDir,
  installPlugin,
  uninstallPlugin,
} from "./plugin.js";

describe("Roblox Studio Plugin Management (apps/cli/src/plugin.ts)", () => {
  let tempDir: string;
  let mockPluginsDir: string;
  let dummyPluginPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "roview-plugin-test-"));
    mockPluginsDir = join(tempDir, "Roblox", "Plugins");
    dummyPluginPath = join(tempDir, "source-plugin.rbxm");
    await writeFile(dummyPluginPath, "MOCK_RBXM_BINARY_DATA_TEST_12345");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getRobloxPluginsDir", () => {
    it("resolves macOS plugin path", () => {
      const dir = getRobloxPluginsDir("darwin", "/Users/tester");
      expect(dir).toBe("/Users/tester/Documents/Roblox/Plugins");
    });

    it("resolves Windows plugin path using LOCALAPPDATA", () => {
      const orig = process.env.LOCALAPPDATA;
      try {
        process.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
        const dir = getRobloxPluginsDir("win32", "C:\\Users\\tester");
        expect(dir).toBe("C:\\Users\\tester\\AppData\\Local/Roblox/Plugins");
      } finally {
        process.env.LOCALAPPDATA = orig;
      }
    });

    it("resolves Linux XDG plugin path", () => {
      const orig = process.env.XDG_DATA_HOME;
      try {
        delete process.env.XDG_DATA_HOME;
        const dir = getRobloxPluginsDir("linux", "/home/tester");
        expect(dir).toBe("/home/tester/.local/share/roblox/Plugins");
      } finally {
        if (orig) process.env.XDG_DATA_HOME = orig;
      }
    });
  });

  describe("findBundledPlugin", () => {
    it("finds plugin at explicit custom path", async () => {
      const found = await findBundledPlugin(dummyPluginPath);
      expect(found).toBe(dummyPluginPath);
    });

    it("finds default repo built plugin if present or fails with informative message", async () => {
      try {
        const found = await findBundledPlugin();
        expect(found).toContain("roview-plugin.rbxm");
      } catch (err: any) {
        expect(err.message).toContain("roview-plugin.rbxm");
      }
    });

    it("throws if non-existent custom path is provided", async () => {
      await expect(findBundledPlugin(join(tempDir, "missing.rbxm"))).rejects.toThrow();
    });
  });

  describe("installPlugin & uninstallPlugin", () => {
    it("installs plugin to target plugins directory and verifies status", async () => {
      // Initially not installed
      const initialStatus = await getPluginStatus({ pluginsDir: mockPluginsDir });
      expect(initialStatus.installed).toBe(false);

      // Install
      const installResult = await installPlugin({
        sourcePath: dummyPluginPath,
        pluginsDir: mockPluginsDir,
      });

      expect(installResult.success).toBe(true);
      expect(installResult.targetPath).toBe(join(mockPluginsDir, PLUGIN_FILENAME));
      expect(installResult.bytes).toBeGreaterThan(0);

      // Check status
      const status = await getPluginStatus({ pluginsDir: mockPluginsDir });
      expect(status.installed).toBe(true);
      expect(status.pluginPath).toBe(join(mockPluginsDir, PLUGIN_FILENAME));
      expect(status.bytes).toBe(installResult.bytes);
      expect(status.modifiedAt).toBeDefined();

      // Verify file exists on disk
      const diskStat = await stat(join(mockPluginsDir, PLUGIN_FILENAME));
      expect(diskStat.isFile()).toBe(true);

      // Uninstall
      const uninstallResult = await uninstallPlugin({ pluginsDir: mockPluginsDir });
      expect(uninstallResult.success).toBe(true);
      expect(uninstallResult.existed).toBe(true);

      // Status after uninstall
      const statusAfter = await getPluginStatus({ pluginsDir: mockPluginsDir });
      expect(statusAfter.installed).toBe(false);
    });

    it("handles uninstall when plugin does not exist gracefully", async () => {
      const uninstallResult = await uninstallPlugin({ pluginsDir: mockPluginsDir });
      expect(uninstallResult.success).toBe(true);
      expect(uninstallResult.existed).toBe(false);
    });

    it("provides troubleshooting guide when directory does not exist", async () => {
      const nonExistent = join(tempDir, "NonExistentDir");
      const status = await getPluginStatus({ pluginsDir: nonExistent });
      expect(status.installed).toBe(false);
      expect(status.dirExists).toBe(false);
      expect(status.troubleshooting).toBeDefined();
      expect(status.troubleshooting).toContain("Plugins Folder");
      expect(status.troubleshooting).toContain("roview plugin install --dir");
    });
  });
});

