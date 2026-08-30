import fs from "fs";
import path from "path";
import { config } from "../config";
import { DiscordClient } from "../mcp/discord-client";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const FALLBACK_LOG = path.join(LOG_DIR, "times-poster.log");

async function ensureLogDir(): Promise<void> {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
}

async function appendFallbackLog(text: string): Promise<void> {
  try {
    await ensureLogDir();
    await fs.promises.appendFile(
      FALLBACK_LOG,
      `${new Date().toISOString()} ${text}\n`,
    );
  } catch (e) {
    // swallow
    // eslint-disable-next-line no-console
    console.error("Failed to write fallback times log:", e);
  }
}

/**
 * Post a summary text to all times channels. If the text exceeds Discord limits,
 * write to a temporary file under `logs/` and attach it.
 */
export async function postToTimes(
  discordClient: DiscordClient,
  summary: string,
  opts?: { fallbackLogPath?: string },
): Promise<void> {
  try {
    const channels = await discordClient.getTimesChannels();
    if (!channels || channels.length === 0) {
      await appendFallbackLog("postToTimes: no times channels found.");
      throw new Error("No times channels found");
    }

    const MAX_LEN = 1900; // keep margin
    for (const channel of channels) {
      try {
        if (summary.length <= MAX_LEN) {
          await channel.send(summary);
        } else {
          // write to file and attach
          await ensureLogDir();
          const filename = `times-${Date.now()}.log`;
          const filePath = path.join(LOG_DIR, filename);
          await fs.promises.writeFile(filePath, summary);
          await channel.send({
            content: "長い出力のためログを添付します。",
            files: [filePath] as any,
          });
        }
      } catch (err) {
        const msg = `Failed to send to channel ${channel.name}: ${err}`;
        await appendFallbackLog(msg);
      }
    }
  } catch (error) {
    await appendFallbackLog(`postToTimes error: ${error}`);
    throw error;
  }
}

export default postToTimes;
