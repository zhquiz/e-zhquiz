import crypto from 'crypto'
import path from 'path'
import qs from 'querystring'
import { pathToFileURL } from 'url'

import { BrowserWindow, app, ipcMain, protocol } from 'electron'
import getPort from 'get-port'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'

import { Server } from './server'

const isDevelopment = process.env.NODE_ENV !== 'production'

if (isDevelopment) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('electron-context-menu')()
}

const token = crypto.randomBytes(48).toString('hex')

let server: Server | null = null
let win: BrowserWindow | null = null

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

async function createWindow () {
  win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      // nodeIntegration: (process.env
      //   .ELECTRON_NODE_INTEGRATION as unknown) as boolean,
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  })

  win.maximize()

  const urlPayload: Record<string, string> = JSON.parse(
    JSON.stringify({
      token,
      preload: pathToFileURL(path.join(__dirname, 'preload.js')),
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      port:
        !process.env.WEBPACK_DEV_SERVER_URL && server ? server.port : undefined
    })
  )

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(
      `${process.env.WEBPACK_DEV_SERVER_URL}/etabs.html?${qs.stringify(
        urlPayload
      )}`
    )
  } else {
    createProtocol('app')
    win.setMenu(null)

    // Load the etabs.html when not in development
    win.loadURL(`app://./etabs.html?${qs.stringify(urlPayload)}`)
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
  server = await Server.init({
    port: parseInt(process.env.SERVER_PORT || '') || (await getPort()),
    userDataDir: app.getPath('userData'),
    asarUnpack: app.isPackaged
      ? __dirname.replace(/\.asar([\\/]|$)/, '.asar.unpacked$1')
      : undefined,
    token
  })

  app.once('before-quit', () => {
    if (server) {
      server.cleanup()
      server = null
    }
  })

  if (isDevelopment) {
    // Install Vue Devtools
    try {
      const { default: installExtension, VUEJS_DEVTOOLS } = await import(
        'electron-devtools-installer'
      )

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

ipcMain.on('open-url', (ev, msg) => {
  if (win) {
    win.webContents.send('open-url', msg)
  }
})
