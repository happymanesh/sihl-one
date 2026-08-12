import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { applyDecorators, Body, Query } from '@nestjs/common';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Zod is used for request validation instead of class-validator so that the API
 * and the web app enforce byte-identical rules from one shared package. The
 * cost is that Swagger cannot infer a schema from decorator metadata, so the
 * helpers below convert Zod → JSON Schema and hand it to @nestjs/swagger.
 */

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field-keyed errors so the client can attach messages to inputs rather
    // than dumping one string at the top of the form.
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      (errors[key] ??= []).push(issue.message);
    }

    throw new BadRequestException({
      title: 'Validation failed',
      detail: 'One or more fields are invalid.',
      errors,
    });
  }
}

/**
 * The `schema` cast is load-bearing: zod-to-json-schema's generic signature
 * makes TypeScript try to fully expand deeply-composed schemas (createLeadSchema
 * and friends) and it bails with "type instantiation is excessively deep". The
 * conversion is a runtime concern only, so erasing the generic here costs
 * nothing — the Zod type is still enforced at every call site.
 */
function toOpenApiSchema(schema: ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(schema as never, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

/**
 * Validates the request body against a Zod schema.
 *
 * A **parameter** decorator, applied to the parameter it validates:
 *
 *     create(@CurrentUser() user, @ZodBody(createLeadSchema) body: CreateLeadInput)
 *
 * An earlier version of this was a *method* decorator that called
 * `Body(pipe)(target, key, 0)` internally. That silently bound the body to
 * parameter index 0 — which on every controller here is `@CurrentUser()`, not
 * the body. The authenticated principal was therefore replaced by the request
 * payload, so `user.dataScope` became `undefined`, the ABAC filter collapsed to
 * `{ ownerId: undefined }`, and Prisma treats an `undefined` value as "no
 * condition". The result was that any authenticated user could write to any
 * record in the system while still being correctly blocked from reading it.
 *
 * The lesson worth keeping: a decorator must never guess a parameter position.
 * Positions are the caller's business.
 */
export function ZodBody(schema: ZodTypeAny): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

/** Documents the request body in Swagger. Pair with `@ZodBody` on the parameter. */
export function ApiZodBody(schema: ZodTypeAny, description?: string): MethodDecorator {
  return applyDecorators(ApiBody({ description, schema: toOpenApiSchema(schema) as never }));
}

/**
 * Query-string validation. Applied as a parameter decorator because query
 * parameters need documenting individually for Swagger's "try it out" panel to
 * be usable.
 */
export function ZodQuery(schema: ZodTypeAny): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}

/** Documents each top-level key of an object schema as an optional query param. */
export function ApiZodQuery(schema: ZodTypeAny): MethodDecorator {
  const json = toOpenApiSchema(schema) as {
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
  const properties = json.properties ?? {};
  const required = new Set(json.required ?? []);

  const decorators = Object.entries(properties).map(([name, property]) =>
    ApiQuery({
      name,
      required: required.has(name),
      description: property.description,
      schema: property as never,
    }),
  );
  return applyDecorators(...decorators);
}

/** Narrow a path parameter to a plausible id before it reaches the database. */
export const idParamSchema = z.string().min(8).max(64);
export const IdParamPipe = new ZodValidationPipe(idParamSchema);
