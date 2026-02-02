import type { MoltbotPluginApi, MoltbotConfig, PluginRuntime } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { onebotPlugin } from "./src/channel.js";
import { setOneBotRuntime, getOneBotRuntime } from "./src/runtime.js";
import {
  sendMsg,
  sendImage,
  sendRecord,
  sendVideo,
  extractTextFromMessage,
  extractMediaFromMessage,
  isAtUser,
  parseTextWithEmoji,
  hasEmojiCode,
} from "./src/api.js";
import type { OneBotConfig, OneBotMessageEvent, OneBotEvent, OneBotMessage } from "./src/types.js";

type OneBotCoreRuntime = PluginRuntime;

// 下载图片并保存到临时文件
async function downloadImageToTempFile(
  url: string,
  log: MoltbotPluginApi["logger"],
): Promise<{ path: string; dataUrl: string; mimeType: string; size: number } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    const mimeType = contentType.split(";")[0].trim();
    
    // 根据 MIME 类型确定扩展名
    const extMap: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
    };
    const ext = extMap[mimeType] || ".png";
    
    // 保存到临时文件
    const tempDir = os.tmpdir();
    const fileName = `moltbot-onebot-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(tempDir, fileName);
    
    fs.writeFileSync(filePath, buffer);
    
    // 也生成 data URL 以备后用
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    return {
      path: filePath,
      dataUrl,
      mimeType,
      size: buffer.length,
    };
  } catch (err) {
    log.error(`[onebot] Failed to download image: ${String(err)}`);
    return null;
  }
}

// 下载文件并保存到临时目录
async function downloadFileToTemp(
  url: string,
  fileName: string | undefined,
  log: MoltbotPluginApi["logger"],
): Promise<{ path: string; content: string | null; mimeType: string; size: number; isText: boolean } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();
    
    // 从 URL 或 fileName 获取扩展名
    const ext = fileName 
      ? path.extname(fileName) 
      : path.extname(new URL(url).pathname) || "";
    
    // 判断是否是文本文件
    const textExtensions = [
      ".txt", ".md", ".json", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h",
      ".css", ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
      ".sh", ".bat", ".ps1", ".sql", ".csv", ".log", ".env", ".gitignore",
    ];
    const isText = textExtensions.includes(ext.toLowerCase()) || 
                   mimeType.startsWith("text/") ||
                   mimeType === "application/json";
    
    // 保存到临时文件
    const tempDir = os.tmpdir();
    const safeName = fileName || `moltbot-file-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(tempDir, safeName);
    
    fs.writeFileSync(filePath, buffer);
    
    // 如果是文本文件，读取内容
    let content: string | null = null;
    if (isText && buffer.length < 100 * 1024) { // 小于 100KB 才读取
      content = buffer.toString("utf-8");
    }
    
    return {
      path: filePath,
      content,
      mimeType,
      size: buffer.length,
      isText,
    };
  } catch (err) {
    log.error(`[onebot] Failed to download file: ${String(err)}`);
    return null;
  }
}

// 保存最后消息发送者，用于 screenshot 工具直接发送图片
let lastSenderContext: {
  userId: number;
  messageType: "private" | "group";
  groupId?: number;
  config: OneBotConfig;
} | null = null;

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

/**
 * 检测媒体类型
 */
function detectMediaKind(url: string): "image" | "video" | "audio" | "document" {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(lower)) return "image";
  if (/\.(mp4|avi|mov|mkv|webm)(\?|$)/i.test(lower)) return "video";
  if (/\.(mp3|ogg|wav|m4a|flac|opus)(\?|$)/i.test(lower)) return "audio";
  // 默认按图片处理（大多数工具输出是图片）
  return "image";
}

/**
 * 将本地文件转换为 base64 URL (NapCat 格式)
 */
async function localFileToBase64Url(filePath: string): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    // 处理 file:// URL 格式
    let normalizedPath = filePath;
    if (filePath.startsWith("file:///")) {
      normalizedPath = filePath.slice(8); // 去掉 file:///
    } else if (filePath.startsWith("file://")) {
      normalizedPath = filePath.slice(7); // 去掉 file://
    }
    
    // Windows 路径修复
    normalizedPath = normalizedPath.replace(/\//g, path.sep);
    
    // 检查文件是否存在
    await fs.access(normalizedPath);
    
    // 读取文件并转换为 base64
    const buffer = await fs.readFile(normalizedPath);
    const base64 = buffer.toString("base64");
    
    // 返回 NapCat 可识别的 base64 格式
    return `base64://${base64}`;
  } catch {
    return null;
  }
}

/**
 * 检查是否为本地文件路径
 */
function isLocalFilePath(url: string): boolean {
  // 本地文件路径格式：
  // - file:///C:/path/to/file
  // - C:\path\to\file
  // - /path/to/file (Unix)
  if (url.startsWith("file://")) return true;
  if (/^[A-Za-z]:[\\\/]/.test(url)) return true; // Windows 绝对路径
  if (url.startsWith("/") && !url.startsWith("//")) return true; // Unix 绝对路径
  return false;
}

/**
 * 发送媒体到 QQ
 */
async function deliverMediaToOneBot(params: {
  onebotConfig: OneBotConfig;
  messageType: "private" | "group";
  userId?: number;
  groupId?: number;
  mediaUrl: string;
  caption?: string;
  log: MoltbotPluginApi["logger"];
}): Promise<boolean> {
  const { onebotConfig, messageType, userId, groupId, caption, log } = params;
  let { mediaUrl } = params;
  const kind = detectMediaKind(mediaUrl);
  
  // 如果是本地文件，转换为 base64 URL
  if (isLocalFilePath(mediaUrl)) {
    log.info(`[onebot] Converting local file to base64: ${mediaUrl}`);
    const base64Url = await localFileToBase64Url(mediaUrl);
    if (base64Url) {
      mediaUrl = base64Url;
      log.info(`[onebot] Converted to base64 (length: ${base64Url.length})`);
    } else {
      log.error(`[onebot] Failed to read local file: ${mediaUrl}`);
      return false;
    }
  }

  try {
    let result;
    if (kind === "image") {
      result = await sendImage(onebotConfig, {
        messageType,
        userId,
        groupId,
        file: mediaUrl,
        text: caption,
      });
    } else if (kind === "video") {
      result = await sendVideo(onebotConfig, {
        messageType,
        userId,
        groupId,
        file: mediaUrl,
        text: caption,
      });
    } else if (kind === "audio") {
      result = await sendRecord(onebotConfig, {
        messageType,
        userId,
        groupId,
        file: mediaUrl,
      });
      // 语音消息不支持 caption，单独发送文字
      if (caption && result.status === "ok") {
        await sendMsg(onebotConfig, {
          messageType,
          userId,
          groupId,
          message: caption,
        });
      }
    } else {
      // 默认当图片发
      result = await sendImage(onebotConfig, {
        messageType,
        userId,
        groupId,
        file: mediaUrl,
        text: caption,
      });
    }

    if (result.status === "ok") {
      log.info(`[onebot] Media sent successfully: ${kind}`);
      return true;
    } else {
      log.error(`[onebot] Media send API error: ${result.retcode}`);
      return false;
    }
  } catch (err) {
    log.error(`[onebot] Media send failed: ${String(err)}`);
    return false;
  }
}

