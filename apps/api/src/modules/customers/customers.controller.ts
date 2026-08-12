import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createCustomerSchema,
  customerQuerySchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerQuery,
  type UpdateCustomerInput,
} from '@sihl-one/contracts';

import { Audited, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'List customers within the caller’s data scope' })
  @ApiZodQuery(customerQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(customerQuerySchema) query: CustomerQuery,
  ) {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('customer:read')
  @ApiParam({ name: 'id', description: 'Customer id' })
  @ApiOperation({
    summary: 'Customer 360',
    description:
      'Profile, onboarding progress, relationship, acquisition attribution, holdings, ' +
      'engagement summary and derived insights in a single response.',
  })
  find360(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.customers.find360(user, id);
  }

  @Post()
  @RequirePermissions('customer:create')
  @Audited({ action: 'CREATE', resource: 'customer' })
  @ApiOperation({ summary: 'Create a customer directly (outside lead conversion)' })
  @ApiZodBody(createCustomerSchema)
  create(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(createCustomerSchema) body: CreateCustomerInput) {
    return this.customers.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Update a customer, including onboarding stage' })
  @ApiZodBody(updateCustomerSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateCustomerSchema) body: UpdateCustomerInput,
  ) {
    return this.customers.update(user, id, body);
  }
}
