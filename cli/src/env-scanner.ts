import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { getAdapterDir, type AdapterName } from "./utils";
import type {
  AdapterReadiness,
  AdapterStatus,
  AosAdapterReadiness,
  AuthState,
  PackageManager,
  ScanReport,
  VendorCliReadiness,
} from "./init-types";

export interface AdapterMetadata {
  label: string;
  packageName: string;
  cliBinary: string;
  authCommand: string[];
  loginHint: string;
  installUrl: string;
}

export const ADAPTER_METADATA: Record<AdapterName, AdapterMetadata> = {
  pi: {
    label: "Pi",
    packageName: "@aos-harness/pi-adapter",
    cliBinary: "pi",
    authCommand: ["pi", "auth", "status"],
    loginHint: "Run `pi login`",
    installUrl: "https://pi.dev",
  },
  "claude-code": {
    label: "Claude Code",
    packageName: "@aos-harness/claude-code-adapter",
    cliBinary: "claude",
    authCommand: ["claude", "config", "list"],
    loginHint: "Run `claude login`",
    installUrl: "https://claude.ai/code",
  },
  codex: {
    label: "Codex",
    packageName: "@aos-harness/codex-adapter",
    cliBinary: "codex",
    authCommand: ["codex", "auth", "status"],
    loginHint: "Run `codex auth login`",
    installUrl: "https://developers.openai.com/codex",
  },
  gemini: {
    label: "Gemini CLI",
    packageName: "@aos-harness/gemini-adapter",
    cliBinary: "gemini",
    authCommand: ["gemini", "auth", "status"],
    loginHint: "Run `gemini auth login`",
    installUrl: "https://ai.google.dev/gemini-api/docs/cli",
  },
};

export interface ScanEnvironmentOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  bunGlobalDir?: string | null;
  npmGlobalDir?: string | null;
  probeVendorCli?: (adapter: AdapterName, meta: AdapterMetadata) => Promise<VendorCliReadiness>;
  resolveAdapterDir?: (adapter: AdapterName) => string | null;
  findBinary?: (name: string) => string | null;
}

function detectPackageManager(): PackageManager {
  const entry = process.argv[1] ?? import.meta.url;
  if (entry.includes("/.bun/")) return "bun";
  if (entry.includes("/node_modules/")) return "npm";
  return "unknown";
}

async function runCommandCapture(cmd: string[], timeoutMs = 3000): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}> {
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultVendorCliProbe(adapter: AdapterName, meta: AdapterMetadata): Promise<VendorCliReadiness> {
  const path = Bun.which(meta.cliBinary);
  if (!path) {
    return {
      present: false,
      auth: {
        state: "unknown",
        hint: `Install ${meta.label} first: ${meta.installUrl}`,
      },
    };
  }

  let version: string | undefined;
  try {
    const versionResult = await runCommandCapture([meta.cliBinary, "--version"], 1500);
    const firstLine = (versionResult.stdout || versionResult.stderr).trim().split("\n")[0];
    version = firstLine || undefined;
  } catch {
    version = undefined;
  }

  const authResult = await runCommandCapture(meta.authCommand, 3000);
  const combined = `${authResult.stdout}\n${authResult.stderr}`.trim();

  let authState: AuthState = "unknown";
  let hint: string | undefined;
  if (authResult.timedOut) {
    hint = "Readiness probe timed out";
  } else if (authResult.exitCode === 0) {
    authState = "ready";
  } else if (/login|log in|not logged|not authenticated|auth/i.test(combined)) {
    authState = "needs-login";
    hint = meta.loginHint;
  }

  return {
    present: true,
    version,
    path,
    auth: {
      state: authState,
      hint,
    },
  };
}

function readPackageVersion(packageDir: string): string | undefined {
  const pkgJson = join(packageDir, "package.json");
  if (!existsSync(pkgJson)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(pkgJson, "utf-8")) as { version?: string };
    return raw.version;
  } catch {
    return undefined;
  }
}

function getBunGlobalDir(env: Record<string, string | undefined>, explicit?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  return env.AOS_BUN_GLOBAL_DIR ?? join(homedir(), ".bun", "install", "global", "node_modules");
}

