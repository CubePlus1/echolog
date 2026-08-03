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
  tmux_target?: string;
  tmux_session_name?: string;
  tmux_window_index?: number;
  tmux_window_name?: string;
  tmux_pane_index?: number;
  pane_id?: string;
  pane_pid?: number;
  working_directory?: string;
  agent_conversations?: TmuxAgentConversation[];
}

export type AgentTool = "codex" | "grok";
export type ConversationIdKind = "codex_thread_id" | "grok_session_id";
export type ConversationIdStatus = "confirmed" | "unknown";

export interface TmuxAgentConversation {
  tool: AgentTool;
  conversation_id: string | null;
  conversation_id_status: ConversationIdStatus;
  conversation_id_kind: ConversationIdKind;
  identity_source: string;
  source_path: string | null;
  working_directory: string;
  process_pids: number[];
  stable_mapping_key: string | null;
  resume_command: string | null;
  evidence: string;
}

export interface TmuxRecoveryEntry {
  tool: AgentTool;
  conversation_id: string | null;
  conversation_id_status: ConversationIdStatus;
  conversation_id_kind: ConversationIdKind;
  identity_source: string;
  source_path: string | null;
  stable_mapping_key: string | null;
  tmux_target: string;
  tmux_session_name: string;
  pane_id: string;
  pane_pid: number;
  process_pids: number[];
  working_directory: string;
  resume_command: string | null;
}

export interface TmuxStatusPayload {
  schema_version?: number;
  tool_version?: string;
  server_instance_id?: string | null;
  producer?: {
    name: string;
    version: string;
  };
  report_type?: "status" | "snapshot" | "recovery";
  pre_restart?: boolean;
  host?: string;
  generated_at: string;
  thresholds: {
    cpu_percent: number;
    memory_mb: number;
  };
  pane_count: number;
  anomaly_count: number;
  confirmed_conversation_count?: number;
  unknown_conversation_count?: number;
  recovery?: TmuxRecoveryEntry[];
  panes: TmuxPaneStatus[];
}

export interface TmuxAdapterConfig {
  executable: string;
  timeoutMs: number;
  collectionIntervalSeconds: number;
  cpuThreshold: number;
  memoryThresholdMb: number;
}
