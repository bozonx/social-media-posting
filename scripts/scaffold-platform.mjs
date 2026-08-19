#!/usr/bin/env node
/**
 * Create a new platform package: manifest, capability descriptor, platform
 * skeleton, credential validator, and a spec already wired to the contract
 * suite.
 *
 * Usage: node scripts/scaffold-platform.mjs <network-name>
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: node scripts/scaffold-platform.mjs <network-name>');
  console.error('The name must be lower-case letters, digits and dashes, e.g. "mastodon".');
  process.exit(1);
}

const dir = join('packages', `platform-${name}`);
if (existsSync(dir)) {
  console.error(`${dir} already exists.`);
  process.exit(1);
}

const Pascal = name
  .split('-')
  .map(part => part[0].toUpperCase() + part.slice(1))
  .join('');
const Display = Pascal;

const files = {
  LICENSE: `MIT License

Copyright (c) 2026 Ivan K

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  'package.json': `{
  "name": "@bozonx/social-posting-${name}",
  "version": "2.0.0",
  "description": "${Display} platform for @bozonx/social-posting",
  "keywords": ["social-media", "posting", "${name}"],
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "workerd": "./dist/index.js",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf dist *.tsbuildinfo",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepack": "pnpm run build"
  },
  "dependencies": {},
  "peerDependencies": { "@bozonx/social-posting": "workspace:^" },
  "devDependencies": {
    "@bozonx/social-posting": "workspace:*",
    "@bozonx/social-posting-conformance": "workspace:*"
  },
  "publishConfig": { "access": "public", "provenance": true },
  "sideEffects": false,
  "author": "Ivan K",
  "license": "MIT",
  "engines": { "node": ">=24.0.0" }
}
`,

  'tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2023", "DOM"],
    "types": []
  },
  "include": ["src/**/*", "test/**/*"]
}
`,

  'tsconfig.build.json': `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "declarationMap": false
  },
  "include": ["src/**/*"]
}
`,

  'src/capabilities.ts': `import { PostType } from '@bozonx/social-posting';
import type { PlatformCapabilities } from '@bozonx/social-posting';

/**
 * What ${Display} accepts, stated as data.
 *
 * Fill every field from the network's own documentation. Where it documents no
 * limit, leave the field out rather than guessing: an invented limit rejects
 * posts the network would have accepted.
 */
export const ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities: PlatformCapabilities = {
  name: '${name}',
  displayName: '${Display}',

  supportedTypes: [PostType.AUTO, PostType.POST],

  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['cover', 'video', 'audio', 'document', 'media'],
    },
  },

  // maxBodyLength: 0,
  // bodyLengthRule: { urlWeight: 23 },
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',

  // These two decide whether this network works on Workers. State both.
  supportsUrlPassthrough: false,
  requiresByteUpload: true,

  supportsNativeScheduling: false,
  supportsDraft: false,

  // Fields the request shape accepts that this network has nowhere to put.
  ignoredFields: [],
};
`,

  'src/index.ts': `/**
 * \`@bozonx/social-posting-${name}\` — ${Display} support for \`@bozonx/social-posting\`.
 */
import type { PlatformModule } from '@bozonx/social-posting';
import { ${Pascal}Platform } from './${name}.platform.js';
import { ${Pascal}AuthValidator } from './${name}-auth.validator.js';
import { ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities } from './capabilities.js';

/** The descriptor a host registers to publish to ${Display}. */
export const ${name.replace(/-./g, m => m[1].toUpperCase())}: PlatformModule = {
  name: '${name}',
  capabilities: ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities,
  create: deps => new ${Pascal}Platform(deps),
  authValidator: new ${Pascal}AuthValidator(),
};

export { ${Pascal}Platform } from './${name}.platform.js';
export { ${Pascal}AuthValidator } from './${name}-auth.validator.js';
export { ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities } from './capabilities.js';
`,

  [`src/${name}-auth.validator.ts`]: `import type { AuthValidation, IAuthValidator } from '@bozonx/social-posting';

