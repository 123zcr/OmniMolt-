import type { MoltbotConfig } from "clawdbot/plugin-sdk";
import { sendTextMessage, replyMessage } from "./api.js";
import type { FeishuConfig } from "./types.js";

export async function sendFeishuMessage(params: {
  cfg: MoltbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
}): Promise<{ messageId?: string }> {
  const feishuConfig = params.cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
    throw new Error("Feishu not configured (missing appId or appSecret)");
  }

  // 如果有 replyToMessageId，使用回复 API
  if (params.replyToMessageId) {
    const result = await replyMessage({
      config: feishuConfig,
      messageId: params.replyToMessageId,
      text: params.text,
    });
    if (result.code !== 0) {
      throw new Error(`Failed to reply message: ${result.msg}`);
    }
    return { messageId: result.data?.message_id };
  }

  // 判断目标类型
  let receiveIdType: "open_id" | "chat_id" = "open_id";
  let receiveId = params.to;

  if (params.to.startsWith("oc_")) {
    // 群组 chat_id
    receiveIdType = "chat_id";
  } else if (params.to.startsWith("ou_")) {
    // open_id
    receiveIdType = "open_id";
  } else if (params.to.startsWith("chat:")) {
    receiveIdType = "chat_id";
    receiveId = params.to.replace("chat:", "");
  } else if (params.to.startsWith("user:")) {
    receiveIdType = "open_id";
    receiveId = params.to.replace("user:", "");
  }

  const result = await sendTextMessage({
    config: feishuConfig,
    receiveId,
    receiveIdType,
    text: params.text,
  });

  if (result.code !== 0) {
    throw new Error(`Failed to send message: ${result.msg}`);
  }

  return { messageId: result.data?.message_id };
}
