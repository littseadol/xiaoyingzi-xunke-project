import initSqlJs, { type Database } from 'sql.js';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSettings, type Recording, type Settings } from '../shared/types.js';

const require = createRequire(import.meta.url);

export class Store {
  private constructor(
    private database: Database,
    private filename: string,
  ) {}

  static async open(directory: string): Promise<Store> {
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const filename = join(directory, 'classroom.sqlite');
    const store = new Store(
      new SQL.Database(existsSync(filename) ? readFileSync(filename) : undefined),
      filename,
    );
    store.database.run(
      'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    store.database.run(
      "CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, startedAt TEXT NOT NULL, endedAt TEXT, status TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '')",
    );
    store.persist();
    return store;
  }

  get<T>(key: string): T | null {
    const statement = this.database.prepare('SELECT value FROM config WHERE key = ?');
    try {
      statement.bind([key]);
      return statement.step() ? (JSON.parse(statement.getAsObject().value as string) as T) : null;
    } finally {
      statement.free();
    }
  }

  set(key: string, value: unknown): void {
    this.database.run(
      'INSERT INTO config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
    this.persist();
  }

  settings(): Settings {
    return this.get<Settings>('settings') ?? structuredClone(defaultSettings);
  }

  listRecordings(): Recording[] {
    const result = this.database.exec(
      'SELECT id, startedAt, endedAt, status, bytes, error FROM recordings ORDER BY startedAt DESC',
    );
    if (!result.length) return [];
    return result[0].values.map(
      (row) =>
        Object.fromEntries(
          result[0].columns.map((column, index) => [column, row[index]]),
        ) as unknown as Recording,
    );
  }

  saveRecording(recording: Recording): void {
    this.database.run(
      'INSERT OR REPLACE INTO recordings(id, startedAt, endedAt, status, bytes, error) VALUES (?, ?, ?, ?, ?, ?)',
      [
        recording.id,
        recording.startedAt,
        recording.endedAt,
        recording.status,
        recording.bytes,
        recording.error,
      ],
    );
    this.persist();
  }

  deleteRecording(id: string): void {
    this.database.run('DELETE FROM recordings WHERE id = ?', [id]);
    this.persist();
  }

  private persist(): void {
    writeFileSync(`${this.filename}.tmp`, this.database.export());
    renameSync(`${this.filename}.tmp`, this.filename);
  }

  close(): void {
    this.database.close();
  }
}