async function processOneBotMessage(params: {
  event: OneBotMessageEvent;
  onebotConfig: OneBotConfig;
  config: MoltbotConfig;
  core: OneBotCoreRuntime;
  log: MoltbotPluginApi["logger"];
}): Promise<void> {
  const { event, onebotConfig, config, core, log } = params;

  const isGroup = event.message_type === "group";
  const userId = event.user_id;
  const groupId = event.group_id;
  const senderId = String(userId);
  const senderName = event.sender.card || event.sender.nickname || undefined;
  const chatId = isGroup ? `group:${groupId}` : `user:${userId}`;

  // 保存发送者上下文，供 screenshot 工具使用
  lastSenderContext = {
    userId,
    messageType: isGroup ? "group" : "private",
    groupId: isGroup ? groupId : undefined,
    config: onebotConfig,
  };

  // 提取纯文本
  let rawBody = extractTextFromMessage(event.message).trim();

  // 提取媒体（图片、语音、视频、文件）
  const extractedMedia = extractMediaFromMessage(event.message);
  
  // 处理各种媒体类型
  const mediaPaths: string[] = [];
  const mediaUrls: string[] = [];
  const mediaTypes: string[] = [];
  const fileContents: string[] = []; // 文本文件内容
  let hasInboundAudio = false; // 用户是否发送了语音消息
  
  for (const media of extractedMedia) {
    if (!media.url) continue;
    
    const url = media.url;
    const isHttpUrl = url.startsWith("http://") || url.startsWith("https://");
    const isLocalPath = /^[A-Za-z]:[\\\/]/.test(url) || url.startsWith("/");
    
    if (!isHttpUrl && !isLocalPath) {
      log.warn(`[onebot] Skipping invalid media URL: ${url.substring(0, 50)}...`);
      continue;
    }
    
    if (media.type === "image" || media.type === "mface") {
      if (isHttpUrl) {
        // 图片/商城表情 → 下载并传给 AI 看
        const result = await downloadImageToTempFile(url, log);
        if (result) {
          mediaPaths.push(result.path);
          mediaUrls.push(result.dataUrl);
          mediaTypes.push(result.mimeType);
          const mediaLabel = media.type === "mface" 
            ? `商城表情[${media.summary}]` 
            : "图片";
          log.info(`[onebot] ${mediaLabel} saved to temp file: ${result.path} (${Math.round(result.size / 1024)}KB)`);
        }
      } else if (isLocalPath) {
        // 本地图片文件
        try {
          const buffer = fs.readFileSync(url);
          const ext = path.extname(url).toLowerCase();
          const mimeMap: Record<string, string> = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
          };
          const mimeType = mimeMap[ext] || "image/png";
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${mimeType};base64,${base64}`;
          mediaPaths.push(url);
          mediaUrls.push(dataUrl);
          mediaTypes.push(mimeType);
          log.info(`[onebot] Local image loaded: ${url} (${Math.round(buffer.length / 1024)}KB)`);
        } catch (err) {
          log.error(`[onebot] Failed to read local image: ${String(err)}`);
        }
      }
    } else if (media.type === "record") {
      // 语音消息 → 传递给 media-understanding 进行转录
      hasInboundAudio = true;
      if (isLocalPath) {
        try {
          // 等待文件写入完成（QQ 可能还在写入语音文件）
          let fileExists = false;
          let filePath = url;
          
          // 尝试 URL 解码路径（某些 OneBot 实现可能返回编码后的路径）
          try {
            const decoded = decodeURIComponent(url);
            if (decoded !== url && fs.existsSync(decoded)) {
              filePath = decoded;
              fileExists = true;
            }
          } catch {}
          
          // 重试机制：等待文件写入完成
          if (!fileExists) {
            for (let retry = 0; retry < 5; retry++) {
              if (fs.existsSync(filePath)) {
                fileExists = true;
                break;
              }
              // 等待 200ms 后重试
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
          
          if (fileExists) {
            // 检测语音格式
            const ext = path.extname(filePath).toLowerCase();
            let mimeType = "audio/amr"; // 默认 AMR
            if (ext === ".silk" || filePath.includes(".silk")) {
              mimeType = "audio/silk";
            } else if (ext === ".mp3") {
              mimeType = "audio/mpeg";
            } else if (ext === ".ogg" || ext === ".opus") {
              mimeType = "audio/ogg";
            } else if (ext === ".wav") {
              mimeType = "audio/wav";
            }
            mediaPaths.push(filePath);
            mediaTypes.push(mimeType);
            log.info(`[onebot] Voice message received: ${filePath} (${mimeType}), will be transcribed`);
          } else {
            log.warn(`[onebot] Voice file not found after retries: ${url}`);
            fileContents.push(`\n[用户发送了一条语音消息，但文件无法访问。请检查 QQ 数据目录权限。]`);
          }
        } catch (err) {
          log.error(`[onebot] Failed to access voice file: ${String(err)}`);
          fileContents.push(`\n[用户发送了一条语音消息，文件访问失败]`);
        }
      } else if (isHttpUrl) {
        // HTTP URL 的语音 - 也传递给 media-understanding
        mediaUrls.push(url);
        mediaTypes.push("audio/amr");
        log.info(`[onebot] Voice message URL: ${url}, will be transcribed`);
      }
    } else if (media.type === "file") {
      // 文件 → 下载，如果是文本文件则读取内容
      if (isHttpUrl) {
        const result = await downloadFileToTemp(url, media.fileName, log);
        if (result) {
          const sizeKB = Math.round(result.size / 1024);
          log.info(`[onebot] File saved: ${media.fileName || "unknown"} (${sizeKB}KB, ${result.isText ? "text" : "binary"})`);
          
          if (result.isText && result.content) {
            // 文本文件：将内容附加到消息中
            const fileHeader = `\n\n--- 文件: ${media.fileName || "unknown"} ---\n`;
            const fileFooter = `\n--- 文件结束 ---`;
            fileContents.push(fileHeader + result.content + fileFooter);
          } else {
            // 二进制文件：告诉 AI 有这个文件
            fileContents.push(`\n[收到文件: ${media.fileName || "unknown"}, 大小: ${sizeKB}KB, 类型: ${result.mimeType}]`);
          }
        }
      } else if (isLocalPath) {
        // 本地文件
        try {
          const buffer = fs.readFileSync(url);
          const sizeKB = Math.round(buffer.length / 1024);
          fileContents.push(`\n[收到文件: ${media.fileName || path.basename(url)}, 大小: ${sizeKB}KB]`);
          log.info(`[onebot] Local file: ${url} (${sizeKB}KB)`);
        } catch (err) {
          log.error(`[onebot] Failed to read local file: ${String(err)}`);
        }
      }
    }
  }
  
  // 将文件内容附加到消息末尾
  if (fileContents.length > 0) {
    rawBody = rawBody + fileContents.join("");
  }
  
  const hasMedia = mediaPaths.length > 0;

  // 群聊中检查是否 @ 了机器人
  let wasMentioned = false;
  if (isGroup && onebotConfig.selfId) {
    wasMentioned = isAtUser(event.message, onebotConfig.selfId);
    // 如果被 @，移除 @ 文本
    if (wasMentioned) {
      rawBody = rawBody.replace(/@[^\s]+\s*/g, "").trim();
    }
  }

  // 如果没有文本也没有媒体，跳过
  if (!rawBody && !hasMedia) {
    log.info("[onebot] Empty message (no text or media), skipping");
    return;
  }

  // 如果只有媒体没有文本，添加占位符
  if (!rawBody && hasMedia) {
    const placeholders = extractedMedia.map((m) => {
      if (m.type === "image") return "<media:image>";
      if (m.type === "mface") return `<media:sticker:${m.summary || "表情"}>`;
      if (m.type === "record") return "<media:audio>";
      if (m.type === "video") return "<media:video>";
      return "<media:file>";
    });
    rawBody = placeholders.join(" ");
  }

  log.info(`[onebot] Processing message from ${senderId}: "${rawBody.substring(0, 50)}..."`);

  // 群聊配置检查
  if (isGroup) {
    const groupPolicy = onebotConfig.groupPolicy ?? "allowlist";
    if (groupPolicy === "disabled") {
      log.info(`[onebot] Group messages disabled, skipping`);
      return;
    }

    const groupConfig = onebotConfig.groups?.[String(groupId)] ?? onebotConfig.groups?.["*"];
    if (groupPolicy === "allowlist" && !groupConfig) {
      log.info(`[onebot] Group ${groupId} not in allowlist, skipping`);
      return;
    }

    if (groupConfig?.enabled === false) {
      log.info(`[onebot] Group ${groupId} disabled, skipping`);
      return;
    }

    // 检查是否需要 @
    const requireMention = groupConfig?.requireMention ?? true;
    if (requireMention && !wasMentioned) {
      log.info(`[onebot] Group message without mention, skipping`);
      return;
    }
  }

  // 解析路由
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "onebot",
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
  // 始终包含 QQ 号，方便 agent 识别发送者身份
  const fromLabel = isGroup 
    ? `群${groupId}:${userId}${senderName ? `(${senderName})` : ''}` 
    : `${userId}${senderName ? `(${senderName})` : ''}`;

  const formattedBody = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: fromLabel,
    timestamp: event.time * 1000,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // 构建上下文（包含媒体信息）
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: formattedBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `onebot:${senderId}`,
    To: `onebot:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    WasMentioned: isGroup ? wasMentioned : undefined,
    Provider: "onebot",
    Surface: "onebot",
    MessageSid: String(event.message_id),
    MessageSidFull: String(event.message_id),
    OriginatingChannel: "onebot",
    OriginatingTo: `onebot:${chatId}`,
    // 标记入站语音消息，用于 TTS 的 inbound 模式
    HasInboundAudio: hasInboundAudio,
    // 媒体信息传递给 agent（需要 MediaPaths 才能被检测到）
    ...(mediaPaths.length > 0
      ? {
          MediaPaths: mediaPaths,
          MediaPath: mediaPaths[0],
          MediaUrls: mediaUrls,
          MediaUrl: mediaUrls[0],
          MediaTypes: mediaTypes,
          MediaType: mediaTypes[0],
        }
      : {}),
  });

  // 记录会话元数据
  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((err) => {
      log.error(`[onebot] Failed updating session meta: ${String(err)}`);
    });

  // 共享的媒体发送参数
  const messageType = isGroup ? "group" : "private";
  const targetUserId = isGroup ? undefined : userId;
  const targetGroupId = isGroup ? groupId : undefined;

  // 记录本轮已发送的纯文本，避免 block 流式 + final 同内容导致重复发送
  let lastDeliveredText = "";

  // 分发消息并处理回复
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload, info) => {
        const text = payload.text?.trim();
        // 提取 mediaUrls（工具输出的图片等）
        const payloadMediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
        const hasText = Boolean(text);
        const hasPayloadMedia = payloadMediaUrls.length > 0;

        if (!hasText && !hasPayloadMedia) return;

        // 去重：若 final 回复与上一句已发送的文本完全一致，则不再发（避免流式 block + final 重复）
        const kind = (info as { kind?: string } | undefined)?.kind;
        if (kind === "final" && hasText && text === lastDeliveredText && !hasPayloadMedia) {
          log.info(`[onebot] Skipping duplicate final reply (same as last block)`);
          return;
        }

        // 检测是否为语音回复（audioAsVoice 标志 + 音频媒体）
        const wantsVoice = payload.audioAsVoice === true;
        if (wantsVoice && hasPayloadMedia) {
          // 检查第一个媒体是否是音频
          const firstMedia = payloadMediaUrls[0];
          if (firstMedia) {
            const kind = detectMediaKind(firstMedia);
            if (kind === "audio") {
              log.info(`[onebot] Sending voice reply`);
              try {
                // 发送语音消息
                await deliverMediaToOneBot({
                  onebotConfig,
                  messageType,
                  userId: targetUserId,
                  groupId: targetGroupId,
                  mediaUrl: firstMedia,
                  log,
                });
                // 语音回复不需要额外发送文本
                return;
              } catch (err) {
                log.error(`[onebot] Voice reply failed, falling back to text: ${String(err)}`);
                // 降级到文本回复
              }
            }
          }
        }

        // 先发送媒体（图片直接发送为 QQ 图片）
        if (hasPayloadMedia) {
          for (let i = 0; i < payloadMediaUrls.length; i++) {
            const mediaUrl = payloadMediaUrls[i];
            if (!mediaUrl) continue;
            // 第一张媒体带文字说明（如果有），后续媒体不带
            const caption = i === 0 && hasText ? text : undefined;
            await deliverMediaToOneBot({
              onebotConfig,
              messageType,
              userId: targetUserId,
              groupId: targetGroupId,
              mediaUrl,
              caption,
              log,
            });
          }
          // 如果媒体已经带了 caption，不再单独发送文字
          if (hasText && payloadMediaUrls.length > 0) {
            return;
          }
        }

        // 发送文本（支持表情）
        if (hasText) {
          log.info(`[onebot] Sending reply: "${text.substring(0, 50)}..."`);
          try {
            // 尝试解析表情，如果失败则降级为纯文本
            let message: string | OneBotMessage[] = text;
            let usedEmoji = false;
            
            if (hasEmojiCode(text)) {
              message = parseTextWithEmoji(text);
              usedEmoji = true;
            }
            
            let result = await sendMsg(onebotConfig, {
              messageType,
              userId: targetUserId,
              groupId: targetGroupId,
              message,
            });

            // 如果表情消息发送失败，降级为纯文本重试
            if (result.status !== "ok" && usedEmoji) {
              log.warn(`[onebot] Emoji message failed (${result.retcode}), retrying as plain text`);
              result = await sendMsg(onebotConfig, {
                messageType,
                userId: targetUserId,
                groupId: targetGroupId,
                message: text, // 纯文本
              });
            }

            if (result.status === "ok") {
              lastDeliveredText = text;
              log.info("[onebot] Reply sent successfully");
            } else {
              log.error(`[onebot] Reply API error: ${result.retcode}`);
            }
          } catch (err) {
            log.error(`[onebot] Reply failed: ${String(err)}`);
          }
        }
      },
      onError: (err, info) => {
        log.error(`[onebot] ${info.kind} reply failed: ${String(err)}`);
      },
    },
    // 工具执行时实时发送输出（包括图片）- 仅私聊启用
    replyOptions: !isGroup
      ? {
          onToolResult: async (toolPayload) => {
            const toolText = toolPayload.text?.trim();
            const toolMediaUrls = toolPayload.mediaUrls ?? [];

            // 发送工具输出的媒体
            if (toolMediaUrls.length > 0) {
              for (const mediaUrl of toolMediaUrls) {
                if (!mediaUrl) continue;
                await deliverMediaToOneBot({
                  onebotConfig,
                  messageType,
                  userId: targetUserId,
                  groupId: targetGroupId,
                  mediaUrl,
                  log,
                });
              }
            }

            // 工具文本输出（可选，通常不需要单独发送）
            // 如果需要发送工具摘要文本，取消下面的注释
            // if (toolText) {
            //   await sendMsg(onebotConfig, {
            //     messageType,
            //     userId: targetUserId,
            //     groupId: targetGroupId,
            //     message: toolText,
            //   });
            // }
          },
        }
      : undefined,
  });
}

