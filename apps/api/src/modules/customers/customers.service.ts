import { Injectable, NotFoundException } from '@nestjs/common';
import {
  maskMobile,
  maskPan,
  onboardingProgress,
  type CreateCustomerInput,
  type Customer360,
  type CustomerQuery,
  type UpdateCustomerInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { ScopeService } from '../../common/scope.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { decimalToString } from '../leads/lead.mapper';

const SORTABLE = new Set(['createdAt', 'updatedAt', 'firstName', 'status', 'onboardingStage']);

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: CustomerQuery,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const and: Record<string, unknown>[] = [this.scope.customerScope(user)];

    if (query.q) {
      and.push({
        OR: [
          { firstName: { contains: query.q, mode: 'insensitive' } },
          { lastName: { contains: query.q, mode: 'insensitive' } },
          { mobile: { contains: query.q } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { reference: { contains: query.q, mode: 'insensitive' } },
          { clientCode: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.kycStatus) and.push({ kycStatus: query.kycStatus });
    if (query.onboardingStage) and.push({ onboardingStage: query.onboardingStage });
    if (query.relationshipManagerId) and.push({ relationshipManagerId: query.relationshipManagerId });
    if (query.partnerId) and.push({ partnerId: query.partnerId });

    // Which product relationship is being asked about. `opportunity` — wants it,
    // does not hold it — is the actionable one and the default, because pitching
    // a client something they already own is the mistake worth preventing.
    if (query.productInterest?.length) {
      const codes = query.productInterest;
      const interested = { productInterest: { hasSome: codes } };
      const holds = { holdings: { some: { product: { in: codes } } } };

      if (query.productDimension === 'interested') {
        and.push(interested);
      } else if (query.productDimension === 'holds') {
        and.push(holds);
      } else {
        and.push(interested, { NOT: holds });
      }
    }

    const where = { deletedAt: null, AND: and };
    const sortBy = query.sortBy && SORTABLE.has(query.sortBy) ? query.sortBy : 'createdAt';

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { [sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          relationshipManager: { select: { id: true, firstName: true, lastName: true } },
          partner: { select: { id: true, name: true } },
          // Product codes only. The list shows chips; the 360 screen is where
          // values, sync times and the rest of the mirrored record belong.
          holdings: { select: { product: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(
      rows.map((customer) => ({
        id: customer.id,
        reference: customer.reference,
        clientCode: customer.clientCode,
        fullName: `${customer.firstName} ${customer.lastName ?? ''}`.trim(),
        email: customer.email,
        mobileMasked: maskMobile(customer.mobile),
        panMasked: maskPan(customer.pan),
        city: customer.city,
        status: customer.status,
        kycStatus: customer.kycStatus,
        onboardingStage: customer.onboardingStage,
        progressPercent: onboardingProgress(customer.onboardingStage),
        relationshipManager: customer.relationshipManager
          ? {
              id: customer.relationshipManager.id,
              fullName: `${customer.relationshipManager.firstName} ${customer.relationshipManager.lastName}`.trim(),
            }
          : null,
        partner: customer.partner,
        productInterest: customer.productInterest,
        // What they hold. Rows written here on conversion carry
        // sourceSystem=SIHL_ONE — what was sold through our own pipeline — and a
        // back-office feed writes BACKOFFICE rows alongside them. Per ADR-0002
        // this system is not the authority on holdings, which is exactly why the
        // provenance is recorded rather than assumed.
        holdings: customer.holdings.map((holding) => holding.product),
        createdAt: customer.createdAt.toISOString(),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Customer 360.
   *
   * The brief asks for one screen showing profile, onboarding, relationship,
   * acquisition, holdings, engagement and insights. Assembling it here — in
   * five parallel queries behind one endpoint — rather than letting the client
   * make seven calls is what keeps the screen fast on a branch's connection.
   */
  async find360(user: AuthenticatedPrincipal, id: string): Promise<Customer360> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, AND: [this.scope.customerScope(user)] },
      include: {
        relationshipManager: { select: { id: true, firstName: true, lastName: true, email: true } },
        partner: { select: { id: true, name: true, type: true } },
        orgUnit: { select: { id: true, name: true } },
        holdings: true,
        lead: {
          select: {
            id: true,
            reference: true,
            source: true,
            convertedAt: true,
            campaign: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException({
        title: 'Customer not found',
        detail: 'No customer with that id is visible to you.',
      });
    }

    const [activityCount, lastActivity, openTasks, lastVisit] = await Promise.all([
      this.prisma.activity.count({ where: { entityType: 'CUSTOMER', entityId: id } }),
      this.prisma.activity.findFirst({
        where: { entityType: 'CUSTOMER', entityId: id },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
      this.prisma.task.count({
        where: { entityType: 'CUSTOMER', entityId: id, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } }, deletedAt: null },
      }),
      this.prisma.visit.findFirst({
        where: { entityType: 'CUSTOMER', entityId: id, status: 'COMPLETED' },
        orderBy: { checkInAt: 'desc' },
        select: { checkInAt: true },
      }),
    ]);

    await this.audit.record({ action: 'READ', resource: 'customer', resourceId: id });

    return {
      profile: {
        id: customer.id,
        reference: customer.reference,
        fullName: `${customer.firstName} ${customer.lastName ?? ''}`.trim(),
        email: customer.email,
        mobileMasked: maskMobile(customer.mobile),
        panMasked: maskPan(customer.pan),
        city: customer.city,
        state: customer.state,
        status: customer.status,
        createdAt: customer.createdAt.toISOString(),
      },
      onboarding: {
        kycStatus: customer.kycStatus,
        onboardingStage: customer.onboardingStage,
        stageCompletedAt: customer.stageUpdatedAt?.toISOString() ?? null,
        accountOpenedAt: customer.accountOpenedAt?.toISOString() ?? null,
        activatedAt: customer.activatedAt?.toISOString() ?? null,
        progressPercent: onboardingProgress(customer.onboardingStage),
      },
      relationship: {
        relationshipManager: customer.relationshipManager
          ? {
              id: customer.relationshipManager.id,
              fullName: `${customer.relationshipManager.firstName} ${customer.relationshipManager.lastName}`.trim(),
              email: customer.relationshipManager.email,
            }
          : null,
        partner: customer.partner,
        orgUnit: customer.orgUnit,
      },
      acquisition: {
        leadId: customer.lead?.id ?? null,
        leadReference: customer.lead?.reference ?? null,
        source: customer.lead?.source ?? null,
        campaign: customer.lead?.campaign ?? null,
        convertedAt: customer.lead?.convertedAt?.toISOString() ?? null,
      },
      holdings: customer.holdings.map((holding) => ({
        product: holding.product,
        status: holding.status,
        openedAt: holding.openedAt?.toISOString() ?? null,
        value: decimalToString(holding.currentValue),
      })),
      engagement: {
        totalActivities: activityCount,
        lastActivityAt: lastActivity?.occurredAt.toISOString() ?? null,
        openTasks,
        lastVisitAt: lastVisit?.checkInAt?.toISOString() ?? null,
      },
      insights: this.deriveInsights(customer, activityCount, lastActivity?.occurredAt ?? null),
    };
  }

  async create(user: AuthenticatedPrincipal, input: CreateCustomerInput) {
    const reference = await this.references.next('CU');

    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          reference,
          ...input,
          lastName: input.lastName ?? null,
          relationshipManagerId: input.relationshipManagerId ?? user.id,
          orgUnitId: user.orgUnitId,
          status: 'ONBOARDING',
          stageUpdatedAt: new Date(),
          createdById: user.id,
        },
      });
      await this.outbox.publish(tx, {
        aggregateType: 'customer',
        aggregateId: created.id,
        eventType: 'customer.created',
        payload: { reference, pan: input.pan },
      });
      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'customer',
      resourceId: customer.id,
      changes: { reference },
    });
    return this.find360(user, customer.id);
  }

  async update(user: AuthenticatedPrincipal, id: string, input: UpdateCustomerInput) {
    const before = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null, AND: [this.scope.customerScope(user)] },
    });
    if (!before) throw new NotFoundException({ title: 'Customer not found' });

    const stageChanged = input.onboardingStage && input.onboardingStage !== before.onboardingStage;

    const after = await this.prisma.customer.update({
      where: { id },
      data: {
        ...input,
        stageUpdatedAt: stageChanged ? new Date() : undefined,
        activatedAt: input.onboardingStage === 'ACTIVATED' ? new Date() : undefined,
        accountOpenedAt: input.onboardingStage === 'ACCOUNT_OPENED' ? new Date() : undefined,
        updatedById: user.id,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'customer',
      resourceId: id,
      changes: diffRecords(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
      ) as Record<string, unknown> | null,
    });

    return this.find360(user, id);
  }

  /**
   * Rule-based insights — the same reasoning as lead scoring. Each one names a
   * concrete, checkable condition so an RM can act on it, rather than producing
   * a number nobody trusts.
   */
  private deriveInsights(
    customer: {
      kycStatus: string;
      onboardingStage: string;
      status: string;
      stageUpdatedAt: Date | null;
      activatedAt: Date | null;
      firstTradeAt: Date | null;
      holdings: unknown[];
    },
    activityCount: number,
    lastActivityAt: Date | null,
  ): Customer360['insights'] {
    const insights: Customer360['insights'] = [];
    const daysSince = (date: Date | null): number | null =>
      date ? Math.floor((Date.now() - date.getTime()) / 86_400_000) : null;

    const stalledDays = daysSince(customer.stageUpdatedAt);
    if (
      customer.onboardingStage !== 'ACTIVATED' &&
      stalledDays !== null &&
      stalledDays > 3
    ) {
      insights.push({
        code: 'ONBOARDING_STALLED',
        title: 'Onboarding has stalled',
        detail: `No stage change for ${stalledDays} days at ${customer.onboardingStage.replace(/_/g, ' ').toLowerCase()}.`,
        severity: stalledDays > 10 ? 'RISK' : 'WARN',
      });
    }

    if (customer.kycStatus === 'REJECTED') {
      insights.push({
        code: 'KYC_REJECTED',
        title: 'KYC was rejected',
        detail: 'The account cannot proceed until the KYC issue is resolved.',
        severity: 'RISK',
      });
    }

    if (customer.activatedAt && !customer.firstTradeAt) {
      const days = daysSince(customer.activatedAt) ?? 0;
      if (days > 7) {
        insights.push({
          code: 'ACTIVATED_NOT_TRADED',
          title: 'Account funded but not traded',
          detail: `Activated ${days} days ago with no first trade recorded.`,
          severity: 'WARN',
        });
      }
    }

    const quietDays = daysSince(lastActivityAt);
    if (activityCount === 0) {
      insights.push({
        code: 'NEVER_CONTACTED',
        title: 'No interaction recorded',
        detail: 'Nobody has logged a call, meeting or message with this customer.',
        severity: 'WARN',
      });
    } else if (quietDays !== null && quietDays > 60) {
      insights.push({
        code: 'RELATIONSHIP_COOLING',
        title: 'Relationship is cooling',
        detail: `No contact for ${quietDays} days.`,
        severity: 'WARN',
      });
    }

    if (customer.holdings.length === 1) {
      insights.push({
        code: 'SINGLE_PRODUCT',
        title: 'Cross-sell opportunity',
        detail: 'The customer holds a single product. Multi-product customers retain materially better.',
        severity: 'INFO',
      });
    }

    return insights;
  }
}
