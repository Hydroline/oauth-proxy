export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);

    if (request.method !== "POST" || urlObj.pathname !== "/") {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 404,
          error: "Not Found",
          bodyType: "text",
          body: "Not Found",
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 400,
          error: "Invalid JSON body",
          bodyType: "text",
          body: "Invalid JSON body",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const PROXY_KEY = env.OAUTH_PROXY_KEY || env.PROXY_KEY || "";
    const { key: clientKey } = payload || {};
    const normalizedProxyKey =
      typeof PROXY_KEY === "string" ? PROXY_KEY.trim() : PROXY_KEY;
    const normalizedClientKey =
      typeof clientKey === "string" ? clientKey.trim() : clientKey;

    const keysMatch = normalizedProxyKey && normalizedClientKey === normalizedProxyKey;
    if (!keysMatch) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 401,
          error: "Invalid proxy key",
          bodyType: "text",
          body: "Invalid proxy key",
          receivedKey: clientKey ?? null,
          normalizedClientKey: normalizedClientKey ?? null,
          serverKey: PROXY_KEY ?? null,
          normalizedServerKey: normalizedProxyKey ?? null,
          keysMatch
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }

    const { url, method = "GET", headers = {}, bodyType, body } = payload || {};

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 400,
          error: "Invalid url",
          bodyType: "text",
          body: "Invalid url",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const fetchInit = { method, headers: new Headers(headers) };
    if (body != null) {
      fetchInit.body = body;
    }

    let upstreamResp;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      upstreamResp = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch (err) {
      const message =
        err.name === "AbortError"
          ? "Upstream request timeout"
          : `Upstream request failed: ${err.message}`;
      return new Response(
        JSON.stringify({
          ok: false,
          status: 500,
          error: message,
          bodyType: "text",
          body: message,
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    const status = upstreamResp.status;
    const ok = upstreamResp.ok;
    const contentType = upstreamResp.headers.get("content-type") || "";

    let proxyBodyType = "text";
    let proxyBody;

    try {
      if (contentType.includes("application/json")) {
        const text = await upstreamResp.text();
        proxyBodyType = "json";
        proxyBody = text;
      } else if (contentType.startsWith("text/")) {
        proxyBodyType = "text";
        proxyBody = await upstreamResp.text();
      } else {
        const arrayBuffer = await upstreamResp.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        proxyBodyType = "binary";
        proxyBody = btoa(binary);
      }
    } catch (err) {
      const message = `Failed to read upstream response: ${err.message}`;
      return new Response(
        JSON.stringify({
          ok: false,
          status: 502,
          error: message,
          bodyType: "text",
          body: message,
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const headersObj = {};
    upstreamResp.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        [
          "content-type",
          "cache-control",
          "etag",
          "expires",
          "last-modified",
        ].includes(lower)
      ) {
        headersObj[lower] = value;
      }
    });

    return new Response(
      JSON.stringify({
        ok,
        status,
        headers: headersObj,
        bodyType: proxyBodyType,
        body: proxyBody,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  },
};
