# @statvisor/sdk

Official SDK for [Statvisor](https://statvisor.com) — backend API monitoring and frontend performance analytics.

## Installation

```bash
npm install @statvisor/sdk
# or
yarn add @statvisor/sdk
# or
pnpm add @statvisor/sdk
```

## Quick Start

1. Create a free account at [statvisor.com](https://statvisor.com)
2. Create a project and copy your API key
3. Add the middleware to your app

```ts
import * as statvisor from '@statvisor/sdk';

app.use(statvisor.express({ apiKey: process.env.STATVISOR_API_KEY! }));
```

For full setup guides (Express, Fastify, Hono, Next.js, Cloudflare Workers, and frontend analytics), visit the **[docs at statvisor.com](https://statvisor.com/docs)**.

## License

MIT
