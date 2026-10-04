import { randomUUID } from "node:crypto";
import type {
  AuthTokenPurpose,
  Prisma,
  PrismaClient,
  User,
} from "@prisma/client";
import type { RegisterInput, PublicUser } from "@monitorx/contracts";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
} from "@monitorx/security";
import { ACCESS_MS, SESSION_MS } from "./config.js";
import { audit } from "./audit.js";
import { denied, invalidToken } from "./errors.js";
import type { AuthMailer } from "./mail.js";

export const publicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  emailVerified: !!user.emailVerifiedAt,
});
export interface SessionResult {
  access: string;
  refresh: string;
  expiresAt: Date;
  user: PublicUser;
}

export class AuthService {
  constructor(
    readonly db: PrismaClient,
    private readonly mailer: AuthMailer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // Cold connection acquisition on Windows can exceed Prisma's 2s default.
    // Keep bounded waits without silently treating pool pressure as bad credentials.
    return this.db.$transaction(work, { maxWait: 10_000, timeout: 15_000 });
  }

  private async lock(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }

  private async issueSession(
    tx: Prisma.TransactionClient,
    user: User,
    familyId: string = randomUUID(),
    expiresAt = new Date(this.clock().getTime() + SESSION_MS),
  ): Promise<SessionResult> {
    const access = newToken();
    const refresh = newToken();
    await tx.authSession.create({
      data: {
        userId: user.id,
        familyId,
        accessHash: tokenHash(access),
        refreshHash: tokenHash(refresh),
        accessExpiresAt: new Date(
          Math.min(this.clock().getTime() + ACCESS_MS, expiresAt.getTime()),
        ),
        expiresAt,
      },
    });
    return { access, refresh, expiresAt, user: publicUser(user) };
  }

