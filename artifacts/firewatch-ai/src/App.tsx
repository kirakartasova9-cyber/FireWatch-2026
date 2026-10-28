import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useCreateFirewatchStation,
  useDeleteFirewatchStation,
  useGetFirewatchAlerts,
  useGetFirewatchDashboard,
  useGetFirewatchMeasurements,
  useGetFirewatchStations,
  useRunFirewatchScenario,
  useSubmitFirewatchMeasurements,
  useUpdateFirewatchAlertStatus,
  useUpdateFirewatchStation,
  getGetFirewatchDashboardQueryKey,
  getGetFirewatchStationsQueryKey,
  getGetFirewatchMeasurementsQueryKey,
  getGetFirewatchAlertsQueryKey,
} from '@workspace/api-client-react';
import type { Alert, Measurement, MeasurementInput, Station, StationInput } from '@workspace/api-client-react';
import { AlertTriangle, Bell, CirclePause, Flame, Leaf, MapPinned, Pencil, Plus, RotateCcw, ShieldCheck, Signal, SlidersHorizontal, Thermometer, Trash2 } from 'lucide-react';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import 'leaflet/dist/leaflet.css';
import './index.css';

const queryClient = new QueryClient();
const measurementsParams = { limit: 100 };
const levelLabels: Record<string, string> = { low: 'Низкий', moderate: 'Умеренный', high: 'Высокий', critical: 'Критический' };
const modeLabels: Record<string, string> = { normal: 'Обычный сценарий', danger: 'Опасный сценарий', paused: 'Пауза' };

function simulateReadings(stationIds: string[], mode: 'normal' | 'danger', tick: number): MeasurementInput[] {
  return stationIds.map((stationId, index) => {
    const wave = Math.sin(tick * 0.72 + index * 1.31);
    if (mode === 'danger') {
      return {
        stationId,
        temperature: Number((39 + index * 0.7 + wave * 1.4).toFixed(1)),
        humidity: Math.round(22 + wave * 3),
        smoke: Math.round(86 + wave * 5),
      };
    }
    return {
      stationId,
      temperature: Number((18 + index * 0.5 + wave * 1.3).toFixed(1)),
      humidity: Math.round(72 - index * 1.2 + wave * 3),
      smoke: Math.round(7 + index + wave * 2),
    };
  });
}

