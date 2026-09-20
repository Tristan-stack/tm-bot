import { disconnectPrisma } from "@launchbot/db";
import { runProcess } from "@launchbot/shared/server";
import { createBotService } from "./index.js";

// §12: the bot and the API (V1-05) share one process. V1-05 adds its service to this list.
await runProcess([createBotService()], { onShutdown: disconnectPrisma });
