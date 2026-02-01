import type { MoltbotPluginApi, MoltbotConfig, PluginRuntime } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";

import { feishuPlugin } from "./src/channel.js";
import { setFeishuRuntime, getFeishuRuntime } from "./src/runtime.js";
import { decryptFeishuMessage, replyMessage, sendTextMessage } from "./src/api.js";
import type { FeishuConfig, FeishuMessage } from "./src/types.js";

type FeishuCoreRuntime = PluginRuntime;

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        resolve({ ok: false, error: "Request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const value = JSON.parse(raw);
        resolve({ ok: true, value });
      } catch (err) {
        resolve({ ok: false, error: `JSON parse error: ${String(err)}` });
      }
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: String(err) });
    });
  });
}

async function processFeishuMessage(params: {
  body: FeishuMessage;
  feishuConfig: FeishuConfig;
  config: MoltbotConfig;
  core: FeishuCoreRuntime;
  log: MoltbotPluginApi["logger"];
}): Promise<void> {
  const { body, feishuConfig, config, core, log } = params;

  if (body.header?.event_type !== "im.message.receive_v1" || !body.event?.message) {
    return;
  }

  const message = body.event.message;
  const sender = body.event.sender;
  const chatId = message.chat_id;
  const isGroup = message.chat_type !== "p2p";
  const senderId = sender?.sender_id?.open_id || "unknown";
  const senderName = sender?.sender_id?.user_id || undefined;

  // 解析消息内容
  let rawBody = "";
  try {
    const content = JSON.parse(message.content) as { text?: string };
    rawBody = content.text || "";
  } catch {
    rawBody = message.content;
  }

  // 移除 @机器人 的提及
  if (message.mentions?.length) {
    for (const mention of message.mentions) {
      rawBody = rawBody.replace(mention.key, "").trim();
    }
  }

  if (!rawBody) {
    log.info("[feishu] Empty message, skipping");
    return;
  }

  log.info(`[feishu] Processing message from ${senderId}: "${rawBody.substring(0, 50)}..."`);

  // 解析路由
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "feishu",
    accountId: "default",
    peer: {
      kind: isGroup ? "group" : "dm",
      id: chatId,
    },
  });

  // 构建会话路径
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  // 获取之前的时间戳
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  // 格式化消息信封
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const fromLabel = isGroup ? `group:${chatId}` : senderName || `user:${senderId}`;
  
  const formattedBody = core.channel.reply.formatAgentEnvelope({
    channel: "Feishu",
    from: fromLabel,
    timestamp: message.create_time ? parseInt(message.create_time, 10) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // 构建上下文
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: formattedBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `feishu:${senderId}`,
    To: `feishu:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    Provider: "feishu",
    Surface: "feishu",
    MessageSid: message.message_id,
    MessageSidFull: message.message_id,
    OriginatingChannel: "feishu",
    OriginatingTo: `feishu:${chatId}`,
  });

  // 记录会话元数据
  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((err) => {
      log.error(`[feishu] Failed updating session meta: ${String(err)}`);
    });

  // 分发消息并处理回复
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        const text = payload.text?.trim();
        if (!text) return;

        log.info(`[feishu] Sending reply: "${text.substring(0, 50)}..."`);

        try {
          // 回复消息
          const result = await replyMessage({
            config: feishuConfig,
            messageId: message.message_id,
            text,
          });

          if (result.code !== 0) {
            log.error(`[feishu] Reply API error: ${result.msg}`);
          } else {
            log.info("[feishu] Reply sent successfully");
          }
        } catch (err) {
          log.error(`[feishu] Reply failed: ${String(err)}`);
        }
      },
      onError: (err, info) => {
        log.error(`[feishu] ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}

async function handleFeishuWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  api: MoltbotPluginApi
): Promise<void> {
  const cfg = api.config;
  const feishuConfig = cfg.channels?.feishu as FeishuConfig | undefined;
  const log = api.logger;
  const core = getFeishuRuntime();

  log.info("[feishu] Webhook request received");

  if (!feishuConfig?.appId || !feishuConfig?.appSecret) {
    log.error("[feishu] Not configured - missing appId or appSecret");
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Feishu not configured" }));
    return;
  }

  const parsed = await readJsonBody(req, 1024 * 1024);
  if (!parsed.ok) {
    log.error(`[feishu] Body parse error: ${parsed.error}`);
    res.statusCode = 400;
    res.end(JSON.stringify({ error: parsed.error }));
    return;
  }

  let body = parsed.value as FeishuMessage & { challenge?: string; type?: string; encrypt?: string };

  // 处理加密请求
  if (body.encrypt && feishuConfig.encryptKey) {
    log.info("[feishu] Encrypted request received, decrypting...");
    try {
      const decrypted = decryptFeishuMessage(body.encrypt, feishuConfig.encryptKey);
      body = JSON.parse(decrypted) as typeof body;
      log.info("[feishu] Decryption successful");
    } catch (err) {
      log.error(`[feishu] Decryption failed: ${String(err)}`);
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Decryption failed" }));
      return;
    }
  }

  // URL 验证请求 (飞书会发送此请求验证 webhook)
  if (body.challenge) {
    log.info("[feishu] URL verification received, responding with challenge");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ challenge: body.challenge }));
    return;
  }

  // 验证 token (对于非加密请求)
  if (!body.encrypt && feishuConfig.verificationToken && body.header?.token !== feishuConfig.verificationToken) {
    log.warn("[feishu] Invalid verification token");
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Invalid token" }));
    return;
  }

  // 立即返回成功响应 (飞书要求 3 秒内响应)
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ code: 0, msg: "success" }));

  // 异步处理消息
  processFeishuMessage({
    body,
    feishuConfig,
    config: cfg,
    core,
    log,
  }).catch((err) => {
    log.error(`[feishu] Message processing failed: ${String(err)}`);
  });
}

const plugin = {
  id: "feishu",
  name: "Feishu (飞书)",
  description: "Feishu/Lark channel plugin for Moltbot",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setFeishuRuntime(api.runtime);

    // 注册 HTTP 路由到 Gateway
    api.registerHttpRoute({
      path: "/webhook/feishu",
      handler: async (req, res) => {
        await handleFeishuWebhook(req, res, api);
      },
    });

    api.registerChannel({ plugin: feishuPlugin });
  },
};

export default plugin;
