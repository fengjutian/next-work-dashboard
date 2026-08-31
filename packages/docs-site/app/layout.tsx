import type { Metadata } from 'next'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import 'nextra-theme-docs/style.css'
import './styles.css'

export const metadata: Metadata = {
  title: {
    default: 'Next Work Dashboard',
    template: '%s – Next Work Dashboard'
  },
  description: 'Next Work Dashboard 的产品、插件与开发文档。',
  metadataBase: new URL('https://next-work-dashboard.netlify.app')
}

const banner = (
  <Banner storageKey="nwd-docs-banner">
    文档站已支持 Netlify 持续部署
  </Banner>
)

const navbar = (
  <Navbar
    logo={
      <span className="brand">
        <span className="brandMark">N</span>
        <strong>Next Work Dashboard</strong>
      </span>
    }
    projectLink="https://github.com/"
  />
)

const footer = (
  <Footer>
    <span>© {new Date().getFullYear()} Next Work Dashboard</span>
  </Footer>
)

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/your-org/next-work-dashboard/tree/main/packages/docs-site"
          footer={footer}
          feedback={{ content: '有问题？提交反馈' }}
          editLink="在 GitHub 上编辑此页"
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
          toc={{ title: '本页目录', backToTop: '返回顶部' }}
          navigation={{ prev: true, next: true }}
          search={null}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
