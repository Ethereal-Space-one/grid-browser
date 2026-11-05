import type { IpcMainInvokeEvent, WebContents } from 'electron';

export function assertTrustedUi(event: IpcMainInvokeEvent, expected: WebContents | undefined, trustedUrl: string): void {
  const frame = event.senderFrame;
  if (!expected || expected.isDestroyed() || event.sender !== expected || !frame || frame !== expected.mainFrame || frame.url !== trustedUrl) {
    throw new Error('无效的界面调用');
  }
}
