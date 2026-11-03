import type { Settings } from '../shared/types.js';

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确');
  const value = input as Settings;
  if (
    typeof value.classroomName !== 'string' ||
    !value.classroomName.trim() ||
    value.classroomName.length > 40
  )
    throw new Error('教室名称需为 1—40 个字符');
  if (typeof value.recordingEnabled !== 'boolean') throw new Error('录像开关格式不正确');
  if (![2, 3].includes(value.retentionDays)) throw new Error('录像保存期限只能为 2 天或 3 天');
  if (typeof value.cameraId !== 'string' || value.cameraId.length > 512)
    throw new Error('摄像头设置不正确');
  if (!Array.isArray(value.schedules) || value.schedules.length > 20)
    throw new Error('最多设置 20 个录像时段');
  const identifiers = new Set<string>();
  for (const schedule of value.schedules) {
    if (
      !schedule ||
      typeof schedule.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(schedule.id) ||
      identifiers.has(schedule.id)
    )
      throw new Error('录像时段编号不正确或重复');
    identifiers.add(schedule.id);
    if (
      !Array.isArray(schedule.days) ||
      schedule.days.length < 1 ||
      schedule.days.length > 7 ||
      schedule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(schedule.days).size !== schedule.days.length
    )
      throw new Error('请选择不重复的录像星期');
    if (
      !timePattern.test(schedule.start) ||
      !timePattern.test(schedule.end) ||
      schedule.start === schedule.end
    )
      throw new Error('录像起止时间不正确，不能相同');
  }
  return {
    classroomName: value.classroomName.trim(),
    recordingEnabled: value.recordingEnabled,
    retentionDays: value.retentionDays,
    cameraId: value.cameraId,
    schedules: value.schedules.map((schedule) => ({ ...schedule, days: [...schedule.days] })),
  };
}

export function isRecordingDue(settings: Settings, date = new Date()): boolean {
  if (!settings.recordingEnabled) return false;
  const parts = Object.fromEntries(
    clock.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const day = weekdays[parts.weekday];
  const time = `${parts.hour}:${parts.minute}`;
  return settings.schedules.some((schedule) => {
    if (schedule.start < schedule.end)
      return schedule.days.includes(day) && time >= schedule.start && time < schedule.end;
    return (
      (schedule.days.includes(day) && time >= schedule.start) ||
      (schedule.days.includes((day + 6) % 7) && time < schedule.end)
    );
  });
}
