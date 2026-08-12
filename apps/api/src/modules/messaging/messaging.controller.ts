import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createTemplateSchema,
  sendMessageSchema,
  templateQuerySchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type SendMessageInput,
  type TemplateQuery,
  type UpdateTemplateInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { MessagingService } from './messaging.service';

@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('templates')
  @RequirePermissions('campaign:read')
  @ApiOperation({ summary: 'Message templates' })
  @ApiZodQuery(templateQuerySchema)
  listTemplates(@ZodQuery(templateQuerySchema) query: TemplateQuery) {
    return this.messaging.listTemplates(query);
  }

  @Post('templates')
  @RequirePermissions('campaign:create')
  @ApiOperation({
    summary: 'Create a template',
    description:
      'The purpose is fixed at creation: it decides whether DND and quiet hours apply, so it ' +
      'must not be editable afterwards.',
  })
  @ApiZodBody(createTemplateSchema)
  createTemplate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createTemplateSchema) body: CreateTemplateInput,
  ) {
    return this.messaging.createTemplate(user, body);
  }

  @Patch('templates/:id')
  @RequirePermissions('campaign:update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Edit the copy, or switch a template off' })
  @ApiZodBody(updateTemplateSchema)
  updateTemplate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateTemplateSchema) body: UpdateTemplateInput,
  ) {
    return this.messaging.updateTemplate(user, id, body);
  }

  @Post('send')
  @RequirePermissions('activity:create')
  @ApiOperation({
    summary: 'Send a templated message to a lead or a customer',
    description:
      'Runs the consent, DND and quiet-hours gate first. A refused message is still recorded, ' +
      'with its reason, so "they never received it" is answerable.',
  })
  @ApiZodBody(sendMessageSchema)
  send(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(sendMessageSchema) body: SendMessageInput,
  ) {
    return this.messaging.send(user, body);
  }

  @Get('log')
  @RequirePermissions('campaign:read')
  @ApiOperation({ summary: 'Recent outbound messages, including suppressed ones' })
  log(@Query('limit') limit?: string) {
    return this.messaging.listLog(Math.min(Number(limit) || 50, 200));
  }
}
