import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { APP_CONFIG, type AppConfig } from './config/configuration';
import { ConfigurationModule } from './config/configuration.module';
import { CommonModule } from './common/common.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { PartnersModule } from './modules/partners/partners.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { SpeechModule } from './modules/speech/speech.module';
import { StorageModule } from './modules/storage/storage.module';
import { VisitsModule } from './modules/visits/visits.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { AuditModule } from './modules/audit/audit.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { DuplicatesModule } from './modules/duplicates/duplicates.module';
import { EventsModule } from './modules/events/events.module';
import { MastersModule } from './modules/masters/masters.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { OrgUnitsModule } from './modules/org-units/org-units.module';
import { ImportsModule } from './modules/imports/imports.module';
import { OffboardingModule } from './modules/offboarding/offboarding.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [
    ConfigurationModule,

    ThrottlerModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.rateLimit.ttlSeconds * 1000, limit: config.rateLimit.limit }],
      }),
    }),

    PrismaModule,
    CommonModule,
    StorageModule,
    GeocodingModule,
    SpeechModule,
    AssignmentModule,
    AuditModule,
    CampaignsModule,
    DuplicatesModule,
    EventsModule,
    MastersModule,
    MessagingModule,
    OrgUnitsModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    CustomersModule,
    ActivitiesModule,
    TasksModule,
    DashboardModule,
    VisitsModule,
    DocumentsModule,
    PartnersModule,
    ImportsModule,
    OffboardingModule,
    PerformanceModule,
    ReportsModule,
    MailModule,
    NotificationsModule,
    OutboxModule,
    HealthModule,
  ],
  providers: [
    // Guard order matters. Throttling first — it is the cheapest check and it
    // protects the two that follow. Then authentication, then authorisation.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },

    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
