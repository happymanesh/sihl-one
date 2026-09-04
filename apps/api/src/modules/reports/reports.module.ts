import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { WorkbookService } from './workbook.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, WorkbookService],
  exports: [ReportsService],
})
export class ReportsModule {}
