import 'reflect-metadata';

import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('Bootstrap');

  // Behind a load balancer, X-Forwarded-For must be trusted for rate limiting
  // and audit IPs to mean anything. `1` = trust exactly one proxy hop; trusting
  // all of them lets a client spoof its own IP by setting the header.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON, never HTML, so a restrictive CSP costs nothing.
      // Swagger UI is the one exception and is disabled in production anyway.
      contentSecurityPolicy: config.isProduction
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(config.globalPrefix, {
    exclude: ['health/live', 'health/ready'],
  });

  // URI versioning from day one. Adding /v2 later without a version segment in
  // v1's URLs means either breaking every existing client or shipping a second
  // hostname; a segment costs nothing now.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Payload cap. The default is 100kb; lead and activity payloads are far
  // smaller, and an unbounded body is a free denial-of-service.
  app.useBodyParser('json', { limit: '256kb' });

  app.enableShutdownHooks();

  if (!config.isProduction) {
    // Swagger is a complete map of the attack surface, including which fields
    // are validated and how. It is not served in production; the spec is
    // published to the internal developer portal from CI instead.
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SIHL ONE API')
        .setDescription(
          'System of engagement for Shah Investors Home Ltd. — CRM, lead management, ' +
            'customer 360, field sales and partner journeys.\n\n' +
            'All errors use RFC 9457 Problem Details. All list endpoints are filtered by the ' +
            'caller’s data scope.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .addTag('Authentication')
        .addTag('Leads')
        .addTag('Customers')
        .addTag('Activities')
        .addTag('Tasks')
        .addTag('Dashboard')
        .addTag('Users')
        .addTag('Health')
        .build(),
    );
    SwaggerModule.setup(`${config.globalPrefix}/docs`, app, document, {
      jsonDocumentUrl: `${config.globalPrefix}/docs/openapi.json`,
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  logger.log(`SIHL ONE API listening on http://localhost:${config.port}/${config.globalPrefix}`);
  if (!config.isProduction) {
    logger.log(`OpenAPI docs at http://localhost:${config.port}/${config.globalPrefix}/docs`);
  }
}

void bootstrap();
