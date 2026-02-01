import type {
  ChannelPlugin,
  MoltbotConfig,
  InboundMessageContext,
} from "clawdbot/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
} from "clawdbot/plugin-sdk";

import { sendFeishuMessage } from "./send.js";
import { getFeishuRuntime } from "./runtime.js";
import type { FeishuConfig } from "./types.js";

export type ResolvedFeishuAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  config: FeishuConfig;
};

function resolveFeishuAccount(cfg: MoltbotConfig, accountId: string): ResolvedFeishuAccount {
  const feishuConfig = cfg.channels?.feishu as FeishuConfig | undefined;
  return {
    accountId,
    name: "Feishu",
    enabled: feishuConfig?.enabled ?? false,
    config: feishuConfig ?? {},
  };
}

export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  id: "feishu",
  meta: {
    label: "Feishu (飞书)",
    icon: "feishu",
  },
  pairing: {
    idLabel: "feishuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^feishu:/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendFeishuMessage({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.feishu"] },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveFeishuAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const nextChannels = { ...cfg.channels };
      delete nextChannels.feishu;
      return { ...cfg, channels: nextChannels };
    },
    isConfigured: (account) =>
      Boolean(account.config.appId?.trim() && account.config.appSecret?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.appId?.trim() && account.config.appSecret?.trim()),
    }),
    resolveAllowFrom: ({ cfg }) =>
      ((cfg.channels?.feishu as FeishuConfig | undefined)?.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^feishu:/i, ""))
        .toLowerCase?.() ?? allowFrom,
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.feishu.dmPolicy",
      allowFromPath: "channels.feishu.allowFrom",
    }),
  },
  messaging: {
    normalizeTarget: (target) => target,
    targetResolver: {
      looksLikeId: (id) => id.startsWith("ou_") || id.startsWith("oc_"),
      hint: "<open_id or chat_id>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 10000,
    sendText: async ({ to, text, cfg, replyToId }) => {
      const result = await sendFeishuMessage({
        cfg,
        to,
        text,
        replyToMessageId: replyToId ?? undefined,
      });
      return { channel: "feishu", messageId: result.messageId };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.appId?.trim() && account.config.appSecret?.trim()),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({ accountId: ctx.accountId, running: true });
      ctx.log?.info("Feishu provider started (webhook via Gateway at /webhook/feishu)");
      return new Promise<void>((resolve) => {
        ctx.abortSignal?.addEventListener("abort", () => {
          ctx.log?.info("Feishu provider stopping");
          resolve();
        });
      });
    },
  },
};
