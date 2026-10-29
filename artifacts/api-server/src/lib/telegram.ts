import {
  claimTelegramNotification,
  setTelegramNotificationStatus,
  type Alert,
} from "./firewatch-store";

export type TelegramConnectionState = "not_configured" | "connected" | "error";

export interface TelegramConnectionStatus {
  status: TelegramConnectionState;
  configured: boolean;
  checkedAt: string;
}

type TelegramCredentials = {
  botToken: string;
  chatId: string;
};

type TelegramSendResult =
  | "sent"
  | "duplicate"
  | "ignored"
  | "not_configured"
  | "failed";

const STATUS_CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 6_000;
let cachedStatus: TelegramConnectionStatus | undefined;
let checkedAtMs = 0;

function credentials(): TelegramCredentials | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return botToken && chatId ? { botToken, chatId } : null;
}

function saveStatus(status: TelegramConnectionState): TelegramConnectionStatus {
  const checkedAt = new Date().toISOString();
  cachedStatus = {
    status,
    configured: Boolean(credentials()),
    checkedAt,
  };
  checkedAtMs = Date.now();
  return cachedStatus;
}

async function telegramRequest(
  method: "getMe" | "sendMessage",
  botToken: string,
  body?: Record<string, string | boolean>,
): Promise<{ ok: boolean; httpStatus: number }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let result: { ok?: unknown } | null = null;
  try {
    result = (await response.json()) as { ok?: unknown };
  } catch {
    // A non-JSON response is treated as a failed Telegram API request.
  }
  return { ok: response.ok && result?.ok === true, httpStatus: response.status };
}

export async function getTelegramConnectionStatus(): Promise<TelegramConnectionStatus> {
  const currentCredentials = credentials();
  if (!currentCredentials) {
    return saveStatus("not_configured");
  }

  if (cachedStatus && Date.now() - checkedAtMs < STATUS_CACHE_MS) {
    return cachedStatus;
  }

  try {
    const result = await telegramRequest("getMe", currentCredentials.botToken);
    return saveStatus(result.ok ? "connected" : "error");
  } catch {
    return saveStatus("error");
  }
}

export async function notifyTelegramOfNewAlert(alert: Alert): Promise<TelegramSendResult> {
  if (alert.level !== "high" && alert.level !== "critical") {
    return "ignored";
  }
  const currentCredentials = credentials();
  if (!currentCredentials) {
    saveStatus("not_configured");
    return "not_configured";
  }

  try {
    if (!claimTelegramNotification(alert.id)) {
      return "duplicate";
    }

    const text = [
      alert.level === "critical" ? "🚨 Критическое предупреждение" : "⚠️ Предупреждение высокого уровня",
      `Станция: ${alert.stationName}`,
      `Риск: ${alert.risk}/100`,
      `Причина: ${alert.reason}`,
      `Время: ${new Date(alert.occurredAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`,
      "",
      "Учебная модель — не подтверждение реального пожара.",
    ].join("\n");

    const result = await telegramRequest("sendMessage", currentCredentials.botToken, {
      chat_id: currentCredentials.chatId,
      text,
      disable_web_page_preview: true,
    });
    if (!result.ok) {
      setTelegramNotificationStatus(alert.id, "failed", `http_${result.httpStatus}`);
      saveStatus("error");
      return "failed";
    }

    setTelegramNotificationStatus(alert.id, "sent");
    saveStatus("connected");
    return "sent";
  } catch {
    try {
      setTelegramNotificationStatus(alert.id, "failed", "request_failed");
    } catch {
      // A persisted "sending" claim still prevents duplicate delivery on retry.
    }
    saveStatus("error");
    return "failed";
  }
}
