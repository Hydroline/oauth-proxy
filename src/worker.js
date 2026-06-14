const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const DEFAULT_TIMEOUT_MS = 15000;

const FORWARD_HEADER_DENYLIST = new Set([
  "host",
  "connection",
  "content-length",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-real-ip",
  "cookie",
  "set-cookie",
]);

const ROUTE_DEFINITIONS = [
  {
    host: "github.com",
    method: "POST",
    path: /^\/login\/oauth\/access_token$/,
    validateQuery: (urlObj) => urlObj.searchParams.size === 0,
  },
  {
    host: "api.github.com",
    method: "GET",
    path: /^\/user$/,
    validateQuery: (urlObj) => urlObj.searchParams.size === 0,
  },
  {
    host: "oauth2.googleapis.com",
    method: "POST",
    path: /^\/token$/,
    validateQuery: (urlObj) => urlObj.searchParams.size === 0,
  },
  {
    host: "www.googleapis.com",
    method: "GET",
    path: /^\/oauth2\/v3\/userinfo$/,
    validateQuery: (urlObj) => urlObj.searchParams.size === 0,
  },
];

const jsonResponse = (payload, status = 200) => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
};

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : value;

const normalizeMethod = (method) =>
  typeof method === "string" && method.trim()
    ? method.trim().toUpperCase()
    : "GET";

const normalizeUpstreamHeaders = (headers) => {
  const result = {};

  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return result;
  }

  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (typeof rawKey !== "string" || typeof rawValue !== "string") {
      continue;
    }

    const key = rawKey.trim().toLowerCase();
    if (!key || FORWARD_HEADER_DENYLIST.has(key)) {
      continue;
    }

    result[key] = rawValue;
  }

  return result;
};

const pickResponseHeaders = (headers) => {
  const keep = new Set([
    "content-type",
    "cache-control",
    "etag",
    "expires",
    "last-modified",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-resource",
    "x-ratelimit-used",
  ]);
  const result = {};

  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (keep.has(lower)) {
      result[lower] = value;
    }
  });

  return result;
};

const matchAllowedRoute = (urlObj, method) => {
  return ROUTE_DEFINITIONS.some((route) => {
    if (route.host !== urlObj.hostname) {
      return false;
    }

    if (route.method !== method) {
      return false;
    }

    if (!route.path.test(urlObj.pathname)) {
      return false;
    }

    return route.validateQuery(urlObj);
  });
};

const applyDefaultUpstreamHeaders = (targetUrl, headers) => {
  const normalizedHeaders = new Headers(headers);

  // GitHub REST API requires a User-Agent header even for simple OAuth userinfo probes.
  if (
    targetUrl.hostname === "api.github.com" &&
    !normalizedHeaders.has("user-agent")
  ) {
    normalizedHeaders.set("user-agent", "hydcraft-oauth-proxy");
  }

  return normalizedHeaders;
};

const buildUpstreamBody = (payload, method) => {
  if (method === "GET" || method === "HEAD" || payload.body == null) {
    return undefined;
  }

  if (payload.bodyType === "json") {
    return typeof payload.body === "string"
      ? payload.body
      : JSON.stringify(payload.body);
  }

  if (typeof payload.body === "string") {
    return payload.body;
  }

  return JSON.stringify(payload.body);
};

const toBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
};

const parseUpstreamResponse = async (upstreamResp) => {
  if (upstreamResp.status === 204 || upstreamResp.status === 304) {
    return { bodyType: "text", body: "" };
  }

  const contentType = (upstreamResp.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    return { bodyType: "json", body: await upstreamResp.text() };
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("application/xml")
  ) {
    return { bodyType: "text", body: await upstreamResp.text() };
  }

  return {
    bodyType: "binary",
    body: toBase64(await upstreamResp.arrayBuffer()),
  };
};

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);

    if (request.method !== "POST" || urlObj.pathname !== "/") {
      return jsonResponse(
        {
          ok: false,
          status: 404,
          error: "Not Found",
          bodyType: "text",
          body: "Not Found",
        },
        404
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return jsonResponse(
        {
          ok: false,
          status: 400,
          error: "Invalid JSON body",
          bodyType: "text",
          body: "Invalid JSON body",
        },
        400
      );
    }

    const PROXY_KEY = env.OAUTH_PROXY_KEY || env.PROXY_KEY || "";
    const { key: clientKey } = payload || {};
    const normalizedProxyKey = normalizeString(PROXY_KEY);
    const normalizedClientKey = normalizeString(clientKey);

    const keysMatch =
      normalizedProxyKey && normalizedClientKey === normalizedProxyKey;
    if (!keysMatch) {
      return jsonResponse(
        {
          ok: false,
          status: 401,
          error: "Invalid proxy key",
          bodyType: "text",
          body: "Invalid proxy key",
          receivedKey: clientKey ?? null,
        },
        401
      );
    }

    const { url, method = "GET", headers = {}, bodyType, body } = payload || {};

    if (!url || typeof url !== "string") {
      return jsonResponse(
        {
          ok: false,
          status: 400,
          error: "Invalid url",
          bodyType: "text",
          body: "Invalid url",
        },
        400
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return jsonResponse(
        {
          ok: false,
          status: 400,
          error: "Invalid url",
          bodyType: "text",
          body: "Invalid url",
        },
        400
      );
    }

    const upstreamMethod = normalizeMethod(method);
    if (targetUrl.protocol !== "https:" || !matchAllowedRoute(targetUrl, upstreamMethod)) {
      return jsonResponse(
        {
          ok: false,
          status: 403,
          error: "Target is not allowed",
          bodyType: "text",
          body: "Target is not allowed",
        },
        403
      );
    }

    const fetchInit = {
      method: upstreamMethod,
      headers: applyDefaultUpstreamHeaders(
        targetUrl,
        normalizeUpstreamHeaders(headers)
      ),
      body: buildUpstreamBody({ bodyType, body }, upstreamMethod),
    };

    if (fetchInit.body == null) {
      delete fetchInit.body;
    }

    let upstreamResp;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      upstreamResp = await fetch(targetUrl.toString(), {
        ...fetchInit,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const message =
        err.name === "AbortError"
          ? "Upstream request timeout"
          : `Upstream request failed: ${err.message}`;
      return jsonResponse(
        {
          ok: false,
          status: err.name === "AbortError" ? 504 : 502,
          error: message,
          bodyType: "text",
          body: message,
        },
        err.name === "AbortError" ? 504 : 502
      );
    }

    clearTimeout(timeoutId);

    const status = upstreamResp.status;
    const ok = upstreamResp.ok;
    let parsedResponse;

    try {
      parsedResponse = await parseUpstreamResponse(upstreamResp);
    } catch (err) {
      const message = `Failed to read upstream response: ${err.message}`;
      return jsonResponse(
        {
          ok: false,
          status: 502,
          error: message,
          bodyType: "text",
          body: message,
        },
        502
      );
    }

    return jsonResponse(
      {
        ok,
        status,
        headers: pickResponseHeaders(upstreamResp.headers),
        bodyType: parsedResponse.bodyType,
        body: parsedResponse.body,
      },
      200
    );
  },
};
