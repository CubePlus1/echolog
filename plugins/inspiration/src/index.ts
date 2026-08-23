import type {
  PluginDefinition,
  PluginManifest,
} from "@echolog/plugin-sdk";
import manifestJson from "../echolog.plugin.json";
import { renderInspirationDailySummary } from "./cli.js";
import { createFlowRoutes } from "./flow-routes.js";
import { FlowStore } from "./flow-store.js";
import { createFlowJob, FlowService } from "./flow.js";
import { migrations } from "./migrations.js";
import { notificationsSendProvider } from "./notifications.js";
import { createInspirationRoutes } from "./routes.js";
import { InspirationStore } from "./store.js";

const manifest = manifestJson as PluginManifest;

let inspirationStore: InspirationStore | null = null;
let flowStore: FlowStore | null = null;
let flowService: FlowService | null = null;

function requireInspirationStore(): InspirationStore {
  if (!inspirationStore) throw new Error("inspiration store is not initialized");
  return inspirationStore;
}

function requireFlowService(): FlowService {
  if (!flowService) throw new Error("inspiration Flow is not initialized");
  return flowService;
}

export const inspirationPlugin: PluginDefinition = {
  manifest,
  routes: [
    ...createInspirationRoutes(requireInspirationStore),
    ...createFlowRoutes(requireFlowService),
  ],
  defaultEnabled: true,
  defaultConfig: {},
  validateConfig(config) {
    return Object.keys(config).length === 0
      ? []
      : ["inspiration configuration does not accept fields in v1"];
  },
  migrations,
  register(context) {
    const databaseUrl = context.service<string>("database.url");
    inspirationStore = new InspirationStore(databaseUrl);
    flowStore = new FlowStore(databaseUrl);
    flowService = new FlowService(
      flowStore,
      notificationsSendProvider(context)
    );

    context.registerJob(createFlowJob(flowService));
    context.registerReportSection({
      id: "daily-inspiration",
      title: "灵感",
      order: 250,
      async render(date) {
        return renderInspirationDailySummary(
          await requireFlowService().getDailySummary(date)
        );
      },
    });
  },
  start(context) {
    context.logger.info(
      { notificationService: "notifications.send" },
      "Inspiration plugin started"
    );
  },
  async stop() {
    const stores = [inspirationStore, flowStore].filter(
      (store): store is InspirationStore | FlowStore => store !== null
    );
    inspirationStore = null;
    flowStore = null;
    flowService = null;
    await Promise.all(stores.map((store) => store.close()));
  },
};

export default inspirationPlugin;
export { migrations } from "./migrations.js";
export type { NotificationsSendService } from "./notifications.js";
