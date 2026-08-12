import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  selectOwner,
  selectRule,
  type AssignableLead,
  type AssignmentCriteria,
  type CreateAssignmentRuleInput,
  type MatchableRule,
  type OwnerWorkload,
  type UpdateAssignmentRuleInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lead routing.
 *
 * One engine for every path that needs to decide who owns a lead: bulk import,
 * event capture, public web capture and offboarding handover. The alternative —
 * a little assignment logic at each entry point — drifts, and the drift is
 * invisible until leads start landing with the wrong person on exactly one of
 * the four routes.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listRules() {
    const rules = await this.prisma.assignmentRule.findMany({
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      include: { orgUnit: { select: { id: true, name: true } } },
    });

    // Resolve target names in one query rather than per rule.
    const userIds = [...new Set(rules.flatMap((rule) => rule.targetUserIds))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const names = new Map(
      users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
    );

    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      isActive: rule.isActive,
      strategy: rule.strategy,
      criteria: rule.criteria as AssignmentCriteria,
      targets: rule.targetUserIds.map((id) => ({ id, fullName: names.get(id) ?? 'Unknown' })),
      orgUnit: rule.orgUnit,
      assignmentCount: rule.assignmentCount,
      lastAppliedAt: rule.lastAppliedAt?.toISOString() ?? null,
    }));
  }

  async createRule(user: AuthenticatedPrincipal, input: CreateAssignmentRuleInput) {
    await this.assertTargetsAreAssignable(input.targetUserIds);

    const rule = await this.prisma.assignmentRule.create({
      data: {
        name: input.name,
        priority: input.priority,
        isActive: input.isActive,
        strategy: input.strategy,
        criteria: input.criteria as never,
        targetUserIds: input.targetUserIds,
        orgUnitId: input.orgUnitId ?? null,
        createdById: user.id,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'assignment_rule',
      resourceId: rule.id,
      changes: { name: input.name, strategy: input.strategy, priority: input.priority },
    });

    return rule;
  }

  async updateRule(user: AuthenticatedPrincipal, id: string, input: UpdateAssignmentRuleInput) {
    const existing = await this.prisma.assignmentRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ title: 'Rule not found' });

    if (input.targetUserIds) await this.assertTargetsAreAssignable(input.targetUserIds);

    const rule = await this.prisma.assignmentRule.update({
      where: { id },
      data: {
        ...input,
        criteria: input.criteria === undefined ? undefined : (input.criteria as never),
        orgUnitId: input.orgUnitId === undefined ? undefined : input.orgUnitId,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'assignment_rule',
      resourceId: id,
      changes: { from: existing.name, to: rule.name, isActive: rule.isActive },
    });

    return rule;
  }

  async deleteRule(user: AuthenticatedPrincipal, id: string): Promise<void> {
    await this.prisma.assignmentRule.delete({ where: { id } });
    await this.audit.record({ action: 'DELETE', resource: 'assignment_rule', resourceId: id });
  }

  /**
   * Decides who should own a lead.
   *
   * Returns null when no rule matches or the matching rule deliberately leaves
   * leads unassigned — the caller then applies its own fallback (usually the
   * importing user). Returning null rather than picking someone arbitrary is
   * important: a lead with no owner is visible in the unassigned queue, whereas
   * a lead given to the wrong person is invisible.
   */
  async resolveOwner(lead: AssignableLead): Promise<{ ownerId: string | null; ruleId: string | null }> {
    const rules = await this.prisma.assignmentRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });

    const matchable: MatchableRule[] = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      isActive: rule.isActive,
      criteria: rule.criteria as AssignmentCriteria,
      strategy: rule.strategy,
      targetUserIds: rule.targetUserIds,
    }));

    const rule = selectRule(matchable, lead);
    if (!rule) return { ownerId: null, ruleId: null };

    const persisted = rules.find((candidate) => candidate.id === rule.id)!;

    const workloads =
      rule.strategy === 'LOAD_BALANCED'
        ? await this.workloadsFor(rule.targetUserIds)
        : [];

    // Only people who are still active can receive leads. A rule that names
    // someone who has since left must not silently route to a dead account.
    const activeTargets = await this.activeUserIds(rule.targetUserIds);
    if (activeTargets.length === 0) {
      this.logger.warn(
        `Assignment rule "${rule.name}" matched but none of its targets are active; leaving unassigned.`,
      );
      return { ownerId: null, ruleId: rule.id };
    }

    const ownerId = selectOwner(
      { ...rule, targetUserIds: activeTargets },
      workloads,
      persisted.roundRobinCursor,
    );

    if (ownerId) {
      // Cursor and counters advance atomically so parallel imports on different
      // pods still rotate evenly rather than all picking index 0.
      await this.prisma.assignmentRule.update({
        where: { id: rule.id },
        data: {
          roundRobinCursor: { increment: 1 },
          assignmentCount: { increment: 1 },
          lastAppliedAt: new Date(),
        },
      });
    }

    return { ownerId, ruleId: rule.id };
  }

  /**
   * Dry run: which rule would fire and who would get it, without touching the
   * cursor. Lets an administrator check a rule set before it goes live.
   */
  async previewOwner(lead: AssignableLead) {
    const rules = await this.prisma.assignmentRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });

    const matchable: MatchableRule[] = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      isActive: rule.isActive,
      criteria: rule.criteria as AssignmentCriteria,
      strategy: rule.strategy,
      targetUserIds: rule.targetUserIds,
    }));

    const rule = selectRule(matchable, lead);
    if (!rule) return { rule: null, owner: null };

    const persisted = rules.find((candidate) => candidate.id === rule.id)!;
    const workloads =
      rule.strategy === 'LOAD_BALANCED' ? await this.workloadsFor(rule.targetUserIds) : [];
    const activeTargets = await this.activeUserIds(rule.targetUserIds);

    const ownerId = selectOwner(
      { ...rule, targetUserIds: activeTargets },
      workloads,
      persisted.roundRobinCursor,
    );

    const owner = ownerId
      ? await this.prisma.user.findUnique({
          where: { id: ownerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;

    return {
      rule: { id: rule.id, name: rule.name, strategy: rule.strategy },
      owner: owner
        ? { id: owner.id, fullName: `${owner.firstName} ${owner.lastName}`.trim() }
        : null,
    };
  }

  /** Open-lead counts, for load balancing. */
  async workloadsFor(userIds: readonly string[]): Promise<OwnerWorkload[]> {
    if (userIds.length === 0) return [];

    const grouped = await this.prisma.lead.groupBy({
      by: ['ownerId'],
      where: {
        ownerId: { in: [...userIds] },
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      _count: { _all: true },
      orderBy: { ownerId: 'asc' },
    });

    return grouped
      .filter((row): row is typeof row & { ownerId: string } => row.ownerId !== null)
      .map((row) => ({ userId: row.ownerId, openLeads: row._count._all }));
  }

  private async activeUserIds(userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] }, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    // Preserve the rule's declared order — round-robin fairness depends on it.
    const active = new Set(users.map((user) => user.id));
    return userIds.filter((id) => active.has(id));
  }

  private async assertTargetsAreAssignable(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;

    const found = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] }, deletedAt: null, userType: 'INTERNAL' },
      select: { id: true, status: true },
    });

    if (found.length !== userIds.length) {
      throw new BadRequestException({
        title: 'Unknown user in rule targets',
        detail: 'One or more selected people are not internal SIHL users.',
      });
    }

    const inactive = found.filter((user) => user.status !== 'ACTIVE');
    if (inactive.length > 0) {
      throw new BadRequestException({
        title: 'Inactive user in rule targets',
        detail: 'Rules can only route leads to active users.',
      });
    }
  }
}
