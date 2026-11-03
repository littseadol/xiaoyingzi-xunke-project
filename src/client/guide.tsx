import { useEffect, useState } from 'react';
import { api } from './api';
import './guide.css';

type GuidePage = 'live' | 'recordings' | 'settings';
type IllustrationKind = 'install' | 'connect' | 'watch' | 'record' | 'playback' | 'talk';

function GuideSymbol({ name }: { name: 'download' | 'camera' | 'mic' | 'speaker' }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      {name === 'download' ? (
        <path d="M24 7v23m-8-8 8 8 8-8M10 32v9h28v-9" />
      ) : name === 'camera' ? (
        <>
          <rect x="7" y="12" width="25" height="25" rx="6" />
          <path d="m32 20 10-6v21l-10-6" />
        </>
      ) : name === 'mic' ? (
        <>
          <rect x="18" y="5" width="12" height="25" rx="6" />
          <path d="M11 22a13 13 0 0 0 26 0M24 35v8m-8 0h16" />
        </>
      ) : (
        <>
          <path d="M8 19h8l10-9v28l-10-9H8ZM33 16a12 12 0 0 1 0 16m5-22a20 20 0 0 1 0 28" />
        </>
      )}
    </svg>
  );
}

function GuideIllustration({ kind }: { kind: IllustrationKind }) {
  return (
    <figure className={`guide-illustration guide-illustration-${kind}`}>
      <div className="guide-demo-window">
        <div className="guide-demo-title">
          <span className="guide-window-dots">● ● ●</span>小影子 · 操作示意
        </div>
        {kind === 'install' ? (
          <div className="guide-install-demo">
            <span className="guide-app-icon">
              <GuideSymbol name="download" />
            </span>
            <strong>白板小助手</strong>
            <span>在教室白板上安装一次</span>
            <div className="guide-demo-actions">
              <span>双击安装包</span>
              <span>完成后打开</span>
            </div>
          </div>
        ) : kind === 'connect' ? (
          <div className="guide-connect-demo">
            <div>
              <small>① 网站「录制与设置」</small>
              <span>生成绑定码</span>
              <code>A12B34C56D78</code>
            </div>
            <b aria-hidden="true">↓</b>
            <div>
              <small>② 白板上的小助手</small>
              <span className="guide-demo-input">填入同一组 12 位码</span>
              <span className="guide-demo-button">连接教室</span>
            </div>
          </div>
        ) : kind === 'watch' ? (
          <div className="guide-watch-demo">
            <div className="guide-classroom-drawing" aria-hidden="true">
              <span className="guide-blackboard">我的教室</span>
              <span className="guide-desks">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="guide-demo-toolbar">
              <span>● 实时画面</span>
              <span>停止观看　⛶</span>
            </div>
          </div>
        ) : kind === 'record' ? (
          <div className="guide-record-demo">
            <span className="guide-demo-label">例子：每周一到周五，上午一节课</span>
            <div className="guide-demo-days">
              {['一', '二', '三', '四', '五', '六', '日'].map((day, index) => (
                <span key={day} className={index < 5 ? 'selected' : ''}>
                  {day}
                </span>
              ))}
            </div>
            <div className="guide-demo-times">
              <span>08:00</span>
              <b>至</b>
              <span>09:00</span>
            </div>
            <div className="guide-demo-toolbar">
              <span>✓ 启用定时录像</span>
              <span className="guide-demo-button">保存设置</span>
            </div>
          </div>
        ) : kind === 'playback' ? (
          <div className="guide-playback-demo">
            <span className="guide-demo-label">选日期 → 找到那节课 → 点回放</span>
            {['09:00 — 09:05', '09:05 — 09:10'].map((time) => (
              <div className="guide-demo-recording" key={time}>
                <span className="guide-demo-thumbnail">▷</span>
                <span>
                  {time}
                  <small>约 5 分钟一段</small>
                </span>
                <span>回放 ↓</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="guide-talk-demo">
            <div>
              <span className="guide-app-icon">
                <GuideSymbol name="mic" />
              </span>
              <strong>按住说话</strong>
              <small>最长 20 秒</small>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <span className="guide-app-icon guide-speaker">
                <GuideSymbol name="speaker" />
              </span>
              <strong>松手后播放</strong>
              <small>声音从教室白板传出</small>
            </div>
          </div>
        )}
      </div>
      <figcaption>操作示意图 · 图中时间和绑定码仅为例子</figcaption>
    </figure>
  );
}

export function UserGuide({
  cloud,
  onNavigate,
}: {
  cloud: boolean;
  onNavigate: (page: GuidePage) => void;
}) {
  const [download, setDownload] = useState<'loading' | 'ready' | 'unavailable' | 'error'>(
    'loading',
  );
  const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname);
  useEffect(() => {
    let active = true;
    void api<{ installerAvailable: boolean }>('/api/config')
      .then((value) => {
        if (active) setDownload(value.installerAvailable && cloud ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (active) setDownload('error');
      });
    return () => {
      active = false;
    };
  }, [cloud]);
  return (
    <div className="user-guide">
      <section className="guide-welcome card">
        <div>
          <span className="guide-kicker">写给第一次使用的你</span>
          <h2>不用懂电脑，照着做就好。</h2>
          <p>
            手机和办公电脑只需打开这个网站。教室白板装好一次小助手，以后就能在这里看教室、查录像、说句话。
          </p>
          <div className="guide-welcome-actions">
            <button className="primary" onClick={() => onNavigate('live')}>
              去看教室 <span aria-hidden="true">→</span>
            </button>
            <a className="secondary" href="#guide-install">
              第一次使用，从这里开始
            </a>
          </div>
        </div>
        <div
          className="guide-device-map"
          aria-label="在手机或办公电脑打开网站，连接教室白板的摄像头"
        >
          <div className="guide-device">
            <span className="guide-phone-shape">◉</span>
            <strong>你的手机 / 电脑</strong>
            <small>打开网站就能用</small>
          </div>
          <span className="guide-map-link" aria-hidden="true">
            ↔
          </span>
          <div className="guide-device">
            <span className="guide-board-shape">
              <GuideSymbol name="camera" />
            </span>
            <strong>教室里的白板</strong>
            <small>装一次白板小助手</small>
          </div>
        </div>
      </section>
      <nav className="guide-shortcuts" aria-label="使用说明目录">
        <a href="#guide-install">① 安装与连接</a>
        <a href="#guide-watch">② 每天怎么看</a>
        <a href="#guide-record">③ 录像与回放</a>
        <a href="#guide-talk">④ 跟教室说话</a>
        <a href="#guide-faq">⑤ 遇到问题</a>
      </nav>
      {localPreview && (
        <p className="notice">
          你现在看到的是这台电脑上的试用页面。可以先熟悉操作；教室白板安装时，请使用帮你设置的人提供的正式网站和安装包。
        </p>
      )}
      {!cloud && (
        <p className="notice">
          当前连接方式由帮你设置的人提供。下面的绑定码步骤适用于在线网站；日常观看、录像和喊话的操作相同。
        </p>
      )}
      <section className="guide-section" id="guide-install" aria-labelledby="guide-install-title">
        <div className="guide-section-heading">
          <span>01</span>
          <div>
            <h2 id="guide-install-title">第一次使用：在白板装好小助手</h2>
            <p>这部分在教室白板上操作，一般只需要做一次。手机和办公电脑不用安装。</p>
          </div>
        </div>
        <div className="guide-preparation card">
          <strong>开始前，准备好这三样</strong>
          <ul>
            <li>白板已进入 Windows 桌面，并且可以上网。</li>
            <li>有帮你设置的人给的网站地址和访问密码。</li>
            <li>先关闭白板上的“相机”或其他正在使用摄像头的软件。</li>
          </ul>
          <p>如果白板上找不到 Windows 桌面，先拍一下白板型号给帮你设置的人，确认后再安装。</p>
        </div>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <span className="guide-step-number">第 1 步 · 在白板上操作</span>
            <h3>下载安装包，打开白板小助手</h3>
            <ol>
              <li>在教室白板上打开这个网站，用访问密码登录。</li>
              <li>
                点下方“下载白板小助手”。下载完找到 <strong>XiaoYingZi-Setup.exe</strong>，双击它。
              </li>
              <li>按安装窗口提示完成安装。如果询问安装范围，选择“仅为我安装”或“当前用户”。</li>
              <li>安装后打开“小影子教室采集端”，会看到“连接一次，以后自动运行”。</li>
            </ol>
            {download === 'ready' ? (
              <a className="primary guide-download" href="/downloads/collector">
                <GuideSymbol name="download" />
                下载白板小助手
              </a>
            ) : (
              <div className="guide-download-state" role="status">
                {download === 'loading'
                  ? '正在查看安装包是否已准备好…'
                  : download === 'error'
                    ? '暂时没有查到安装包，请刷新页面，或让帮你设置的人发给你。'
                    : '安装包还没放到网站上。让帮你设置的人把安装包发给你，拷贝到白板后双击安装即可。'}
              </div>
            )}
            <p className="guide-tip">
              在手机上看到这一步？请换到教室白板继续。遇到 Windows
              安全提示，把完整提示发给帮你设置的人；学校要求管理员处理时，请让学校管理员协助。
            </p>
          </div>
          <GuideIllustration kind="install" />
        </article>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <span className="guide-step-number">第 2 步 · 把白板和网站连起来</span>
            <h3>生成绑定码，填进白板小助手</h3>
            <ol>
              <li>
                在网站打开<strong>“录制与设置”</strong>，找到“连接教室白板”。手机或电脑都能操作。
              </li>
              <li>
                点<strong>“生成绑定码”</strong>，会出现一组 12 位数字和字母。
              </li>
              <li>
                回到白板上的小助手，把这组码原样填进“12 位绑定码”，再点<strong>“连接教室”</strong>。
              </li>
              <li>网站地址一般已经填好。如果是空的，让帮你设置的人把网站地址填好。</li>
              <li>
                等网站右上角出现<strong>“白板在线”</strong>，就连接成功了。
              </li>
            </ol>
            <button className="secondary" onClick={() => onNavigate('settings')}>
              去录制与设置，生成绑定码 <span aria-hidden="true">→</span>
            </button>
            <p className="guide-tip">
              绑定码 10
              分钟内有效，只能用一次。过期就重新生成。图里的码是例子，不能拿来连接。建议保留“Windows
              登录后自动运行”的勾选。
            </p>
          </div>
          <GuideIllustration kind="connect" />
        </article>
      </section>
      <section className="guide-section" id="guide-watch" aria-labelledby="guide-watch-title">
        <div className="guide-section-heading">
          <span>02</span>
          <div>
            <h2 id="guide-watch-title">每天使用：打开网站，点开始观看</h2>
            <p>以后手机和办公电脑都按这几步来，不用每次重新安装或绑定。</p>
          </div>
        </div>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <h3>看的是教室摄像头，不是白板屏幕</h3>
            <ol>
              <li>让教室白板保持开机、联网，小助手保持运行。</li>
              <li>在手机或电脑打开网站，输入访问密码。</li>
              <li>
                进入<strong>“实时教室”</strong>，确认右上角显示“白板在线”，点
                <strong>“开始观看”</strong>。
              </li>
              <li>
                画面右下角的展开按钮可以全屏查看。不看了点<strong>“停止观看”</strong>。
              </li>
            </ol>
            <button className="secondary" onClick={() => onNavigate('live')}>
              打开实时教室 <span aria-hidden="true">→</span>
            </button>
            <p className="guide-tip">
              没有教室声音是正常的：本版本只看画面。手机和电脑先选一个看；换到另一个页面时，旧页面会停止连接。
            </p>
          </div>
          <GuideIllustration kind="watch" />
        </article>
        <div className="guide-reminder card">
          <strong>白板窗口关掉了，怎么办？</strong>
          <p>
            点小助手窗口右上角的 ×，它会收进右下角的小图标里继续工作。需要打开时，在 Windows
            右下角找到小影子图标。如果选了“退出并停止采集”，或者白板关机、休眠，小助手就不能继续工作了。
          </p>
        </div>
      </section>
      <section className="guide-section" id="guide-record" aria-labelledby="guide-record-title">
        <div className="guide-section-heading">
          <span>03</span>
          <div>
            <h2 id="guide-record-title">需要留录像？先设时间，再打开开关</h2>
            <p>刚开始默认不录像。开启后按你设的课表录，不用一直盯着网页。</p>
          </div>
        </div>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <h3>安排什么时候录</h3>
            <ol>
              <li>
                打开<strong>“录制与设置”</strong>，添加一个录像时间段。
              </li>
              <li>
                选要录像的星期，再填开始和结束时间。比如周一到周五 <strong>08:00–09:00</strong>
                ；更多课程可以继续添加。
              </li>
              <li>
                选择保留<strong>2 天或 3 天</strong>，勾上<strong>“启用定时录像”</strong>，最后点
                <strong>“保存设置”</strong>。
              </li>
              <li>
                到了时间、白板在线时开始录；时间结束自动停。要暂停，就取消“启用定时录像”，再保存。
              </li>
            </ol>
            <button className="secondary" onClick={() => onNavigate('settings')}>
              去设置录像时间 <span aria-hidden="true">→</span>
            </button>
            <p className="guide-tip">
              所有时间都按北京时间。停止观看、关掉手机网页不会取消已保存的录像计划；白板关机、休眠或断网会影响录制，断网期间的画面不会自动补回来。
            </p>
          </div>
          <GuideIllustration kind="record" />
        </article>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <h3>找录像、回放，或者保存一份</h3>
            <ol>
              <li>
                打开<strong>“录像回放”</strong>，选择想看的日期。
              </li>
              <li>
                按时间找到那节课，点<strong>“回放”</strong>。录像大约每 5 分钟一段，一节课会有多段。
              </li>
              <li>
                想长期保留，就点<strong>“下载”</strong>
                保存到自己的手机或电脑。不同浏览器可能先打开视频，再提供保存选项。
              </li>
              <li>刚录完可能还在处理，稍等再刷新；超过所选的 2/3 天，网站会自动删除。</li>
            </ol>
            <button className="secondary" onClick={() => onNavigate('recordings')}>
              去找录像 <span aria-hidden="true">→</span>
            </button>
            <p className="guide-tip">
              回放也是无声的。重要片段请提前下载；手动删除或自动过期后，网站没有回收站。
            </p>
          </div>
          <GuideIllustration kind="playback" />
        </article>
      </section>
      <section className="guide-section" id="guide-talk" aria-labelledby="guide-talk-title">
        <div className="guide-section-heading">
          <span>04</span>
          <div>
            <h2 id="guide-talk-title">跟教室说句话：按住说，松手播</h2>
            <p>你的声音会从教室白板的扬声器里播放。</p>
          </div>
        </div>
        <article className="guide-step card">
          <div className="guide-step-copy">
            <h3>像发一条语音消息一样</h3>
            <ol>
              <li>先确认“白板在线”，并把白板扬声器音量打开。</li>
              <li>
                在<strong>“实时教室”</strong>找到<strong>“按住说话”</strong>
                。第一次使用，浏览器询问麦克风权限时选“允许”。
              </li>
              <li>
                按住按钮说话，说完松手，语音才会发到教室播放。每条最长 <strong>20 秒</strong>。
              </li>
              <li>
                看到<strong>“上一条语音已播放”</strong>
                ，说明小助手已完成播放；是否听清还要看白板的音量。
              </li>
            </ol>
            <p className="guide-tip">
              这不是实时通话，也听不到教室回复。录音时切到其他应用会取消本条语音；拒绝了麦克风权限，可在浏览器的网站权限里重新允许。
            </p>
          </div>
          <GuideIllustration kind="talk" />
        </article>
      </section>
      <section className="guide-section" id="guide-faq" aria-labelledby="guide-faq-title">
        <div className="guide-section-heading">
          <span>05</span>
          <div>
            <h2 id="guide-faq-title">遇到问题，先看这里</h2>
            <p>不需要记专业词，照着检查；还是不行就把提示发给帮你设置的人。</p>
          </div>
        </div>
        <div className="guide-faq card">
          <details>
            <summary>一直显示“白板未连接”</summary>
            <p>
              先看白板有没有开机、能不能上网、小助手有没有运行。若白板提示绑定已解除，再去“录制与设置”生成新码，从小助手右下角图标选择“重新绑定教室”。不要为了重连反复点“解除设备绑定”。
            </p>
          </details>
          <details>
            <summary>白板在线，但是画面黑的或打不开</summary>
            <p>
              先关闭白板上其他正在用摄像头的软件，再点“停止观看”后重新开始。如果仍然失败，把网页和小助手的完整错误提示发过去；有时需要帮你设置的人检查摄像头或学校网络。
            </p>
          </details>
          <details>
            <summary>能看画面，但听不到教室声音</summary>
            <p>
              这是正常的。目前实时画面和录像都不收教室声音。你可以用“按住说话”向教室发送一条语音。
            </p>
          </details>
          <details>
            <summary>开了录像，为什么列表里还没有？</summary>
            <p>
              确认时间段和星期选对、勾上“启用定时录像”并点过“保存设置”，还要在白板在线且当前处于录像时间内。正在录的一段需要先结束并处理完成才会出现在可回放列表中，稍后再查看。
            </p>
          </details>
          <details>
            <summary>喊话显示已播放，教室里还是没声音</summary>
            <p>
              检查白板音量是否为零、有没有静音，以及是否接到了别的音箱或耳机。“已播放”说明软件完成播放，不能代替现场确认声音。先发一条短语音，请教室里的人帮忙听一下。
            </p>
          </details>
          <details>
            <summary>换了手机，要重新安装或连接吗？</summary>
            <p>
              手机不用装小助手。打开同一个网站，用访问密码登录即可。白板仍然使用原来的连接；换一台白板才需要重新安装、生成新码。
            </p>
          </details>
          <details>
            <summary>忘了密码，或者安装、更新时看不懂提示</summary>
            <p>
              联系帮你设置网站的人，不要反复猜密码。更新白板小助手时，先从右下角图标选择“退出并停止采集”，再运行他提供的新版安装包。若更新后又出现连接页，按上面的绑定步骤重新连接。
            </p>
          </details>
        </div>
        <div className="guide-closing">
          <strong>每天只记住三件事就够了</strong>
          <span>白板开机联网 · 小助手保持运行 · 需要时打开网站</span>
        </div>
      </section>
    </div>
  );
}
