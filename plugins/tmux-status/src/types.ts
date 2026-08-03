export interface TmuxPaneStatus {
  session: string;
  window: string;
  pane: string;
  target: string;
  pid: number;
  command: string;
  path: string;
  attached: boolean;
  selected: boolean;
  dead: boolean;
  cpu_percent: number;
  memory_mb: number;
  process_count: number;
  tools: string[];
  activity: string;
  activity_source: string;
  note: string;
  anomalies: string[];
  session_id?: string;
  session_created?: number;
  window_id?: string;
  server_instance_id?: string;
  pane_instance_id?: string;
}

export interface TmuxStatusPayload {
  schema_version?: number;
  tool_version?: string;
  server_instance_id?: string | null;
  producer?: {
    name: string;
    version: string;
  };
  generated_at: string;
  thresholds: {
    cpu_percent: number;
    memory_mb: number;
  };
  pane_count: number;
  anomaly_count: number;
  panes: TmuxPaneStatus[];
}

export interface TmuxAdapterConfig {
  executable: string;
  timeoutMs: number;
  collectionIntervalSeconds: number;
  cpuThreshold: number;
  memoryThresholdMb: number;
}
