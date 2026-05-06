#!/usr/bin/env node

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

async function main() {
  const webhook = required(env("FEISHU_WEBHOOK_URL"), "FEISHU_WEBHOOK_URL");
  const pdf = arg("pdf", "US_Market_Morning_Call.pdf");
  const runUrl = env("GITHUB_SERVER_URL") && env("GITHUB_REPOSITORY") && env("GITHUB_RUN_ID")
    ? `${env("GITHUB_SERVER_URL")}/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}`
    : "";
  const text = [
    "US Market Morning Call PDF is ready.",
    `PDF: ${pdf}`,
    runUrl ? `Download from GitHub Actions artifact: ${runUrl}` : "Open the generated output folder to get the PDF.",
  ].join("\n");
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Feishu webhook failed: ${res.status} ${body}`);
  console.log(body);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
