export type FeishuConfig = {
  /** 是否启用飞书渠道 */
  enabled?: boolean;
  /** 飞书应用 App ID */
  appId?: string;
  /** 飞书应用 App Secret */
  appSecret?: string;
  /** Webhook 验证 Token (用于验证飞书请求) */
  verificationToken?: string;
  /** Encrypt Key (可选，用于解密消息) */
  encryptKey?: string;
  /** Webhook 端口 (默认: 3979) */
  webhookPort?: number;
  /** DM 策略 */
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  /** 允许列表 */
  allowFrom?: string[];
  /** 群组策略 */
  groupPolicy?: "open" | "disabled" | "allowlist";
  /** 群组允许列表 */
  groupAllowFrom?: string[];
};

export type FeishuMessage = {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          open_id?: string;
          user_id?: string;
          union_id?: string;
        };
        name: string;
        tenant_key?: string;
      }>;
    };
  };
};

export type FeishuTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

export type FeishuSendMessageResponse = {
  code: number;
  msg: string;
  data?: {
    message_id: string;
  };
};

export type FeishuUserInfo = {
  code: number;
  msg: string;
  data?: {
    user?: {
      open_id?: string;
      user_id?: string;
      name?: string;
      en_name?: string;
      nickname?: string;
      email?: string;
      mobile?: string;
      avatar?: {
        avatar_72?: string;
        avatar_240?: string;
        avatar_640?: string;
        avatar_origin?: string;
      };
    };
  };
};
