# @marko/run + Rspack Example

A basic example of using `@marko/run` with `@markopack/rspack`.

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/routes/
├── +page.marko
├── about/+page.marko
├── guides/getting-started/+page.marko
├── guides/advanced/performance/+page.marko
├── _marketing.contact/+page.marko
├── blog/$slug/+handler.ts
├── products/$category/$id/+handler.ts
├── docs/$$rest/+handler.ts
└── api/users/+handler.ts
```

## Key Differences from Vite

This example uses rspack instead of Vite:

- **Build Tool**: Rspack instead of Rollup (Vite)
- **Integration**: `@markopack/rspack` instead of `@marko/run/vite`
- **Programmatic API**: `build()` and `dev()` functions instead of vite config plugin

## Features Demonstrated

- Multi-page static routes
- Nested static routes
- Dynamic segments (`$param`)
- Catch-all segment (`$$rest`)
- Pathless grouping (`_segment`)
- API-style handler routes
- Node.js adapter
- Hot reload
- Production builds

## Learn More

- [@marko/run documentation](https://github.com/marko-js/run)
- [Rspack documentation](https://rspack.rs/)
- [Marko documentation](https://markojs.com/)
