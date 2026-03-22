# OrcaFlow Test Suite

Root-level `pnpm` scripts now own test execution for the repository.

## Setup

```bash
pnpm install --frozen-lockfile
```

## Running Tests

```bash
pnpm test
pnpm test:edge
pnpm test:e2e
```

## Test Files

| File                            | What it tests                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `unit/embeddingsCore.test.js`   | `open-sse/handlers/embeddingsCore.js` - core logic: body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.js` | `cloud/src/handlers/embeddings.js` - cloud worker handler: auth, validation, rate limits, CORS      |

## Coverage Summary

### `embeddingsCore.test.js`

- `buildEmbeddingsBody`: single string, array, encoding_format, default float
- `buildEmbeddingsUrl`: openai, openrouter, openai-compatible-\*, unsupported providers
- `buildEmbeddingsHeaders`: per-provider header sets, fallback to accessToken
- `handleEmbeddingsCore` input validation: missing, wrong type, null, empty
- `handleEmbeddingsCore` success: response format, CORS, Content-Type, callbacks
- `handleEmbeddingsCore` errors: 400/429/500, network error, invalid JSON
- `handleEmbeddingsCore` token refresh: 401 retry, graceful fallback

### `embeddings.cloud.test.js`

- CORS OPTIONS: 200 response, empty body, correct headers
- Authentication: missing key, bad format, old-format key, wrong key value, valid key
- Body validation: invalid JSON, missing model, missing input, bad model
- Happy path: single string, array, correct delegation, CORS header, machineId override
- Rate limiting: all accounts rate-limited -> 503 with Retry-After, no credentials -> 400
- Error propagation: non-fallback errors passed through, 429 exhausts accounts
- machineId override: validates key, rejects wrong key
