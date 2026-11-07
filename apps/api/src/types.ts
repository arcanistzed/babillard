import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "./db";

export type UserRow = InferSelectModel<typeof schema.users>;

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: UserRow;
    sessionId: string;
    adminEmail: string;
  };
}
