import { existsSync } from 'node:fs'
import os from 'node:os'
import { join } from 'pathe'
import type { Nuxt } from 'nuxt/schema'
import { addPlugin, addTemplate, addVitePlugin, logger } from '@nuxt/kit'
import type { ViteDevServer } from 'vite'
import { searchForWorkspaceRoot } from 'vite'
import sirv from 'sirv'
import { colors } from 'consola/utils'
import { version } from '../package.json'
import type { ModuleOptions, NuxtDevToolsOptions } from './types'
import { setupRPC } from './server-rpc'
import { clientDir, isGlobalInstall, packageDir, runtimeDir } from './dirs'
import { ROUTE_ANALYZE, ROUTE_AUTH, ROUTE_AUTH_VERIFY, ROUTE_CLIENT, defaultTabOptions } from './constant'
import { getDevAuthToken } from './dev-auth'
import { readLocalOptions } from './utils/local-options'

export async function enableModule(options: ModuleOptions, nuxt: Nuxt) {
  // Disable in test mode
  if (process.env.TEST || process.env.NODE_ENV === 'test')
    return

  if (nuxt.options.builder !== '@nuxt/vite-builder') {
    logger.warn('Nuxt DevTools only supports Vite mode, module is disabled.')
    return
  }

  if (!nuxt.options.dev) {
    if (nuxt.options.build.analyze)
      await import('./integrations/analyze-build').then(({ setup }) => setup(nuxt, options))
    return
  }

  // Determine if user aware devtools, by checking the presentation in the config
  const enabledExplicitly = (nuxt.options.devtools === true)
    || (nuxt.options.devtools && nuxt.options.devtools.enabled)
    || !!nuxt.options.modules.find(m => m === '@nuxt/devtools' || m === '@nuxt/devtools-edge')

  await nuxt.callHook('devtools:before')

  // Make unimport exposing more information, like the usage of each auto imported function
  nuxt.options.imports.collectMeta = true

  addPlugin({
    src: join(runtimeDir, 'plugins/devtools.client'),
    mode: 'client',
  })

  addPlugin({
    src: join(runtimeDir, 'plugins/devtools.server'),
    mode: 'server',
  })

  // Mainly for the injected runtime plugin to access the settings
  // Usage `import settings from '#build/devtools/settings'`
  addTemplate({
    filename: 'devtools/settings.mjs',
    async getContents() {
      const uiOptions = await readLocalOptions<NuxtDevToolsOptions['ui']>(
        {
          ...defaultTabOptions.ui,
          // When not enabled explicitly, we hide the panel by default
          showPanel: enabledExplicitly ? true : null,
        },
        { root: nuxt.options.rootDir },
      )
      return `export default ${JSON.stringify({
        ui: uiOptions,
      })}`
    },
  })

  // Inject inline script
  nuxt.hook('nitro:config', (config) => {
    config.externals = config.externals || {}
    config.externals.inline = config.externals.inline || []
    config.externals.inline.push(join(runtimeDir, 'nitro'))
    config.virtual = config.virtual || {}
    config.virtual['#nuxt-devtools-inline'] = `export const script = \`
if (!window.__NUXT_DEVTOOLS_TIME_METRIC__) {
  Object.defineProperty(window, '__NUXT_DEVTOOLS_TIME_METRIC__', {
    value: {},
    enumerable: false,
    configurable: true,
  })
}
window.__NUXT_DEVTOOLS_TIME_METRIC__.appInit = Date.now()
\``
    config.plugins = config.plugins || []
    config.plugins.unshift(join(runtimeDir, 'nitro/inline'))
  })

  const {
    vitePlugin,
    ...ctx
  } = setupRPC(nuxt, options)

  addVitePlugin(vitePlugin)

  const clientDirExists = existsSync(clientDir)
  const analyzeDir = join(nuxt.options.rootDir, '.nuxt/analyze')

  nuxt.hook('vite:extendConfig', (config) => {
    config.server ||= {}
    config.server.fs ||= {}
    config.server.fs.allow ||= [
      searchForWorkspaceRoot(process.cwd()),
    ]
    config.server.fs.allow.push(packageDir)

    config.server.watch ||= {}
    config.server.watch.ignored ||= []
    if (!Array.isArray(config.server.watch.ignored))
      config.server.watch.ignored = [config.server.watch.ignored]
    config.server.watch.ignored.push('**/.nuxt/analyze/**')
  })

  nuxt.hook('imports:extend', (imports) => {
    imports.push({
      name: 'useNuxtDevTools',
      from: join(runtimeDir, 'use-nuxt-devtools'),
    })
  })

  // TODO: Use WS from nitro server when possible
  nuxt.hook('vite:serverCreated', (server: ViteDevServer) => {
    server.middlewares.use(ROUTE_ANALYZE, sirv(analyzeDir, { single: false, dev: true }))
    // serve the front end in production
    if (clientDirExists)
      server.middlewares.use(ROUTE_CLIENT, sirv(clientDir, { single: true, dev: true }))
    server.middlewares.use(ROUTE_AUTH, sirv(join(runtimeDir, 'auth'), { single: true, dev: true }))
    server.middlewares.use(ROUTE_AUTH_VERIFY, async (req, res) => {
      const search = req.url?.split('?')[1]
      if (!search) {
        res.statusCode = 400
        res.end('No token provided')
      }
      const query = new URLSearchParams(search)
      const token = query.get('token')
      if (!token) {
        res.statusCode = 400
        res.end('No token provided')
      }
      if (token === await getDevAuthToken()) {
        res.statusCode = 200
        res.end('Valid token')
      }
      else {
        res.statusCode = 403
        res.end('Invalid token')
      }
    })
  })

  const integrations = [
    import('./integrations/plugin-metrics').then(({ setup }) => setup(ctx)),
    options.viteInspect !== false
      ? import('./integrations/vite-inspect').then(({ setup }) => setup(ctx))
      : null,
    options.componentInspector !== false
      ? import('./integrations/vue-inspector').then(({ setup }) => setup(ctx))
      : null,
    options.vscode?.enabled
      ? import('./integrations/vscode').then(({ setup }) => setup(ctx))
      : null,
    (options.experimental?.timeline || options.timeline?.enabled)
      ? import('./integrations/timeline').then(({ setup }) => setup(ctx))
      : null,
  ]

  await Promise.all(integrations)

  await nuxt.callHook('devtools:initialized', {
    version,
    packagePath: packageDir,
    isGlobalInstall: isGlobalInstall(),
  })

  const isMac = os.platform() === 'darwin'

  logger.log([
    colors.yellow(`  ➜ DevTools: `),
    colors.dim('press '),
    colors.green('Shift'),
    colors.dim(' + '),
    colors.green(isMac ? 'Option' : 'Alt'),
    colors.dim(' + '),
    colors.green('D'),
    colors.dim(` in the browser (v${version})`),
    '\n',
  ].join(''))
}
