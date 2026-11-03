import { mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, parse, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function showSavedDownload(filename) {
  console.log(`下载已保存：${filename}`);
  if (process.platform !== 'win32') return;
  const explorer = spawn('explorer.exe', [`/select,${filename}`], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  explorer.on('error', () => console.error(`请手动打开下载文件夹：${filename}`));
  explorer.unref();
}

export function attachDevelopmentDownloads(page, options = {}) {
  const directory = resolve(
    options.directory ?? process.env.XY_DEV_DOWNLOAD_DIR ?? join(homedir(), 'Downloads'),
  );
  const onSaved = options.onSaved ?? showSavedDownload;
  const onError = options.onError ?? ((error) => console.error(`下载未保存成功：${error.message}`));
  const listener = async (download) => {
    let destination;
    let saved = false;
    try {
      await mkdir(directory, { recursive: true });
      const filename = basename(download.suggestedFilename());
      const { name, ext } = parse(filename);
      for (let index = 0; ; index++) {
        const candidate = join(directory, index ? `${name} (${index})${ext}` : filename);
        try {
          const reserved = await open(candidate, 'wx', 0o600);
          await reserved.close();
          destination = candidate;
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      await download.saveAs(destination);
      saved = true;
      await onSaved(destination);
    } catch (error) {
      if (destination && !saved) await unlink(destination).catch(() => undefined);
      onError(error);
    }
  };
  page.on('download', listener);
  return () => page.off('download', listener);
}
