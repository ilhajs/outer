import type { Session, User } from "better-auth";

export type AuthSession = {
  user: User;
  session: Session;
} | null;
