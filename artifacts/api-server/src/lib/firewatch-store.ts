import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type ScenarioMode = "normal" | "danger" | "paused";
export type AlertStatus = "new" | "handled";

export interface Station {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  temperature: number;
  humidity: number;
  smoke: number;
  risk: number;
  level: RiskLevel;
  enabled: boolean;
  updatedAt: string;
}

export interface Measurement {
  id: number;
  stationId: string;
  stationName: string;
  recordedAt: string;
  temperature: number;
  humidity: number;
  smoke: number;
  risk: number;
  level: RiskLevel;
}

export interface Alert {
  id: number;
  stationId: string;
  stationName: string;
  reason: string;
  risk: number;
  level: RiskLevel;
  occurredAt: string;
  status: AlertStatus;
}

export interface Dashboard {
  summary: {
    stationCount: number;
    activeAlerts: number;
    averageRisk: number;
  };
  stations: Station[];
  alerts: Alert[];
  mode: ScenarioMode;
  lastUpdated: string;
}

const databasePath =
  process.env["FIREWATCH_SQLITE_PATH"] ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../data/firewatch.sqlite",
  );

mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    smoke REAL NOT NULL,
    risk INTEGER NOT NULL,
    level TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    station_name TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    smoke REAL NOT NULL,
    risk INTEGER NOT NULL,
    level TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    station_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    risk INTEGER NOT NULL,
    level TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const initialStations = [
  { id: "altai-east", name: "Восточный Алтай", region: "Восточно-Казахстанская область", latitude: 49.95, longitude: 83.12, temperature: 18, humidity: 72, smoke: 6 },
  { id: "ile-alatau", name: "Иле-Алатау", region: "Алматинская область", latitude: 43.11, longitude: 77.08, temperature: 20, humidity: 68, smoke: 8 },
  { id: "bayanaul", name: "Баянаул", region: "Павлодарская область", latitude: 50.79, longitude: 75.69, temperature: 17, humidity: 75, smoke: 5 },
  { id: "kokshetau", name: "Кокшетау", region: "Акмолинская область", latitude: 53.28, longitude: 69.38, temperature: 19, humidity: 70, smoke: 7 },
  { id: "karatau", name: "Каратау", region: "Туркестанская область", latitude: 43.17, longitude: 70.46, temperature: 21, humidity: 66, smoke: 9 },
];

function calculateRisk(temperature: number, humidity: number, smoke: number): number {
  const temperatureNorm = Math.min(100, Math.max(0, ((temperature - 10) / 30) * 100));
  const humidityNorm = 100 - humidity;
  return Math.round(0.35 * temperatureNorm + 0.25 * humidityNorm + 0.4 * smoke);
}

function riskLevel(risk: number): RiskLevel {
  if (risk < 30) return "low";
  if (risk < 60) return "moderate";
  if (risk < 80) return "high";
  return "critical";
}

function mapStation(row: Record<string, unknown>): Station {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    region: String(row["region"]),
    latitude: Number(row["latitude"]),
    longitude: Number(row["longitude"]),
    temperature: Number(row["temperature"]),
    humidity: Number(row["humidity"]),
    smoke: Number(row["smoke"]),
    risk: Number(row["risk"]),
    level: String(row["level"]) as RiskLevel,
    enabled: Boolean(row["enabled"]),
    updatedAt: String(row["updated_at"]),
  };
}

function mapMeasurement(row: Record<string, unknown>): Measurement {
  return {
    id: Number(row["id"]),
    stationId: String(row["station_id"]),
    stationName: String(row["station_name"]),
    recordedAt: String(row["recorded_at"]),
    temperature: Number(row["temperature"]),
    humidity: Number(row["humidity"]),
    smoke: Number(row["smoke"]),
    risk: Number(row["risk"]),
    level: String(row["level"]) as RiskLevel,
  };
}

function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: Number(row["id"]),
    stationId: String(row["station_id"]),
    stationName: String(row["station_name"]),
    reason: String(row["reason"]),
    risk: Number(row["risk"]),
    level: String(row["level"]) as RiskLevel,
    occurredAt: String(row["occurred_at"]),
    status: String(row["status"]) as AlertStatus,
  };
}

