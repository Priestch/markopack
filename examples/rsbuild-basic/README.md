# @marko/run + Rsbuild Example

A basic example of using `@marko/run` with `@rs-marko-run/rsbuild`.

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
├── +page.marko          # Home page
└── +handler.ts          # Route handler
```

## Key Differences from Vite

This example uses Rsbuild instead of Vite:

- **Configuration**: `rsbuild.config.ts` instead of `vite.config.ts`
- **Build Tool**: Rspack (Rsbuild) instead of Rollup (Vite)
- **Plugin**: `@rs-marko-run/rsbuild` instead of `@marko/run/vite`

## Features Demonstrated

- ✓ Basic routing
- ✓ Rsbuild configuration
- ✓ Node.js adapter
- ✓ Hot Module Replacement (HMR)
- ✓ Production builds

## Learn More

- [@marko/run documentation](https://github.com/marko-js/run)
- [Rsbuild documentation](https://rsbuild.dev/)
- [Marko documentation](https://markojs.com/)
