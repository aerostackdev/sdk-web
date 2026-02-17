# @aerostack/sdk-web Examples

This directory contains example scripts demonstrating how to use the @aerostack/sdk-web SDK.

## Prerequisites

- Node.js (v18 or higher)
- npm

## Setup

1. Copy `.env.template` to `.env`:
   ```bash
   cp .env.template .env
   ```

2. Edit `.env` and add your actual credentials

## Available Examples

| Example | Description |
|---------|-------------|
| [**Vanilla JS Auth**](./vanilla-js-auth.html) | Simple HTML/JS page with login flow. |
| [**SPA Routing**](./spa-routing.html) | Client-side routing with protected pages. |
| [**AI Chat**](./aiAIChat.example.ts) | Generated AI chat example. |
| [**Database Query**](./databaseDbQuery.example.ts) | Generated DB query example. |

## Running the Examples

To run an example file from the examples directory:

```bash
npm run build && npx tsx example.ts
```

## Creating new examples

Duplicate an existing example file, they won't be overwritten by the generation process.


