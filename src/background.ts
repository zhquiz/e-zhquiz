import { BrowserWindow, app, protocol } from 'electron'
import ContextMenu from 'electron-context-menu'
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import getPort from 'get-port'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'

import { Server } from './server'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      win: BrowserWindow | null;
    }
  }
}

ContextMenu()

const isDevelopment = process.env.NODE_ENV !== 'production'

let server: Server | null = null
global.win = null

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

async function createWindow () {
  global.win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: (process.env
        .ELECTRON_NODE_INTEGRATION as unknown) as boolean,
      webviewTag: true
    }
  })

  global.win.maximize()

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await global.win.loadURL(`${process.env.WEBPACK_DEV_SERVER_URL}/etabs.html`)
  } else {
    createProtocol('app')
    protocol.interceptHttpProtocol('app', (req, cb) => {
      if (server) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { uploadData, ...res } = req
        const url = req.url.replace(
          /^app:\/\/[^/]+\/api\//,
          `http://localhost:${server.port}/api/`
        )
        console.log(url)
        // eslint-disable-next-line standard/no-callback-literal
        cb({
          ...res,
          url
        })
      }
    })

    // Load the index.html when not in development
    global.win.loadURL('app://./etabs.html')
  }
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS_DEVTOOLS)
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString())
    }
  }
  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}

async function initServer () {
  server = await Server.init({
    port: parseInt(process.env.SERVER_PORT || '') || (await getPort()),
    userDataDir: app.getPath('userData'),
    asarUnpack: app.isPackaged
      ? __dirname.replace(/\.asar([\\/])/, '.asar.unpacked$1')
      : undefined
  })

  app.once('before-quit', () => {
    if (server) {
      server.cleanup()
      server = null
    }
  })
}
initServer()