function prettyDate(value?: string, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', withTime
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function AppView() {
  const client = useQueryClient();
  const dashboard = useGetFirewatchDashboard({ query: { queryKey: getGetFirewatchDashboardQueryKey(), refetchInterval: 12000 } });
  const stationsQuery = useGetFirewatchStations({ query: { queryKey: getGetFirewatchStationsQueryKey(), refetchInterval: 20000 } });
  const measurementsQuery = useGetFirewatchMeasurements(measurementsParams, {
    query: { queryKey: getGetFirewatchMeasurementsQueryKey(measurementsParams), refetchInterval: 12000 },
  });
  const alertsQuery = useGetFirewatchAlerts({ query: { queryKey: getGetFirewatchAlertsQueryKey(), refetchInterval: 20000 } });
  const createStation = useCreateFirewatchStation();
  const updateStation = useUpdateFirewatchStation();
  const deleteStation = useDeleteFirewatchStation();
  const updateAlert = useUpdateFirewatchAlertStatus();
  const runScenario = useRunFirewatchScenario();
  const submitMeasurements = useSubmitFirewatchMeasurements();
  const [modalStation, setModalStation] = useState<Station | null | undefined>(undefined);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [activeNav, setActiveNav] = useState('overview');
  const sampleSequence = useRef(0);
  const sendingReadings = useRef(false);

  const stations = stationsQuery.data ?? dashboard.data?.stations ?? [];
  const activeStationIds = useMemo(() => stations.filter((station) => station.enabled).map((station) => station.id), [stations]);
  const activeStationSignature = activeStationIds.join('|');
  const alerts = alertsQuery.data ?? dashboard.data?.alerts ?? [];
  const measurements = measurementsQuery.data ?? [];
  const alertCount = dashboard.data?.summary.activeAlerts ?? alerts.filter((alert) => alert.status === 'new').length;
  const averageRisk = dashboard.data?.summary.averageRisk;
  const center = useMemo<[number, number]>(() => {
    if (!stations.length) return [61.5, 96.5];
    return [
      stations.reduce((sum, station) => sum + station.latitude, 0) / stations.length,
      stations.reduce((sum, station) => sum + station.longitude, 0) / stations.length,
    ];
  }, [stations]);
  const chartData = useMemo(() => measurements.slice().reverse().map((item: Measurement) => ({
    ...item,
    timeLabel: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.recordedAt)),
  })), [measurements]);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), 3200);
  }, []);
  const refreshAll = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetFirewatchDashboardQueryKey() }),
      client.invalidateQueries({ queryKey: getGetFirewatchStationsQueryKey() }),
      client.invalidateQueries({ queryKey: getGetFirewatchMeasurementsQueryKey(measurementsParams) }),
      client.invalidateQueries({ queryKey: getGetFirewatchAlertsQueryKey() }),
    ]);
  }, [client]);
  const sendMeasurements = useCallback(async (mode: 'normal' | 'danger', stationIds: string[]) => {
    if (!stationIds.length || sendingReadings.current) return false;
    sendingReadings.current = true;
    try {
      const data = await submitMeasurements.mutateAsync({
        data: { readings: simulateReadings(stationIds, mode, ++sampleSequence.current) },
      });
      await refreshAll();
      return data.accepted === stationIds.length;
    } catch {
      notify('Не удалось отправить измерения на сервер', true);
      return false;
    } finally {
      sendingReadings.current = false;
    }
  }, [notify, refreshAll, submitMeasurements.mutateAsync]);
  const handleScenario = (action: 'normal' | 'danger' | 'pause' | 'reset') => {
    runScenario.mutate({ data: { action } }, {
      onSuccess: async () => {
        await refreshAll();
        if (action === 'normal' || action === 'danger') {
          const sent = await sendMeasurements(action, activeStationIds);
          if (!sent) return;
        }
        notify('Сценарий обновлён');
      },
      onError: () => notify('Не удалось изменить сценарий', true),
    });
  };
  const handleAlert = (alert: Alert) => {
    updateAlert.mutate({ alertId: alert.id, data: { status: alert.status === 'handled' ? 'new' : 'handled' } }, {
      onSuccess: async () => { await refreshAll(); notify(alert.status === 'handled' ? 'Сигнал возвращён в новые' : 'Сигнал отмечен обработанным'); },
      onError: () => notify('Не удалось обновить сигнал', true),
    });
  };
  const toggleStation = (station: Station) => {
    updateStation.mutate({ stationId: station.id, data: { enabled: !station.enabled } }, {
      onSuccess: async () => { await refreshAll(); notify(station.enabled ? 'Станция отключена' : 'Станция включена'); },
      onError: () => notify('Не удалось изменить состояние станции', true),
    });
  };
  const removeStation = (station: Station) => {
    if (!window.confirm(`Удалить станцию «${station.name}»?`)) return;
    deleteStation.mutate({ stationId: station.id }, {
      onSuccess: async () => { await refreshAll(); notify('Станция удалена'); },
      onError: () => notify('Не удалось удалить станцию', true),
    });
  };
  const submitStation = (input: StationInput) => {
    if (modalStation) {
      updateStation.mutate({ stationId: modalStation.id, data: input }, {
        onSuccess: async () => { setModalStation(undefined); await refreshAll(); notify('Изменения станции сохранены'); },
        onError: () => notify('Не удалось сохранить станцию', true),
      });
    } else {
      createStation.mutate({ data: input }, {
        onSuccess: async () => { setModalStation(undefined); await refreshAll(); notify('Станция добавлена'); },
        onError: () => notify('Не удалось добавить станцию', true),
      });
    }
  };
  const scrollTo = (id: string) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const isBusy = runScenario.isPending || submitMeasurements.isPending;

  useEffect(() => {
    const mode = dashboard.data?.mode;
    if ((mode !== 'normal' && mode !== 'danger') || !activeStationSignature) return;
    const stationIds = activeStationSignature.split('|');
    const timer = window.setInterval(() => {
      void sendMeasurements(mode, stationIds);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [activeStationSignature, dashboard.data?.mode, sendMeasurements]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Flame aria-hidden="true" /></div>
          <div>FireWatch AI<small>УЧЕБНЫЙ МОНИТОРИНГ</small></div>
        </div>
        <div className="top-actions">
          <div className="updated"><Signal size={13} /> Обновлено {prettyDate(dashboard.data?.lastUpdated, true)}</div>
          <div className="live-pill"><span className="live-dot" /> ДЕМО-СРЕДА</div>
        </div>
      </header>

      <div className="layout">
        <aside className="side-nav" aria-label="Навигация по панели">
          <div className="nav-kicker">Рабочая область</div>
          <button className={`nav-link ${activeNav === 'overview' ? 'active' : ''}`} onClick={() => scrollTo('overview')} data-testid="nav-overview"><SlidersHorizontal /> Обзор</button>
          <button className={`nav-link ${activeNav === 'map-section' ? 'active' : ''}`} onClick={() => scrollTo('map-section')} data-testid="nav-map"><MapPinned /> Карта станций</button>
          <button className={`nav-link ${activeNav === 'history' ? 'active' : ''}`} onClick={() => scrollTo('history')} data-testid="nav-history"><Thermometer /> История измерений</button>
          <button className={`nav-link ${activeNav === 'alerts' ? 'active' : ''}`} onClick={() => scrollTo('alerts')} data-testid="nav-alerts"><Bell /> Сигналы</button>
          <button className={`nav-link ${activeNav === 'stations' ? 'active' : ''}`} onClick={() => scrollTo('stations')} data-testid="nav-stations"><Leaf /> Станции</button>
          <div className="side-note"><strong>Учебный прототип</strong>Показатели и тревоги моделируются сервером. Панель не обнаруживает реальные возгорания.</div>
        </aside>

        <main className="content" id="overview">
          <div className="page-head">
            <div><div className="eyebrow">Диспетчерская · учебный полигон</div><h1>Обстановка в лесных зонах</h1><p>Сводка сенсорных станций и динамика модельных показателей.</p></div>
            <div className="updated"><span className="live-dot" /> Обновление каждые 12 сек.</div>
          </div>

          <div className="sim-banner" role="note" data-testid="simulation-notice">
            <AlertTriangle aria-hidden="true" /><div><strong>Данные симулированы.</strong> Это образовательная демонстрация — система не выявляет и не подтверждает реальные пожары.</div>
          </div>

          {dashboard.isError && <div className="error-state" role="alert" data-testid="dashboard-error">Не удалось загрузить сводку. Проверьте соединение с API.<br /><button className="retry-btn" onClick={() => dashboard.refetch()} data-testid="button-retry-dashboard">Повторить загрузку</button></div>}
          <section className="metrics" aria-label="Сводные показатели">
            <article className="metric" data-testid="metric-station-count"><div className="metric-label">Станции в системе</div><div className="metric-value">{dashboard.isLoading ? <span className="skeleton" style={{ width: 54 }} /> : dashboard.data?.summary.stationCount ?? stations.length}<small>шт.</small></div></article>
            <article className={`metric ${alertCount > 0 ? 'warn' : ''}`} data-testid="metric-alert-count"><div className="metric-label">Новые сигналы</div><div className="metric-value">{dashboard.isLoading ? <span className="skeleton" style={{ width: 54 }} /> : alertCount}<small>активных</small></div></article>
            <article className="metric" data-testid="metric-average-risk"><div className="metric-label">Средний модельный риск</div><div className="metric-value">{dashboard.isLoading ? <span className="skeleton" style={{ width: 54 }} /> : averageRisk?.toFixed(1) ?? '—'}<small>/ 100</small></div></article>
            <article className="metric metric-compact" data-testid="metric-last-update"><div className="metric-label">Последнее обновление</div><div className="metric-value">{dashboard.isLoading ? <span className="skeleton" style={{ width: 110 }} /> : prettyDate(dashboard.data?.lastUpdated, true)}</div></article>
          </section>

          <div className="grid-main">
            <section className="panel" id="map-section" aria-labelledby="map-title">
              <div className="panel-head"><div><div className="panel-title" id="map-title">Карта станций</div><div className="panel-sub">Спутниковый обзор · координаты станций из API</div></div><span className="tiny-tag">{stations.length} точек</span></div>
              <div className="map-wrap" data-testid="map-stations">
                {stationsQuery.isLoading && !stations.length ? <div className="map-empty">Загружаем расположение станций…</div> : stations.length ? <>
                  <MapContainer center={center} zoom={4} scrollWheelZoom={false} attributionControl={true}>
                    <TileLayer
                      className="satellite-imagery"
                      attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      maxZoom={19}
                    />
                    <TileLayer
                      className="satellite-labels"
                      attribution='Labels &copy; <a href="https://www.esri.com/">Esri</a>'
                      url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                      maxZoom={19}
                    />
                    {stations.map((station) => <CircleMarker key={station.id} center={[station.latitude, station.longitude]} radius={station.level === 'critical' || station.level === 'high' ? 9 : 7} pathOptions={{ color: station.level === 'critical' || station.level === 'high' ? '#c36b3d' : '#52785d', fillColor: station.level === 'critical' || station.level === 'high' ? '#dc8652' : '#78a17b', fillOpacity: station.enabled ? 0.9 : 0.3, weight: 2 }}>
                      <Tooltip><strong>{station.name}</strong><br />{station.region}<br />Риск: {station.risk} · {levelLabels[station.level] ?? station.level}</Tooltip>
                    </CircleMarker>)}
                  </MapContainer>
                  <div className="map-mode-badge"><span /> СПУТНИК</div>
                  <div className="map-legend"><div className="legend-row"><span className="legend-dot" /> Низкий / умеренный риск</div><div className="legend-row"><span className="legend-dot high" /> Высокий / критический</div></div>
                </> : <div className="map-empty">Добавьте станцию, чтобы показать её на карте.</div>}
              </div>
            </section>

            <section className="panel scenario-panel" aria-labelledby="scenario-title">
              <div className="panel-head"><div><div className="panel-title" id="scenario-title">Управление сценарием</div><div className="panel-sub">Переключение демонстрационных данных</div></div><span className="tiny-tag">API</span></div>
              <div className="mode-card">
                <div className="mode-line"><div className="mode-title">{modeLabels[dashboard.data?.mode ?? ''] ?? 'Загрузка режима'}</div><div className="mode-state">{dashboard.data?.mode === 'paused' ? 'приостановлен' : 'активен'}</div></div>
                <p>Сценарий меняет только учебные значения в демонстрационном контуре.</p>
              </div>
              <div className="scenario-actions">
                <button className={`scenario-btn ${dashboard.data?.mode === 'normal' ? 'selected' : ''}`} disabled={isBusy} onClick={() => handleScenario('normal')} data-testid="scenario-normal"><span>Обычный сценарий</span><span>01</span></button>
                <button className={`scenario-btn danger ${dashboard.data?.mode === 'danger' ? 'selected' : ''}`} disabled={isBusy} onClick={() => handleScenario('danger')} data-testid="scenario-danger"><span>Опасный сценарий</span><span>02</span></button>
                <button className={`scenario-btn ${dashboard.data?.mode === 'paused' ? 'selected' : ''}`} disabled={isBusy} onClick={() => handleScenario('pause')} data-testid="scenario-pause"><span><CirclePause size={13} style={{ verticalAlign: 'middle', marginRight: 7 }} />Пауза</span><span>03</span></button>
                <button className="scenario-btn" disabled={isBusy} onClick={() => handleScenario('reset')} data-testid="scenario-reset"><span><RotateCcw size={13} style={{ verticalAlign: 'middle', marginRight: 7 }} />Сброс данных</span><span>↺</span></button>
              </div>
            </section>
          </div>

          <div className="below-grid">
            <section className="panel" id="history" aria-labelledby="history-title">
              <div className="panel-head"><div><div className="panel-title" id="history-title">История модельных измерений</div><div className="panel-sub">Температура по точкам наблюдения · последние данные API</div></div><span className="tiny-tag">°C</span></div>
              {measurementsQuery.isLoading ? <div className="chart-area"><div className="skeleton" style={{ height: '100%', opacity: .5 }} /></div> : measurementsQuery.isError ? <div className="error-state">История временно недоступна<br /><button className="retry-btn" onClick={() => measurementsQuery.refetch()} data-testid="button-retry-history">Повторить</button></div> : chartData.length ? <div className="chart-area" data-testid="chart-measurements">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 3 }}>
                    <CartesianGrid strokeDasharray="3 5" stroke="#e8e6dd" vertical={false} />
                    <XAxis dataKey="timeLabel" tick={{ fill: '#929990', fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis tick={{ fill: '#929990', fontSize: 9 }} tickLine={false} axisLine={false} />
                    <ChartTooltip contentStyle={{ border: '1px solid #e4e0d5', borderRadius: 9, background: '#faf9f4', fontSize: 11 }} formatter={(value: number, name: string) => [`${value} ${name === 'temperature' ? '°C' : '%'}`, name === 'temperature' ? 'Температура' : 'Влажность']} labelFormatter={(label) => `Время: ${label}`} />
                    <Line type="monotone" dataKey="temperature" stroke="#c67848" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#c67848', stroke: '#faf9f4', strokeWidth: 2 }} />
                    <Line type="monotone" dataKey="humidity" stroke="#668b72" strokeWidth={1.8} dot={false} activeDot={{ r: 3, fill: '#668b72' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div> : <div className="chart-empty" data-testid="empty-measurements">История появится после поступления измерений.</div>}
            </section>
            <section className="panel" id="alerts" aria-labelledby="alerts-title">
              <div className="panel-head"><div><div className="panel-title" id="alerts-title">Последние сигналы</div><div className="panel-sub">Модельные события из учебного сценария</div></div><span className="tiny-tag">{alerts.filter((alert) => alert.status === 'new').length} новых</span></div>
              {alertsQuery.isLoading && !alerts.length ? <div className="loading-state">Загружаем сигналы…</div> : alertsQuery.isError && !alerts.length ? <div className="error-state">Не удалось загрузить сигналы<br /><button className="retry-btn" onClick={() => alertsQuery.refetch()} data-testid="button-retry-alerts">Повторить</button></div> : alerts.length ? <div className="alert-list">
                {alerts.slice(0, 6).map((alert) => <div className="alert-item" key={alert.id} data-testid={`alert-item-${alert.id}`}>
                  <div className={`alert-mark ${alert.status === 'handled' ? 'handled' : ''}`} />
                  <div><div className="alert-name">{alert.stationName}</div><div className="alert-reason">{alert.reason}</div><div className="alert-time">{prettyDate(alert.occurredAt, true)} · {alert.status === 'handled' ? 'обработан' : 'новый'}</div></div>
                  <div className="alert-side"><span className={`risk-chip ${alert.level}`}>{levelLabels[alert.level] ?? alert.level}</span><button className="handle-btn" disabled={updateAlert.isPending} onClick={() => handleAlert(alert)} data-testid={`button-handle-alert-${alert.id}`}>{alert.status === 'handled' ? 'Вернуть' : 'Обработать'}</button></div>
                </div>)}
              </div> : <div className="empty-state" data-testid="empty-alerts"><ShieldCheck size={22} style={{ display: 'block', margin: '0 auto 8px', color: '#729078' }} />Новых сигналов нет. Это модельная сводка, не оценка реальной обстановки.</div>}
            </section>
          </div>

          <section className="panel table-panel" id="stations" aria-labelledby="stations-title">
            <div className="panel-head">
              <div><div className="panel-title section-title" id="stations-title"><Leaf /> Станции мониторинга</div><div className="panel-sub">Модельные данные по всем зарегистрированным точкам</div></div>
              <button className="button-primary" onClick={() => setModalStation(null)} data-testid="button-add-station"><Plus /> Добавить станцию</button>
            </div>
            {stationsQuery.isLoading && !stations.length ? <div className="loading-state">Загружаем станции…</div> : stationsQuery.isError && !stations.length ? <div className="error-state">Не удалось загрузить станции<br /><button className="retry-btn" onClick={() => stationsQuery.refetch()} data-testid="button-retry-stations">Повторить</button></div> : stations.length ? <div className="table-wrap">
              <table>
                <thead><tr><th>Станция / регион</th><th>Риск</th><th>Температура</th><th>Влажность</th><th>Дым</th><th>Активна</th><th><span className="sr-only">Действия</span></th></tr></thead>
                <tbody>{stations.map((station) => <tr key={station.id} data-testid={`station-row-${station.id}`}>
                  <td><div className="station-cell">{station.name}</div><div className="station-region">{station.region}</div></td>
                  <td><span className={`level ${station.level}`} data-testid={`station-level-${station.id}`}>{levelLabels[station.level] ?? station.level} · {station.risk}</span></td>
                  <td>{station.temperature} °C</td><td>{station.humidity}%</td><td>{station.smoke}</td>
                  <td><button className={`switch ${station.enabled ? 'on' : ''}`} role="switch" aria-checked={station.enabled} aria-label={`${station.enabled ? 'Отключить' : 'Включить'} станцию ${station.name}`} onClick={() => toggleStation(station)} disabled={updateStation.isPending} data-testid={`toggle-station-${station.id}`}><span /></button></td>
                  <td><div className="row-actions"><button className="icon-btn" aria-label={`Редактировать ${station.name}`} onClick={() => setModalStation(station)} data-testid={`edit-station-${station.id}`}><Pencil /></button><button className="icon-btn delete" aria-label={`Удалить ${station.name}`} onClick={() => removeStation(station)} disabled={deleteStation.isPending} data-testid={`delete-station-${station.id}`}><Trash2 /></button></div></td>
                </tr>)}</tbody>
              </table>
            </div> : <div className="empty-state" data-testid="empty-stations">Станций пока нет. Добавьте первую точку, чтобы увидеть её на карте.</div>}
          </section>
          <div className="footer-note">FireWatch AI · учебные данные · не использовать для принятия оперативных решений</div>
        </main>
      </div>

      {modalStation !== undefined && <StationModal station={modalStation} saving={createStation.isPending || updateStation.isPending} onClose={() => setModalStation(undefined)} onSubmit={submitStation} />}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status" data-testid="toast-result">{toast.text}</div>}
    </div>
  );
}

function StationModal({ station, saving, onClose, onSubmit }: { station: Station | null; saving: boolean; onClose: () => void; onSubmit: (input: StationInput) => void }) {
  const [name, setName] = useState(station?.name ?? '');
  const [region, setRegion] = useState(station?.region ?? '');
  const [latitude, setLatitude] = useState(String(station?.latitude ?? ''));
  const [longitude, setLongitude] = useState(String(station?.longitude ?? ''));
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!name.trim() || !region.trim()) { setError('Укажите название станции и регион.'); return; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { setError('Координаты должны быть в диапазоне широты −90…90 и долготы −180…180.'); return; }
    setError('');
    onSubmit({ name: name.trim(), region: region.trim(), latitude: lat, longitude: lon });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="station-modal-title">
      <div className="modal-head"><h2 id="station-modal-title">{station ? 'Редактирование станции' : 'Новая станция'}</h2><button className="modal-close" aria-label="Закрыть" onClick={onClose} disabled={saving} data-testid="button-close-station-modal">×</button></div>
      <form className="modal-form" onSubmit={submit}>
        <div className="field"><label htmlFor="station-name">Название</label><input id="station-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Северный кордон" required data-testid="input-station-name" /></div>
        <div className="field"><label htmlFor="station-region">Регион</label><input id="station-region" value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Республика Карелия" required data-testid="input-station-region" /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="station-lat">Широта</label><input id="station-lat" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="61.5240" required data-testid="input-station-latitude" /></div>
          <div className="field"><label htmlFor="station-lon">Долгота</label><input id="station-lon" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="105.3188" required data-testid="input-station-longitude" /></div>
        </div>
        {error && <div className="form-error" role="alert" data-testid="station-form-error">{error}</div>}
        <div className="form-actions"><button className="button-quiet" type="button" onClick={onClose} disabled={saving} data-testid="button-cancel-station">Отмена</button><button className="button-primary" type="submit" disabled={saving} data-testid="button-save-station">{saving ? 'Сохраняем…' : station ? 'Сохранить' : 'Добавить'}</button></div>
      </form>
    </section>
  </div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><AppView /></QueryClientProvider>;
}

export default App;
