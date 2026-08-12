import { randomInt } from 'node:crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  captureUrl,
  generateReferralCode,
  maskMobile,
  type Partner360,
  type PartnerQuery,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { decimalToString } from '../leads/lead.mapper';

const DAY_MS = 86_400_000;

const PUBLIC_WEB_URL = (): string => process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';

/** Retries on the (vanishingly unlikely) chance a generated code is taken. */
const CODE_ATTEMPTS = 5;

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: PartnerQuery,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    // A partner user may only ever see their own organisation in this list.
    const and: Record<string, unknown>[] = user.partnerId ? [{ id: user.partnerId }] : [];

    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { contactPerson: { contains: query.q, mode: 'insensitive' } },
          { reference: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.type) and.push({ type: query.type });

    const where = { deletedAt: null, AND: and };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.partner.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          orgUnit: { select: { name: true } },
          _count: { select: { leads: true, customers: true } },
        },
      }),
      this.prisma.partner.count({ where }),
    ]);

    return paginate(
      rows.map((partner) => ({
        id: partner.id,
        reference: partner.reference,
        name: partner.name,
        type: partner.type,
        status: partner.status,
        contactPerson: partner.contactPerson,
        city: partner.city,
        branch: partner.orgUnit?.name ?? null,
        commissionRate: decimalToString(partner.commissionRate),
        leadsSourced: partner._count.leads,
        clients: partner._count.customers,
        onboardedAt: partner.onboardedAt?.toISOString() ?? null,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Partner 360.
   *
   * Every money figure here is derived from CRM attribution and labelled as an
   * estimate. Settled brokerage and amounts actually payable live in the back
   * office (ADR-0002); a portal that presents its own arithmetic as an amount
   * due creates a dispute the first time the two disagree.
   */
  async find360(user: AuthenticatedPrincipal, partnerId: string): Promise<Partner360> {
    if (user.partnerId && user.partnerId !== partnerId) {
      throw new ForbiddenException({
        title: 'Not your partner record',
        detail: 'You can only view your own partner profile.',
      });
    }

    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
    });
    if (!partner) throw new NotFoundException({ title: 'Partner not found' });

    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const leadWhere = { partnerId, deletedAt: null };

    const [
      leadsSourced,
      leadsOpen,
      leadsConverted,
      clientsTotal,
      clientsActive,
      clientsOnboarding,
      attributed,
      leadsLast30,
      conversionsLast30,
      lastLead,
      documentCount,
    ] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: leadWhere }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
      }),
      this.prisma.lead.count({ where: { ...leadWhere, status: 'CONVERTED' } }),
      this.prisma.customer.count({ where: { partnerId, deletedAt: null } }),
      this.prisma.customer.count({ where: { partnerId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.customer.count({ where: { partnerId, deletedAt: null, status: 'ONBOARDING' } }),
      this.prisma.lead.aggregate({
        where: { ...leadWhere, status: 'CONVERTED' },
        _sum: { estimatedValue: true },
      }),
      this.prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: since30 } } }),
      this.prisma.lead.count({ where: { ...leadWhere, convertedAt: { gte: since30 } } }),
      this.prisma.lead.findFirst({
        where: leadWhere,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.document.count({
        where: { entityType: 'PARTNER', entityId: partnerId, deletedAt: null },
      }),
    ]);

    const attributedValue = attributed._sum.estimatedValue
      ? Number(attributed._sum.estimatedValue)
      : 0;
    const rate = partner.commissionRate ? Number(partner.commissionRate) : null;

    await this.audit.record({ action: 'READ', resource: 'partner', resourceId: partnerId });

    return {
      profile: {
        id: partner.id,
        reference: partner.reference,
        name: partner.name,
        type: partner.type,
        status: partner.status,
        contactPerson: partner.contactPerson,
        email: partner.email,
        mobileMasked: maskMobile(partner.mobile),
        city: partner.city,
        state: partner.state,
        sebiRegNo: partner.sebiRegNo,
        commissionRate: decimalToString(partner.commissionRate),
        onboardedAt: partner.onboardedAt?.toISOString() ?? null,
      },
      business: {
        leadsSourced,
        leadsOpen,
        leadsConverted,
        conversionRate:
          leadsSourced > 0 ? Number(((leadsConverted / leadsSourced) * 100).toFixed(1)) : 0,
        clientsTotal,
        clientsActive,
        clientsOnboarding,
      },
      estimatedEarnings: {
        attributedBusinessValue: String(attributedValue),
        commissionRatePercent: rate === null ? null : String(rate),
        estimatedCommission:
          rate === null ? null : String(Math.round((attributedValue * rate) / 100)),
        basis:
          'Estimated from the agreed revenue share applied to the value of leads this partner ' +
          'sourced that converted. Not settled brokerage. Amounts actually payable are ' +
          'calculated by the back office.',
      },
      activity: {
        leadsLast30,
        conversionsLast30,
        lastLeadAt: lastLead?.createdAt.toISOString() ?? null,
      },
      compliance: {
        hasPan: Boolean(partner.pan),
        hasGstin: Boolean(partner.gstin),
        hasSebiRegistration: Boolean(partner.sebiRegNo),
        documentCount,
      },
    };
  }

  /** Resolves the signed-in partner user's own organisation. */
  async me(user: AuthenticatedPrincipal): Promise<Partner360> {
    if (!user.partnerId) {
      throw new ForbiddenException({
        title: 'Not a partner account',
        detail: 'This endpoint is for associate partner logins.',
      });
    }
    return this.find360(user, user.partnerId);
  }
  /**
   * The partner's own onboarding link.
   *
   * Issued on first request rather than at onboarding, so partners who never
   * use one never carry a live public code. Idempotent: asking twice returns
   * the same link, because the alternative is a partner whose printed card
   * silently stops working.
   */
  async referralLink(user: AuthenticatedPrincipal, partnerId?: string) {
    const id = partnerId ?? user.partnerId;
    if (!id) {
      throw new ForbiddenException({
        title: 'Not a partner',
        detail: 'Only an associate partner has a referral link.',
      });
    }
    if (user.partnerId && user.partnerId !== id) {
      throw new ForbiddenException({ title: 'Not your partner organisation' });
    }

    const partner = await this.prisma.partner.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true, referralCode: true },
    });
    if (!partner) throw new NotFoundException({ title: 'Partner not found' });

    const code = partner.referralCode ?? (await this.issueCode(partner.id));

    return {
      code,
      url: captureUrl(PUBLIC_WEB_URL(), 'PARTNER', code),
      partnerName: partner.name,
      // A suspended partner keeps their code but the link stops accepting
      // submissions, which the public page states plainly.
      active: partner.status === 'ACTIVE',
    };
  }

  /**
   * Replaces the code, invalidating every link already handed out.
   *
   * The reason is mandatory and audited: rotation breaks printed cards and QR
   * codes in circulation, so it should be a decision somebody can account for
   * rather than a button that looks harmless.
   */
  async rotateReferralCode(user: AuthenticatedPrincipal, partnerId: string, reason: string) {
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true, referralCode: true },
    });
    if (!partner) throw new NotFoundException({ title: 'Partner not found' });

    const code = await this.issueCode(partner.id);

    await this.audit.record({
      action: 'UPDATE',
      resource: 'partner',
      resourceId: partner.id,
      reason,
      // The old code is recorded so a lead that arrives on a stale link can
      // still be traced back after the rotation.
      changes: { referralCode: { from: partner.referralCode, to: code } },
    });

    return { code, url: captureUrl(PUBLIC_WEB_URL(), 'PARTNER', code) };
  }

  private async issueCode(partnerId: string): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = generateReferralCode((max) => randomInt(max));

      const clash = await this.prisma.partner.findFirst({
        where: { referralCode: code },
        select: { id: true },
      });
      if (clash) continue;

      await this.prisma.partner.update({ where: { id: partnerId }, data: { referralCode: code } });
      return code;
    }

    throw new ForbiddenException({
      title: 'Could not issue a referral code',
      detail: 'Please try again.',
    });
  }
}
