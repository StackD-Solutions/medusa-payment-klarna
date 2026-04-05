<!--suppress HtmlDeprecatedAttribute -->
<h1 align="center">
  <br>
  <a href="https://www.stackd-solutions.io"><img src="https://raw.githubusercontent.com/StackD-Solutions/medusa-payment-klarna/main/docs/logo.svg" alt="StackD Solutions" width="250"></a>
  <br>Medusa Klarna Payment Provider
  <br>
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@stackd-solutions/medusa-payment-klarna"><img src="https://img.shields.io/npm/v/@stackd-solutions/medusa-payment-klarna" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@stackd-solutions/medusa-payment-klarna"><img src="https://img.shields.io/npm/dm/@stackd-solutions/medusa-payment-klarna" alt="npm downloads"></a>
  <img src="https://img.shields.io/npm/l/@stackd-solutions/medusa-payment-klarna" alt="Apache License">
  <img src="https://img.shields.io/npm/types/@stackd-solutions/medusa-payment-klarna" alt="Types Included">
</p>

A [Medusa v2](https://medusajs.com/) payment provider that integrates [Klarna](https://www.klarna.com/) as a payment option. Supports Klarna's Hosted Payment Page (HPP) flow, direct authorization, fraud detection webhooks, and multiple regions (EU, NA, Oceania).

## Features

- Full payment lifecycle: initiate, authorize, capture, refund, cancel
- Klarna Hosted Payment Page (HPP) integration
- Direct authorization token flow
- Fraud detection webhook handling (accepted, rejected, stopped)
- Multi-region support (EU, NA, Oceania)
- Playground and live environments
- Automatic retry with exponential backoff on server errors
- Idempotent capture and refund operations
- Zero-decimal currency support (JPY, KRW, etc.)
- Custom line item support with tax handling

## Installation

```bash
yarn add @stackd-solutions/medusa-payment-klarna
```

## Configuration

Register the module in your `medusa-config.ts`:

```typescript
import {defineConfig} from '@medusajs/framework/utils'

export default defineConfig({
  // ... other config
  modules: [
    {
      resolve: '@stackd-solutions/medusa-payment-klarna/modules/payment-klarna',
      options: {
        apiKey: 'your-klarna-api-key',
        environment: 'playground',
        region: 'eu',
        defaultCountry: 'NL',
        defaultLocale: 'nl-NL',
        storefrontUrl: 'https://shop.example.com',
      }
    }
  ]
})
```

### Module Options

| Option           | Type                           | Required | Default                          | Description                                         |
| ---------------- | ------------------------------ | -------- | -------------------------------- | --------------------------------------------------- |
| `apiKey`         | `string`                       | Yes      | --                               | Base64-encoded or raw `username:password` API key    |
| `environment`    | `'playground'` \| `'live'`     | Yes      | --                               | Klarna API environment                              |
| `region`         | `'eu'` \| `'na'` \| `'oc'`    | Yes      | --                               | Geographic region for API endpoints                 |
| `defaultCountry` | `string`                       | Yes      | --                               | 2-letter ISO country code (e.g. `"NL"`, `"SE"`)    |
| `defaultLocale`  | `string`                       | Yes      | --                               | RFC 1766 locale code (e.g. `"nl-NL"`, `"en-US"`)   |
| `storefrontUrl`  | `string`                       | Yes      | --                               | Base URL of your storefront                         |
| `callbackPath`   | `string`                       | No       | `/{language}/order/callback/klarna` | Path for payment completion callback             |
| `checkoutPath`   | `string`                       | No       | `/{language}/checkout`           | Path for cancellation redirect                      |

### API Key Format

The `apiKey` option accepts either:

- A Base64-encoded string (e.g. `"dXNlcm5hbWU6cGFzc3dvcmQ="`)
- A raw `username:password` string (e.g. `"K12345_abcdef:secretkey"`) which will be Base64-encoded automatically

## Payment Flow

1. **Initiate** -- Creates a Klarna payment session and HPP session. Returns `client_token` and `hpp_redirect_url` in the session data.
2. **Authorize** -- Processes authorization via HPP completion or a direct `authorization_token`. Creates the Klarna order.
3. **Capture** -- Captures the authorized payment amount (idempotent).
4. **Refund** -- Issues a refund for the specified amount (idempotent).
5. **Cancel** -- Cancels the payment and deletes the authorization.

### Fraud Detection

Klarna performs asynchronous fraud checks. The provider handles fraud webhooks automatically:

- `FRAUD_RISK_ACCEPTED` -- Payment is authorized
- `FRAUD_RISK_REJECTED` -- Payment is cancelled
- `FRAUD_RISK_STOPPED` -- Payment requires manual review

## Line Items

Pass custom line items via `data.line_items` when initiating or updating a payment:

```typescript
const lineItems: Array<KlarnaLineItemInput> = [
  {
    name: 'Product Name',
    quantity: 2,
    unit_price: 1999,      // in minor units (cents)
    tax_rate: 2100,         // 21.00% in basis points
    reference: 'SKU-001',  // optional
    type: 'physical',      // optional
  },
  {
    name: 'Shipping',
    quantity: 1,
    unit_price: 499,
    tax_rate: 2100,
    type: 'shipping_fee',
  }
]
```

## Build

```bash
yarn build
```

## Development

```bash
yarn dev
```

## Types

```typescript
import type {
  KlarnaOptions,
  KlarnaLineItemInput,
  KlarnaSessionData,
  KlarnaPaymentData,
  KlarnaOrderLine,
  KlarnaPaymentMethodCategory,
  KlarnaOrderResponse,
  KlarnaOrderDetails,
} from '@stackd-solutions/medusa-payment-klarna'

import {
  KlarnaApiError,
  KlarnaFraudStatus,
  KlarnaOrderStatus,
  KlarnaHppSessionStatus,
  KlarnaWebhookEvent,
} from '@stackd-solutions/medusa-payment-klarna'
```

## License

Apache 2.0