  private async deliver(
    user: User,
    purpose: AuthTokenPurpose,
    token: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.mailer.send(user.email, purpose, token);
    } catch {
      await audit(this.db, "email_delivery_failed", requestId, user.id);
    }
  }

  private async issueEmailToken(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: AuthTokenPurpose,
  ): Promise<string> {
    const now = this.clock();
    const token = newToken();
    await tx.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    await tx.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: tokenHash(token),
        expiresAt: new Date(
          now.getTime() + (purpose === "VERIFY_EMAIL" ? 24 * 60 : 30) * 60_000,
        ),
      },
    });
    return token;
  }

  async register(input: RegisterInput, requestId: string): Promise<void> {
    // Hash even duplicate registrations, avoiding a fast account-existence branch.
    const passwordHash = await hashPassword(input.password);
    const result = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.email}, 0))::text`;
      const existing = await tx.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        await audit(tx, "registration_requested", requestId);
        return null;
      }
      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        },
      });
      const token = await this.issueEmailToken(tx, user.id, "VERIFY_EMAIL");
      await audit(tx, "registered", requestId, user.id);
      return { user, token };
    });
    if (result)
      await this.deliver(result.user, "VERIFY_EMAIL", result.token, requestId);
  }

  async login(
    email: string,
    password: string,
    requestId: string,
  ): Promise<SessionResult> {
    const snapshot = await this.db.user.findUnique({ where: { email } });
    const matches = await verifyPassword(
      password,
      snapshot?.passwordHash ?? null,
    );
    const session = await this.transaction(async (tx) => {
      if (!snapshot) {
        await audit(tx, "login_failed", requestId);
        return null;
      }
      await this.lock(tx, snapshot.id);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: snapshot.id },
      });
      const now = this.clock();
      if (
        user.status !== "ACTIVE" ||
        (user.lockedUntil && user.lockedUntil > now)
      ) {
        await audit(tx, "login_failed", requestId, user.id);
        return null;
      }
      if (!matches || user.passwordHash !== snapshot.passwordHash) {
        const failedLoginCount = Math.min(user.failedLoginCount + 1, 30);
        const seconds =
          failedLoginCount >= 5
            ? Math.min(60 * 2 ** (failedLoginCount - 5), 3600)
            : 0;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount,
            lockedUntil: seconds
              ? new Date(now.getTime() + seconds * 1000)
              : null,
          },
        });
        await audit(
          tx,
          seconds ? "account_backoff" : "login_failed",
          requestId,
          user.id,
        );
        return null;
      }
      if (!user.emailVerifiedAt) {
        await audit(tx, "login_failed", requestId, user.id);
        return null;
      }
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      await audit(tx, "login_succeeded", requestId, user.id);
      return this.issueSession(tx, user);
    });
    if (!session) throw denied();
    return session;
  }

  async requestEmail(
    email: string,
    purpose: AuthTokenPurpose,
    requestId: string,
  ): Promise<void> {
    const result = await this.transaction(async (tx) => {
      const snapshot = await tx.user.findUnique({ where: { email } });
      await audit(
        tx,
        purpose === "VERIFY_EMAIL"
          ? "verification_requested"
          : "reset_requested",
        requestId,
      );
      if (!snapshot) return null;
      await this.lock(tx, snapshot.id);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: snapshot.id },
      });
      if (
        user.status !== "ACTIVE" ||
        (purpose === "VERIFY_EMAIL" && user.emailVerifiedAt)
      )
        return null;
      return { user, token: await this.issueEmailToken(tx, user.id, purpose) };
    });
    if (result)
      await this.deliver(result.user, purpose, result.token, requestId);
  }

  async consumeEmail(
    token: string,
    purpose: AuthTokenPurpose,
    requestId: string,
    password?: string,
  ): Promise<void> {
    const passwordHash = password ? await hashPassword(password) : undefined;
    const result = await this.transaction(async (tx) => {
      const snapshot = await tx.authToken.findUnique({
        where: { tokenHash: tokenHash(token) },
      });
      if (!snapshot) {
        await audit(tx, "email_token_rejected", requestId);
        return false;
      }
      await this.lock(tx, snapshot.userId);
      const record = await tx.authToken.findUniqueOrThrow({
        where: { id: snapshot.id },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: record.userId },
      });
      const now = this.clock();
      if (
        record.purpose !== purpose ||
        record.usedAt ||
        record.expiresAt <= now ||
        user.status !== "ACTIVE" ||
        (purpose === "RESET_PASSWORD" && !passwordHash)
      ) {
        await audit(tx, "email_token_rejected", requestId, user.id);
        return false;
      }
      await tx.authToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      });
      if (purpose === "VERIFY_EMAIL") {
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: now },
        });
        await audit(tx, "email_verified", requestId, user.id);
      } else {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        });
        await tx.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authToken.updateMany({
          where: { userId: user.id, purpose: "RESET_PASSWORD", usedAt: null },
          data: { usedAt: now },
        });
        await audit(tx, "password_reset", requestId, user.id);
      }
      return true;
    });
    if (!result) throw invalidToken();
  }

  async authenticate(access: string): Promise<PublicUser> {
    const now = this.clock();
    const record = await this.db.authSession.findUnique({
      where: { accessHash: tokenHash(access) },
      include: { user: true },
    });
    if (
      !record ||
      record.usedAt ||
      record.revokedAt ||
      record.accessExpiresAt <= now ||
      record.expiresAt <= now ||
      record.user.status !== "ACTIVE" ||
      !record.user.emailVerifiedAt
    )
      throw denied();
    return publicUser(record.user);
  }

  async refresh(refresh: string, requestId: string): Promise<SessionResult> {
    const result = await this.transaction(async (tx) => {
      const snapshot = await tx.authSession.findUnique({
        where: { refreshHash: tokenHash(refresh) },
      });
      if (!snapshot) {
        await audit(tx, "refresh_rejected", requestId);
        return null;
      }
      await this.lock(tx, snapshot.userId);
      const record = await tx.authSession.findUniqueOrThrow({
        where: { id: snapshot.id },
        include: { user: true },
      });
      const now = this.clock();
      if (record.usedAt || record.revokedAt) {
        await tx.authSession.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await audit(tx, "refresh_reuse_detected", requestId, record.userId);
        return null; // Return, don't throw: commit family revocation before the 401.
      }
      if (
        record.expiresAt <= now ||
        record.user.status !== "ACTIVE" ||
        !record.user.emailVerifiedAt
      ) {
        await audit(tx, "refresh_rejected", requestId, record.userId);
        return null;
      }
      await tx.authSession.update({
        where: { id: record.id },
        data: { usedAt: now },
      });
      await audit(tx, "session_refreshed", requestId, record.userId);
      return this.issueSession(
        tx,
        record.user,
        record.familyId,
        record.expiresAt,
      );
    });
    if (!result) throw denied();
    return result;
  }

  async logout(
    access: string,
    refresh: string,
    requestId: string,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      const records = await tx.authSession.findMany({
        where: {
          OR: [
            { accessHash: tokenHash(access) },
            { refreshHash: tokenHash(refresh) },
          ],
        },
        orderBy: { userId: "asc" },
      });
      for (const record of records) {
        await this.lock(tx, record.userId);
        await tx.authSession.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: this.clock() },
        });
      }
      await audit(tx, "logged_out", requestId, records[0]?.userId);
    });
  }

  async githubLogin(
    profile: { id: string; email: string; name: string },
    requestId: string,
  ): Promise<SessionResult> {
    const result = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${profile.email}, 0))::text`;
      let user = await tx.user.findUnique({ where: { githubId: profile.id } });
      if (!user) {
        // Never automatically link an existing password account by email.
        if (await tx.user.findUnique({ where: { email: profile.email } })) {
          await audit(tx, "oauth_rejected", requestId);
          return null;
        }
        user = await tx.user.create({
          data: {
            githubId: profile.id,
            email: profile.email,
            displayName: profile.name,
            emailVerifiedAt: this.clock(),
          },
        });
      }
      await this.lock(tx, user.id);
      user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (
        user.status !== "ACTIVE" ||
        !user.emailVerifiedAt ||
        (user.lockedUntil && user.lockedUntil > this.clock())
      ) {
        await audit(tx, "oauth_rejected", requestId, user.id);
        return null;
      }
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: this.clock() },
      });
      await audit(tx, "oauth_succeeded", requestId, user.id);
      return this.issueSession(tx, user);
    });
    if (!result) throw denied();
    return result;
  }
}
