import { disconnectPrisma } from "@launchbot/db";
import { runProcess } from "@launchbot/shared/server";
import { createApiService } from "./index.js";

// The API alone. With the bot, in one process: `pnpm --filter @launchbot/bot start`.
await runProcess([createApiService()], { onShutdown: disconnectPrisma });
