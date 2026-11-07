// A small HTTP client shared by the dev seed script and the end-to-end tests.
// It signs in through the real auth flow using the code that DEV_MODE returns.

import { randomBytes } from "node:crypto";
// A direct path, because Node runs this script without a bundler and can't resolve the shared package's other files.
import { generateDeviceKey, openMessage, sealMessage, type DeviceKey, type Envelope } from "../../../packages/shared/src/e2ee.ts";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, path: string) {
    super(`${path} returned ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class Client {
  baseUrl: string;
  token: string | null = null;
  id = "";
  /** This client's device key, registered at sign-in as the app does. */
  device: DeviceKey = generateDeviceKey(randomBytes);

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON. Keep the text.
    }
    if (!response.ok) throw new ApiError(response.status, parsed, path);
    return parsed as T;
  }

  get<T = any>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.request<T>("POST", path, body);
  }
  put<T = any>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body);
  }
  delete<T = any>(path: string) {
    return this.request<T>("DELETE", path);
  }

  async signIn(email: string): Promise<this> {
    const { devCode } = await this.post<{ devCode: string }>("/auth/start", { email });
    const { token, me } = await this.post<{ token: string; me: { id: string } }>("/auth/verify", { email, code: devCode });
    this.token = token;
    this.id = me.id;
    await this.post("/me/device-key", { publicKey: this.device.publicKey });
    return this;
  }

  /** Encrypts for everyone currently in the chat, as a phone does. */
  async seal(conversationId: string, text: string): Promise<Envelope> {
    const detail = await this.get(`/conversations/${conversationId}`);
    const readers = detail.members.flatMap((member: { deviceKeys: string[] }) => member.deviceKeys);
    return sealMessage({ text, conversationId, senderId: this.id, sender: this.device, readers, random: randomBytes });
  }

  async say(conversationId: string, text: string, clientId?: string): Promise<any> {
    return this.post(`/conversations/${conversationId}/messages`, { envelope: await this.seal(conversationId, text), ...(clientId ? { clientId } : {}) });
  }

  /** The chat as this device reads it. Text this device can't open comes back with `unreadable` set. */
  async read(conversationId: string, query = ""): Promise<any[]> {
    const messages = await this.get<any[]>(`/conversations/${conversationId}/messages${query}`);
    return messages.map((message) => {
      if (!message.envelope) return message;
      const opened = openMessage({ envelope: message.envelope, conversationId, senderId: message.senderId, me: this.device });
      return opened ? { ...message, body: opened.text, contentKey: opened.contentKey } : { ...message, unreadable: true };
    });
  }
}

export interface PersonSeed {
  displayName: string;
  cityId: string;
  campusId?: string | null;
  fields?: string[];
  lookingFor?: string[];
  role?: string;
  bio?: string;
  dob?: string;
}

export async function createPerson(baseUrl: string, email: string, seed: PersonSeed): Promise<Client> {
  const client = new Client(baseUrl);
  await client.signIn(email);
  await client.put("/me/onboarding", {
    displayName: seed.displayName,
    bio: seed.bio ?? "",
    role: seed.role ?? "grad",
    fields: seed.fields ?? ["economics"],
    lookingFor: seed.lookingFor ?? ["learning"],
    dob: seed.dob ?? "1999-05-01",
    cityId: seed.cityId,
    campusId: seed.campusId ?? null,
  });
  return client;
}
