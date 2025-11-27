import { Controller, Get, Res, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller('dashboard')
export class DashboardController {
  @Get('*')
  serveDashboard(@Req() req: Request, @Res() res: Response) {
    // 1. Check if the request is for a static file that exists
    // Note: app.useStaticAssets handles root-level static files, but if we are here,
    // it means it matched /dashboard/* and wasn't handled by static assets middleware
    // (or we want to be explicit).

    // Remove '/dashboard' prefix to get relative path in public/dashboard
    const relativePath = req.path.replace(/^\/dashboard/, '');
    const publicDashboardPath = join(process.cwd(), 'public', 'dashboard');

    // If it has an extension, try to serve the file
    if (relativePath.includes('.') && !relativePath.endsWith('.html')) {
      const filePath = join(publicDashboardPath, relativePath);
      if (existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }

    // 2. For everything else (SPA routes), serve index.html
    const indexPath = join(publicDashboardPath, 'index.html');
    if (existsSync(indexPath)) {
      return res.sendFile(indexPath);
    } else {
      return res.status(404).send(`
          <h1>Dashboard not found</h1>
          <p>Please run <code>pnpm run build:dashboard</code> to build the frontend.</p>
        `);
    }
  }
}
