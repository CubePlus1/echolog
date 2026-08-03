import postgres from "postgres";
import type {
  TmuxAgentConversation,
  TmuxPaneStatus,
  TmuxStatusPayload,
} from "./types.js";

export function sessionKey(pane: TmuxPaneStatus): string {
  return pane.server_instance_id && pane.session_id && pane.session_created
    ? `${pane.server_instance_id}:${pane.session_id}:${pane.session_created}`
    : `legacy:${pane.session}`;
}

export function paneIdentity(pane: TmuxPaneStatus): string {
  if (pane.pane_instance_id) return pane.pane_instance_id;
  return [
    pane.window_id ?? "legacy-window",
    pane.pane,
    String(pane.pid),
  ].join(":");
}

export function conversationObservationKey(
  pane: TmuxPaneStatus,
  conversation: TmuxAgentConversation
): string {
  if (
    conversation.conversation_id_status === "confirmed" &&
    conversation.stable_mapping_key
  ) {
    return [
      "confirmed",
      pane.pane_instance_id ?? paneIdentity(pane),
      conversation.working_directory,
      conversation.stable_mapping_key,
    ].join(":");
  }
  return [
    "unknown",
    pane.pane_instance_id ?? paneIdentity(pane),
    conversation.tool,
    conversation.conversation_id_kind,
    conversation.working_directory,
    [...conversation.process_instance_keys].sort().join(","),
  ].join(":");
}

function minuteBucket(generatedAt: Date): Date {
  const bucket = new Date(generatedAt);
  bucket.setUTCSeconds(0, 0);
  return bucket;
}

export class TmuxObservationStore {
  private readonly sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async observe(snapshot: TmuxStatusPayload): Promise<void> {
    const generatedAt = new Date(snapshot.generated_at);
    const bucket = minuteBucket(generatedAt);
    await this.sql.begin(async (transaction) => {
      for (const pane of snapshot.panes) {
        const key = sessionKey(pane);
        const identity = paneIdentity(pane);
        await transaction`
          INSERT INTO tmux_sessions (
            session_key, session_name, session_id, session_created,
            first_observed_at, last_observed_at
          ) VALUES (
            ${key}, ${pane.session}, ${pane.session_id ?? null},
            ${pane.session_created ?? null}, ${generatedAt}, ${generatedAt}
          )
          ON CONFLICT (session_key) DO UPDATE SET
            session_name = EXCLUDED.session_name,
            last_observed_at = GREATEST(
              tmux_sessions.last_observed_at,
              EXCLUDED.last_observed_at
            )
        `;
        await transaction`
          INSERT INTO tmux_pane_minutes (
            session_key, pane_identity, minute_bucket, pane_id, pane_pid,
            window_id, target, tools, first_observed_at, last_observed_at,
            last_generated_at, sample_count, cpu_average, cpu_peak,
            memory_peak_mb, anomaly_count
          ) VALUES (
            ${key}, ${identity}, ${bucket}, ${pane.pane}, ${pane.pid},
            ${pane.window_id ?? null}, ${pane.target}, ${pane.tools},
            ${generatedAt}, ${generatedAt}, ${generatedAt}, 1,
            ${pane.cpu_percent}, ${pane.cpu_percent}, ${pane.memory_mb},
            ${pane.anomalies.length > 0 ? 1 : 0}
          )
          ON CONFLICT (session_key, pane_identity, minute_bucket)
          DO UPDATE SET
            last_observed_at = EXCLUDED.last_observed_at,
            last_generated_at = EXCLUDED.last_generated_at,
            tools = EXCLUDED.tools,
            sample_count = tmux_pane_minutes.sample_count + 1,
            cpu_average = (
              tmux_pane_minutes.cpu_average * tmux_pane_minutes.sample_count
              + EXCLUDED.cpu_average
            ) / (tmux_pane_minutes.sample_count + 1),
            cpu_peak = GREATEST(
              tmux_pane_minutes.cpu_peak,
              EXCLUDED.cpu_peak
            ),
            memory_peak_mb = GREATEST(
              tmux_pane_minutes.memory_peak_mb,
              EXCLUDED.memory_peak_mb
            ),
            anomaly_count = tmux_pane_minutes.anomaly_count
              + EXCLUDED.anomaly_count
          WHERE tmux_pane_minutes.last_generated_at < EXCLUDED.last_generated_at
        `;
        for (const conversation of pane.agent_conversations ?? []) {
          const observationKey = conversationObservationKey(pane, conversation);
          await transaction`
            INSERT INTO tmux_agent_conversations (
              observation_key, session_key, pane_identity, tmux_target,
              pane_id, pane_pid, agent_process_pids, working_directory,
              tool, conversation_id_kind, conversation_id,
              conversation_id_status, identity_source, source_path,
              stable_mapping_key, resume_command, first_observed_at,
              last_observed_at, last_generated_at
            ) VALUES (
              ${observationKey}, ${key}, ${identity},
              ${pane.tmux_target ?? pane.target}, ${pane.pane_id ?? pane.pane},
              ${pane.pane_pid ?? pane.pid}, ${conversation.process_pids},
              ${conversation.working_directory}, ${conversation.tool},
              ${conversation.conversation_id_kind}, ${conversation.conversation_id},
              ${conversation.conversation_id_status}, ${conversation.identity_source},
              ${conversation.source_path}, ${conversation.stable_mapping_key},
              ${conversation.resume_command}, ${generatedAt}, ${generatedAt},
              ${generatedAt}
            )
            ON CONFLICT (observation_key) DO UPDATE SET
              session_key = EXCLUDED.session_key,
              pane_identity = EXCLUDED.pane_identity,
              tmux_target = EXCLUDED.tmux_target,
              pane_id = EXCLUDED.pane_id,
              pane_pid = EXCLUDED.pane_pid,
              agent_process_pids = EXCLUDED.agent_process_pids,
              working_directory = EXCLUDED.working_directory,
              identity_source = EXCLUDED.identity_source,
              source_path = EXCLUDED.source_path,
              resume_command = EXCLUDED.resume_command,
              last_observed_at = EXCLUDED.last_observed_at,
              last_generated_at = EXCLUDED.last_generated_at
            WHERE tmux_agent_conversations.last_generated_at
              < EXCLUDED.last_generated_at
          `;
        }
      }
    });
  }
}
