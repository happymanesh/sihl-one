import { randomInt } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canGrantRoles,
  canManageUserAt,
  formatStaffCode,
  ROLE_PERMISSIONS,
  scopeForDesignation,
  suggestWorkEmail,
  validateReportingLine,
  WORK_EMAIL_DOMAIN,
  type ActorContext,
  type CreateDesignationInput,
  type CreateUserInput,
  type DataScope,
  type DesignationSummary,
  type UpdateDesignationInput,
  type UpdateUserInput,
  type UserSummary,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { ReferenceService } from '../../common/reference.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';

/**
 * User and designation administration.
 *
 * The three escalation guards from `hierarchy.ts` are applied here, on every
 * write. They are not optional refinements: without them a Sales Manager can
 * create a National Head account and grant themselves company-wide access
 * through a second login, and nothing in an audit of their own account shows it.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  // --- Designations --------------------------------------------------------

  async listDesignations(includeInactive = false): Promise<DesignationSummary[]> {
    const designations = await this.prisma.designation.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { level: 'desc' },
      include: { _count: { select: { users: true } } },
    });

    return designations.map((designation) => ({
      id: designation.id,
      code: designation.code,
      name: designation.name,
      level: designation.level,
      defaultScope: designation.defaultScope,
      isActive: designation.isActive,
      userCount: designation._count.users,
    }));
  }

  async createDesignation(actor: AuthenticatedPrincipal, input: CreateDesignationInput) {
    const clash = await this.prisma.designation.findFirst({ where: { level: input.level } });
    if (clash) {
      throw new BadRequestException({
        title: 'That level is taken',
        detail: `"${clash.name}" already sits at level ${input.level}. Levels are seeded with gaps so a new one can slot between two existing levels — pick a number in a gap.`,
      });
    }

    const designation = await this.prisma.designation.create({ data: { ...input, isSystem: false } });
    await this.audit.record({
      action: 'CREATE',
      resource: 'designation',
      resourceId: designation.id,
      changes: { code: input.code, level: input.level, defaultScope: input.defaultScope },
    });
    return designation;
  }

  async updateDesignation(
    actor: AuthenticatedPrincipal,
    id: string,
    input: UpdateDesignationInput,
  ) {
    const existing = await this.prisma.designation.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) throw new NotFoundException({ title: 'Designation not found' });

    // Deactivating a level people still hold would silently strip their place
    // in the hierarchy and, with it, their derived scope.
    if (input.isActive === false && existing._count.users > 0) {
      throw new BadRequestException({
        title: 'Designation is in use',
        detail: `${existing._count.users} user(s) hold "${existing.name}". Move them to another level first.`,
      });
    }

    const designation = await this.prisma.designation.update({ where: { id }, data: input });
    await this.audit.record({
      action: 'UPDATE',
      resource: 'designation',
      resourceId: id,
      changes: { name: designation.name, level: designation.level, isActive: designation.isActive },
    });
    return designation;
  }

  // --- Users ---------------------------------------------------------------

  async listUsers(actor: AuthenticatedPrincipal): Promise<UserSummary[]> {
    const context = await this.actorContext(actor);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        userType: 'INTERNAL',
        // A manager sees their own subtree; an admin sees everyone.
        ...(context.isUnrestricted || !context.orgUnitPath
          ? {}
          : { orgUnit: { path: { startsWith: context.orgUnitPath } } }),
      },
      orderBy: [{ designation: { level: 'desc' } }, { firstName: 'asc' }],
      include: {
        designation: { select: { id: true, name: true, level: true } },
        orgUnit: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        roles: { select: { roleCode: true } },
        _count: { select: { reports: true } },
      },
    });

    return users.map((user) => ({
      id: user.id,
      reference: user.reference,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      employeeCode: user.employeeCode,
      status: user.status,
      designation: user.designation,
      orgUnit: user.orgUnit,
      manager: user.manager
        ? { id: user.manager.id, fullName: `${user.manager.firstName} ${user.manager.lastName}`.trim() }
        : null,
      roles: user.roles.map((assignment) => assignment.roleCode),
      dataScope: user.dataScope ?? 'SELF',
      isHrManaged: user.isHrManaged,
      directReports: user._count.reports,
    }));
  }

  async createUser(actor: AuthenticatedPrincipal, input: CreateUserInput) {
    const context = await this.actorContext(actor);
    const designation = await this.mustFindDesignation(input.designationId);
    const orgUnit = await this.mustFindOrgUnit(input.orgUnitId);

    this.assertCanManage(context, {
      designationLevel: designation.level,
      orgUnitPath: orgUnit.path,
      roleCodes: input.roleCodes,
    });
    this.assertCanGrant(context, input.roleCodes);

    if (input.managerId) {
      await this.assertReportingLine(input.managerId, designation.level);
    }

    if (input.employeeCode) await this.assertEmployeeCodeFree(input.employeeCode);

    // Staff get a generated code; partners bring the one the back office
    // already issued, which the schema makes mandatory for them.
    const employeeCode =
      input.employeeCode ??
      (input.userType === 'INTERNAL'
        ? await this.generateStaffCode()
        : null);

    const email = input.email ?? (await this.generateWorkEmail(input.firstName, input.lastName));

    const reference = await this.references.next('US');

    // No password is set. The account is INVITED until an administrator issues
    // credentials — creating a user must never mint a usable login as a side
    // effect, and there is no email delivery yet to send an invitation through.
    const user = await this.prisma.user.create({
      data: {
        reference,
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        mobile: input.mobile ?? null,
        employeeCode,
        designationId: designation.id,
        orgUnitId: orgUnit.id,
        managerId: input.managerId ?? null,
        userType: input.userType,
        status: 'INVITED',
        dataScope: scopeForDesignation(
          designation.defaultScope as DataScope,
          input.dataScope as DataScope | undefined,
        ),
        mustChangePassword: true,
        roles: { create: input.roleCodes.map((roleCode) => ({ roleCode, assignedBy: actor.id })) },
      },
      include: { designation: true },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'user',
      resourceId: user.id,
      changes: {
        email: input.email,
        designation: designation.code,
        roles: input.roleCodes,
        orgUnit: orgUnit.code,
        dataScope: user.dataScope,
      },
    });

    return {
      id: user.id,
      reference: user.reference,
      status: user.status,
      dataScope: user.dataScope,
      note: 'Created as INVITED. An administrator must issue credentials before they can sign in.',
    };
  }

  async updateUser(actor: AuthenticatedPrincipal, userId: string, input: UpdateUserInput) {
    const context = await this.actorContext(actor);

    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { designation: true, orgUnit: true, roles: { select: { roleCode: true } } },
    });
    if (!target) throw new NotFoundException({ title: 'User not found' });

    // Checked against the target's *current* position first: you must be
    // entitled to touch them at all before you can change anything about them.
    this.assertCanManage(context, {
      designationLevel: target.designation?.level ?? 0,
      orgUnitPath: target.orgUnit?.path ?? null,
      roleCodes: target.roles.map((role) => role.roleCode),
    });

    const designation = input.designationId
      ? await this.mustFindDesignation(input.designationId)
      : target.designation;
    const orgUnit = input.orgUnitId ? await this.mustFindOrgUnit(input.orgUnitId) : target.orgUnit;

    // …and again against where they would end up, so an edit cannot be used to
    // promote someone past the actor.
    if (designation && orgUnit) {
      this.assertCanManage(context, {
        designationLevel: designation.level,
        orgUnitPath: orgUnit.path,
        roleCodes: input.roleCodes ?? target.roles.map((role) => role.roleCode),
      });
    }

    if (input.roleCodes) this.assertCanGrant(context, input.roleCodes);
    if (input.managerId && designation) {
      await this.assertReportingLine(input.managerId, designation.level);
    }
    if (input.employeeCode) await this.assertEmployeeCodeFree(input.employeeCode, userId);

    const { roleCodes, ...scalar } = input;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (roleCodes) {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: roleCodes.map((roleCode) => ({ userId, roleCode, assignedBy: actor.id })),
        });
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          ...scalar,
          dataScope:
            designation && (input.dataScope !== undefined || input.designationId)
              ? scopeForDesignation(
                  designation.defaultScope as DataScope,
                  (input.dataScope ?? undefined) as DataScope | undefined,
                )
              : undefined,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'user',
      resourceId: userId,
      changes: {
        designation: designation?.code,
        roles: roleCodes,
        dataScope: updated.dataScope,
        status: updated.status,
      },
    });

    return { id: updated.id, dataScope: updated.dataScope, status: updated.status };
  }

  /**
   * Issues a one-time password so a newly created user can actually sign in.
   *
   * The password is returned in the response and shown once. That is a
   * deliberate trade, not an oversight: there is no email delivery yet, so the
   * alternative is an account nobody can ever use. It is mitigated by
   * `mustChangePassword`, by never writing the value to a log, and by revoking
   * every existing session so an issued credential cannot be used to ride an
   * old one.
   *
   * When email delivery exists this becomes a signed single-use link and the
   * password stops crossing the wire at all.
   */
  async issueCredentials(actor: AuthenticatedPrincipal, userId: string) {
    const context = await this.actorContext(actor);

    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { designation: true, orgUnit: true, roles: { select: { roleCode: true } } },
    });
    if (!target) throw new NotFoundException({ title: 'User not found' });

    // The same escalation guard as editing: you cannot mint a login for
    // somebody you are not entitled to manage.
    this.assertCanManage(context, {
      designationLevel: target.designation?.level ?? 0,
      orgUnitPath: target.orgUnit?.path ?? null,
      roleCodes: target.roles.map((role) => role.roleCode),
    });

    if (target.userType !== 'INTERNAL') {
      throw new BadRequestException({
        title: 'Not an internal user',
        detail: 'Credentials can only be issued to SIHL staff accounts.',
      });
    }

    const temporary = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporary);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          status: 'ACTIVE',
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      // Any session opened before the reset is no longer trustworthy.
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'CREDENTIALS_REISSUED' },
      }),
    ]);

    // Deliberately records that credentials were issued, never what they were.
    await this.audit.record({
      action: 'UPDATE',
      resource: 'user.credentials',
      resourceId: userId,
      changes: { issuedTo: target.email, mustChangePassword: true },
      reason: 'Temporary credentials issued',
    });

    return {
      email: target.email,
      temporaryPassword: temporary,
      note: 'Shown once. They must change it at first sign-in.',
    };
  }

  /** Candidate managers: anyone more senior than the given level, in scope. */
  async managerOptions(actor: AuthenticatedPrincipal, designationId: string) {
    const designation = await this.mustFindDesignation(designationId);
    const context = await this.actorContext(actor);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        userType: 'INTERNAL',
        // Strictly more senior — not "one level up", which is what allows a
        // Sales Manager to report straight to a Zonal Head.
        designation: { level: { gt: designation.level } },
        ...(context.isUnrestricted || !context.orgUnitPath
          ? {}
          : { orgUnit: { path: { startsWith: context.orgUnitPath } } }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: { select: { name: true, level: true } },
      },
      orderBy: { designation: { level: 'asc' } },
      take: 100,
    });

    return users.map((user) => ({
      id: user.id,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      designation: user.designation?.name ?? null,
    }));
  }

  // -------------------------------------------------------------------------

  private async actorContext(actor: AuthenticatedPrincipal): Promise<ActorContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      include: { designation: { select: { level: true } }, orgUnit: { select: { path: true } } },
    });

    return {
      designationLevel: user?.designation?.level ?? null,
      orgUnitPath: user?.orgUnit?.path ?? null,
      permissions: actor.permissions,
      // `system:configure` is the admin marker: someone who can reconfigure the
      // platform is already above the hierarchy.
      isUnrestricted: actor.permissions.includes('system:configure'),
    };
  }

  private assertCanManage(
    context: ActorContext,
    target: { designationLevel: number; orgUnitPath: string | null; roleCodes: readonly string[] },
  ): void {
    const result = canManageUserAt(context, target);
    if (!result.allowed) {
      throw new ForbiddenException({ title: 'Not permitted', detail: result.reason });
    }
  }

  private assertCanGrant(context: ActorContext, roleCodes: readonly string[]): void {
    const result = canGrantRoles(
      context.permissions,
      ROLE_PERMISSIONS as unknown as Record<string, readonly string[]>,
      roleCodes,
      context.isUnrestricted,
    );
    if (!result.allowed) {
      throw new ForbiddenException({ title: 'Cannot grant that role', detail: result.reason });
    }
  }

  private async assertReportingLine(managerId: string, reportLevel: number): Promise<void> {
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, deletedAt: null },
      include: { designation: { select: { level: true } } },
    });
    if (!manager) throw new BadRequestException({ title: 'Manager not found' });

    const result = validateReportingLine(reportLevel, manager.designation?.level ?? null);
    if (!result.allowed) {
      throw new BadRequestException({ title: 'Invalid reporting line', detail: result.reason });
    }
  }

  /**
   * The next free staff code.
   *
   * The counter is atomic, but a code can still be taken — an administrator may
   * have typed SIHL-0007 by hand for somebody. So the counter is advanced until
   * a free code appears rather than trusting it blindly; skipping a number
   * costs nothing, and a duplicate employee code costs an afternoon.
   */
  private async generateStaffCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = formatStaffCode(await this.references.nextStaffCode());
      const taken = await this.prisma.user.findFirst({
        where: { employeeCode: code, deletedAt: null },
        select: { id: true },
      });
      if (!taken) return code;
    }

    throw new BadRequestException({
      title: 'Could not allocate an employee code',
      detail: 'Enter one manually. The generated sequence is colliding with codes already in use.',
    });
  }

  /**
   * firstname.lastname@sihl.in, avoiding addresses already issued.
   *
   * Soft-deleted users are included in the check on purpose: their address is
   * still theirs in every system that ever received mail from it, and handing
   * it to a new joiner would deliver a departed colleague's replies to them.
   */
  private async generateWorkEmail(firstName: string, lastName: string): Promise<string> {
    const suggested = suggestWorkEmail(firstName, lastName, []);
    if (!suggested) {
      throw new BadRequestException({
        title: 'Could not build an email address',
        detail: 'That name has no letters to build an address from. Enter the address directly.',
      });
    }

    const local = suggested.slice(0, suggested.indexOf('@'));
    const existing = await this.prisma.user.findMany({
      where: { email: { startsWith: local, endsWith: `@${WORK_EMAIL_DOMAIN}` } },
      select: { email: true },
    });

    const email = suggestWorkEmail(
      firstName,
      lastName,
      existing.map((row) => row.email),
    );

    if (!email) {
      throw new BadRequestException({
        title: 'Could not build an email address',
        detail: 'Too many people share this name. Enter the address directly.',
      });
    }

    return email;
  }

  private async assertEmployeeCodeFree(code: string, exceptUserId?: string): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: {
        employeeCode: code,
        deletedAt: null,
        ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      },
      select: { firstName: true, lastName: true },
    });
    if (clash) {
      throw new BadRequestException({
        title: 'Employee code already in use',
        detail: `${clash.firstName} ${clash.lastName} already has employee code ${code}.`,
      });
    }
  }

  private async mustFindDesignation(id: string) {
    const designation = await this.prisma.designation.findFirst({ where: { id, isActive: true } });
    if (!designation) {
      throw new BadRequestException({
        title: 'Unknown designation',
        detail: 'Choose an active designation.',
      });
    }
    return designation;
  }

  private async mustFindOrgUnit(id: string) {
    const orgUnit = await this.prisma.orgUnit.findFirst({ where: { id, isActive: true } });
    if (!orgUnit) throw new BadRequestException({ title: 'Unknown branch' });
    return orgUnit;
  }
}

/**
 * A temporary password that satisfies the policy in `auth.ts` — 12+ chars with
 * upper, lower, digit and symbol.
 *
 * Built from `randomInt` rather than `Math.random`, which is not
 * cryptographically secure and would make issued passwords predictable from
 * one another.
 */
function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const pick = (pool: string): string => pool[randomInt(pool.length)]!;

  // One of each class first, so the policy is satisfied by construction rather
  // than by retrying until a random string happens to qualify.
  const characters = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (characters.length < 14) characters.push(pick(all));

  // Fisher-Yates, so the guaranteed characters are not always in positions 0-3.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }

  return characters.join('');
}
