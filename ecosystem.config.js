/**
 * ecosystem.config.js — PM2 Process Manager Configuration
 * Artha AI Production Process Management (EC2 / VPS / Bare Metal)
 *
 * Usage:
 *  - Start: pm2 start ecosystem.config.js --env production
 *  - Save:  pm2 save && pm2 startup
 *  - Logs:  pm2 logs artha-api
 */

module.exports = {
  apps: [
    {
      name: 'artha-api',
      script: './apps/api/dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
