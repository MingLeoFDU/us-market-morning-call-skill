#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

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

async function tenantAccessToken() {
  const appId = required(env("FEISHU_APP_ID"), "FEISHU_APP_ID");
  const appSecret = required(env("FEISHU_APP_SECRET"), "FEISHU_APP_SECRET");
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Feishu tenant token failed: ${JSON.stringify(json)}`);
  return json.tenant_access_token;
}

async function uploadFile(token, filePath) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file_type", "pdf");
  form.append("file_name", path.basename(filePath));
  form.append("file", new Blob([bytes], { type: "application/pdf" }), path.basename(filePath));
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Feishu file upload failed: ${JSON.stringify(json)}`);
  return json.data.file_key;
}

async function sendFileMessage(token, fileKey) {
  const receiveId = required(env("FEISHU_RECEIVE_ID"), "FEISHU_RECEIVE_ID");
  const receiveIdType = env("FEISHU_RECEIVE_ID_TYPE", "chat_id");
  const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Feishu message send failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const file = path.resolve(required(arg("file"), "--file"));
  if (!fs.existsSync(file)) throw new Error(`PDF does not exist: ${file}`);
  const token = await tenantAccessToken();
  const fileKey = await uploadFile(token, file);
  const message = await sendFileMessage(token, fileKey);
  console.log(JSON.stringify({ ok: true, file, file_key: fileKey, message_id: message.message_id }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
