export interface Schedule {
  id: string;
  days: number[];
  start: string;
  end: string;
}

export interface Settings {
  classroomName: string;
  recordingEnabled: boolean;
  retentionDays: number;
  schedules: Schedule[];
  cameraId: string;
}

export const defaultSettings: Settings = {
  classroomName: '我的教室',
  recordingEnabled: false,
  retentionDays: 3,
  schedules: [],
  cameraId: '',
};

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface BoardStatus {
  online: boolean;
  camera: 'idle' | 'starting' | 'ready' | 'error';
  recording: boolean;
  cameras: CameraDevice[];
  error: string;
  lastSeen: string | null;
}

export interface Recording {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: 'writing' | 'processing' | 'ready' | 'interrupted' | 'failed';
  bytes: number;
  error: string;
}

export interface Overview {
  deployment?: 'local' | 'cloud';
  settings: Settings;
  board: BoardStatus;
  recordingDue: boolean;
  serverTime: string;
  storage: { freeBytes: number | null; videoBytes: number; directory: string };
  shout: { id: string; status: 'queued' | 'playing' | 'played' | 'failed'; error: string } | null;
}

export interface BoardControl {
  iceServers?: IceServer[];
  type: 'control';
  recording: boolean;
  watching: boolean;
  watchId: string;
  cameraId: string;
}

export interface SignalData {
  description?: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string };
  candidate?: {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  };
}

export interface Bootstrap {
  deployment?: 'local' | 'cloud';
  boardToken: string;
  addresses: string[];
  initialPassword: string | null;
  dataDirectory: string;
  autoStart: boolean;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
