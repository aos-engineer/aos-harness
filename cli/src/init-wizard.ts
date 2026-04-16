import { getInitEditor, getInitModels, getSelectedAdaptersForInit, listKnownAdapters } from "./aos-config";
import { ADAPTER_METADATA } from "./env-scanner";
import { clackPromptContext, renderScanReport, type PromptContext } from "./prompts";
import type { ScanReport, WizardAction, WizardResult } from "./init-types";
import type { AdapterName } from "./utils";

export function buildActions(scan: ScanReport, enabledAdapters: AdapterName[]): WizardAction[] {
  const actions: WizardAction[] = [];

  for (const adapter of enabledAdapters) {
    const readiness = scan.adapters[adapter];
    const meta = ADAPTER_METADATA[adapter];

    if ((readiness.status === "needs-adapter" || readiness.status === "broken") && scan.packageManager !== "unknown") {
      actions.push({
        type: "install-adapter",
        packageName: meta.packageName,
        manager: scan.packageManager,
        global: true,
      });
    }

    if (readiness.status === "needs-login") {
      actions.push({
        type: "info-login",
        adapter,
        vendorCommand: readiness.vendorCli.auth.hint ?? meta.loginHint,
      });
    }

    if (readiness.status === "needs-cli") {
      actions.push({
        type: "info-install-vendor-cli",
        adapter,
        url: meta.installUrl,
      });
    }
  }

  return actions;
}

function requirePromptValue<T>(value: T | symbol, promptContext: PromptContext): T {
  if (promptContext.isCancel(value)) {
    promptContext.cancel("Operation cancelled.");
    process.exit(130);
  }
  return value as T;
}

export async function runWizard(
  scan: ScanReport,
  cwd: string,
  flagAdapter?: string | boolean,
  promptContext: PromptContext = clackPromptContext,
): Promise<WizardResult> {
  promptContext.intro("AOS init");
  promptContext.note(renderScanReport(scan), "Environment Scan");

  const existingSelected = getSelectedAdaptersForInit(cwd, flagAdapter);
  const recommended = existingSelected.length > 0
    ? existingSelected
    : listKnownAdapters().filter((adapter) => {
        const status = scan.adapters[adapter].status;
        return status === "ready" || status === "needs-adapter" || status === "needs-login";
      });

  const enabled = requirePromptValue(
    await promptContext.multiselect<AdapterName>({
    message: "Select the adapters to enable",
    options: listKnownAdapters().map((adapter) => ({
      value: adapter,
      label: adapter,
      hint: scan.adapters[adapter].statusHint,
    })),
    initialValues: recommended,
    required: true,
  }),
    promptContext,
  );
  if (!enabled || enabled.length === 0) {
    throw new Error("At least one adapter must be enabled.");
  }

  const defaultAdapter = requirePromptValue(
    await promptContext.select<AdapterName>({
      message: "Choose the default adapter",
      options: enabled.map((adapter) => ({
        value: adapter,
        label: adapter,
        hint: scan.adapters[adapter].statusHint,
      })),
      initialValue: enabled[0],
    }),
    promptContext,
  );

  const memoryProvider = requirePromptValue(
    await promptContext.select<"expertise" | "mempalace">({
      message: "Choose the memory provider",
      options: [
        {
          value: scan.memory.mempalace.available ? "mempalace" : "expertise",
          label: scan.memory.mempalace.available ? "mempalace" : "expertise",
          hint: scan.memory.mempalace.available
            ? "MemPalace socket detected"
            : "Built-in fallback recommended right now",
        },
        {
          value: scan.memory.mempalace.available ? "expertise" : "mempalace",
          label: scan.memory.mempalace.available ? "expertise" : "mempalace",
          hint: scan.memory.mempalace.available
            ? "Built-in fallback"
            : "Configure MemPalace later",
        },
      ],
      initialValue: scan.memory.mempalace.available ? "mempalace" : "expertise",
    }),
    promptContext,
  );

  promptContext.outro("Init choices captured.");

  return {
    enabledAdapters: enabled,
    defaultAdapter,
    memory: {
      provider: memoryProvider,
    },
    models: getInitModels(cwd),
    editor: getInitEditor(cwd),
    actions: buildActions(scan, enabled),
  };
}
