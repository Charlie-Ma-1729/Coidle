// OpenRouter（OpenAI 相容）呼叫：用原生 fetch，不需額外 SDK。
// 金鑰只從呼叫端傳入（來自伺服器的環境變數），這裡不記錄、不輸出金鑰。

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** 要求模型輸出 JSON 物件 */
  json?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** OpenRouter 回報的實際花費（美元）；沒回報就是 null */
  costUsd: number | null;
  ms: number;
  finishReason: string | null;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const f = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.9,
    usage: { include: true },
    // 內容生成不需要長篇推理；能關的模型就關，省錢也省時間
    reasoning: { enabled: false },
  };
  if (opts.json) body.response_format = { type: "json_object" };

  let res: Response;
  try {
    res = await f(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", "x-title": "Coidle" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
  } catch (e) {
    throw new LlmError(`連不到 OpenRouter：${e instanceof Error ? e.name : "error"}`);
  }
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new LlmError(`OpenRouter 回應不是 JSON（HTTP ${res.status}）`, res.status);
  }
  if (!res.ok || data?.error) {
    // 只回報錯誤訊息本身，不帶任何請求內容
    throw new LlmError(`OpenRouter 錯誤（HTTP ${res.status}）：${String(data?.error?.message ?? "unknown").slice(0, 200)}`, res.status);
  }
  const choice = data.choices?.[0];
  const usage = data.usage ?? {};
  return {
    text: String(choice?.message?.content ?? ""),
    model: String(data.model ?? opts.model),
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0),
    costUsd: typeof usage.cost === "number" ? usage.cost : null,
    ms: Date.now() - started,
    finishReason: choice?.finish_reason ?? null,
  };
}

/** 從模型輸出裡取出 JSON（容忍外面包了 ```json 圍欄或前後多餘文字） */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = Math.min(...["{", "["].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))));
  if (!Number.isFinite(start)) throw new LlmError("輸出裡找不到 JSON");
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new LlmError("輸出的 JSON 格式不正確");
  }
}