async function handleOneBotWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  api: MoltbotPluginApi
): Promise<void> {
  const cfg = api.config;
  const onebotConfig = cfg.channels?.onebot as OneBotConfig | undefined;
  const log = api.logger;
  const core = getOneBotRuntime();

  log.info("[onebot] Webhook request received");

  if (!onebotConfig?.enabled) {
    log.error("[onebot] Not enabled");
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "OneBot not enabled" }));
    return;
  }

  // 注意：accessToken 是用于调用 NapCat API 的，不用于验证入站 webhook
  // 因为 webhook 是本地请求 (127.0.0.1)，不需要额外鉴权

  const parsed = await readJsonBody(req, 1024 * 1024);
  if (!parsed.ok) {
    log.error(`[onebot] Body parse error: ${parsed.error}`);
    res.statusCode = 400;
    res.end(JSON.stringify({ error: parsed.error }));
    return;
  }

  const event = parsed.value as OneBotEvent;

  // 立即返回成功响应
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "ok" }));

  // 只处理消息事件
  if (event.post_type !== "message") {
    log.info(`[onebot] Ignoring non-message event: ${event.post_type}`);
    return;
  }

  const msgEvent = event as OneBotMessageEvent;

  // 只接收私聊消息，忽略群聊
  if (msgEvent.message_type === "group") {
    log.info(`[onebot] Ignoring group message from ${msgEvent.group_id}`);
    return;
  }

  // 保存 selfId (机器人 QQ 号)
  if (!onebotConfig.selfId) {
    onebotConfig.selfId = event.self_id;
  }

  // 异步处理消息
  processOneBotMessage({
    event: msgEvent,
    onebotConfig,
    config: cfg,
    core,
    log,
  }).catch((err) => {
    log.error(`[onebot] Message processing failed: ${String(err)}`);
  });
}

