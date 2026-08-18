import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_FILENAME = "Roview.rbxm";

export interface PluginOptions {
  sourcePath?: string | undefined;
  pluginsDir?: string | undefined;
  homeDir?: string | undefined;
  osPlatform?: NodeJS.Platform | string | undefined;
}

export interface PluginInstallResult {
  success: boolean;
  sourcePath: string;
  targetPath: string;
  bytes: number;
  dirCreated: boolean;
  isCustomDir: boolean;
}

export interface PluginUninstallResult {
  success: boolean;
  targetPath: string;
  existed: boolean;
}

export interface PluginStatusResult {
  pluginsDir: string;
  pluginPath: string;
  installed: boolean;
  dirExists: boolean;
  bytes?: number | undefined;
  modifiedAt?: string | undefined;
  troubleshooting?: string | undefined;
}

/**
 * Returns candidate Roblox Studio local plugins directories in priority order.
 */
export function getCandidatePluginsDirs(
  osPlatform: NodeJS.Platform | string = platform(),
  home = homedir()
): string[] {
  if (osPlatform === "darwin") {
    return [
      join(home, "Documents", "Roblox", "Plugins"),
      // macOS iCloud Drive sync fallback
      join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Documents", "Roblox", "Plugins"),
    ];
  }

  if (osPlatform === "win32") {
    const candidates: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(join(localAppData, "Roblox", "Plugins"));
    }
    candidates.push(join(home, "AppData", "Local", "Roblox", "Plugins"));
    candidates.push(join(home, "Documents", "Roblox", "Plugins"));
    // Windows OneDrive redirection fallback
    if (process.env.OneDrive) {
      candidates.push(join(process.env.OneDrive, "Documents", "Roblox", "Plugins"));
    }
    return candidates;
  }

  // Linux / Wine / Sober / Grapejuice
  const candidates: string[] = [];
  const dataHome = process.env.XDG_DATA_HOME;
  if (dataHome) {
    candidates.push(join(dataHome, "roblox", "Plugins"));
  }
  candidates.push(join(home, ".local", "share", "roblox", "Plugins"));
  candidates.push(join(home, ".var", "app", "io.github.vinegarhq.Sober", "data", "sober", "plugins"));
  candidates.push(join(home, ".local", "share", "grapejuice", "plugins"));
  return candidates;
}

/**
 * Returns the default Roblox Studio local plugins directory for the current or specified platform.
 */
export function getRobloxPluginsDir(
  osPlatform: NodeJS.Platform | string = platform(),
  home = homedir()
): string {
  const candidates = getCandidatePluginsDirs(osPlatform, home);
  return candidates[0] ?? join(home, "Documents", "Roblox", "Plugins");
}

/**
 * Generates clear, step-by-step instructions for locating the exact Roblox Studio plugins folder.
 */
export function formatPluginsLocationGuide(customDir?: string): string {
  const expectedDefault = customDir ?? getRobloxPluginsDir();
  return `\x1B[1mHow to find your Roblox Studio Plugins folder:\x1B[0m
  1. Open \x1B[1mRoblox Studio\x1B[0m.
  2. In the top ribbon menu, click the \x1B[36mPlugins\x1B[0m tab.
  3. Click the \x1B[36mPlugins Folder\x1B[0m button (this opens the exact directory in Finder / File Explorer).
  4. Once opened, you can either:
     • Run: \x1B[32mroview plugin install --dir "<path-to-that-folder>"\x1B[0m
     • Or manually drag & drop \x1B[1m${PLUGIN_FILENAME}\x1B[0m into that folder.

  \x1B[2mExpected default path for your system:\x1B[0m
  ${expectedDefault}`;
}

/**
 * Searches common candidate locations for the compiled roview-plugin.rbxm binary.
 */
