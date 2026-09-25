import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canSend,
  maskMobile,
  renderTemplate,
  type CreateTemplateInput,
  type MessageChannel,
  type MessagePurpose,
  type RecipientState,
  type SendMessageInput,
  type TemplateQuery,
  type UpdateTemplateInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageSender } from './message-sender';

/** Where "now" is, for quiet hours. TRAI's window is Indian local time. */
const IST_OFFSET_MINUTES = 330;

function istHour(now = new Date()): number {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).getUTCHours();
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sender: MessageSender,
  ) {}

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  listTemplates(query: TemplateQuery) {
    return this.prisma.messageTemplate.findMany({
      where: {
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.purpose ? { purpose: query.purpose } : {}),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { name: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ channel: 'asc' }, { name: 'asc' }],
    });
  }

  async createTemplate(user: AuthenticatedPrincipal, input: CreateTemplateInput) {
    const existing = await this.prisma.messageTemplate.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.name}.`,
      });
    }

    const created = await this.prisma.messageTemplate.create({
      data: {
        ...input,
        subject: input.subject ?? null,
        providerTemplateId: input.providerTemplateId ?? null,
        createdById: user.id,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'message_template',
      resourceId: created.id,
      changes: { code: created.code, channel: created.channel, purpose: created.purpose },
    });

    return created;
  }

  /**
   * Edits copy. Never the purpose.
   *
   * `purpose` decides whether DND and quiet hours apply, so allowing it to be
   * changed would let a promotion be re-labelled transactional after approval —
   * the exact abuse the regime exists to stop. A different purpose needs a new
   * template, which leaves a record.
   */
  async updateTemplate(user: AuthenticatedPrincipal, id: string, input: UpdateTemplateInput) {
    const before = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Template not found' });

    const after = await this.prisma.messageTemplate.update({ where: { id }, data: input });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'message_template',
      resourceId: id,
      changes: {
        ...(input.body !== undefined ? { body: 'changed' } : {}),
        ...(input.isActive !== undefined
          ? { isActive: { from: before.isActive, to: after.isActive } }
          : {}),
      },
    });

    return after;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(user: AuthenticatedPrincipal, input: SendMessageInput) {
    if (Boolean(input.leadId) === Boolean(input.customerId)) {
      throw new BadRequestException({
        title: 'Choose one recipient',
        detail: 'A message goes to a lead or a customer, not both and not neither.',
      });
    }

    const template = await this.prisma.messageTemplate.findFirst({
      where: { code: input.templateCode, isActive: true },
    });
    if (!template) {
      throw new NotFoundException({
        title: 'Template not found',
        detail: `No active template with code "${input.templateCode}".`,
      });
    }

    const recipient = await this.loadRecipient(
      template.channel as MessageChannel,
      input.leadId,
      input.customerId,
    );

    const decision = canSend(template.purpose as MessagePurpose, recipient.state, istHour());

    const rendered = renderTemplate(template.body, {
      ...input.variables,
      // Always available, because almost every template opens with a name.
      name: recipient.name,
    });

    if (rendered.missing.length > 0) {
      throw new BadRequestException({
        title: 'Missing template values',
        detail: `Nothing supplied for: ${rendered.missing.join(', ')}. The message was not sent.`,
      });
    }

    // Logged whether or not it goes. A refusal that leaves no trace is
    // unanswerable when somebody asks why a client never heard from us.
    const log = await this.prisma.messageLog.create({
      data: {
        templateId: template.id,
        templateCode: template.code,
        channel: template.channel,
        purpose: template.purpose,
        leadId: input.leadId ?? null,
        customerId: input.customerId ?? null,
        destination: recipient.state.destination ?? '(none)',
        subject: template.subject,
        body: rendered.text,
        status: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
        decisionCode: decision.code,
        failureReason: decision.reason,
        requestedById: user.id,
      },
    });

    if (!decision.allowed) {
      await this.audit.record({
        action: 'CREATE',
        resource: 'message.suppressed',
        resourceId: log.id,
        reason: decision.reason,
        changes: { templateCode: template.code, decisionCode: decision.code },
      });
      return { id: log.id, status: 'SUPPRESSED' as const, reason: decision.reason };
    }

    const result = await this.sender.send({
      channel: template.channel as MessageChannel,
      destination: recipient.state.destination!,
      subject: template.subject,
      body: rendered.text,
      providerTemplateId: template.providerTemplateId,
    });

    const updated = await this.prisma.messageLog.update({
      where: { id: log.id },
      data: {
        status: result.accepted ? 'SENT' : 'FAILED',
        providerMessageId: result.providerMessageId,
        failureReason: result.failureReason,
        sentAt: result.accepted ? new Date() : null,
      },
    });

    return { id: updated.id, status: updated.status, reason: null };
  }

  /** A standing refusal, honoured ahead of every purpose. */
  async optOut(
    entityType: 'LEAD' | 'CUSTOMER',
    entityId: string,
    channel: MessageChannel,
    reason?: string,
  ) {
    return this.prisma.messageOptOut.upsert({
      where: { entityType_entityId_channel: { entityType, entityId, channel } },
      update: {},
      create: { entityType, entityId, channel, reason: reason ?? null },
    });
  }

  // -------------------------------------------------------------------------

  private async loadRecipient(
    channel: MessageChannel,
    leadId?: string,
    customerId?: string,
  ): Promise<{ name: string; state: RecipientState }> {
    const isCustomer = Boolean(customerId);

    const person = isCustomer
      ? await this.prisma.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          select: { id: true, firstName: true, email: true, mobile: true, dndRegistered: true },
        })
      : await this.prisma.lead.findFirst({
          where: { id: leadId, deletedAt: null },
          select: { id: true, firstName: true, email: true, mobile: true, dndRegistered: true },
        });

    if (!person) throw new NotFoundException({ title: 'Recipient not found' });

    const [optOut, consent] = await Promise.all([
      this.prisma.messageOptOut.findUnique({
        where: {
          entityType_entityId_channel: {
            entityType: isCustomer ? 'CUSTOMER' : 'LEAD',
            entityId: person.id,
            channel,
          },
        },
      }),
      // The *latest* consent record wins, granted or not.
      //
      // Consent here is append-only: a withdrawal is a new row with
      // `granted: false`, not an update to the old one. Filtering on
      // `granted: true` would therefore find the original grant and cheerfully
      // market to somebody who had since opted out — the row is still there,
      // and still says true.
      this.prisma.consentRecord.findFirst({
        where: { entityId: person.id, purpose: 'MARKETING_CONTACT' },
        orderBy: { capturedAt: 'desc' },
        select: { granted: true },
      }),
    ]);

    return {
      name: person.firstName,
      state: {
        channel,
        destination: channel === 'EMAIL' ? person.email : person.mobile,
        isDndRegistered: person.dndRegistered,
        hasMarketingConsent: consent?.granted === true,
        hasOptedOut: Boolean(optOut),
        isCustomer,
      },
    };
  }

  listLog(limit = 50) {
    return this.prisma.messageLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        channel: true,
        purpose: true,
        templateCode: true,
        destination: true,
        subject: true,
        body: true,
        status: true,
        decisionCode: true,
        failureReason: true,
        providerMessageId: true,
        sentAt: true,
        createdAt: true,
      },
    });
  }
}

/** Kept out of the select above; the log is read by more people than the record is. */
export function maskDestination(destination: string): string {
  return destination.includes('@')
    ? `${destination.split('@')[0]!.slice(0, 2)}***@${destination.split('@')[1]}`
    : maskMobile(destination);
}
