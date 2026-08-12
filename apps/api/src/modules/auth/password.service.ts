import { Inject, Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';

/**
 * Password hashing.
 *
 * Argon2id, not bcrypt: bcrypt silently truncates at 72 bytes and has no memory
 * cost, so it is cheap to attack with commodity GPUs. Argon2id is the current
 * OWASP recommendation and `@node-rs/argon2` ships prebuilt binaries, so no
 * node-gyp toolchain is needed on a build agent.
 *
 * The pepper is a server-side secret concatenated before hashing. It lives in
 * the secrets manager, never in the database, so a stolen database dump alone
 * cannot be cracked offline — the attacker needs the application secret too.
 */
@Injectable()
export class PasswordService {
  private readonly pepper: string;

  // OWASP Password Storage Cheat Sheet baseline: 19 MiB, t=2, p=1.
  private readonly options = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pepper = config.auth.pepper;
  }

  async hash(plain: string): Promise<string> {
    return hash(this.season(plain), this.options);
  }

  async verify(plain: string, digest: string): Promise<boolean> {
    try {
      return await verify(digest, this.season(plain), this.options);
    } catch {
      // A malformed or legacy digest must read as "wrong password", never as a
      // 500 — otherwise the error itself tells an attacker the account exists
      // and has an unusual hash.
      return false;
    }
  }

  private season(plain: string): string {
    return `${plain}${this.pepper}`;
  }
}
