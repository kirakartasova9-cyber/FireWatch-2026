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
  RunFirewatchScenarioBody,
  RunFirewatchScenarioResponse,
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
  updateAlertStatus,
  updateStation,
} from "../lib/firewatch-store";

const router: IRouter = Router();

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
