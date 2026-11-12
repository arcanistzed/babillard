import { languageTag, t } from "./i18n";

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        "accept-language": languageTag,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    // A rejected code or link says nothing about the session this device already has.
    if (response.status === 401 && sessionToken && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(response.status, payload.error ?? "request_failed");
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export async function uploadAvatar(uri: string): Promise<void> {
  const file = await (await fetch(uri)).blob();
  const response = await fetch(`${BASE_URL}/me/avatar`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}) },
    body: file,
  });
  if (!response.ok) throw new ApiError(response.status, "upload_failed");
}

/** React Native's WebSocket accepts headers as a third argument, which keeps the token out of URLs and logs. */
export function openConversationSocket(conversationId: string): WebSocket {
  const url = `${BASE_URL.replace(/^http/, "ws")}/conversations/${conversationId}/ws`;
  const Socket = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;
  return new Socket(url, undefined, { headers: { authorization: `Bearer ${sessionToken ?? ""}` } });
}

export function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError)) return t("Something went wrong. Try again.", "Un problème est survenu. Réessayez.");
  const messages: Record<string, string> = {
    network: t("Can't reach Babillard. Check your connection.", "Impossible de joindre Babillard. Vérifiez votre connexion."),
    did_not_meet: t("Only people who met can answer these questions.", "Seules les personnes qui se sont rencontrées peuvent répondre à ces questions."),
    invalid_or_expired: t("That code didn't work. Check it, or ask for a new one.", "Ce code n'a pas fonctionné. Vérifiez-le ou demandez-en un nouveau."),
    account_unavailable: t("This account has been closed.", "Ce compte a été fermé."),
    under_age: t("Babillard is for people 18 and over.", "Babillard est réservé aux personnes de 18 ans et plus."),
    email_unavailable: t("Couldn't send the email. Try again in a minute.", "Impossible d'envoyer le courriel. Réessayez dans une minute."),
    too_many_attempts: t("Too many tries. Wait a minute and try again.", "Trop d'essais. Attendez une minute et réessayez."),
    wording_unavailable: t("Wording help isn't available right now.", "L'aide à la formulation n'est pas disponible pour l'instant."),
    too_many_submissions: t("That's the limit for today. Suggest more tomorrow.", "C'est la limite pour aujourd'hui. Suggérez-en d'autres demain."),
    too_many_reports: t("That's the limit for today. If you're in danger, call 911.", "C'est la limite pour aujourd'hui. Si vous êtes en danger, composez le 911."),
    invalid_request: t("Some of that isn't quite right. Check it and try again.", "Quelque chose ne va pas. Vérifiez et réessayez."),
    conversation_closed: t("This conversation has ended.", "Cette conversation est terminée."),
    starts_in_the_past: t("That time has already passed. Pick another.", "Cette heure est déjà passée. Choisissez-en une autre."),
    upload_failed: t("That photo didn't upload. Try a different one.", "Cette photo n'a pas pu être envoyée. Essayez-en une autre."),
  };
  return messages[error.code] ?? t("Something went wrong. Try again.", "Un problème est survenu. Réessayez.");
}