export async function findBundledPlugin(customPath?: string): Promise<string> {
  if (customPath) {
    const resolved = resolve(customPath);
    await stat(resolved);
    return resolved;
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    // Direct in current working directory
    resolve(process.cwd(), "roview-plugin.rbxm"),
    // Workspace root from apps/cli/src
    resolve(currentDir, "../../../roview-plugin.rbxm"),
    // Dist / package relative paths
    resolve(currentDir, "../assets/roview-plugin.rbxm"),
    resolve(currentDir, "../../assets/roview-plugin.rbxm"),
    resolve(currentDir, "../roview-plugin.rbxm"),
  ];

  for (const candidate of candidatePaths) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Continue searching next candidate
    }
  }

  throw new Error(
    "Could not locate 'roview-plugin.rbxm'. Build the plugin first with 'pnpm build:plugin' or specify --file <path>."
  );
}

/**
 * Resolves the best existing plugins directory among candidate locations.
 */
export async function resolveExistingPluginsDir(options: PluginOptions = {}): Promise<{
  pluginsDir: string;
  exists: boolean;
}> {
  if (options.pluginsDir) {
    try {
      const s = await stat(options.pluginsDir);
      return { pluginsDir: options.pluginsDir, exists: s.isDirectory() };
    } catch {
      return { pluginsDir: options.pluginsDir, exists: false };
    }
  }

  const candidates = getCandidatePluginsDirs(options.osPlatform, options.homeDir);
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) {
        return { pluginsDir: candidate, exists: true };
      }
    } catch {}
  }

  // Fallback to default
  return { pluginsDir: candidates[0] ?? getRobloxPluginsDir(), exists: false };
}

/**
 * Installs the Roview Roblox Studio plugin into the local Studio plugins folder.
 */
export async function installPlugin(options: PluginOptions = {}): Promise<PluginInstallResult> {
  const sourcePath = await findBundledPlugin(options.sourcePath);
  const resolved = await resolveExistingPluginsDir(options);
  const pluginsDir = resolved.pluginsDir;

  let dirCreated = false;
  if (!resolved.exists) {
    await mkdir(pluginsDir, { recursive: true });
    dirCreated = true;
  }

  const targetPath = join(pluginsDir, PLUGIN_FILENAME);
  await copyFile(sourcePath, targetPath);
  const stats = await stat(targetPath);

  return {
    success: true,
    sourcePath,
    targetPath,
    bytes: stats.size,
    dirCreated,
    isCustomDir: Boolean(options.pluginsDir),
  };
}

/**
 * Uninstalls the Roview Roblox Studio plugin from the local Studio plugins folder.
 */
export async function uninstallPlugin(options: PluginOptions = {}): Promise<PluginUninstallResult> {
  const resolved = await resolveExistingPluginsDir(options);
  const targetPath = join(resolved.pluginsDir, PLUGIN_FILENAME);

  let existed = false;
  try {
    const stats = await stat(targetPath);
    if (stats.isFile()) {
      existed = true;
      await unlink(targetPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return {
    success: true,
    targetPath,
    existed,
  };
}

/**
 * Retrieves the current installation status of the Studio plugin.
 */
export async function getPluginStatus(options: PluginOptions = {}): Promise<PluginStatusResult> {
  const resolved = await resolveExistingPluginsDir(options);
  const pluginsDir = resolved.pluginsDir;
  const pluginPath = join(pluginsDir, PLUGIN_FILENAME);

  if (!resolved.exists) {
    return {
      pluginsDir,
      pluginPath,
      installed: false,
      dirExists: false,
      troubleshooting: formatPluginsLocationGuide(pluginsDir),
    };
  }

  try {
    const stats = await stat(pluginPath);
    if (stats.isFile()) {
      return {
        pluginsDir,
        pluginPath,
        installed: true,
        dirExists: true,
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    }
  } catch {
    // Not installed
  }

  return {
    pluginsDir,
    pluginPath,
    installed: false,
    dirExists: true,
    troubleshooting: formatPluginsLocationGuide(pluginsDir),
  };
}
