import { createApiService } from "@launchbot/api";
import { disconnectPrisma } from "@launchbot/db";
import { runProcess } from "@launchbot/shared/server";
import { createBotService } from "./index.js";

// §12: the bot and the API share one process. The bot comes first: its devnet guard refuses
// the startup before anything listens.
await runProcess([createBotService(), createApiService()], { onShutdown: disconnectPrisma });
