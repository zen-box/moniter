/* Browser-only fixtures; no sign-in, Agent or database mutations. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("C:/Users/78646/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://127.0.0.1:8080";
const output = path.resolve(__dirname, "../../../.ui-review");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/78646/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
  const passed = [], errors = [];
  const timers = new Set();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", reducedMotion: "reduce" });
    await context.addInitScript(() => { localStorage.setItem("aegis_lang", "zh"); localStorage.setItem("aegis_theme", "light"); });
    const live = await context.newPage();
    live.on("pageerror", error => errors.push(error.message));
    const times = [];
    let liveReads = 0;
    live.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/servers") liveReads++; });
    live.on("websocket", socket => {
      if (new URL(socket.url()).pathname === "/ws/client") socket.on("framereceived", () => times.push(performance.now()));
    });
    await live.goto(origin, { waitUntil: "networkidle" });
    assert.equal(await live.locator(".mp-sync").count(), 0, "No connection badge should be displayed");
    await live.waitForTimeout(5300);
    assert.ok(times.length >= 5, "Actual server must push snapshots without a manual refresh");
    const intervals = times.slice(1).map((time, index) => Math.round(time - times[index]));
    assert.ok(intervals.every(ms => ms < 2000), "Local push intervals should follow the one-second broadcaster");
    assert.equal(liveReads, 1, "A healthy stream must stop periodic list polling");
    await live.screenshot({ path: path.join(output, "realtime-live-desktop.png") });
    passed.push("actual server pushes roughly once per second and stops five-second polling");
    await live.close();

    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    let snapshot = [{ id: "live-fixture", name: "Live regression", region: "sg", region_name: "新加坡", provider: "Fixture", status: "online", last_seen: Date.now(), os_name: "Debian 12", cpu_cores: 4, current_cpu: 11, mem_used_mb: 1024, mem_total_mb: 4096, disk_used_bytes: 1024 ** 3, disk_total_bytes: 10 * 1024 ** 3, net_in_speed_kb: 20, net_out_speed_kb: 30, billing_price: 0, billing_currency: "$", billing_cycle: "monthly", renewal_date: "", traffic_limit_gb: 0 }];
    const sockets = new Set();
    let blocked = false, httpReads = 0, holdNext = false, held = null, releaseHeld, connectedWaiter = null;
    const nextConnection = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { connectedWaiter = null; reject(new Error("Fixture stream did not reconnect")); }, 12000);
      connectedWaiter = () => { clearTimeout(timeout); resolve(); };
    });
    await page.route("**/api/v1/servers", async route => {
      httpReads++;
      if (holdNext) { holdNext = false; held = route; releaseHeld(); return; }
      await route.fulfill({ json: snapshot });
    });
    await page.route("**/api/v1/metrics/**", route => route.fulfill({ json: [] }));
    await page.route("**/api/v1/target_metrics/**", route => route.fulfill({ json: [] }));
    await page.routeWebSocket("**/ws/client", socket => {
      if (blocked) { socket.close({ code: 1013, reason: "Fixture unavailable" }); return; }
      sockets.add(socket);
      socket.send(JSON.stringify(snapshot));
      const connected = connectedWaiter; connectedWaiter = null; connected?.();
      const timer = setInterval(() => socket.send(JSON.stringify(snapshot)), 1000);
      timers.add(timer);
      socket.onClose(() => { clearInterval(timer); timers.delete(timer); sockets.delete(socket); });
    });
    const push = patch => {
      snapshot = snapshot.map(node => ({ ...node, ...patch, last_seen: Date.now() }));
      for (const socket of sockets) socket.send(JSON.stringify(snapshot));
    };
    const expectCpu = value => page.waitForFunction(value => document.querySelector(".mp-node .mp-resource strong")?.textContent === value, value);
    await page.goto(origin, { waitUntil: "networkidle" });
    await expectCpu("11.0%");
    push({ current_cpu: 31.5, status: "offline" });
    await page.locator(".mp-node-offline").waitFor();
    assert.equal(await page.locator(".mp-node .mp-resource strong").first().textContent(), "—");
    push({ current_cpu: 31.5, status: "online" });
    await expectCpu("31.5%");
    passed.push("pushed resource and online/offline transitions update cards immediately");

    const stale = snapshot.map(node => ({ ...node, current_cpu: 11 }));
    const heldReady = new Promise(resolve => { releaseHeld = resolve; });
    holdNext = true;
    await page.getByRole("button", { name: "刷新数据", exact: true }).click();
    await heldReady;
    push({ current_cpu: 47.3 });
    await expectCpu("47.3%");
    await held.fulfill({ json: stale });
    await page.waitForTimeout(200);
    await expectCpu("47.3%");
    passed.push("a delayed manual HTTP response cannot overwrite a newer WebSocket snapshot");

    await page.locator(".mp-node-link").click();
    await page.locator(".mp-detail").waitFor();
    push({ current_cpu: 61.7 });
    await page.waitForFunction(() => document.querySelector(".mp-detail")?.textContent.includes("61.7%"));
    assert.equal(await page.locator(".mp-browser-test").count(), 0);
    await page.getByRole("button", { name: "返回节点列表", exact: true }).click();
    await expectCpu("61.7%");
    passed.push("node details receive the same live data and the removed browser test stays absent");

    snapshot = snapshot.map(node => ({ ...node, current_cpu: 66 }));
    blocked = true;
    const readsBeforeLoss = httpReads;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const socket of sockets) socket.close({ code: 1012, reason: "Fixture reconnect" });
    sockets.clear();
    await expectCpu("66.0%");
    assert.equal(await page.locator(".mp-node").count(), 1);
    await page.waitForTimeout(5300);
    assert.ok(httpReads >= readsBeforeLoss + 2, "A disconnected stream must temporarily refresh by HTTP");
    assert.equal(await page.locator(".mp-sync").count(), 0);
    const reconnected = nextConnection();
    blocked = false;
    await reconnected;
    push({ current_cpu: 68.4 });
    await expectCpu("68.4%");
    passed.push("disconnects preserve data, use HTTP fallback and reconnect automatically");

    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
    const pausedReads = httpReads;
    await page.waitForTimeout(5300);
    assert.equal(httpReads, pausedReads);
    const resumed = nextConnection();
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
    await resumed;
    push({ current_cpu: 72.1 });
    await expectCpu("72.1%");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "realtime-fixture-mobile.png") });
    passed.push("visibility changes pause traffic and resume streaming without a page reload");
    await page.close();
    await context.close();
    assert.deepEqual(errors, []);
    const report = { status: "passed", checks: passed, actualServer: { frames: times.length, intervalsMs: intervals, listRequests: liveReads }, browserErrors: errors };
    fs.writeFileSync(path.join(output, "realtime-result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { for (const timer of timers) clearInterval(timer); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
