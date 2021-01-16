process.env.SERVER_PORT = process.env.SERVER_PORT || '5000'

module.exports = {
  devServer: {
    proxy: `http://localhost:${process.env.SERVER_PORT}`
  },
  pluginOptions: {
    electronBuilder: {
      externals: ['fastify'],
      nodeIntegration: true,
      preload: 'src/preload.js',
      builderOptions: {
        appId: 'cc.zhquiz.zhquiz',
        asarUnpack: ['assets/', 'node_modules/nodejieba/dict/'],
        // afterPack: './scripts/include-go.js',
        // extends: null,
        win: {
          target: ['nsis', 'portable'],
          icon: 'public/android-chrome-512x512.ico'
        },
        mac: {
          target: ['zip'],
          icon: 'public/favicon.icns',
          category: 'public.app-category.education'
        },
        linux: {
          target: [
            'AppImage'
            // 'deb'
          ],
          icon: 'public/icon.png'
        }
      }
    }
  }
}
