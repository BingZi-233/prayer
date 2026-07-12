/** 运行日志错误分类:把上游含糊/误导文案映射为稳定 code + 中文标题 + 处置建议 */

export type LogCategory =
  | "content_safety"
  | "rate_limit"
  | "auth"
  | "model"
  | "validation"
  | "infra"
  | "business"
  | "unknown";

export interface ClassifiedError {
  code: string;
  category: LogCategory;
  title: string;
  hint: string;
  retryable: boolean;
}

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  content_safety: "内容安全",
  rate_limit: "限流",
  auth: "鉴权",
  model: "模型",
  validation: "校验",
  infra: "基础设施",
  business: "业务",
  unknown: "未分类",
};

/**
 * 对已知上游错误码/文案做分类。纯函数,便于单测与后台展示。
 * 匹配顺序:更具体的规则在前。
 */
export function classifyError(raw: string): ClassifiedError {
  const msg = raw ?? "";

  // 图片敏感优先于通用 1026
  if (/image is sensitive/i.test(msg) || (/new_sensitive/i.test(msg) && /image/i.test(msg))) {
    return {
      code: "content_safety.image",
      category: "content_safety",
      title: "图片被内容安全拦截",
      hint: "检查消息中的图片;相同输入重试无效。",
      retryable: false,
    };
  }
  if (/new_sensitive|\b1026\b|input\s+new_sensitive/i.test(msg)) {
    return {
      code: "content_safety.input",
      category: "content_safety",
      title: "输入被内容安全拦截",
      hint: "检查对话/KB 片段是否含敏感文本;相同输入重试无效;反思路径下该群游标不会推进。",
      retryable: false,
    };
  }
  if (/\b1027\b|output[_\s]?sensitive/i.test(msg)) {
    return {
      code: "content_safety.output",
      category: "content_safety",
      title: "输出被内容安全拦截",
      hint: "模型输出触发安全策略;可换表述重试或换模型。",
      retryable: false,
    };
  }

  if (/reached maximum number of turns|max(?:imum)?\s*turns/i.test(msg)) {
    return {
      code: "model.max_turns",
      category: "model",
      title: "达到最大轮次",
      hint: "模型反复 tool_use 或未收敛;可提高 maxTurns 或收紧工具权限。",
      retryable: true,
    };
  }

  if (/\b429\b|rate[_\s-]?limit|too many requests/i.test(msg)) {
    return {
      code: "api.rate_limit",
      category: "rate_limit",
      title: "触发限流",
      hint: "稍后重试或降低并发/扫描频率。",
      retryable: true,
    };
  }

  if (
    /\b401\b|\b403\b|invalid[_\s-]?api[_\s-]?key|invalid[_\s-]?token|unauthorized|authentication|鉴权/i.test(
      msg
    )
  ) {
    return {
      code: "api.auth",
      category: "auth",
      title: "鉴权失败",
      hint: "检查 CLAUDE_CONFIG_DIR/settings.json 中的 ANTHROPIC_AUTH_TOKEN / BASE_URL。",
      retryable: false,
    };
  }

  if (/产出未过|安全校验|非 JSON|校验失败|structured_output|json_schema/i.test(msg)) {
    return {
      code: "llm.validation",
      category: "validation",
      title: "LLM 产出校验失败",
      hint: "模型未按 schema 输出;本轮结果已丢弃,下轮可重试。",
      retryable: true,
    };
  }

  if (/database connection is not open|SQLITE_|no such table|db is not open/i.test(msg)) {
    return {
      code: "infra.db",
      category: "infra",
      title: "数据库连接异常",
      hint: "检查 DB_PATH 与进程是否热重载导致连接关闭;重启服务通常可恢复。",
      retryable: true,
    };
  }

  if (/blocked intent=/i.test(msg)) {
    return {
      code: "business.intent_block",
      category: "business",
      title: "意图拦截",
      hint: "用户触发滥用意图门,已回模板婉拒(非系统故障)。",
      retryable: false,
    };
  }

  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|WebSocket|socket hang up/i.test(msg)) {
    return {
      code: "infra.network",
      category: "infra",
      title: "网络/连接异常",
      hint: "检查 OneBot WS、模型 API 可达性与网络。",
      retryable: true,
    };
  }

  return {
    code: "unknown",
    category: "unknown",
    title: "未分类错误",
    hint: "查看原始错误;可补充分类规则。",
    retryable: true,
  };
}

/** 从 unknown 抽出错误文案 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 从 sessionKey `groupId:userId` 解析群号 */
export function groupIdFromSession(sessionKey?: string): number | undefined {
  if (!sessionKey) return undefined;
  const n = Number(sessionKey.split(":")[0]);
  return Number.isFinite(n) ? n : undefined;
}