/**
 * Validates the shape of ${Display} credentials.
 *
 * Return \`code: ErrorCode.AUTH_REFRESH_REQUIRED\` for credentials that are
 * well-formed but spent, so the host re-authorizes instead of retrying forever.
 */
export class ${Pascal}AuthValidator implements IAuthValidator {
  readonly providerName = '${name}';

  validate(auth: Record<string, unknown>): AuthValidation {
    const errors: string[] = [];

    if (typeof auth.accessToken !== 'string' || auth.accessToken.length === 0) {
      errors.push("Field 'accessToken' is required for ${Display} auth");
    }

    return { errors };
  }
}
`,

  [`src/${name}.platform.ts`]: `import {
  ErrorCode,
  PlatformError,
  ValidationError,
  httpRequest,
  validateAgainstCapabilities,
} from '@bozonx/social-posting';
import type {
  CapabilityValidationOptions,
  ILogger,
  IPlatform,
  PlatformPublishResponse,
  PostRequest,
  PostType,
  PublishOptions,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import { ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities } from './capabilities.js';

/** Collaborators this platform needs, passed explicitly. */
export interface ${Pascal}PlatformDeps {
  logger: ILogger;
}

const LOG_CONTEXT = '${Pascal}Platform';

export class ${Pascal}Platform implements IPlatform {
  readonly name = '${name}';
  readonly capabilities = ${name.replace(/-./g, m => m[1].toUpperCase())}Capabilities;

  private readonly logger: ILogger;

  constructor(deps: ${Pascal}PlatformDeps) {
    this.logger = deps.logger;
  }

  async publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const { errors } = validateAgainstCapabilities(
      request,
      this.capabilities,
      this.validationHooks(accountConfig),
    );
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    // TODO: call the ${Display} API. Use httpRequest() so a connection that
    // dies before the request completes is retried once, and nothing else is.
    const response = await httpRequest('https://api.${name}.example/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: \`Bearer \${String(accountConfig.auth.accessToken)}\`,
      },
      body: JSON.stringify({ text: request.body }),
      signal,
    });

    if (!response.ok) {
      throw this.toPlatformError(response, await response.text());
    }

    const created = (await response.json()) as { id: string; url?: string };
    this.logger.log(\`Published \${created.id}\`, LOG_CONTEXT);

    return { status: 'published', postId: created.id, url: created.url };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(
    _request: PostRequest,
    _accountConfig: ResolvedAccountConfig,
    _type: PostType,
  ): string[] {
    return [];
  }

  private validationHooks(accountConfig: ResolvedAccountConfig): CapabilityValidationOptions {
    return {
      validateExtra: (request, type) => this.validateExtra(request, accountConfig, type),
    };
  }

  /**
   * Classify a ${Display} failure once, here, so the core never has to.
   *
   * Carry \`retryAfterMs\` whenever the network states a cool-down: it is what
   * lets the host back off correctly instead of guessing.
   */
  private toPlatformError(response: Response, body: string): PlatformError {
    const retryAfter = Number(response.headers.get('retry-after'));

    if (response.status === 429) {
      return new PlatformError(\`${Display} rate limited: \${body}\`, ErrorCode.RATE_LIMIT_ERROR, {
        retryable: true,
        retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        httpStatus: response.status,
      });
    }

    if (response.status === 401 || response.status === 403) {
      return new PlatformError(\`${Display} rejected the credentials: \${body}\`, ErrorCode.AUTH_ERROR, {
        retryable: false,
        httpStatus: response.status,
      });
    }

    return new PlatformError(\`${Display} responded with \${response.status}: \${body}\`,
      response.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.VALIDATION_ERROR,
      { retryable: response.status >= 500, httpStatus: response.status },
    );
  }
}
`,

  'test/fixtures/errors.json': `{
  "$comment": "Responses recorded from the real ${Display} API. Record the failures too — those are the paths that break in production.",
  "rateLimited": { "status": 429, "headers": { "retry-after": "30" }, "body": {} },
  "unauthorized": { "status": 401, "body": {} },
  "serverError": { "status": 503, "body": {} }
}
`,

  'test/contract.spec.ts': `import { vi } from 'vitest';
import { ErrorCode, PostType } from '@bozonx/social-posting';
import { describePlatformContract } from '@bozonx/social-posting-conformance';
import type { ContractHarness, RecordedResponse } from '@bozonx/social-posting-conformance';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { ${name.replace(/-./g, m => m[1].toUpperCase())} } from '../src/index.js';
import errors from './fixtures/errors.json' with { type: 'json' };

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

const accountConfig: ResolvedAccountConfig = {
  platform: '${name}',
  source: 'account',
  auth: { accessToken: 'test-token' },
};

function createHarness(): ContractHarness {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  const respond = (body: () => Response) => {
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(body());
    }) as unknown as typeof fetch;
  };

  return {
    platform: ${name.replace(/-./g, m => m[1].toUpperCase())}.create({ logger: silentLogger }),
    accountConfig,

    respondSuccess() {
      respond(
        () =>
          new Response(JSON.stringify({ id: '1', url: 'https://${name}.example/1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
    },

    respondWith(recorded: RecordedResponse) {
      respond(
        () =>
          new Response(JSON.stringify(recorded.body ?? {}), {
            status: recorded.status,
            headers: { 'content-type': 'application/json', ...recorded.headers },
          }),
      );
    },

    respondNever() {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }) as unknown as typeof fetch;
    },

    callCount: () => calls,

    restore() {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    },
  };
}

describePlatformContract({
  module: ${name.replace(/-./g, m => m[1].toUpperCase())},
  createHarness,

  requests: {
    [PostType.POST]: { platform: '${name}', account: 'main', body: 'Contract suite post', type: PostType.POST },
  },

  errorCases: [
    {
      name: 'a rate limit with retry-after',
      response: errors.rateLimited as RecordedResponse,
      expect: {
        code: ErrorCode.RATE_LIMIT_ERROR,
        retryable: true,
        retryAfterMs: 30_000,
        httpStatus: 429,
      },
    },
    {
      name: 'rejected credentials',
      response: errors.unauthorized as RecordedResponse,
      expect: { code: ErrorCode.AUTH_ERROR, retryable: false, httpStatus: 401 },
    },
    {
      name: 'an outage',
      response: errors.serverError as RecordedResponse,
      expect: { code: ErrorCode.PLATFORM_ERROR, retryable: true, httpStatus: 503 },
    },
  ],
});
`,

  'README.md': `# @bozonx/social-posting-${name}

${Display} support for [\`@bozonx/social-posting\`](https://github.com/bozonx/social-media-posting).

\`\`\`ts
import { createPostingClient } from '@bozonx/social-posting';
import { ${name.replace(/-./g, m => m[1].toUpperCase())} } from '@bozonx/social-posting-${name}';

const client = createPostingClient({
  accounts: { main: { platform: '${name}', auth: { accessToken: '…' } } },
  platforms: [${name.replace(/-./g, m => m[1].toUpperCase())}],
});
\`\`\`

## Status

Scaffolded, not implemented. Before this ships:

- [ ] Fill \`src/capabilities.ts\` from the network's documentation.
- [ ] Implement \`publish()\` against the real API.
- [ ] Record real responses into \`test/fixtures/\`, failures included.
- [ ] Make the contract suite pass on Node and under \`workerd\`.
- [ ] Add a row to \`docs/DELIVERY-SEMANTICS.md\` for this network.
- [ ] Add a row to the support table in the root README.
`,
};

for (const [path, contents] of Object.entries(files)) {
  const target = join(dir, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

console.log(`Scaffolded ${dir}

Next:
  1. pnpm install
  2. Fill in src/capabilities.ts from ${Display}'s documentation
  3. Implement publish() in src/${name}.platform.ts
  4. Record real API responses into test/fixtures/
  5. pnpm test && pnpm test:workerd

Read CONTRIBUTING-PLATFORMS.md before starting.`);
