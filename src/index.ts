import path from 'path'

import { BrowserWindow, app, protocol } from 'electron'
import contextMenu from 'electron-context-menu'
import getPort from 'get-port'

import { Server } from './server'

declare global {
  namespace NodeJS {
    interface Global {
      win: BrowserWindow | null
    }
  }
}

contextMenu()

let server: Server | null = null
global.win = null

async function initServer() {
  server = await Server.init({
    port: await getPort(),
    userDataDir: app.getPath('userData'),
    assetsDir: getAsarUnpackedPath('assets')
  })

  if (global.win && !global.win.webContents.getURL().startsWith('app://')) {
    global.win.loadURL(`http://localhost:${server.port}/etabs.html`)
  }

  app.once('before-quit', () => {
    if (server) {
      server.cleanup()
      server = null
    }
  })
}
initServer()

function createWindow() {
  global.win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      webviewTag: true,
      contextIsolation: false
    }
  })
  global.win.maximize()

  if (server) {
    global.win.loadURL(`http://localhost:${server.port}/etabs.html`)
  } else {
    global.win.loadFile('public/loading/index.html')
  }

  global.win.on('close', () => {
    if (global.win) {
      global.win.webContents.send('app-close')
      global.win = null
    }
  })
}

app.whenReady().then(() => {
  const isRegistered = protocol.registerHttpProtocol('app', (req, cb) => {
    if (server) {
      const { uploadData, ...res } = req
      const url = req.url.replace(
        /^app:\/\/[^/]+/,
        `http://localhost:${server.port}`
      )
      console.log(url)
      cb({
        ...res,
        url
      })
    }
  })

  if (!isRegistered) {
    console.error('protocol registration failed')
  }

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function getAsarUnpackedPath(...ps: string[]) {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', ...ps)
  } else {
    let asarUnpackedPath = __dirname.replace(
      /\.asar([\\/])/,
      '.asar.unpacked$1'
    )
    return path.join(asarUnpackedPath, '..', ...ps)
  }
}
