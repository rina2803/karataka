import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Get()
  list() {
    return this.jobs.list();
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const job = await this.jobs.image(id);
    if (!job) throw new NotFoundException('Affiche introuvable');
    res.setHeader('Content-Type', job.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(job.imageData, 'base64'));
  }
}

@Controller('admin/jobs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminJobsController {
  constructor(private jobs: JobsService) {}

  @Get()
  list() {
    return this.jobs.list(true);
  }

  @Post()
  create(@Body() body: { title?: string; description?: string; contact?: string; image?: string }) {
    return this.jobs.create(body ?? {});
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; contact?: string; image?: string; active?: boolean },
  ) {
    return this.jobs.update(id, body ?? {});
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobs.remove(id);
  }
}
