export interface AdapterProbeInfo {
  info?: Record<string, string>;
}

export async function probeAdapterInfo(): Promise<AdapterProbeInfo> {
  return {};
}
