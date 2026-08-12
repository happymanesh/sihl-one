import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTaskSchema,
  taskQuerySchema,
  updateTaskSchema,
  type CreateTaskInput,
  type TaskQuery,
  type UpdateTaskInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, IdParamPipe, ZodBody, ZodQuery } from '../../common/zod';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('task:read')
  @ApiOperation({ summary: 'List tasks, soonest due first' })
  @ApiZodQuery(taskQuerySchema)
  list(@CurrentUser() user: AuthenticatedPrincipal, @ZodQuery(taskQuerySchema) query: TaskQuery) {
    return this.tasks.list(user, query);
  }

  @Get('summary')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: 'Open, overdue, due-today and completed counts' })
  summary(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.tasks.summary(user);
  }

  @Post()
  @RequirePermissions('task:create')
  @ApiOperation({ summary: 'Create a task or follow-up' })
  @ApiZodBody(createTaskSchema)
  create(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(createTaskSchema) body: CreateTaskInput) {
    return this.tasks.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: 'Update or complete a task' })
  @ApiZodBody(updateTaskSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateTaskSchema) body: UpdateTaskInput,
  ) {
    return this.tasks.update(user, id, body);
  }
}
