import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/server/store.js';
import { Recordings } from '../src/server/recordings.js';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;

test('真实编码链路：按序写入、处理为静音 MP4、持久化及过期清理', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-recordings-'));
  const store = await Store.open(directory);
  const recordings = new Recordings(store, join(directory, 'videos'));
  try {
    await recordings.initialize();
    const source = join(directory, 'synthetic.webm');
    const generated = spawnSync(
      ffmpeg,
      [
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=10',
        '-t',
        '1',
        '-an',
        '-c:v',
        'libvpx',
        source,
      ],
      { windowsHide: true },
    );
    assert.equal(generated.status, 0, generated.stderr?.toString() ?? 'FFmpeg 未启动');
    const record = await recordings.start();
    await assert.rejects(() => recordings.append(record.id, Buffer.from('invalid'), 1), /顺序/);
    await assert.rejects(() => recordings.start(), /尚未结束/);
    await recordings.append(record.id, await readFile(source), 0);
    recordings.finish(record.id);
    for (let index = 0; index < 100 && recordings.find(record.id)?.status === 'processing'; index++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(recordings.find(record.id)?.status, 'ready', recordings.find(record.id)?.error);
    const decoded = spawnSync(
      ffmpeg,
      ['-nostdin', '-i', recordings.path(record.id), '-f', 'null', '-'],
      { windowsHide: true },
    );
    assert.equal(decoded.status, 0, decoded.stderr?.toString());
    assert.match(decoded.stderr.toString(), /h264/);
    assert.doesNotMatch(decoded.stderr.toString(), /Audio:/);
    const old = {
      ...recordings.find(record.id)!,
      id: randomUUID(),
      startedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      endedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    };
    store.saveRecording(old);
    await writeFile(recordings.path(old.id), 'old');
    await recordings.maintenance();
    assert.equal(recordings.find(old.id), undefined);
    await assert.rejects(() => access(recordings.path(old.id)));
    assert.equal(recordings.find(record.id)?.status, 'ready');
    assert.throws(() => recordings.path('../outside'), /编号/);
    await recordings.remove(record.id);
    assert.equal(recordings.find(record.id), undefined);
  } finally {
    await recordings.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('数据库关闭重开后保留设置和录像索引', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-store-'));
  let store = await Store.open(directory);
  try {
    store.set('settings', {
      ...store.settings(),
      classroomName: '持久化教室',
      recordingEnabled: true,
    });
    const id = randomUUID();
    store.saveRecording({
      id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'writing',
      bytes: 1,
      error: '',
    });
    store.close();
    store = await Store.open(directory);
    assert.equal(store.settings().classroomName, '持久化教室');
    assert.equal(store.settings().recordingEnabled, true);
    assert.equal(store.listRecordings()[0].id, id);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('重启时恢复已写入但未结束的合成录像', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoyingzi-recovery-'));
  const store = await Store.open(directory);
  const recordings = new Recordings(store, join(directory, 'videos'));
  try {
    await recordings.initialize();
    const record = await recordings.start();
    const source = join(directory, 'source.webm');
    const generated = spawnSync(
      ffmpeg,
      [
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x120:rate=10',
        '-t',
        '1',
        '-an',
        '-c:v',
        'libvpx',
        source,
      ],
      { windowsHide: true },
    );
    assert.equal(generated.status, 0);
    await recordings.append(record.id, await readFile(source), 0);
    await recordings.close();
    const recovered = new Recordings(store, join(directory, 'videos'));
    try {
      await recovered.initialize();
      for (let index = 0; index < 100 && recovered.find(record.id)?.status !== 'ready'; index++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(recovered.find(record.id)?.status, 'ready', recovered.find(record.id)?.error);
      await access(recovered.path(record.id));
    } finally {
      await recovered.close();
    }
  } finally {
    await recordings.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
