import { Router, type IRouter } from "express";
import {
  CreateFirewatchStationBody,
  CreateFirewatchStationResponse,
  DeleteFirewatchStationParams,
  DeleteFirewatchStationResponse,
  GetFirewatchAlertsResponse,
  GetFirewatchDashboardResponse,
  GetFirewatchMeasurementsQueryParams,
  GetFirewatchMeasurementsResponse,
  GetFirewatchStationsResponse,
  GetFirewatchTelegramStatusResponse,
  RunFirewatchScenarioBody,
  RunFirewatchScenarioResponse,
  SubmitFirewatchMeasurementsBody,
  SubmitFirewatchMeasurementsResponse,
  UpdateFirewatchAlertStatusBody,
  UpdateFirewatchAlertStatusParams,
  UpdateFirewatchAlertStatusResponse,
  UpdateFirewatchStationBody,
  UpdateFirewatchStationParams,
  UpdateFirewatchStationResponse,
} from "@workspace/api-zod";
import {
  createStation,
  deleteStation,
  getAlerts,
  getDashboard,
  getMeasurements,
  getStations,
  runScenario,
  MeasurementStationError,
  storeMeasurements,
  updateAlertStatus,
  updateStation,
} from "../lib/firewatch-store";
import {
  getTelegramConnectionStatus,
  notifyTelegramOfNewAlert,
} from "../lib/telegram";

const router: IRouter = Router();

router.get("/firewatch/telegram/status", async (_req, res): Promise<void> => {
  res.json(
    GetFirewatchTelegramStatusResponse.parse(await getTelegramConnectionStatus()),
  );
});

router.get("/firewatch/dashboard", (_req, res) => {
  res.json(GetFirewatchDashboardResponse.parse(getDashboard()));
});

router.get("/firewatch/stations", (_req, res) => {
  res.json(GetFirewatchStationsResponse.parse(getStations()));
});

router.post("/firewatch/stations", (req, res) => {
  const parsed = CreateFirewatchStationBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid station input");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(CreateFirewatchStationResponse.parse(createStation(parsed.data)));
});

router.patch("/firewatch/stations/:stationId", (req, res) => {
  const params = UpdateFirewatchStationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateFirewatchStationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const station = updateStation(params.data.stationId, body.data);
  if (!station) {
    res.status(404).json({ error: "Станция не найдена" });
    return;
  }
  res.json(UpdateFirewatchStationResponse.parse(station));
});

router.delete("/firewatch/stations/:stationId", (req, res) => {
  const params = DeleteFirewatchStationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!deleteStation(params.data.stationId)) {
    res.status(404).json({ error: "Станция не найдена" });
    return;
  }
  res.json(DeleteFirewatchStationResponse.parse({ deleted: true }));
});

router.get("/firewatch/measurements", (req, res) => {
  const query = GetFirewatchMeasurementsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  res.json(
    GetFirewatchMeasurementsResponse.parse(
      getMeasurements(query.data.stationId, query.data.limit ?? 120),
    ),
  );
});

router.post("/firewatch/measurements", (req, res) => {
  const body = SubmitFirewatchMeasurementsBody.safeParse(req.body);
  if (!body.success) {
    req.log.warn({ errors: body.error.message }, "Invalid sensor readings");
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const { measurements, newAlerts } = storeMeasurements(body.data.readings);
    for (const alert of newAlerts) {
      if (alert.level !== "high" && alert.level !== "critical") continue;
      void notifyTelegramOfNewAlert(alert).then((result) => {
        if (result === "failed") {
          req.log.warn({ alertId: alert.id }, "Telegram alert delivery failed");
        }
      }).catch(() => {
        req.log.warn({ alertId: alert.id }, "Telegram alert delivery failed");
      });
    }
    res.json(
      SubmitFirewatchMeasurementsResponse.parse({
        accepted: measurements.length,
        measurements,
      }),
    );
  } catch (error) {
    if (error instanceof MeasurementStationError) {
      req.log.warn(
        { code: error.code, stationId: error.stationId },
        "Rejected readings for unavailable station",
      );
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to store sensor readings");
    res.status(500).json({ error: "Не удалось сохранить измерения" });
  }
});

router.get("/firewatch/alerts", (_req, res) => {
  res.json(GetFirewatchAlertsResponse.parse(getAlerts()));
});

router.patch("/firewatch/alerts/:alertId/status", (req, res) => {
  const params = UpdateFirewatchAlertStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateFirewatchAlertStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const alert = updateAlertStatus(params.data.alertId, body.data.status);
  if (!alert) {
    res.status(404).json({ error: "Предупреждение не найдено" });
    return;
  }
  res.json(UpdateFirewatchAlertStatusResponse.parse(alert));
});

router.post("/firewatch/scenario", (req, res) => {
  const body = RunFirewatchScenarioBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  res.json(RunFirewatchScenarioResponse.parse(runScenario(body.data.action)));
});

export default router;