function getNpmGlobalDir(env: Record<string, string | undefined>, explicit?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  if (env.AOS_NPM_GLOBAL_DIR) return env.AOS_NPM_GLOBAL_DIR;
  if (env.npm_config_prefix) return join(env.npm_config_prefix, "lib", "node_modules");
  const prefix = Bun.spawnSync(["npm", "prefix", "-g"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = prefix.stdout.toString().trim();
  if (!out) return null;
  return join(out, "lib", "node_modules");
}

function scanAdapterPackage(
  adapter: AdapterName,
  cwd: string,
  env: Record<string, string | undefined>,
  bunGlobalDir?: string | null,
  npmGlobalDir?: string | null,
  resolveAdapterDir: (adapter: AdapterName) => string | null = getAdapterDir,
): AosAdapterReadiness {
  const meta = ADAPTER_METADATA[adapter];
  const bunPath = bunGlobalDir ? join(bunGlobalDir, meta.packageName) : null;
  const npmPath = npmGlobalDir ? join(npmGlobalDir, meta.packageName) : null;
  const projectLocalPath = join(cwd, "node_modules", meta.packageName);

  if (bunPath && existsSync(bunPath)) {
    const resolvedFrom = resolveAdapterDir(adapter) ?? undefined;
    return {
      installed: true,
      version: readPackageVersion(bunPath),
      store: "bun",
      loadable: !!resolvedFrom,
      resolvedFrom,
    };
  }

  if (npmPath && existsSync(npmPath)) {
    const resolvedFrom = resolveAdapterDir(adapter) ?? undefined;
    return {
      installed: true,
      version: readPackageVersion(npmPath),
      store: "npm",
      loadable: !!resolvedFrom,
      resolvedFrom,
    };
  }

  if (existsSync(projectLocalPath)) {
    return {
      installed: false,
      version: readPackageVersion(projectLocalPath),
      store: "project-local",
      loadable: false,
    };
  }

  const resolvedFrom = resolveAdapterDir(adapter) ?? undefined;
  if (resolvedFrom) {
    return {
      installed: true,
      version: readPackageVersion(resolvedFrom),
      store: resolvedFrom.includes("/adapters/") ? "workspace" : "unknown",
      loadable: true,
      resolvedFrom,
    };
  }

  return {
    installed: false,
    store: "unknown",
    loadable: false,
  };
}

export function deriveAdapterStatus(
  adapter: AdapterName,
  vendorCli: VendorCliReadiness,
  aosAdapter: AosAdapterReadiness,
): Pick<AdapterReadiness, "status" | "statusHint"> {
  const meta = ADAPTER_METADATA[adapter];

  if (!vendorCli.present) {
    return {
      status: "needs-cli",
      statusHint: `Install the ${meta.label} CLI first: ${meta.installUrl}`,
    };
  }

  if (vendorCli.auth.state === "needs-login") {
    return {
      status: "needs-login",
      statusHint: vendorCli.auth.hint ?? meta.loginHint,
    };
  }

  if (aosAdapter.store === "project-local") {
    return {
      status: "broken",
      statusHint: `${meta.label} adapter is only installed in project-local node_modules; AOS will not load it from there.`,
    };
  }

  if (!aosAdapter.installed) {
    return {
      status: "needs-adapter",
      statusHint: `Install ${meta.packageName} to let AOS use the ${meta.label} CLI.`,
    };
  }

  if (!aosAdapter.loadable) {
    return {
      status: "broken",
      statusHint: `${meta.packageName} is installed, but this aos install cannot resolve it.`,
    };
  }

  if (vendorCli.auth.state === "unknown") {
    return {
      status: "ready",
      statusHint: `${meta.label} CLI and AOS adapter are present; auth could not be confirmed.`,
    };
  }

  return {
    status: "ready",
    statusHint: `${meta.label} CLI and AOS adapter are ready.`,
  };
}

function getMempalaceSocket(env: Record<string, string | undefined>): string {
  if (env.MEMPALACE_SOCKET) return env.MEMPALACE_SOCKET;
  if (process.platform === "linux") {
    return join(env.XDG_RUNTIME_DIR || tmpdir(), "mempalace.sock");
  }
  return join(env.TMPDIR || tmpdir(), "mempalace.sock");
}

export async function scanEnvironment(options: ScanEnvironmentOptions = {}): Promise<ScanReport> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const probeVendorCli = options.probeVendorCli ?? defaultVendorCliProbe;
  const resolveAdapterDir = options.resolveAdapterDir ?? getAdapterDir;
  const bunGlobalDir = getBunGlobalDir(env, options.bunGlobalDir);
  const npmGlobalDir = getNpmGlobalDir(env, options.npmGlobalDir);
  const findBinary = options.findBinary ?? ((name: string) => Bun.which(name) ?? null);

  const adapters = {} as Record<AdapterName, AdapterReadiness>;
  const notes: string[] = [];

  for (const adapter of Object.keys(ADAPTER_METADATA) as AdapterName[]) {
    const meta = ADAPTER_METADATA[adapter];
    const vendorCli = await probeVendorCli(adapter, meta);
    const aosAdapter = scanAdapterPackage(adapter, cwd, env, bunGlobalDir, npmGlobalDir, resolveAdapterDir);
    const { status, statusHint } = deriveAdapterStatus(adapter, vendorCli, aosAdapter);

    const apiKeyMap: Partial<Record<AdapterName, string>> = {
      pi: "ANTHROPIC_API_KEY",
      "claude-code": "ANTHROPIC_API_KEY",
      codex: "OPENAI_API_KEY",
      gemini: "GEMINI_API_KEY",
    };
    const apiKey = apiKeyMap[adapter];
    if (vendorCli.auth.state === "needs-login" && apiKey && env[apiKey] !== undefined) {
      notes.push(`${adapter}: vendor CLI needs login, but ${apiKey} is set in the environment.`);
    }

    adapters[adapter] = {
      adapter,
      vendorCli,
      aosAdapter,
      status,
      statusHint,
    };
  }

  const socketPath = getMempalaceSocket(env);
  const mempalaceBinary = findBinary("mempalace");
  if (mempalaceBinary && !existsSync(socketPath)) {
    notes.push(`mempalace: binary found at ${mempalaceBinary}, but socket ${socketPath} was not detected. Set MEMPALACE_SOCKET if MemPalace uses a custom socket path.`);
  }

  return {
    packageManager: detectPackageManager(),
    adapters,
    memory: {
      mempalace: {
        available: existsSync(socketPath),
        socketPath,
        binaryInstalled: !!mempalaceBinary,
        binaryPath: mempalaceBinary ?? undefined,
      },
    },
    notes,
  };
}
