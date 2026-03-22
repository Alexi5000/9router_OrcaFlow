const path = require("path");

const appRoot = __dirname;
const dataDir = process.env.DATA_DIR || path.join(appRoot, "data");
const logsDir = path.join(dataDir, "logs");
const port = process.env.PORT || "20128";
const requireApiKey = process.env.REQUIRE_API_KEY || "false";
const axelApiUrl = process.env.AXEL_API_URL || "http://localhost:4000";
const axelUserId =
  process.env.AXEL_USER_ID || "00000000-0000-0000-0000-000000000001";
const claudeMemUrl = process.env.CLAUDE_MEM_URL || "http://localhost:37777";
const minContentLength = process.env.MIN_CONTENT_LENGTH || "60";
const postDelayMs = process.env.POST_DELAY_MS || "200";

module.exports = {
  apps: [
    {
      name: "9router",
      cwd: appRoot,
      script: "scripts/start-standalone.cjs",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        PORT: port,
        DATA_DIR: dataDir,
        REQUIRE_API_KEY: requireApiKey,
      },
      watch: false,
      max_memory_restart: "512M",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: path.join(logsDir, "out.log"),
      error_file: path.join(logsDir, "err.log"),
    },
    {
      name: "9router-watchdog",
      cwd: appRoot,
      script: "watchdog.mjs",
      env_file: ".env",
      env: {
        DATA_DIR: dataDir,
      },
      // Run every 5 minutes via cron_restart
      cron_restart: "*/5 * * * *",
      // Do not keep alive between runs - exit after each check
      autorestart: false,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: path.join(logsDir, "watchdog.log"),
      error_file: path.join(logsDir, "watchdog-err.log"),
    },
    {
      name: "9router-usage-ingest",
      cwd: appRoot,
      script: "scripts/usage-ingest.mjs",
      env: {
        AXEL_API_URL: axelApiUrl,
        AXEL_USER_ID: axelUserId,
        DATA_DIR: dataDir,
      },
      // Run daily at 2:00 AM
      cron_restart: "0 2 * * *",
      autorestart: false,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: path.join(logsDir, "usage-ingest.log"),
      error_file: path.join(logsDir, "usage-ingest-err.log"),
    },
    {
      name: "mem-bridge",
      cwd: appRoot,
      script: "scripts/mem-bridge.mjs",
      env: {
        CLAUDE_MEM_URL: claudeMemUrl,
        AXEL_API_URL: axelApiUrl,
        AXEL_USER_ID: axelUserId,
        MIN_CONTENT_LENGTH: minContentLength,
        POST_DELAY_MS: postDelayMs,
      },
      // Run daily at 2:30 AM - after usage-ingest has finished
      cron_restart: "30 2 * * *",
      autorestart: false,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: path.join(logsDir, "mem-bridge.log"),
      error_file: path.join(logsDir, "mem-bridge-err.log"),
    },
  ],
};
