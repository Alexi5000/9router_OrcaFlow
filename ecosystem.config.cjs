module.exports = {
  apps: [
    {
      name: '9router',
      cwd: 'C:\\Users\\Admin\\TechTide\\Tools\\9router',
      script: 'node',
      args: 'scripts/start-standalone.cjs',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        PORT: '20128',
        DATA_DIR: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data',
        INITIAL_PASSWORD: '[REDACTED-ROTATED]',
        REQUIRE_API_KEY: 'false',
      },
      watch: false,
      max_memory_restart: '512M',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\out.log',
      error_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\err.log',
    },
    {
      name: '9router-watchdog',
      cwd: 'C:\\Users\\Admin\\TechTide\\Tools\\9router',
      script: 'node',
      args: 'watchdog.mjs',
      env_file: '.env',
      env: {
        INITIAL_PASSWORD: '[REDACTED-ROTATED]',
        DATA_DIR: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data',
      },
      // Run every 5 minutes via cron_restart
      cron_restart: '*/5 * * * *',
      // Do not keep alive between runs — exit after each check
      autorestart: false,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\watchdog.log',
      error_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\watchdog-err.log',
    },
    {
      name: '9router-usage-ingest',
      cwd: 'C:\\Users\\Admin\\TechTide\\Tools\\9router',
      script: 'node',
      args: 'scripts/usage-ingest.mjs',
      env: {
        AXEL_API_URL: 'http://localhost:4000',
        AXEL_USER_ID: '00000000-0000-0000-0000-000000000001',
        DATA_DIR: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data',
      },
      // Run daily at 2:00 AM
      cron_restart: '0 2 * * *',
      autorestart: false,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\usage-ingest.log',
      error_file: 'C:\\Users\\Admin\\TechTide\\Tools\\9router\\data\\logs\\usage-ingest-err.log',
    },
  ],
};
