#!/usr/bin/env node

const baseUrl = process.env.ORCAFLOW_BASE_URL || "http://127.0.0.1:20128";

async function check(label, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
  });

  return {
    label,
    path,
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
  };
}

async function main() {
  const checks = await Promise.all([
    check("version", "/api/version"),
    check("login", "/login"),
    check("dashboard", "/dashboard"),
    check("usage", "/dashboard/usage"),
    check("usage-stats", "/api/usage/stats?period=7d"),
    check("usage-stream", "/api/usage/stream"),
  ]);

  const failures = [];

  for (const result of checks) {
    console.log(
      `${result.label}: status=${result.status}` +
      (result.location ? ` location=${result.location}` : "") +
      (result.contentType ? ` type=${result.contentType}` : ""),
    );

    if (result.label === "version" && result.status !== 200) failures.push(result);
    if (result.label === "login" && result.status !== 200) failures.push(result);
    if (result.label === "dashboard" && result.status !== 307) failures.push(result);
    if (result.label === "usage" && result.status !== 307) failures.push(result);
    if (result.label === "usage-stats" && result.status !== 200) failures.push(result);
    if (result.label === "usage-stream" && result.status !== 200) failures.push(result);
  }

  if (failures.length > 0) {
    console.error(`dashboard health failed (${failures.length} checks)`);
    process.exit(1);
  }

  console.log("dashboard health ok");
}

main().catch((error) => {
  console.error(`dashboard health error: ${error.message}`);
  process.exit(1);
});
