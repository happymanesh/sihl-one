import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { DailyActivityService } from './daily-activity.service';
import { ReportsService } from './reports.service';
import { WorkbookService } from './workbook.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, WorkbookService, DailyActivityService],
  exports: [ReportsService],
})
export class ReportsModule {}
