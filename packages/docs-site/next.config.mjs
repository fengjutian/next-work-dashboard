import nextra from 'nextra'
import { fileURLToPath } from 'node:url'

const withNextra = nextra({
  defaultShowCopyCode: true
})

export default withNextra({
  output: 'export',
  trailingSlash: true,
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolveAlias: {
      'next-mdx-import-source-file': './mdx-components.tsx'
    }
  },
  images: {
    unoptimized: true
  }
})
