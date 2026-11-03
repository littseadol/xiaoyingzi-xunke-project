import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, type Settings } from '../src/shared/types.js';
import { isRecordingDue, validateSettings } from '../src/server/schedule.js';

function plan(overrides: Partial<Settings> = {}): Settings {
  return {
    ...structuredClone(defaultSettings),
    recordingEnabled: true,
    schedules: [{ id: 'morning', days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00' }],
    ...overrides,
  };
}

test('首次设置默认不录像，空时间表也不录像', () => {
  assert.equal(isRecordingDue(defaultSettings, new Date('2026-11-02T01:00:00Z')), false);
  assert.equal(isRecordingDue(plan({ schedules: [] })), false);
});

test('按北京时间录制，开始含边界，结束不含边界', () => {
  assert.equal(isRecordingDue(plan(), new Date('2026-11-02T00:00:00Z')), true);
  assert.equal(isRecordingDue(plan(), new Date('2026-11-02T03:59:59Z')), true);
  assert.equal(isRecordingDue(plan(), new Date('2026-11-02T04:00:00Z')), false);
  assert.equal(isRecordingDue(plan(), new Date('2026-11-01T01:00:00Z')), false);
});

test('跨午夜时段按起始星期执行，支持周日跨周一', () => {
  const settings = plan({ schedules: [{ id: 'night', days: [0], start: '23:00', end: '01:00' }] });
  assert.equal(isRecordingDue(settings, new Date('2026-11-01T15:30:00Z')), true);
  assert.equal(isRecordingDue(settings, new Date('2026-11-01T16:30:00Z')), true);
  assert.equal(isRecordingDue(settings, new Date('2026-11-01T17:00:00Z')), false);
  assert.equal(isRecordingDue(settings, new Date('2026-11-02T16:30:00Z')), false);
});

test('重叠时段按并集执行，关闭总开关立即不录像', () => {
  const settings = plan();
  settings.schedules.push({ id: 'overlap', days: [1], start: '11:00', end: '14:00' });
  assert.equal(isRecordingDue(settings, new Date('2026-11-02T05:00:00Z')), true);
  settings.recordingEnabled = false;
  assert.equal(isRecordingDue(settings, new Date('2026-11-02T05:00:00Z')), false);
});

test('拒绝非法星期、重复编号、错误时间和保存期限', () => {
  for (const settings of [
    plan({ retentionDays: 30 }),
    plan({ schedules: [{ id: 'bad', days: [7], start: '08:00', end: '12:00' }] }),
    plan({ schedules: [{ id: 'bad', days: [], start: '08:00', end: '12:00' }] }),
    plan({ schedules: [{ id: 'bad', days: [1, 1], start: '08:00', end: '12:00' }] }),
    plan({ schedules: [{ id: 'bad', days: [1], start: '08:00', end: '08:00' }] }),
    plan({ schedules: [{ id: 'bad', days: [1], start: '25:00', end: '12:00' }] }),
    plan({
      schedules: [
        { id: 'same', days: [1], start: '08:00', end: '12:00' },
        { id: 'same', days: [2], start: '08:00', end: '12:00' },
      ],
    }),
  ])
    assert.throws(() => validateSettings(settings));
});

test('设置只保留契约字段，并复制时间表', () => {
  const input = { ...plan(), classroomName: '  我的教室  ', boardToken: 'ignored' };
  const output = validateSettings(input);
  assert.equal(output.classroomName, '我的教室');
  assert.equal('boardToken' in output, false);
  output.schedules[0].days.push(0);
  assert.equal(input.schedules[0].days.includes(0), false);
});