// Windows 截图工具 & Computer Use 工具
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";

// Screenshot 工具 Schema
const ScreenshotToolSchema = Type.Object({
  action: Type.Unsafe<"capture" | "send">(Type.String({ 
    description: "Action: 'capture' (take screenshot) or 'send' (send existing file)",
    enum: ["capture", "send"],
  })),
  monitor: Type.Optional(Type.Number({ description: "Monitor index (0-based), default all monitors" })),
  filePath: Type.Optional(Type.String({ description: "For send action: path to image file" })),
});

async function executeScreenshotTool(
  _toolCallId: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details?: unknown }> {
  const action = args.action as string;
  const monitor = typeof args.monitor === "number" ? args.monitor : -1;
  
  if (action === "capture") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const screenshotPath = path.join(os.tmpdir(), `screenshot-${timestamp}.png`);
    
    try {
      // PowerShell 截图命令（带 DPI aware，确保物理分辨率）
      const escapedPath = screenshotPath.replace(/\\/g, "/");
      const cmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DPI { [DllImport(\\\"user32.dll\\\")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${escapedPath}'); $g.Dispose(); $bmp.Dispose()"`;
      
      execSync(cmd, {
        encoding: "utf-8",
        windowsHide: true,
        timeout: 10000,
      });
      
      if (!fs.existsSync(screenshotPath)) {
        return {
          content: [{ type: "text", text: `Screenshot file not created` }],
        };
      }
      
      let imageBuffer = fs.readFileSync(screenshotPath);
      const originalSize = imageBuffer.length;
      
      // 转换为 JPEG 减小体积（保持原尺寸），方便 QQ 发送
      try {
        const sharp = (await import("sharp")).default;
        imageBuffer = await sharp(imageBuffer)
          .jpeg({ quality: 90 })
          .toBuffer();
      } catch {
        // sharp 失败则用原图
      }
      
      const base64Data = imageBuffer.toString("base64");
      const fileSize = imageBuffer.length;
      
      // 直接发送图片到 OneBot
      if (lastSenderContext) {
        try {
          const result = await sendImage(lastSenderContext.config, {
            messageType: lastSenderContext.messageType,
            userId: lastSenderContext.userId,
            groupId: lastSenderContext.groupId,
            file: `base64://${base64Data}`,
          });
          if (result.status === "ok") {
            return {
              content: [
                { type: "text", text: `Screenshot captured and sent! (${Math.round(fileSize / 1024)}KB)` },
              ],
              details: {
                path: screenshotPath,
                size: fileSize,
                monitor: monitor,
                sent: true,
              },
            };
          }
        } catch {
          // 发送失败，回退到返回图片数据
        }
      }
      
      // 回退：返回图片数据让系统处理
      return {
        content: [
          { type: "text", text: `Screenshot captured: ${screenshotPath} (${Math.round(fileSize / 1024)}KB)` },
          { type: "image", data: base64Data, mimeType: "image/png" },
        ],
        details: {
          path: screenshotPath,
          size: fileSize,
          monitor: monitor,
        },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Screenshot failed: ${String(err)}` }],
      };
    }
  } else if (action === "send") {
    const filePath = args.filePath as string;
    if (!filePath) {
      return { content: [{ type: "text", text: "filePath required for send action" }] };
    }
    
    try {
      const imageBuffer = fs.readFileSync(filePath);
      const base64Data = imageBuffer.toString("base64");
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : 
                       ext === ".gif" ? "image/gif" : 
                       ext === ".webp" ? "image/webp" : "image/png";
      
      return {
        content: [
          { type: "text", text: `Sending image: ${filePath}` },
          { type: "image", data: base64Data, mimeType },
        ],
        details: { path: filePath, size: imageBuffer.length },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to read file: ${String(err)}` }],
      };
    }
  }
  
  return { content: [{ type: "text", text: `Unknown action: ${action}` }] };
}

