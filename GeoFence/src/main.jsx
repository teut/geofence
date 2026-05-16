import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Geolocation } from "@capacitor/geolocation";
import { Haptics } from "@capacitor/haptics";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Crosshair,
  Eraser,
  FolderOpen,
  MapPinned,
  PanelBottomClose,
  Save,
  Settings,
  X
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "geofence-polygons";
const SETTINGS_KEY = "geofence-settings";
const DEFAULT_CENTER = [50.8503, 4.3517];
const DEFAULT_SETTINGS = {
  showGpsStatus: true,
  defaultZoom: 16,
  beepEnabled: true
};

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return true;
  const [lat, lon] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const crosses = lonI > lon !== lonJ > lon;
    if (crosses) {
      const intersectionLat = ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI;
      if (lat < intersectionLat) inside = !inside;
    }
  }

  return inside;
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modalShell" role="dialog" aria-modal="true">
      <div className="modalBackdrop" onClick={onClose} />
      <section className="modalPanel">
        <header className="modalHeader">
          <h2>{title}</h2>
          <button className="iconButton" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="modalBody">{children}</div>
        {footer ? <footer className="modalFooter">{footer}</footer> : null}
      </section>
    </div>
  );
}

function CoordinateEditor({ points, onChange }) {
  const updatePoint = (index, field, value) => {
    const next = points.map((point, pointIndex) => {
      if (pointIndex !== index) return point;
      return field === "lat" ? [value, point[1]] : [point[0], value];
    });
    onChange(next);
  };

  return (
    <div className="coordEditor">
      {points.map(([lat, lon], index) => (
        <div className="coordRow" key={index}>
          <span className="coordIndex">{index + 1}</span>
          <label>
            Lat
            <input
              inputMode="decimal"
              value={lat}
              onChange={(event) => updatePoint(index, "lat", event.target.value)}
            />
          </label>
          <label>
            Lon
            <input
              inputMode="decimal"
              value={lon}
              onChange={(event) => updatePoint(index, "lon", event.target.value)}
            />
          </label>
          <button
            className="iconButton ghost"
            onClick={() => onChange(points.filter((_, pointIndex) => pointIndex !== index))}
            aria-label="Remove coordinate"
          >
            <X size={17} />
          </button>
        </div>
      ))}
      <button className="secondaryButton fullWidth" onClick={() => onChange([...points, ["", ""]])}>
        Add coordinate
      </button>
    </div>
  );
}

