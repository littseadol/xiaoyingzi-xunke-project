import { useState, type ReactNode } from 'react';

export function InstallerDownload({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const [requested, setRequested] = useState(false);
  return (
    <div className="installer-download">
      <a
        className={className}
        href="/downloads/collector"
        download="XiaoYingZi-Setup.exe"
        onClick={() => setRequested(true)}
      >
        {children}
      </a>
      <p className="download-help" role={requested ? 'status' : undefined}>
        {requested && <strong>已请求下载，请在浏览器的下载列表确认是否完成。</strong>}
        找不到安装包？电脑按 <kbd>Ctrl</kbd> + <kbd>J</kbd> 打开下载列表，找到{' '}
        <b>XiaoYingZi-Setup.exe</b>
        ，点旁边的文件夹图标或“在文件夹中显示”。通常保存在电脑的“下载”文件夹。
      </p>
    </div>
  );
}
