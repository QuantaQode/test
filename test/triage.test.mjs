import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTriageServer } from "../server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createTriageServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function triage(body, { raw } = {}) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test("корректная заявка про доставку возвращает ready с темой и черновиком", async () => {
  const { status, data } = await triage({ text: "Когда привезут заказ? Вопрос по доставке." });
  assert.equal(status, 200);
  assert.equal(data.status, "ready");
  assert.equal(data.topic, "delivery");
  assert.equal(typeof data.draft, "string");
  assert.notEqual(data.draft.trim(), "");
});

test("корректная заявка про цены возвращает topic pricing", async () => {
  const { status, data } = await triage({ text: "Какова стоимость подписки?" });
  assert.equal(status, 200);
  assert.equal(data.status, "ready");
  assert.equal(data.topic, "pricing");
});

test("[timeout]: модель не ответила за 300 мс — ручной разбор, ответ быстрый", async () => {
  const started = Date.now();
  const { status, data } = await triage({ text: "[timeout] где мой заказ?" });
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
  assert.ok(elapsed < 1_000, `ответ занял ${elapsed} мс, ожидалось меньше 1 с`);
});

test("[error]: ошибка модели — ручной разбор", async () => {
  const { status, data } = await triage({ text: "[error] привет" });
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
});

test("[bad-json]: ответ модели не JSON — ручной разбор", async () => {
  const { status, data } = await triage({ text: "[bad-json] привет" });
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
});

test("[bad-topic]: неподходящая тема — ручной разбор", async () => {
  const { status, data } = await triage({ text: "[bad-topic] верните деньги" });
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
});

test("[empty-draft]: пустой черновик — ручной разбор", async () => {
  const { status, data } = await triage({ text: "[empty-draft] привет" });
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
});

test("пустая строка текста — 400 invalid_input", async () => {
  const { status, data } = await triage({ text: "" });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("строка из пробелов — 400 invalid_input", async () => {
  const { status, data } = await triage({ text: "   " });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("отсутствует поле text — 400 invalid_input", async () => {
  const { status, data } = await triage({ message: "привет" });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("нестроковый text — 400 invalid_input", async () => {
  const { status, data } = await triage({ text: 123 });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("битый JSON — 400 invalid_input", async () => {
  const { status, data } = await triage(null, { raw: '{"text":' });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("JSON не объект — 400 invalid_input", async () => {
  const { status, data } = await triage(null, { raw: '["text"]' });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("неизвестный маршрут — 404 not_found", async () => {
  const response = await fetch(`${baseUrl}/api/unknown`, { method: "POST" });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { status: "not_found" });
});