function App() {
  const [points, setPoints] = useState([]);
  const [closed, setClosed] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [savedPolygons, setSavedPolygons] = useState(() => loadJson(STORAGE_KEY, []));
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadJson(SETTINGS_KEY, {}) }));
  const [position, setPosition] = useState(null);
  const [geoError, setGeoError] = useState("");
  const [watching, setWatching] = useState(false);
  const [outside, setOutside] = useState(false);

  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const polygonRef = useRef(null);
  const locationRef = useRef(null);
  const audioRef = useRef(null);
  const wasOutsideRef = useRef(false);

  const validPoints = useMemo(
    () =>
      points
        .map(([lat, lon]) => [toNumber(lat), toNumber(lon)])
        .filter(([lat, lon]) => lat !== null && lon !== null),
    [points]
  );

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const unlockAudio = () => {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioRef.current) audioRef.current = new AudioContext();
      audioRef.current.resume?.();
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, []);

  useEffect(() => {
    const map = L.map("map", {
      zoomControl: false,
      attributionControl: false,
      doubleClickZoom: false
    }).setView(DEFAULT_CENTER, settings.defaultZoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      crossOrigin: true
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    map.on("click", (event) => {
      setPoints((current) => [
        ...current,
        [Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))]
      ]);
      setClosed(false);
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = validPoints.map((point, index) =>
      L.marker(point, {
        title: `Point ${index + 1}`,
        icon: L.divIcon({
          className: "pointMarker",
          html: `<span>${index + 1}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map)
    );

    polygonRef.current?.remove();
    polygonRef.current = null;

    if (validPoints.length >= 2) {
      const layer = closed && validPoints.length >= 3 ? L.polygon : L.polyline;
      polygonRef.current = layer(validPoints, {
        color: outside ? "#ff405c" : "#4ee0a2",
        fillColor: "#4ee0a2",
        fillOpacity: closed ? 0.16 : 0,
        weight: 4,
        lineCap: "round"
      }).addTo(map);
    }
  }, [validPoints, closed, outside]);

  useEffect(() => {
    let cancelled = false;
    let nativeWatchId = null;
    let webWatchId = null;

    const applyReading = (reading) => {
      if (cancelled || !reading?.coords) return;
      const next = {
        lat: reading.coords.latitude,
        lon: reading.coords.longitude,
        accuracy: reading.coords.accuracy
      };
      setPosition(next);
      setGeoError("");
      setWatching(true);

      const map = mapRef.current;
      if (!map) return;
      const latLng = [next.lat, next.lon];
      if (!locationRef.current) {
        locationRef.current = L.circleMarker(latLng, {
          radius: 9,
          color: "#ffffff",
          weight: 3,
          fillColor: "#2f7cff",
          fillOpacity: 1
        }).addTo(map);
        map.setView(latLng, settings.defaultZoom);
      } else {
        locationRef.current.setLatLng(latLng);
      }
    };

    const applyError = (error) => {
      setGeoError(error?.message || "Location permission is needed.");
      setWatching(false);
    };

    const startWebWatching = () => {
      if (cancelled || webWatchId || !navigator.geolocation) return false;
      webWatchId = navigator.geolocation.watchPosition(applyReading, applyError, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 12000
      });
      return true;
    };

    const startWatching = async () => {
      try {
        if (window.Capacitor?.isNativePlatform?.()) {
          const permissions = await Geolocation.requestPermissions();
          if (permissions.location === "denied") {
            applyError(new Error("Location permission is blocked."));
            return;
          }

          Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
          })
            .then(applyReading)
            .catch(applyError);

          nativeWatchId = await Geolocation.watchPosition(
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
            (reading, error) => {
              if (error) applyError(error);
              else applyReading(reading);
            }
          );
          return;
        }

        if (!startWebWatching()) {
          applyError(new Error("Location is not available in this browser."));
        }
      } catch (error) {
        applyError(error);
      }
    };

    startWatching();

    return () => {
      cancelled = true;
      if (nativeWatchId && window.Capacitor?.isNativePlatform?.()) {
        Geolocation.clearWatch({ id: nativeWatchId }).catch(() => {});
      }
      if (webWatchId && navigator.geolocation) {
        navigator.geolocation.clearWatch(webWatchId);
      }
    };
  }, [settings.defaultZoom]);

  useEffect(() => {
    if (!position || !closed || validPoints.length < 3) {
      setOutside(false);
      return;
    }
    setOutside(!pointInPolygon([position.lat, position.lon], validPoints));
  }, [position, validPoints, closed]);

  useEffect(() => {
    const wasOutside = wasOutsideRef.current;
    wasOutsideRef.current = outside;
    if (!outside || wasOutside) return;

    const vibrate = async () => {
      if (window.Capacitor?.isNativePlatform?.()) {
        try {
          await Haptics.vibrate({ duration: 250 });
          return;
        } catch {
          // Fall through to the browser vibration API when native haptics are unavailable.
        }
      }
      navigator.vibrate?.(250);
    };

    vibrate();
    if (!settings.beepEnabled) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioRef.current) audioRef.current = new AudioContext();
    const context = audioRef.current;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.34);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
  }, [outside, settings.beepEnabled]);

  const focusBoundary = () => {
    if (!validPoints.length || !mapRef.current) return;
    mapRef.current.fitBounds(L.latLngBounds(validPoints), { padding: [48, 48] });
  };

  const savePolygon = () => {
    if (validPoints.length < 3) return;
    const polygon = {
      id: crypto.randomUUID(),
      name: saveName.trim() || `Boundary ${savedPolygons.length + 1}`,
      points: validPoints,
      savedAt: new Date().toISOString()
    };
    const next = [polygon, ...savedPolygons];
    setSavedPolygons(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSelectedSavedId(polygon.id);
    setSaveName("");
  };

  const loadPolygon = () => {
    const found = savedPolygons.find((polygon) => polygon.id === selectedSavedId);
    if (!found) return;
    setPoints(found.points);
    setClosed(true);
    setActiveModal(null);
    window.setTimeout(() => {
      mapRef.current?.fitBounds(L.latLngBounds(found.points), { padding: [48, 48] });
    }, 60);
  };

  const deletePolygon = () => {
    const next = savedPolygons.filter((polygon) => polygon.id !== selectedSavedId);
    setSavedPolygons(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSelectedSavedId(next[0]?.id || "");
  };

  const selectedSaved = savedPolygons.find((polygon) => polygon.id === selectedSavedId);
  const editorPoints = points.length ? points : [["", ""], ["", ""], ["", ""]];

  return (
    <main className="appShell">
      <div id="map" className="mapCanvas" />

      {settings.showGpsStatus ? (
        <aside className="gpsPill">
          <div className={`gpsDot ${watching ? "live" : ""}`} />
          {position ? (
            <div>
              <strong>
                {position.lat.toFixed(6)}, {position.lon.toFixed(6)}
              </strong>
              <span>Accuracy {Math.round(position.accuracy)} m</span>
            </div>
          ) : (
            <div>
              <strong>{geoError ? "GPS blocked" : "Finding GPS"}</strong>
              <span>{geoError || "Waiting for iPhone location"}</span>
            </div>
          )}
        </aside>
      ) : null}

      <section className={`statusCard ${outside ? "alert" : ""}`}>
        <div>
          <span className="eyebrow">{closed ? "Boundary armed" : "Draft boundary"}</span>
          <h1>{outside ? "Outside boundary" : "GeoFence"}</h1>
        </div>
        <button className="iconButton glass" onClick={focusBoundary} aria-label="Focus boundary">
          <Crosshair size={21} />
        </button>
      </section>

      <nav className="bottomBar" aria-label="Boundary tools">
        <button onClick={() => setActiveModal("coords")}>
          <MapPinned size={21} />
          <span>Coords</span>
        </button>
        <button onClick={() => setActiveModal("library")}>
          <FolderOpen size={21} />
          <span>Saved</span>
        </button>
        <button onClick={() => setClosed(true)} disabled={validPoints.length < 3}>
          <PanelBottomClose size={21} />
          <span>Close</span>
        </button>
        <button
          onClick={() => {
            setPoints([]);
            setClosed(false);
          }}
        >
          <Eraser size={21} />
          <span>Clear</span>
        </button>
        <button onClick={() => setActiveModal("settings")}>
          <Settings size={21} />
          <span>Settings</span>
        </button>
      </nav>

      {activeModal === "coords" ? (
        <Modal
          title="Manual Coordinates"
          onClose={() => setActiveModal(null)}
          footer={
            <button
              className="primaryButton"
              disabled={validPoints.length < 3}
              onClick={() => {
                setClosed(true);
                setActiveModal(null);
                focusBoundary();
              }}
            >
              Apply boundary
            </button>
          }
        >
          <p className="hint">Enter latitude and longitude pairs. You can also keep adding points by tapping the map.</p>
          <CoordinateEditor points={editorPoints} onChange={setPoints} />
        </Modal>
      ) : null}

      {activeModal === "library" ? (
        <Modal
          title="Save / Load"
          onClose={() => setActiveModal(null)}
          footer={
            <div className="footerGrid">
              <button className="secondaryButton" disabled={!selectedSavedId} onClick={deletePolygon}>
                Delete
              </button>
              <button className="primaryButton" disabled={!selectedSaved} onClick={loadPolygon}>
                Load selected
              </button>
            </div>
          }
        >
          <label className="stackedLabel">
            Boundary name
            <div className="saveRow">
              <input value={saveName} placeholder="Home, site, route..." onChange={(event) => setSaveName(event.target.value)} />
              <button className="iconButton accent" disabled={validPoints.length < 3} onClick={savePolygon} aria-label="Save polygon">
                <Save size={20} />
              </button>
            </div>
          </label>
          <label className="stackedLabel">
            Stored polygons
            <select value={selectedSavedId} onChange={(event) => setSelectedSavedId(event.target.value)}>
              <option value="">{savedPolygons.length ? "Choose a polygon" : "No saved polygons yet"}</option>
              {savedPolygons.map((polygon) => (
                <option key={polygon.id} value={polygon.id}>
                  {polygon.name} ({polygon.points.length} pts)
                </option>
              ))}
            </select>
          </label>
          {selectedSaved ? <p className="hint">Saved {new Date(selectedSaved.savedAt).toLocaleString()}</p> : null}
        </Modal>
      ) : null}

      {activeModal === "settings" ? (
        <Modal title="Settings" onClose={() => setActiveModal(null)}>
          <label className="toggleRow">
            <span>Show GPS status</span>
            <input
              type="checkbox"
              checked={settings.showGpsStatus}
              onChange={(event) => setSettings({ ...settings, showGpsStatus: event.target.checked })}
            />
          </label>
          <label className="toggleRow">
            <span>Beep when outside</span>
            <input
              type="checkbox"
              checked={settings.beepEnabled}
              onChange={(event) => setSettings({ ...settings, beepEnabled: event.target.checked })}
            />
          </label>
          <label className="stackedLabel">
            Default map zoom
            <input
              type="number"
              min="3"
              max="20"
              value={settings.defaultZoom}
              onChange={(event) => setSettings({ ...settings, defaultZoom: Number(event.target.value) })}
            />
          </label>
        </Modal>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
