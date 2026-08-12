import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_CAPACITY,
  recommendOwners,
  type AllocationAdvice,
  type AllocationCandidate,
  type LeadStatus,
} from '@sihl-one/contracts';

import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { PerformanceService } from './performance.service';

const OPEN_LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'];
const RATING_WINDOW_DAYS = 90;

/** Persisted so the development rotation is even across API pods and restarts. */
const DEVELOPMENT_CURSOR_KEY = 'allocation:development';

/**
 * Suggests owners for a lead. It never assigns one.
 *
 * The gap between "suggest" and "assign" is the whole design. See the header of
 * `@sihl-one/contracts/allocation` for why a rating-driven allocator that acts
 * on its own is a feedback loop nobody can argue with.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly performance: PerformanceService,
  ) {}

  async recommendForLead(
    actor: AuthenticatedPrincipal,
    leadId: string,
  ): Promise<AllocationAdvice & { lead: { id: string; reference: string; score: number } }> {
    // Scoped read: you cannot ask who should own a lead you cannot see.
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null, ...this.scope.leadScope(actor) },
      select: { id: true, reference: true, score: true, ownerId: true },
    });
    if (!lead) throw new NotFoundException({ title: 'Lead not found' });

    const candidates = await this.candidates(actor, lead.ownerId);
    const cursor = await this.prisma.counter.findUnique({
      where: { key: DEVELOPMENT_CURSOR_KEY },
    });

    const advice = recommendOwners(lead, candidates, {
      developmentCursor: cursor?.value ?? 0,
    });

    return {
      ...advice,
      lead: { id: lead.id, reference: lead.reference, score: lead.score },
    };
  }

  /**
   * Advances the development rotation.
   *
   * Called after a strong lead is actually assigned, not when advice is merely
   * viewed — otherwise opening the same lead twice would burn the reserved slot
   * and the floor would never deliver its one-in-four.
   */
  async recordStrongAllocation(): Promise<void> {
    await this.prisma.counter.upsert({
      where: { key: DEVELOPMENT_CURSOR_KEY },
      create: { key: DEVELOPMENT_CURSOR_KEY, value: 1 },
      update: { value: { increment: 1 } },
    });
  }

  // -------------------------------------------------------------------------

  private async candidates(
    actor: AuthenticatedPrincipal,
    currentOwnerId: string | null,
  ): Promise<AllocationCandidate[]> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        userType: 'INTERNAL',
        ...(actor.dataScope === 'ALL' ? {} : { id: { in: [actor.id, ...actor.teamUserIds] } }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        noticePeriodFrom: true,
        offboardedAt: true,
        roles: { select: { roleCode: true } },
        _count: { select: { ownedLeads: { where: { deletedAt: null, status: { in: OPEN_LEAD_STATUSES } } } } },
      },
      take: 100,
    });

    // Only people who actually work leads. A branch operations user holding
    // `lead:read` is not a candidate owner.
    const sellers = users.filter((user) =>
      user.roles.some((role) => ['SALES_EXECUTIVE', 'SALES_MANAGER'].includes(role.roleCode)),
    );

    const from = new Date(Date.now() - RATING_WINDOW_DAYS * 86_400_000);
    const ratings = await this.performance.ratingsFor(
      sellers.map((user) => user.id),
      from,
    );

    return sellers.map((user) => {
      const rating = ratings.get(user.id);
      const fullName = `${user.firstName} ${user.lastName}`.trim();

      let isAvailable = true;
      let unavailableReason: string | undefined;

      if (user.status !== 'ACTIVE' || user.offboardedAt) {
        isAvailable = false;
        unavailableReason = 'Not an active user';
      } else if (user.noticePeriodFrom) {
        // Handing new leads to someone who is leaving guarantees a second
        // handover, and the customer feels both of them.
        isAvailable = false;
        unavailableReason = 'Serving notice period';
      } else if (user.id === currentOwnerId) {
        isAvailable = false;
        unavailableReason = 'Already owns this lead';
      }

      return {
        userId: user.id,
        fullName,
        overall: rating?.overall ?? 50,
        behaviourScore: rating?.behaviourScore ?? 50,
        confidence: rating?.confidence ?? 'LOW',
        openLeads: user._count.ownedLeads,
        capacity: DEFAULT_CAPACITY,
        isAvailable,
        unavailableReason,
      };
    });
  }
}
