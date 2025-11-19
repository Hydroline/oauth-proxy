import express from 'express';
import fetch, { Headers } from 'node-fetch';

const app = express();

app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 9000;
const PROXY_KEY = process.env.OAUTH_PROXY_KEY || process.env.PROXY_KEY || '';

function pickResponseHeaders(originalHeaders) {
  const allowed = ['content-type', 'cache-control', 'etag', 'expires', 'last-modified'];
  const result = {};
  for (const [key, value] of Object.entries(originalHeaders)) {
    const lower = key.toLowerCase();
    if (allowed.includes(lower)) {
      result[lower] = value;
    }
  }
  return result;
}

app.post('/', async (req, res) => {
  const clientKey = req.header('x-proxy-key');
  if (!PROXY_KEY || clientKey !== PROXY_KEY) {
    return res.status(401).json({
      ok: false,
      status: 401,
      error: 'Invalid proxy key',
      bodyType: 'text',
      body: 'Invalid proxy key'
    });
  }

  const { url, method = 'GET', headers = {}, bodyType, body } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      ok: false,
      status: 400,
      error: 'Invalid url',
      bodyType: 'text',
      body: 'Invalid url'
    });
  }

  const fetchOptions = { method, headers: new Headers(headers) };

  if (body != null) {
    if (bodyType === 'form' || bodyType === 'raw') {
      fetchOptions.body = body;
    } else {
      fetchOptions.body = body;
    }
  }

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });

    clearTimeout(timeout);
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Upstream request timeout' : `Upstream request failed: ${err.message}`;
    return res.status(500).json({
      ok: false,
      status: 500,
      error: message,
      bodyType: 'text',
      body: message
    });
  }

  const status = response.status;
  const ok = response.ok;
  const contentType = response.headers.get('content-type') || '';

  let proxyBodyType = 'text';
  let proxyBody;

  try {
    if (contentType.includes('application/json')) {
      const text = await response.text();
      proxyBodyType = 'json';
      proxyBody = text;
    } else if (contentType.startsWith('text/')) {
      proxyBodyType = 'text';
      proxyBody = await response.text();
    } else {
      const buffer = await response.arrayBuffer();
      proxyBodyType = 'binary';
      proxyBody = Buffer.from(buffer).toString('base64');
    }
  } catch (err) {
    const message = `Failed to read upstream response: ${err.message}`;
    return res.status(502).json({
      ok: false,
      status: 502,
      error: message,
      bodyType: 'text',
      body: message
    });
  }

  const headersObj = {};
  response.headers.forEach((value, key) => {
    headersObj[key.toLowerCase()] = value;
  });

  const filteredHeaders = pickResponseHeaders(headersObj);

  return res.status(200).json({
    ok,
    status,
    headers: filteredHeaders,
    bodyType: proxyBodyType,
    body: proxyBody
  });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    status: 404,
    error: 'Not Found',
    bodyType: 'text',
    body: 'Not Found'
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`OAuth proxy listening on port ${PORT}`);
});

export default app;
