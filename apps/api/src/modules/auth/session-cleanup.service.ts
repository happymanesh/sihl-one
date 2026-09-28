import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Deletes sessions nobody can use and nobody is going to ask about.
 *
 * Nothing removed them before, so rows accumulated from the day the product
 * shipped: a refresh mints a new session and revokes the old one, so an active
 * user leaves a row behind every fifteen minutes of use. It was harmless at the
 * size it had reached and would not have stayed that way, and the longer idle
 * timeout for remembered sessions means rows turn over more slowly.
 *
 * Only rows that are already dead — revoked, or past their expiry — and only
 * once they are older than the retention window. A revoked session is evidence
 * for as long as someone might ask who signed in from where, and the window
 * covers a normal incident review. After that the audit log is the record; this
 * table is not, and keeping it forever buys nothing.
 *
 * `setInterval` rather than a scheduler dependency, matching the outbox relay:
 * one timer, its own re-entrancy guard, and `unref` so it never holds the
 * process open on its own.
 */
@Injectable()
export class SessionCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const { sessionCleanupIntervalMs, sessionRetentionDays } = this.config.auth;

    this.logger.log(
      `Session cleanup started — every ${Math.round(sessionCleanupIntervalMs / 60_000)} min, ` +
        `keeping dead sessions for ${sessionRetentionDays} days`,
    );

    // Not on boot. A deploy restarts every pod at once and a sweep from each of
    // them at the same moment is a thundering herd against one table, for work
    // that is in no hurry.
    this.timer = setInterval(() => void this.sweep(), sessionCleanupIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass. Public so it can be driven from a test or a console without
   * waiting for the timer.
   */
  async sweep(): Promise<number> {
    // A slow delete on a large table must not overlap itself.
    if (this.running) return 0;
    this.running = true;

    try {
      const cutoff = new Date(
        Date.now() - this.config.auth.sessionRetentionDays * 24 * 60 * 60 * 1000,
      );

      const { count } = await this.prisma.session.deleteMany({
        where: {
          OR: [
            { revokedAt: { lt: cutoff } },
            // Expiry alone is enough: a session past `expiresAt` is refused by
            // the refresh path whether or not anyone got round to revoking it.
            { expiresAt: { lt: cutoff } },
          ],
        },
      });

      if (count > 0) this.logger.log(`Session cleanup removed ${count} dead sessions`);
      return count;
    } catch (error) {
      // Never fatal. A failed sweep means some rows live another hour, which is
      // not worth taking the API down for.
      this.logger.warn(`Session cleanup failed: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
