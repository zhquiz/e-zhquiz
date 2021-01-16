declare global {
  interface Window {
    ipcRenderer: import('electron').IpcRenderer;
  }
}

export function openInNewTab (url: string, title?: string) {
  window.ipcRenderer.send('open-url', { url, title })
}