// OmniParser API 配置
const OMNIPARSER_API_URL = "http://127.0.0.1:8765";

/**
 * 检查 OmniParser 服务是否可用
 */
async function checkOmniParserHealth(): Promise<{ ok: boolean; device?: string; error?: string }> {
  try {
    const response = await fetch(`${OMNIPARSER_API_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json() as { status?: string; device?: string; model_loaded?: boolean };
    if (data.status === "ok" && data.model_loaded) {
      return { ok: true, device: data.device };
    }
    return { ok: false, error: "Model not loaded" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Computer Use 工具 Schema - 完整版，包含所有 OmniTool 支持的动作
const ComputerToolSchema = Type.Object({
  action: Type.Unsafe<
    | "screenshot" | "parse" | "click" | "type" | "key" | "scroll"
    | "mouse_move" | "drag" | "middle_click" | "cursor_position" | "hover" | "wait" | "health"
  >(Type.String({
    description: `Action to perform:
- screenshot: Capture screen and return as image for AI analysis
- parse: Use OmniParser to detect UI elements (returns labeled image with element IDs)
- click: Click at (x, y) coordinates
- mouse_move: Move mouse to (x, y) without clicking
- drag: Drag from current position to (x, y)
- middle_click: Middle mouse button click
- cursor_position: Get current mouse cursor position
- type: Type text
- key: Press key combination (e.g. "ctrl+c", "enter", "win+d")
- scroll: Scroll up or down
- hover: Hover at current position (do nothing, for waiting UI to update)
- wait: Wait for specified milliseconds
- health: Check if OmniParser service is available`,
    enum: ["screenshot", "parse", "click", "type", "key", "scroll", "mouse_move", "drag", "middle_click", "cursor_position", "hover", "wait", "health"],
  })),
  x: Type.Optional(Type.Number({ description: "X coordinate for click/mouse_move/drag action" })),
  y: Type.Optional(Type.Number({ description: "Y coordinate for click/mouse_move/drag action" })),
  text: Type.Optional(Type.String({ description: "Text to type" })),
  key: Type.Optional(Type.String({ description: "Key to press (Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, Win, Ctrl+C, Alt+F4, etc.)" })),
  direction: Type.Optional(Type.Unsafe<"up" | "down">(Type.String({ 
    description: "Scroll direction",
    enum: ["up", "down"],
  }))),
  clicks: Type.Optional(Type.Number({ description: "Number of clicks: 1=single click (for buttons/menus), 2=double click (REQUIRED for launching apps/opening files from desktop or file explorer). Default 1" })),
  button: Type.Optional(Type.Unsafe<"left" | "right" | "middle">(Type.String({
    description: "Mouse button (left, right, or middle), default left",
    enum: ["left", "right", "middle"],
  }))),
  duration: Type.Optional(Type.Number({ description: "Duration in milliseconds for wait action or drag duration. Default: 1000 for wait, 500 for drag" })),
});

async function executeComputerTool(
  _toolCallId: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details?: unknown }> {
  const action = args.action as string;

  try {
    if (action === "screenshot") {
      // 截图并返回给 AI 分析（使用物理坐标系，与点击一致）
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const screenshotPath = path.join(os.tmpdir(), `computer-${timestamp}.png`);
      
      // 使用 SetProcessDPIAware 确保获取物理分辨率
      const cmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DPI { [DllImport(\\\"user32.dll\\\")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${screenshotPath.replace(/\\/g, "/")}'); Write-Output $bmp.Width,$bmp.Height; $g.Dispose(); $bmp.Dispose()"`;
      
      const output = execSync(cmd, { encoding: "utf-8", windowsHide: true, timeout: 10000 });
      const [width, height] = output.trim().split(/\r?\n/).map(Number);
      
      if (!fs.existsSync(screenshotPath)) {
        return { content: [{ type: "text", text: "Screenshot capture failed" }] };
      }
      
      const imageBuffer = fs.readFileSync(screenshotPath);
      const base64Data = imageBuffer.toString("base64");
      
      return {
        content: [
          { type: "text", text: `Screenshot captured. Screen size: ${width}x${height}. Analyze the image to find elements and their coordinates. Or use action="parse" to auto-detect UI elements with OmniParser.` },
          { type: "image", data: base64Data, mimeType: "image/png" },
        ],
        details: { path: screenshotPath, width, height },
      };
    }

    if (action === "parse") {
      // 使用 OmniParser 自动检测 UI 元素
      // 截图使用物理坐标系（实际屏幕分辨率）
      // 点击也使用物理坐标系，保持一致
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const screenshotPath = path.join(os.tmpdir(), `omniparse-${timestamp}.png`);
      
      // 使用 SetProcessDPIAware 确保获取物理分辨率
      const cmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DPI { [DllImport(\\\"user32.dll\\\")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${screenshotPath.replace(/\\/g, "/")}'); Write-Output $bmp.Width,$bmp.Height; $g.Dispose(); $bmp.Dispose()"`;
      
      const output = execSync(cmd, { encoding: "utf-8", windowsHide: true, timeout: 10000 });
      const [width, height] = output.trim().split(/\r?\n/).map(Number);
      
      if (!fs.existsSync(screenshotPath)) {
        return { content: [{ type: "text", text: "Screenshot capture failed" }] };
      }
      
      const imageBuffer = fs.readFileSync(screenshotPath);
      const base64Data = imageBuffer.toString("base64");
      
      // 调用 OmniParser API
      try {
        const response = await fetch(`${OMNIPARSER_API_URL}/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: base64Data }),
        });
        
        if (!response.ok) {
          throw new Error(`OmniParser API error: ${response.statusText}`);
        }
        
        const result = await response.json() as {
          success?: boolean;
          error?: string;
          image_size?: { width: number; height: number };
          element_count?: number;
          elements?: Array<{
            id: number;
            content: {
              type: string;
              bbox: [number, number, number, number]; // normalized [x1, y1, x2, y2]
              interactivity: boolean;
              content: string;
              source: string;
            };
          }>;
          labeled_image?: string; // OmniParser 返回的带标注图片 (base64)
        };
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        // 转换元素格式：归一化坐标 -> 像素坐标，计算中心点
        // 重要：使用实际屏幕分辨率 (width, height)，而不是图片分辨率 (image_size)
        // OmniParser 返回的 bbox 是归一化坐标 (0-1)，需要乘以实际屏幕尺寸
        const screenWidth = width;  // 实际屏幕宽度
        const screenHeight = height;  // 实际屏幕高度
        
        const parsedElements = (result.elements || []).map((e) => {
          const [x1, y1, x2, y2] = e.content.bbox;
          const centerX = Math.round(((x1 + x2) / 2) * screenWidth);
          const centerY = Math.round(((y1 + y2) / 2) * screenHeight);
          return {
            id: e.id,
            type: e.content.type,
            label: e.content.content,
            interactivity: e.content.interactivity,
            center: { x: centerX, y: centerY },
            bbox: {
              x1: Math.round(x1 * screenWidth),
              y1: Math.round(y1 * screenHeight),
              x2: Math.round(x2 * screenWidth),
              y2: Math.round(y2 * screenHeight),
            },
          };
        });
        
        // 格式化元素列表，按类型分组显示
        const interactiveElements = parsedElements.filter((e) => e.interactivity);
        const textElements = parsedElements.filter((e) => e.type === "text" && !e.interactivity);
        const iconElements = parsedElements.filter((e) => e.type === "icon" && !e.interactivity);
        
        let elementList = "";
        if (interactiveElements.length > 0) {
          elementList += "🔘 Interactive Elements:\n";
          elementList += interactiveElements
            .map((e) => `  [${e.id}] "${e.label}" → click(${e.center.x}, ${e.center.y})`)
            .join("\n");
          elementList += "\n\n";
        }
        if (textElements.length > 0) {
          elementList += "📝 Text Elements:\n";
          elementList += textElements
            .map((e) => `  [${e.id}] "${e.label}" at (${e.center.x}, ${e.center.y})`)
            .join("\n");
          elementList += "\n\n";
        }
        if (iconElements.length > 0) {
          elementList += "🎨 Icon Elements:\n";
          elementList += iconElements
            .map((e) => `  [${e.id}] "${e.label}" at (${e.center.x}, ${e.center.y})`)
            .join("\n");
        }
        
        // 优先使用 OmniParser 返回的带标注图片，这样用户可以看到元素编号
        const displayImage = result.labeled_image || base64Data;
        const hasLabeledImage = Boolean(result.labeled_image);
        
        return {
          content: [
            { 
              type: "text", 
              text: `🔍 OmniParser 检测到 ${result.element_count || 0} 个 UI 元素\n📐 屏幕尺寸: ${screenWidth}x${screenHeight}\n${hasLabeledImage ? "📸 已返回带编号标注的图片\n" : ""}\n${elementList}\n💡 点击元素示例: action="click", x=<center_x>, y=<center_y>` 
            },
            { type: "image", data: displayImage, mimeType: "image/png" },
          ],
          details: { 
            path: screenshotPath, 
            width: screenWidth, 
            height: screenHeight, 
            elements: parsedElements,
            omniparser: true,
            hasLabeledImage,
          },
        };
      } catch (err) {
        // OmniParser 不可用，降级为普通截图
        return {
          content: [
            { 
              type: "text", 
              text: `⚠️ OmniParser 不可用 (${String(err)})。\n返回原始截图供手动分析。屏幕尺寸: ${width}x${height}。\n\n💡 提示: 运行 action="health" 检查 OmniParser 服务状态` 
            },
            { type: "image", data: base64Data, mimeType: "image/png" },
          ],
          details: { path: screenshotPath, width, height, omniparser: false },
        };
      }
    }

    if (action === "health") {
      // 检查 OmniParser 服务健康状态
      const health = await checkOmniParserHealth();
      if (health.ok) {
        return {
          content: [{ type: "text", text: `✅ OmniParser 服务正常运行\n🖥️ 设备: ${health.device || "unknown"}\n🔗 地址: ${OMNIPARSER_API_URL}` }],
          details: health,
        };
      } else {
        return {
          content: [{ type: "text", text: `❌ OmniParser 服务不可用\n错误: ${health.error}\n🔗 地址: ${OMNIPARSER_API_URL}\n\n💡 请确保 OmniParser 服务已启动:\ncd OmniParser && python omniparser_api.py` }],
          details: health,
        };
      }
    }

    if (action === "click") {
      const x = args.x as number;
      const y = args.y as number;
      const clicks = (args.clicks as number) || 1;
      const button = (args.button as string) || "left";
      
      if (typeof x !== "number" || typeof y !== "number") {
        return { content: [{ type: "text", text: "click requires x and y coordinates" }] };
      }
      
      // 使用预先写好的点击脚本（逻辑坐标系，与截图一致）
      // 需要调用 SetProcessDPIAware 让坐标使用逻辑坐标系
      const clickDown = button === "right" ? "MOUSEEVENTF_RIGHTDOWN" : "MOUSEEVENTF_LEFTDOWN";
      const clickUp = button === "right" ? "MOUSEEVENTF_RIGHTUP" : "MOUSEEVENTF_LEFTUP";
      
      const psScript = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ClickHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
  public const uint MOUSEEVENTF_RIGHTUP = 0x10;
}
'@
[ClickHelper]::SetProcessDPIAware() | Out-Null
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Start-Sleep -Milliseconds 50
[ClickHelper]::mouse_event([ClickHelper]::${clickDown}, 0, 0, 0, 0)
[ClickHelper]::mouse_event([ClickHelper]::${clickUp}, 0, 0, 0, 0)
${clicks === 2 ? `Start-Sleep -Milliseconds 100
[ClickHelper]::mouse_event([ClickHelper]::${clickDown}, 0, 0, 0, 0)
[ClickHelper]::mouse_event([ClickHelper]::${clickUp}, 0, 0, 0, 0)` : ""}
`;
      
      const scriptPath = path.join(os.tmpdir(), `click-${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, psScript, "ascii");
      
      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { 
          encoding: "utf-8", 
          windowsHide: true, 
          timeout: 10000 
        });
      } finally {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      }
      
      return {
        content: [{ type: "text", text: `Clicked at (${x}, ${y}) with ${button} button${clicks === 2 ? " (double-click)" : ""}` }],
        details: { x, y, clicks, button },
      };
    }

    if (action === "type") {
      const text = args.text as string;
      if (!text) {
        return { content: [{ type: "text", text: "type requires text parameter" }] };
      }
      
      // 使用 PowerShell SendKeys 输入文字
      // 转义特殊字符
      const escapedText = text
        .replace(/\+/g, "{+}")
        .replace(/\^/g, "{^}")
        .replace(/%/g, "{%}")
        .replace(/~/g, "{~}")
        .replace(/\(/g, "{(}")
        .replace(/\)/g, "{)}")
        .replace(/\[/g, "{[}")
        .replace(/\]/g, "{]}")
        .replace(/\{/g, "{{}}")
        .replace(/\}/g, "{}}");
      
      const typeCmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText.replace(/'/g, "''")}')"`;
      
      execSync(typeCmd, { encoding: "utf-8", windowsHide: true, timeout: 10000 });
      
      return {
        content: [{ type: "text", text: `Typed: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"` }],
        details: { text },
      };
    }

    if (action === "key") {
      const key = args.key as string;
      if (!key) {
        return { content: [{ type: "text", text: "key requires key parameter" }] };
      }
      
      // Virtual key codes for keybd_event (supports Win key and all combinations)
      const vkCodes: Record<string, number> = {
        // Modifier keys
        win: 0x5b, lwin: 0x5b, rwin: 0x5c, // Windows key
        ctrl: 0x11, control: 0x11,
        alt: 0x12,
        shift: 0x10,
        // Common keys
        enter: 0x0d, return: 0x0d,
        tab: 0x09,
        escape: 0x1b, esc: 0x1b,
        backspace: 0x08, bs: 0x08,
        delete: 0x2e, del: 0x2e,
        space: 0x20,
        // Arrow keys
        up: 0x26, down: 0x28, left: 0x25, right: 0x27,
        // Navigation
        home: 0x24, end: 0x23,
        pageup: 0x21, pgup: 0x21,
        pagedown: 0x22, pgdn: 0x22,
        insert: 0x2d,
        // Function keys
        f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
        f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
        // Letters A-Z
        a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45, f: 0x46, g: 0x47,
        h: 0x48, i: 0x49, j: 0x4a, k: 0x4b, l: 0x4c, m: 0x4d, n: 0x4e,
        o: 0x4f, p: 0x50, q: 0x51, r: 0x52, s: 0x53, t: 0x54, u: 0x55,
        v: 0x56, w: 0x57, x: 0x58, y: 0x59, z: 0x5a,
        // Numbers 0-9
        "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
        "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
        // Special
        printscreen: 0x2c, prtsc: 0x2c,
        pause: 0x13, capslock: 0x14, numlock: 0x90, scrolllock: 0x91,
      };

      const lowerKey = key.toLowerCase();
      const parts = lowerKey.split("+").map((p) => p.trim());
      
      // Collect all key codes to press
      const keyCodes: number[] = [];
      for (const part of parts) {
        const code = vkCodes[part];
        if (code !== undefined) {
          keyCodes.push(code);
        } else if (part.length === 1) {
          const charCode = part.toUpperCase().charCodeAt(0);
          if (charCode >= 0x30 && charCode <= 0x5a) {
            keyCodes.push(charCode);
          }
        }
      }

      if (keyCodes.length === 0) {
        return { content: [{ type: "text", text: `Unknown key: ${key}` }] };
      }

      // Build PowerShell script using keybd_event
      const keyDownCalls = keyCodes.map((code) => `[KeyHelper]::keybd_event(${code}, 0, 0, 0)`).join("; ");
      const keyUpCalls = [...keyCodes].reverse().map((code) => `[KeyHelper]::keybd_event(${code}, 0, 2, 0)`).join("; ");

      const keyScript = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KeyHelper {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
}
'@
${keyDownCalls}
Start-Sleep -Milliseconds 50
${keyUpCalls}
`;

      const scriptPath = path.join(os.tmpdir(), `key-${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, keyScript, "ascii");
      
      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          encoding: "utf-8",
          windowsHide: true,
          timeout: 10000,
        });
      } finally {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      }
      
      return {
        content: [{ type: "text", text: `Pressed key: ${key}` }],
        details: { key, keyCodes },
      };
    }

    if (action === "scroll") {
      const direction = (args.direction as string) || "down";
      const amount = direction === "up" ? 120 : -120;
      
      const scrollCmd = `powershell -ExecutionPolicy Bypass -Command "$sig='[DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'; Add-Type -MemberDefinition $sig -Name U -Namespace W; [W.U]::mouse_event(0x0800, 0, 0, ${amount * 3}, 0)"`;
      
      execSync(scrollCmd, { encoding: "utf-8", windowsHide: true, timeout: 5000 });
      
      return {
        content: [{ type: "text", text: `Scrolled ${direction}` }],
        details: { direction },
      };
    }

    if (action === "mouse_move") {
      // 移动鼠标到指定位置（不点击）
      const x = args.x as number;
      const y = args.y as number;
      
      if (typeof x !== "number" || typeof y !== "number") {
        return { content: [{ type: "text", text: "mouse_move requires x and y coordinates" }] };
      }
      
      const moveScript = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
'@
[MouseHelper]::SetProcessDPIAware() | Out-Null
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`;
      
      const scriptPath = path.join(os.tmpdir(), `mousemove-${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, moveScript, "ascii");
      
      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          encoding: "utf-8",
          windowsHide: true,
          timeout: 5000,
        });
      } finally {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      }
      
      return {
        content: [{ type: "text", text: `🖱️ Mouse moved to (${x}, ${y})` }],
        details: { x, y },
      };
    }

    if (action === "drag") {
      // 从当前位置拖拽到目标位置
      const x = args.x as number;
      const y = args.y as number;
      const duration = (args.duration as number) || 500;
      
      if (typeof x !== "number" || typeof y !== "number") {
        return { content: [{ type: "text", text: "drag requires x and y coordinates" }] };
      }
      
      // 使用 mouse_event 实现拖拽：按下 -> 移动 -> 释放
      const dragScript = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class DragHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  
  public static void SmoothDrag(int startX, int startY, int endX, int endY, int durationMs) {
    SetProcessDPIAware();
    int steps = Math.Max(10, durationMs / 20);
    double stepX = (double)(endX - startX) / steps;
    double stepY = (double)(endY - startY) / steps;
    int sleepMs = durationMs / steps;
    
    // Move to start and press
    System.Windows.Forms.Cursor.Position = new System.Drawing.Point(startX, startY);
    Thread.Sleep(50);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(50);
    
    // Smooth move
    for (int i = 1; i <= steps; i++) {
      int x = startX + (int)(stepX * i);
      int y = startY + (int)(stepY * i);
      System.Windows.Forms.Cursor.Position = new System.Drawing.Point(x, y);
      Thread.Sleep(sleepMs);
    }
    
    // Release
    Thread.Sleep(50);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  }
}
'@
$pos = [System.Windows.Forms.Cursor]::Position
Write-Output "$($pos.X),$($pos.Y)"
[DragHelper]::SmoothDrag($pos.X, $pos.Y, ${x}, ${y}, ${duration})
`;
      
      const scriptPath = path.join(os.tmpdir(), `drag-${Date.now()}.ps1`);
      fs.writeFileSync(scriptPath, dragScript, "ascii");
      
      let startPos = "unknown";
      try {
        const output = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          encoding: "utf-8",
          windowsHide: true,
          timeout: duration + 5000,
        });
        startPos = output.trim().split(/\r?\n/)[0] || "unknown";
      } finally {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
      }
      
      return {
        content: [{ type: "text", text: `🖱️ Dragged from (${startPos}) to (${x}, ${y})` }],
        details: { startPos, endX: x, endY: y, duration },
      };
    }

    if (action === "middle_click") {
      // 中键点击
      const middleClickCmd = `powershell -ExecutionPolicy Bypass -Command "$sig='[DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'; Add-Type -MemberDefinition $sig -Name U -Namespace W; [W.U]::mouse_event(0x20, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; [W.U]::mouse_event(0x40, 0, 0, 0, 0)"`;
      
      execSync(middleClickCmd, { encoding: "utf-8", windowsHide: true, timeout: 5000 });
      
      return {
        content: [{ type: "text", text: "🖱️ Middle clicked" }],
        details: { button: "middle" },
      };
    }

    if (action === "cursor_position") {
      // 获取当前鼠标位置
      const posCmd = `powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DPI { [DllImport(\\\"user32.dll\\\")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null; $p=[System.Windows.Forms.Cursor]::Position; Write-Output \\"$($p.X),$($p.Y)\\""`;
      
      const output = execSync(posCmd, { encoding: "utf-8", windowsHide: true, timeout: 5000 });
      const [curX, curY] = output.trim().split(",").map(Number);
      
      return {
        content: [{ type: "text", text: `🖱️ Current cursor position: (${curX}, ${curY})` }],
        details: { x: curX, y: curY },
      };
    }

    if (action === "hover") {
      // 悬停（什么都不做，等待 UI 更新）
      return {
        content: [{ type: "text", text: "🖱️ Hovering at current position" }],
        details: { action: "hover" },
      };
    }

    if (action === "wait") {
      // 等待指定时间
      const duration = (args.duration as number) || 1000;
      
      // 使用 Promise 延迟
      await new Promise((resolve) => setTimeout(resolve, duration));
      
      return {
        content: [{ type: "text", text: `⏱️ Waited ${duration}ms` }],
        details: { duration },
      };
    }

    return { content: [{ type: "text", text: `Unknown action: ${action}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Computer action failed: ${String(err)}` }] };
  }
}

const plugin = {
  id: "onebot",
  name: "OneBot (QQ/NapCat)",
  description: "OneBot v11 protocol plugin for QQ via NapCat/Lagrange",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setOneBotRuntime(api.runtime);

    // 注册 HTTP 路由到 Gateway
    api.registerHttpRoute({
      path: "/webhook/onebot",
      handler: async (req, res) => {
        await handleOneBotWebhook(req, res, api);
      },
    });

    api.registerChannel({ plugin: onebotPlugin });
    
    // 注册截图工具 (Windows only)
    if (process.platform === "win32") {
      api.registerTool({
        name: "screenshot",
        label: "Screenshot (Windows)",
        description: 
          "USE THIS TOOL to take and send screenshots on Windows. " +
          "When user asks for a screenshot, use action='capture'. " +
          "The screenshot will be automatically sent as an image to the user. " +
          "Do NOT use exec tool for screenshots - use this tool instead.",
        parameters: ScreenshotToolSchema,
        execute: executeScreenshotTool,
      });
      api.logger.info("[onebot] Screenshot tool registered for Windows");

      // 注册 Computer Use 工具 (Windows only)
      api.registerTool({
        name: "computer",
        label: "Computer Use (Windows)",
        description:
          "Control the computer desktop with full mouse/keyboard control. " +
          "WORKFLOW: 1) Use 'parse' to detect UI elements with OmniParser (returns labeled image with IDs), " +
          "2) Click elements using the coordinates provided. " +
          "ACTIONS: " +
          "• parse - OmniParser UI detection (RECOMMENDED: shows labeled image with element IDs) " +
          "• screenshot - Raw screen capture for manual analysis " +
          "• click(x,y) - Left/right/double click at coordinates " +
          "• mouse_move(x,y) - Move cursor without clicking " +
          "• drag(x,y) - Drag from current position to target " +
          "• middle_click - Middle mouse button " +
          "• cursor_position - Get current cursor location " +
          "• type(text) - Type text " +
          "• key(combo) - Press keys (e.g. 'enter', 'ctrl+c', 'win+d', 'alt+f4') " +
          "• scroll(direction) - Scroll up/down " +
          "• wait(duration) - Wait milliseconds " +
          "• health - Check OmniParser service status",
        parameters: ComputerToolSchema,
        execute: executeComputerTool,
      });
      api.logger.info("[onebot] Computer Use tool registered for Windows");
    }
  },
};

export default plugin;
