import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  SERVICE_KEY_PREFIX,
  isPermissionAllowedForService,
  serviceAccountUsable,
  type CreateServiceAccountInput,
  type DataScope,
  type Permission,
} from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from './password.service';
import type { AuthenticatedPrincipal } from '../../common/types';

/**
 * Machine identities.
 *
 * A key looks like `sihl_svc_<prefix>_<secret>`. The prefix is stored in clear
 * and is how a presented key is found; the secret is stored only as an Argon2id
 * hash. Splitting them is what makes the lookup cheap: without a prefix, every
 * request would have to run the (deliberately expensive) hash against every
 * key in the table until one matched.
 */
@Injectable()
export class ServiceAccountService {
  private readonly logger = new Logger(ServiceAccountService.name);

  /**
   * `lastUsedAt` is a liveness signal, not an access log — the audit trail is
   * the access log. Writing it on every call would turn a read-only integration
   * polling every thirty seconds into a continuous stream of writes to a row
   * every one of its requests already reads.
   */
  private static readonly TOUCH_INTERVAL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Mints a key and returns it once. The plaintext is never stored and cannot
   * be recovered; a lost key is re-minted, not looked up.
   */
  async mint(
    input: CreateServiceAccountInput,
    createdByLabel: string,
  ): Promise<{ id: string; key: string }> {
    const offenders = input.permissions.filter((p) => !isPermissionAllowedForService(p));
    if (offenders.length > 0) {
      // Belt and braces: the schema refuses these too. This is the check that
      // holds if a future caller reaches the service without going through it.
      throw new Error(`Not permitted for a service account: ${offenders.join(', ')}`);
    }

    // The prefix is hex, not base64url, and that is load-bearing: base64url's
    // alphabet contains `_`, which is also the separator. A base64url prefix
    // makes the split point ambiguous and the key unparseable. Hex cannot
    // contain a separator, so everything after the third `_` is the secret —
    // which may then safely contain underscores of its own.
    const prefix = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');

    const account = await this.prisma.serviceAccount.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        keyPrefix: prefix,
        keyHash: await this.passwords.hash(secret),
        permissions: input.permissions,
        dataScope: input.dataScope,
        expiresAt: input.expiresAt,
        createdByLabel,
      },
      select: { id: true },
    });

    return { id: account.id, key: `${SERVICE_KEY_PREFIX}_${prefix}_${secret}` };
  }

  /**
   * Turns a presented key into a principal, or null.
   *
   * Null for every failure — unknown, revoked, expired, wrong secret. The
   * caller is told only that the key did not work, because distinguishing
   * "no such key" from "wrong secret" tells an attacker which half of a guess
   * was right.
   */
  async verify(presented: string): Promise<AuthenticatedPrincipal | null> {
    // Split at the first `_` after the fixed banner and take the rest verbatim.
    // Not `split('_')`: the secret is base64url and may contain underscores, so
    // splitting on every separator would truncate it — and the resulting
    // rejection would look exactly like a wrong key.
    const banner = `${SERVICE_KEY_PREFIX}_`;
    if (!presented.startsWith(banner)) return null;
    const rest = presented.slice(banner.length);
    const cut = rest.indexOf('_');
    if (cut <= 0) return null;
    const prefix = rest.slice(0, cut);
    const secret = rest.slice(cut + 1);
    if (!secret || !/^[0-9a-f]+$/.test(prefix)) return null;

    const account = await this.prisma.serviceAccount.findUnique({
      where: { keyPrefix: prefix },
    });
    if (!account) return null;

    const usable = serviceAccountUsable(account);
    if (!usable.usable) {
      this.logger.warn(`Service key refused for ${account.name}: ${usable.reason ?? 'unusable'}`);
      return null;
    }

    if (!(await this.passwords.verify(secret, account.keyHash))) {
      this.logger.warn(`Service key refused for ${account.name}: secret did not match`);
      return null;
    }

    void this.touch(account.id, account.lastUsedAt);

    return {
      id: account.id,
      // Not a routable address. It is what the audit label is built from, and
      // it has to read unmistakably as a machine to anyone scanning the trail.
      email: `${account.name}@service.sihl.internal`,
      fullName: `Service: ${account.name}`,
      userType: 'INTERNAL',
      roles: [],
      permissions: account.permissions as Permission[],
      dataScope: account.dataScope as DataScope,
      // No place in the hierarchy, and no team. A service is not anybody's
      // report, so a SELF or TEAM scope on one would resolve to nothing — which
      // is the correct, safe outcome if somebody ever mints one that way.
      orgUnitId: null,
      orgUnitPath: null,
      teamUserIds: [],
      partnerId: null,
      sessionId: account.id,
      mustChangePassword: false,
      isService: true,
    };
  }

  /** Never allowed to fail a request; the key still worked. */
  private async touch(id: string, lastUsedAt: Date | null): Promise<void> {
    const now = Date.now();
    if (lastUsedAt && now - lastUsedAt.getTime() < ServiceAccountService.TOUCH_INTERVAL_MS) return;
    try {
      await this.prisma.serviceAccount.update({
        where: { id },
        data: { lastUsedAt: new Date(now) },
      });
    } catch (error) {
      this.logger.warn(
        `Could not update lastUsedAt for service account ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
