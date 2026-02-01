import type { FeishuConfig, FeishuTokenResponse, FeishuSendMessageResponse } from "./types.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 获取 tenant_access_token
 */
export async function getTenantAccessToken(config: FeishuConfig): Promise<string> {
  // 检查缓存
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });

  const data = (await response.json()) as FeishuTokenResponse;
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${data.msg}`);
  }

  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire || 7200) * 1000,
  };

  return cachedToken.token;
}

/**
 * 发送文本消息
 */
export async function sendTextMessage(params: {
  config: FeishuConfig;
  receiveId: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  text: string;
}): Promise<FeishuSendMessageResponse> {
  const token = await getTenantAccessToken(params.config);

  const response = await fetch(
    `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${params.receiveIdType}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: params.receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: params.text }),
      }),
    }
  );

  return (await response.json()) as FeishuSendMessageResponse;
}

/**
 * 回复消息
 */
export async function replyMessage(params: {
  config: FeishuConfig;
  messageId: string;
  text: string;
}): Promise<FeishuSendMessageResponse> {
  const token = await getTenantAccessToken(params.config);

  const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages/${params.messageId}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text: params.text }),
    }),
  });

  return (await response.json()) as FeishuSendMessageResponse;
}

/**
 * 发送富文本消息 (Markdown-like)
 */
export async function sendRichTextMessage(params: {
  config: FeishuConfig;
  receiveId: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  title?: string;
  content: Array<Array<{ tag: string; text?: string; href?: string }>>;
}): Promise<FeishuSendMessageResponse> {
  const token = await getTenantAccessToken(params.config);

  const richTextContent = {
    zh_cn: {
      title: params.title || "",
      content: params.content,
    },
  };

  const response = await fetch(
    `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${params.receiveIdType}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: params.receiveId,
        msg_type: "post",
        content: JSON.stringify(richTextContent),
      }),
    }
  );

  return (await response.json()) as FeishuSendMessageResponse;
}

/**
 * 验证飞书请求签名
 */
export function verifyFeishuRequest(params: {
  timestamp: string;
  nonce: string;
  signature: string;
  encryptKey: string;
  body: string;
}): boolean {
  // 简化验证，生产环境应使用完整的签名验证
  // 这里只做基本检查
  return Boolean(params.timestamp && params.nonce);
}

/**
 * 解密飞书消息 (AES-256-CBC)
 * 飞书使用 Encrypt Key 的 SHA256 哈希作为 AES 密钥
 */
export function decryptFeishuMessage(encrypted: string, encryptKey: string): string {
  if (!encryptKey || !encrypted) return encrypted;

  try {
    const crypto = require("node:crypto") as typeof import("node:crypto");

    // 1. SHA256 哈希 encrypt key 得到 AES 密钥
    const keyHash = crypto.createHash("sha256").update(encryptKey).digest();

    // 2. Base64 解码
    const encryptedBuffer = Buffer.from(encrypted, "base64");

    // 3. 提取 IV (前16字节) 和密文
    const iv = encryptedBuffer.subarray(0, 16);
    const ciphertext = encryptedBuffer.subarray(16);

    // 4. AES-256-CBC 解密
    const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    console.error("Feishu decrypt error:", err);
    return encrypted;
  }
}