function getState(key: string, fallback: string): string {
  const row = database.prepare("SELECT value FROM app_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function setState(key: string, value: string): void {
  database
    .prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

function insertMeasurement(station: Station, recordedAt: string): void {
  database
    .prepare(`
      INSERT INTO measurements (station_id, station_name, recorded_at, temperature, humidity, smoke, risk, level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      station.id,
      station.name,
      recordedAt,
      station.temperature,
      station.humidity,
      station.smoke,
      station.risk,
      station.level,
    );
}

function seedIfEmpty(): void {
  const result = database.prepare("SELECT COUNT(*) AS count FROM stations").get() as {
    count: number;
  };
  if (Number(result.count) !== 0) return;

  const now = new Date().toISOString();
  const insertStation = database.prepare(`
    INSERT INTO stations (id, name, region, latitude, longitude, temperature, humidity, smoke, risk, level, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const seed of initialStations) {
    const risk = calculateRisk(seed.temperature, seed.humidity, seed.smoke);
    const station: Station = {
      ...seed,
      risk,
      level: riskLevel(risk),
      enabled: true,
      updatedAt: now,
    };
    insertStation.run(
      station.id,
      station.name,
      station.region,
      station.latitude,
      station.longitude,
      station.temperature,
      station.humidity,
      station.smoke,
      station.risk,
      station.level,
      now,
    );
    insertMeasurement(station, now);
  }
  setState("mode", "normal");
  setState("tick_count", "0");
}

seedIfEmpty();

function stations(): Station[] {
  return (database
    .prepare("SELECT * FROM stations ORDER BY name")
    .all() as Record<string, unknown>[])
    .map(mapStation);
}

function alerts(limit = 50): Alert[] {
  return (database
    .prepare("SELECT * FROM alerts ORDER BY occurred_at DESC, id DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[])
    .map(mapAlert);
}

function dashboard(): Dashboard {
  const allStations = stations();
  const allAlerts = alerts();
  const enabledStations = allStations.filter((station) => station.enabled);
  const lastUpdated =
    allStations.map((station) => station.updatedAt).sort().at(-1) ??
    new Date().toISOString();
  return {
    summary: {
      stationCount: allStations.length,
      activeAlerts: allAlerts.filter((alert) => alert.status === "new").length,
      averageRisk: enabledStations.length
        ? Math.round(
            enabledStations.reduce((total, station) => total + station.risk, 0) /
              enabledStations.length,
          )
        : 0,
    },
    stations: allStations,
    alerts: allAlerts,
    mode: getState("mode", "normal") as ScenarioMode,
    lastUpdated,
  };
}

function reasonForRisk(station: Station): string {
  const reasons: string[] = [];
  if (station.temperature >= 35) reasons.push("высокая температура");
  if (station.humidity <= 30) reasons.push("низкая влажность");
  if (station.smoke >= 60) reasons.push("повышенная задымлённость");
  return reasons.length ? reasons.join(", ") : "совокупность показателей достигла порога";
}

function recordAlertIfNeeded(station: Station, recordedAt: string): void {
  if (station.risk < 60) return;
  const unresolved = database
    .prepare("SELECT id FROM alerts WHERE station_id = ? AND status = 'new' LIMIT 1")
    .get(station.id);
  if (unresolved) return;
  database
    .prepare(`
      INSERT INTO alerts (station_id, station_name, reason, risk, level, occurred_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'new')
    `)
    .run(
      station.id,
      station.name,
      reasonForRisk(station),
      station.risk,
      station.level,
      recordedAt,
    );
}

function makeMeasurement(mode: "normal" | "danger", index: number, tick: number) {
  const wave = Math.sin(tick * 0.72 + index * 1.31);
  if (mode === "danger") {
    return {
      temperature: Number((39 + index * 0.7 + wave * 1.4).toFixed(1)),
      humidity: Math.round(22 + wave * 3),
      smoke: Math.round(86 + wave * 5),
    };
  }
  return {
    temperature: Number((18 + index * 0.5 + wave * 1.3).toFixed(1)),
    humidity: Math.round(72 - index * 1.2 + wave * 3),
    smoke: Math.round(7 + index + wave * 2),
  };
}

export function recordSimulationTick(): void {
  const mode = getState("mode", "normal");
  if (mode === "paused") return;
  const scenarioMode = mode === "danger" ? "danger" : "normal";
  const tick = Number(getState("tick_count", "0")) + 1;
  setState("tick_count", String(tick));
  const now = new Date().toISOString();
  const updateStation = database.prepare(`
    UPDATE stations
    SET temperature = ?, humidity = ?, smoke = ?, risk = ?, level = ?, updated_at = ?
    WHERE id = ?
  `);

  stations()
    .filter((station) => station.enabled)
    .forEach((station, index) => {
      const values = makeMeasurement(scenarioMode, index, tick);
      const risk = calculateRisk(values.temperature, values.humidity, values.smoke);
      const updated: Station = {
        ...station,
        ...values,
        risk,
        level: riskLevel(risk),
        updatedAt: now,
      };
      updateStation.run(
        updated.temperature,
        updated.humidity,
        updated.smoke,
        updated.risk,
        updated.level,
        now,
        updated.id,
      );
      insertMeasurement(updated, now);
      recordAlertIfNeeded(updated, now);
    });
}

export function getDashboard(): Dashboard {
  return dashboard();
}

export function getStations(): Station[] {
  return stations();
}

export function getMeasurements(stationId: string | undefined, limit: number): Measurement[] {
  const rows = stationId
    ? database
        .prepare(`
          SELECT * FROM measurements WHERE station_id = ?
          ORDER BY recorded_at DESC, id DESC LIMIT ?
        `)
        .all(stationId, limit)
    : database
        .prepare("SELECT * FROM measurements ORDER BY recorded_at DESC, id DESC LIMIT ?")
        .all(limit);
  return (rows as Record<string, unknown>[]).map(mapMeasurement);
}

export function getAlerts(): Alert[] {
  return alerts(100);
}

export function createStation(input: {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}): Station {
  const id = `station-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const now = new Date().toISOString();
  const values = { temperature: 18, humidity: 70, smoke: 7 };
  const risk = calculateRisk(values.temperature, values.humidity, values.smoke);
  database
    .prepare(`
      INSERT INTO stations (id, name, region, latitude, longitude, temperature, humidity, smoke, risk, level, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `)
    .run(
      id,
      input.name,
      input.region,
      input.latitude,
      input.longitude,
      values.temperature,
      values.humidity,
      values.smoke,
      risk,
      riskLevel(risk),
      now,
    );
  const station = stations().find((entry) => entry.id === id);
  if (!station) throw new Error("Created station was not found");
  insertMeasurement(station, now);
  return station;
}

export function updateStation(
  id: string,
  changes: {
    name?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    enabled?: boolean;
  },
): Station | undefined {
  const existing = stations().find((station) => station.id === id);
  if (!existing) return undefined;
  const next = { ...existing, ...changes };
  const now = new Date().toISOString();
  database
    .prepare(`
      UPDATE stations SET name = ?, region = ?, latitude = ?, longitude = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      next.name,
      next.region,
      next.latitude,
      next.longitude,
      next.enabled ? 1 : 0,
      now,
      id,
    );
  return stations().find((station) => station.id === id);
}

export function deleteStation(id: string): boolean {
  return database.prepare("DELETE FROM stations WHERE id = ?").run(id).changes > 0;
}

export function updateAlertStatus(
  id: number,
  status: AlertStatus,
): Alert | undefined {
  const result = database
    .prepare("UPDATE alerts SET status = ? WHERE id = ?")
    .run(status, id);
  if (result.changes === 0) return undefined;
  const row = database.prepare("SELECT * FROM alerts WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapAlert(row) : undefined;
}

export function runScenario(action: "normal" | "danger" | "pause" | "reset"): Dashboard {
  if (action === "reset") {
    database.exec("DELETE FROM alerts; DELETE FROM measurements; DELETE FROM stations;");
    setState("mode", "normal");
    setState("tick_count", "0");
    seedIfEmpty();
    return dashboard();
  }

  if (action === "pause") {
    setState("mode", "paused");
    return dashboard();
  }

  setState("mode", action);
  recordSimulationTick();
  return dashboard();
}

export function startFirewatchSimulation(): void {
  const timer = setInterval(recordSimulationTick, 15_000);
  timer.unref();
}
