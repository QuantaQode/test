import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const MODEL_TIMEOUT_MS = 300;
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);

class ModelTimeoutError extends Error {
  constructor() {
    super(`Model did not respond within ${MODEL_TIMEOUT_MS} ms`);
    this.name = "ModelTimeoutError";
  }
}

class InvalidModelOutputError extends Error {
  constructor(reason) {
    super(`Invalid model output: ${reason}`);
    this.name = "InvalidModelOutputError";
  }
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequestBody(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { text } = payload;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

function classifyWithTimeout(text) {
  return Promise.race([
    classify(text),
    delay(MODEL_TIMEOUT_MS).then(() => {
      throw new ModelTimeoutError();
    }),
  ]);
}

function parseModelOutput(raw) {
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw new InvalidModelOutputError("not valid JSON");
  }
  if (typeof output !== "object" || output === null) {
    throw new InvalidModelOutputError("not an object");
  }
  if (!ALLOWED_TOPICS.has(output.topic)) {
    throw new InvalidModelOutputError(`unexpected topic: ${JSON.stringify(output.topic)}`);
  }
  if (typeof output.draft !== "string" || output.draft.trim() === "") {
    throw new InvalidModelOutputError("draft is not a non-empty string");
  }
  return { topic: output.topic, draft: output.draft };
}

async function handleTriage(request, response) {
  const text = parseRequestBody(await readBody(request));
  if (text === null) {
    return json(response, 400, { status: "invalid_input" });
  }

  try {
    const { topic, draft } = parseModelOutput(await classifyWithTimeout(text));
    return json(response, 200, { status: "ready", topic, draft });
  } catch {
    // Таймаут, ошибка модели или неподходящий ответ модели — ручной разбор.
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }
}

export function createTriageServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createTriageServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
