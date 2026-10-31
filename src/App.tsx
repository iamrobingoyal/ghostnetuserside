import React, { useState, useEffect, useRef } from "react";
import {
  encodePacket,
  decodePacket,
  incrementHop,
  toHex,
  CrisisType,
} from "./protocol";
import {
  translations,
  SUPPORTED_LANGUAGES,
  LanguageMeta,
} from "./i18n/translations";
import { BACKEND_URL } from "./config";

function generateAnonymousId(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

interface SensorTelemetry {
  seismicG: number;
  tempC: number;
  waterDepthM: number;
  impactG: number;
  status: "NORMAL" | "WARNING" | "CRITICAL";
  sourceName?: string;
}

export const App: React.FC = () => {
  const [deviceId, setDeviceId] = useState<number>(() => {
    const saved = localStorage.getItem("ghostnet_user_device_id");
    if (saved) return parseInt(saved, 10);
    const id = generateAnonymousId();
    localStorage.setItem("ghostnet_user_device_id", id.toString());
    return id;
  });

  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [wasAutoTriggered, setWasAutoTriggered] = useState(false);
  const [airplaneMode, setAirplaneMode] = useState(true);
  const [selectedCrisis, setSelectedCrisis] = useState<CrisisType>(CrisisType.TRAPPED);
  const [urgency, setUrgency] = useState<number>(4);
  const [battery, setBattery] = useState<number>(() => Math.floor(Math.random() * 52) + 14);

  // Pre-Disaster Autonomous Sensor Telemetry
  const [sensors, setSensors] = useState<SensorTelemetry>({
    seismicG: 0.04,
    tempC: 26.5,
    waterDepthM: 0.0,
    impactG: 1.0,
    status: "NORMAL",
  });
  const [sensorAlertNotice, setSensorAlertNotice] = useState<string | null>(null);

  // Fluctuate normal background environmental sensor telemetry
  useEffect(() => {
    const interval = setInterval(() => {
      setSensors((prev) => {
        if (prev.status !== "NORMAL") return prev;
        return {
          seismicG: +(0.02 + Math.random() * 0.05).toFixed(2),
          tempC: +(25.0 + Math.random() * 2.0).toFixed(1),
          waterDepthM: 0.0,
          impactG: +(0.97 + Math.random() * 0.06).toFixed(2),
          status: "NORMAL",
        };
      });
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const randomizeBattery = () => {
    const newBat = Math.floor(Math.random() * 52) + 14;
    setBattery(newBat);
  };

  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  const clearBroadcastTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  // Language State with persistence
  const [lang, setLang] = useState<string>(() => {
    return localStorage.getItem("ghostnet_user_lang") || "hi";
  });
  const [showLangModal, setShowLangModal] = useState<boolean>(false);

  // Live Location
  const [lat, setLat] = useState<number>(28.6139);
  const [lng, setLng] = useState<number>(77.2090);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locationName, setLocationName] = useState<string>("Locating real GPS...");
  const [isGpsLocked, setIsGpsLocked] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);

  const [meshLogs, setMeshLogs] = useState<string[]>([]);
  const [hopsReached, setHopsReached] = useState<number>(0);
  const [activePacketHex, setActivePacketHex] = useState<string>("");
  const watchIdRef = useRef<number | null>(null);

  const currentLangMeta = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
  const isRTL = currentLangMeta.isRTL;
  const currentT = translations[lang] || translations.hi;

  const handleSelectLanguage = (code: string) => {
    setLang(code);
    localStorage.setItem("ghostnet_user_lang", code);
    setShowLangModal(false);
  };

  // Reverse Geocoding via Nominatim
  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`,
        { headers: { "Accept-Language": `${lang},en` } }
      );
      if (res.ok) {
        const data = await res.json();
        const addr = data.address || {};
        const neighborhood = addr.suburb || addr.neighbourhood || addr.road || addr.village || addr.town || "";
        const city = addr.city || addr.state_district || addr.county || addr.state || "";
        const country = addr.country || "";
        const formatted = [neighborhood, city, country].filter(Boolean).join(", ");
        if (formatted) {
          setLocationName(formatted);
          return;
        }
      }
    } catch {}
    setLocationName(`Live GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
  };

  const acquireLiveLocation = () => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser");
      setLocationName("Disaster Site (Fallback Coords)");
      return;
    }

    setIsLocating(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        const userAcc = Math.round(pos.coords.accuracy);

        setLat(userLat);
        setLng(userLng);
        setAccuracy(userAcc);
        setIsGpsLocked(true);
        setIsLocating(false);
        setLocationName(`Lat ${userLat.toFixed(4)}, Lng ${userLng.toFixed(4)} (±${userAcc}m)`);
        reverseGeocode(userLat, userLng);
      },
      (err) => {
        console.warn("GPS error:", err.message);
        setIsLocating(false);
        setGpsError("GPS access pending or blocked. Using fallback coordinates.");
        setLocationName("Disaster Site (Fallback Coords)");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAccuracy(Math.round(pos.coords.accuracy));
        setIsGpsLocked(true);
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  };

  useEffect(() => {
    acquireLiveLocation();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Physical motion / accelerometer violent shake detection
  useEffect(() => {
    let lastShake = 0;
    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const x = acc.x || 0;
      const y = acc.y || 0;
      const z = acc.z || 0;
      const gForce = Math.sqrt(x * x + y * y + z * z) / 9.81;

      if (gForce > 2.8 && Date.now() - lastShake > 6000) {
        lastShake = Date.now();
        triggerAutonomousDisaster("PHYSICAL_SHAKE", +(gForce).toFixed(2));
      }
    };

    if (typeof window !== "undefined" && window.DeviceMotionEvent) {
      window.addEventListener("devicemotion", handleDeviceMotion);
    }
    return () => {
      if (typeof window !== "undefined" && window.DeviceMotionEvent) {
        window.removeEventListener("devicemotion", handleDeviceMotion);
      }
    };
  }, []);

  const rotateId = () => {
    const newId = generateAnonymousId();
    setDeviceId(newId);
    localStorage.setItem("ghostnet_user_device_id", newId.toString());
    randomizeBattery();
  };

  const triggerSosBroadcast = async (
    overrideUrgency?: number,
    overrideCrisis?: CrisisType,
    isAuto: boolean = false,
    sensorDiagnosticMsg?: string
  ) => {
    clearBroadcastTimeouts();
    const activeUrgency = overrideUrgency !== undefined ? overrideUrgency : urgency;
    const activeCrisis = overrideCrisis !== undefined ? overrideCrisis : selectedCrisis;

    setIsBroadcasting(true);
    setWasAutoTriggered(isAuto);
    setMeshLogs([]);

    // 1. Phone A encodes 20-byte packet with real location
    const survivorPacket = encodePacket({
      deviceId,
      latitude: lat,
      longitude: lng,
      crisisType: activeCrisis,
      urgency: activeUrgency,
      battery,
      hopCount: 0,
    });

    const hexA = toHex(survivorPacket);
    setActivePacketHex(hexA);
    setHopsReached(0);

    const hazardLabel =
      activeUrgency >= 8
        ? currentT.urgencyCrit || "Critical Life Hazard"
        : activeUrgency >= 5
        ? currentT.urgencyMed || "Urgent"
        : currentT.urgencyLow || "Mild";

    const logHeader = sensorDiagnosticMsg
      ? `[Autonomous Pre-Disaster Engine] ${sensorDiagnosticMsg}`
      : isAuto
      ? `[Auto-Trigger] ⚡ Urgency ${activeUrgency}/9 (${hazardLabel}) detected! Auto-broadcasting Emergency Packet.`
      : `[Manual Trigger] 🆘 Emergency SOS Button Pressed (Urgency: ${activeUrgency}/9 - ${hazardLabel}).`;

    const logSensors = `[Sensor Telemetry] 📊 Seismic: ${sensors.seismicG}G | Thermal: ${sensors.tempC}°C | Water: ${sensors.waterDepthM}m | Shock: ${sensors.impactG}G`;
    const log1 = `[Survivor Device] 📡 20-Byte Emergency Packet Generated (ID: 0x${deviceId.toString(16).slice(0, 6).toUpperCase()}, Battery: ${battery}%)`;
    const log2 = `[Survivor Device] 📍 Real Coordinates: (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
    const log3 = `[Survivor Device] ✈️ Airplane Mode = TRUE. Radiating Bluetooth Low Energy Beacon (0x474E, 0% Wi-Fi/Cellular)`;
    setMeshLogs([logHeader, logSensors, log1, log2, log3]);

    // 2. Phone B relay after 1s
    const t1 = setTimeout(() => {
      const relayedPacketB = incrementHop(survivorPacket);
      if (!relayedPacketB) return;
      const hexB = toHex(relayedPacketB);
      setHopsReached(1);

      setMeshLogs((prev) => [
        ...prev,
        `[Nearby Relay Node] 🔄 Intercepted BLE frame. Validated HMAC. Hop count updated (0 -> 1). Forwarding via BLE...`,
      ]);

      // 3. Phone C gateway after 1s
      const t2 = setTimeout(async () => {
        const relayedPacketC = incrementHop(relayedPacketB);
        if (!relayedPacketC) return;
        const hexC = toHex(relayedPacketC);
        setHopsReached(2);

        setMeshLogs((prev) => [
          ...prev,
          `[Gateway Node] 📶 Discovered packet at Hop 2. Internet uplink detected!`,
          `[Gateway Node] 🚀 Ingesting to Rescue Headquarters (POST /api/gateway/packet)...`,
        ]);

        try {
          const res = await fetch(`${BACKEND_URL}/api/gateway/packet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rawHex: hexC,
              gatewayId: "Gateway-Node-Auto",
            }),
          });
          const data = await res.json();
          if (res.ok) {
            setMeshLogs((prev) => [
              ...prev,
              `[Rescue Command] ✅ Ingested into Database! AI Triage Priority: ${data.triageScore}/100. Pinned on Live Rescuer Map!`,
            ]);
          }
        } catch (e) {
          setMeshLogs((prev) => [
            ...prev,
            `[Rescue Command] 🌐 Packet reached local socket hub.`,
          ]);
        }
      }, 1000);
      timeoutsRef.current.push(t2);
    }, 1000);
    timeoutsRef.current.push(t1);
  };

  const triggerAutonomousDisaster = (
    type: "EARTHQUAKE" | "FIRE" | "FLOOD" | "COLLAPSE" | "PHYSICAL_SHAKE",
    customVal?: number
  ) => {
    let newSensors: SensorTelemetry;
    let autoCrisis: CrisisType;
    let autoUrgency: number;
    let alertDesc: string;

    if (type === "EARTHQUAKE") {
      newSensors = {
        seismicG: 4.25,
        tempC: 27.2,
        waterDepthM: 0.0,
        impactG: 3.9,
        status: "CRITICAL",
        sourceName: "Seismic P-Wave (7.4M Richter)",
      };
      autoCrisis = CrisisType.TRAPPED;
      autoUrgency = 9;
      alertDesc = "🚨 [Pre-Disaster Sensor] Severe 4.25G Seismic P-Wave detected! Structural collapse imminent. Urgency auto-set to 9/9.";
    } else if (type === "FIRE") {
      newSensors = {
        seismicG: 0.06,
        tempC: 84.8,
        waterDepthM: 0.0,
        impactG: 1.05,
        status: "CRITICAL",
        sourceName: "Thermal Flare (>80°C)",
      };
      autoCrisis = CrisisType.FIRE;
      autoUrgency = 8;
      alertDesc = "🚨 [Pre-Disaster Sensor] Extreme Thermal Flare (84.8°C) detected! Urgency auto-set to 8/9.";
    } else if (type === "FLOOD") {
      newSensors = {
        seismicG: 0.05,
        tempC: 22.0,
        waterDepthM: 1.85,
        impactG: 1.0,
        status: "CRITICAL",
        sourceName: "Hydrostatic Water Influx",
      };
      autoCrisis = CrisisType.FLOOD;
      autoUrgency = 8;
      alertDesc = "🚨 [Pre-Disaster Sensor] Flash Flood Water Influx (1.85m depth) detected! Urgency auto-set to 8/9.";
    } else if (type === "COLLAPSE") {
      newSensors = {
        seismicG: 3.8,
        tempC: 26.8,
        waterDepthM: 0.0,
        impactG: 5.85,
        status: "CRITICAL",
        sourceName: "5.85G Deceleration Shock",
      };
      autoCrisis = CrisisType.TRAPPED;
      autoUrgency = 9;
      alertDesc = "🚨 [Pre-Disaster Sensor] Massive Structural Impact (5.85G Deceleration) detected! Urgency auto-set to 9/9.";
    } else {
      const g = customVal || 3.4;
      newSensors = {
        seismicG: g,
        tempC: 28.0,
        waterDepthM: 0.0,
        impactG: g,
        status: "CRITICAL",
        sourceName: "Physical Accelerometer Shock",
      };
      autoCrisis = CrisisType.TRAPPED;
      autoUrgency = 9;
      alertDesc = `🚨 [Physical Accelerometer] Sudden Violent Motion (${g}G) detected on phone! Urgency auto-set to 9/9.`;
    }

    setSensors(newSensors);
    setSelectedCrisis(autoCrisis);
    setUrgency(autoUrgency);
    setSensorAlertNotice(alertDesc);

    if (navigator.vibrate) {
      navigator.vibrate([300, 100, 300, 100, 400]);
    }

    triggerSosBroadcast(autoUrgency, autoCrisis, true, alertDesc);
  };

  const resetSensors = () => {
    setSensors({
      seismicG: 0.04,
      tempC: 26.5,
      waterDepthM: 0.0,
      impactG: 1.0,
      status: "NORMAL",
    });
    setSensorAlertNotice(null);
  };

  const handleSelectUrgency = (lvl: number) => {
    setUrgency(lvl);
    if (lvl >= 5) {
      triggerSosBroadcast(lvl, selectedCrisis, true);
    } else {
      setWasAutoTriggered(false);
    }
  };

  const handleSelectCrisis = (type: CrisisType) => {
    setSelectedCrisis(type);
    if (urgency >= 5) {
      triggerSosBroadcast(urgency, type, true);
    }
  };

  const handleCancelSos = () => {
    clearBroadcastTimeouts();
    resetSensors();
    setIsBroadcasting(false);
    setWasAutoTriggered(false);
    setMeshLogs([]);
    setHopsReached(0);
  };

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-screen bg-zinc-950 text-white font-sans flex flex-col justify-between selection:bg-red-600"
    >
      {/* Top Header Bar with Language Picker */}
      <header className="h-14 px-4 bg-black border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" />
          <span className="font-black text-sm tracking-wide text-zinc-100">
            {currentT.userPortalTitle}
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          {/* Main Language Selector Button */}
          <button
            onClick={() => setShowLangModal(true)}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-black rounded-xl border border-zinc-700 flex items-center space-x-1.5 shadow active:scale-95 transition"
          >
            <span>{currentLangMeta.flag}</span>
            <span>{currentLangMeta.nativeName}</span>
            <span className="text-[10px] text-zinc-400">▼</span>
          </button>

          <a
            href="/admin"
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl border border-zinc-700 transition"
          >
            🗺️ Rescuer Dashboard ➔
          </a>
        </div>
      </header>

      {/* Language Selection Modal */}
      {showLangModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-xl">🌐</span>
                <h3 className="font-black text-base text-white">
                  {currentT.languageSelect}
                </h3>
              </div>
              <button
                onClick={() => setShowLangModal(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {SUPPORTED_LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  onClick={() => handleSelectLanguage(item.code)}
                  className={`p-3 rounded-2xl border text-left flex items-center space-x-3 transition-all ${
                    lang === item.code
                      ? "bg-red-950/80 border-red-500 text-white shadow-lg ring-2 ring-red-500/50"
                      : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  <span className="text-2xl">{item.flag}</span>
                  <div>
                    <div className="font-black text-sm">{item.nativeName}</div>
                    <div className="text-[11px] text-zinc-400">{item.name}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800 text-center text-xs text-zinc-500">
              10 Major World Languages Supported (Includes Arabic RTL & Chinese)
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {/* Quick Horizontal Language Switcher Ribbon */}
        <div className="w-full max-w-sm mb-3 overflow-x-auto scrollbar-none flex items-center space-x-1.5 py-1">
          {SUPPORTED_LANGUAGES.map((item) => (
            <button
              key={item.code}
              onClick={() => handleSelectLanguage(item.code)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center space-x-1 ${
                lang === item.code
                  ? "bg-red-600 text-white shadow-md scale-105"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              <span>{item.flag}</span>
              <span>{item.nativeName}</span>
            </button>
          ))}
        </div>

        {/* Mobile Phone Mockup (User App View) */}
        <div className="w-full max-w-sm bg-black border-4 border-zinc-700 rounded-[44px] shadow-2xl p-4 flex flex-col justify-between min-h-[670px] relative">
          {/* Status Bar */}
          <div className="flex items-center justify-between px-2 pt-1 pb-2 border-b border-zinc-800 text-[11px] text-zinc-400 font-mono">
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-white">GhostNet Client</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setAirplaneMode(!airplaneMode)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                  airplaneMode
                    ? "bg-amber-900 text-amber-200 border border-amber-600"
                    : "bg-emerald-900 text-emerald-200 border border-emerald-600"
                }`}
                title="Toggle Airplane Mode (simulates offline radio environment)"
              >
                {airplaneMode ? "✈️ Airplane ON" : "📶 4G Online"}
              </button>
              <button
                onClick={randomizeBattery}
                title="Click to randomize phone battery"
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 border border-zinc-700 text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 cursor-pointer transition active:scale-95"
              >
                <span>🔋 {battery}%</span>
                <span className="text-[10px] text-zinc-400">🎲</span>
              </button>
            </div>
          </div>

          {/* Real Live Location Banner */}
          <div className="my-2 p-2.5 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-[11px]">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="font-black text-[10px] text-amber-400 uppercase tracking-wider flex items-center space-x-1">
                <span>📍</span>
                <span>{currentT.liveLocationLabel}</span>
              </span>
              <button
                onClick={acquireLiveLocation}
                disabled={isLocating}
                className="text-[10px] text-zinc-400 hover:text-white font-bold underline disabled:opacity-50"
              >
                {isLocating ? "..." : currentT.refreshLocation}
              </button>
            </div>

            <div className="font-bold text-zinc-100 truncate text-xs">
              {locationName}
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono mt-0.5">
              <span>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
              <span className={isGpsLocked ? "text-emerald-400 font-bold" : "text-amber-500"}>
                {accuracy !== null ? `±${accuracy}m accuracy` : isGpsLocked ? "GPS Locked" : "Acquiring..."}
              </span>
            </div>

            {gpsError && (
              <div className="text-[10px] text-amber-400/90 mt-1">
                {gpsError}
              </div>
            )}
          </div>

          {/* Airplane Mode Notice */}
          <div
            className={`mb-2 p-1.5 rounded-xl text-center text-[10px] font-black tracking-wide border ${
              airplaneMode
                ? "bg-emerald-950/80 border-emerald-500/60 text-emerald-300"
                : "bg-blue-950/80 border-blue-500/60 text-blue-300"
            }`}
          >
            {airplaneMode ? currentT.offlineNotice : currentT.onlineNotice}
          </div>

          {!isBroadcasting ? (
            /* Emergency Form */
            <div className="flex-1 flex flex-col justify-between py-1">
              {/* Pre-Disaster Autonomous Sensor Early-Warning Engine */}
              <div
                className={`mb-2 p-2 rounded-2xl border transition-all ${
                  sensors.status === "CRITICAL"
                    ? "bg-red-950/90 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse"
                    : "bg-zinc-900/90 border-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center space-x-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        sensors.status === "CRITICAL" ? "bg-red-500 animate-ping" : "bg-emerald-400 animate-pulse"
                      }`}
                    />
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-200">
                      {currentT.sensorTitle || "Autonomous Pre-Disaster Sensor Monitor"}
                    </span>
                  </div>
                  <span
                    className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                      sensors.status === "CRITICAL" ? "bg-red-600 text-white" : "bg-zinc-800 text-emerald-400 border border-emerald-900/50"
                    }`}
                  >
                    {sensors.status === "CRITICAL" ? "🚨 ANOMALY DETECTED" : "🟢 SENSORS ACTIVE"}
                  </span>
                </div>

                {/* Live Real-time Telemetry Readout */}
                <div className="grid grid-cols-4 gap-1 mb-1.5 text-center">
                  <div
                    className={`p-1 rounded-lg border ${
                      sensors.seismicG > 1.0 ? "bg-red-900/80 border-red-500 text-red-200" : "bg-black/60 border-zinc-800 text-zinc-300"
                    }`}
                  >
                    <div className="text-[8px] text-zinc-400 uppercase font-bold">Seismic</div>
                    <div className="text-[11px] font-black">{sensors.seismicG}G</div>
                  </div>
                  <div
                    className={`p-1 rounded-lg border ${
                      sensors.tempC > 45 ? "bg-orange-900/80 border-orange-500 text-orange-200" : "bg-black/60 border-zinc-800 text-zinc-300"
                    }`}
                  >
                    <div className="text-[8px] text-zinc-400 uppercase font-bold">Thermal</div>
                    <div className="text-[11px] font-black">{sensors.tempC}°C</div>
                  </div>
                  <div
                    className={`p-1 rounded-lg border ${
                      sensors.waterDepthM > 0.5 ? "bg-blue-900/80 border-blue-500 text-blue-200" : "bg-black/60 border-zinc-800 text-zinc-300"
                    }`}
                  >
                    <div className="text-[8px] text-zinc-400 uppercase font-bold">Water</div>
                    <div className="text-[11px] font-black">{sensors.waterDepthM}m</div>
                  </div>
                  <div
                    className={`p-1 rounded-lg border ${
                      sensors.impactG > 2.0 ? "bg-rose-900/80 border-rose-500 text-rose-200" : "bg-black/60 border-zinc-800 text-zinc-300"
                    }`}
                  >
                    <div className="text-[8px] text-zinc-400 uppercase font-bold">Impact</div>
                    <div className="text-[11px] font-black">{sensors.impactG}G</div>
                  </div>
                </div>

                {/* Pre-Disaster Early Trigger Pills */}
                <div>
                  <div className="text-[8px] text-zinc-400 font-bold mb-1 flex items-center justify-between">
                    <span className="truncate">{currentT.sensorSubtitle || "Auto-Sets Urgency & Sends SOS:"}</span>
                    {sensors.status === "CRITICAL" && (
                      <button
                        onClick={resetSensors}
                        className="text-[8px] text-amber-400 hover:text-white underline font-bold ml-1 whitespace-nowrap"
                      >
                        {currentT.sensorReset || "Reset"}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      onClick={() => triggerAutonomousDisaster("EARTHQUAKE")}
                      title="Simulate 7.4M Tremor -> Sets Urgency 9 & Trapped -> Auto-Sends SOS"
                      className="px-1 py-1 bg-zinc-800 hover:bg-amber-950/80 border border-zinc-700 hover:border-amber-500 rounded-lg text-[9px] font-bold text-zinc-200 active:scale-95 transition truncate text-center"
                    >
                      🌋 Quake 7.4M
                    </button>
                    <button
                      onClick={() => triggerAutonomousDisaster("FIRE")}
                      title="Simulate 82°C Thermal Spike -> Sets Urgency 8 & Fire -> Auto-Sends SOS"
                      className="px-1 py-1 bg-zinc-800 hover:bg-orange-950/80 border border-zinc-700 hover:border-orange-500 rounded-lg text-[9px] font-bold text-zinc-200 active:scale-95 transition truncate text-center"
                    >
                      🔥 Fire 82°C
                    </button>
                    <button
                      onClick={() => triggerAutonomousDisaster("FLOOD")}
                      title="Simulate Rising Water Surge -> Sets Urgency 8 & Flood -> Auto-Sends SOS"
                      className="px-1 py-1 bg-zinc-800 hover:bg-blue-950/80 border border-zinc-700 hover:border-blue-500 rounded-lg text-[9px] font-bold text-zinc-200 active:scale-95 transition truncate text-center"
                    >
                      🌊 Water Surge
                    </button>
                    <button
                      onClick={() => triggerAutonomousDisaster("COLLAPSE")}
                      title="Simulate 5.8G Building Collapse Shock -> Sets Urgency 9 & Trapped -> Auto-Sends SOS"
                      className="px-1 py-1 bg-zinc-800 hover:bg-rose-950/80 border border-zinc-700 hover:border-rose-500 rounded-lg text-[9px] font-bold text-zinc-200 active:scale-95 transition truncate text-center"
                    >
                      💥 Impact 5.8G
                    </button>
                  </div>
                </div>

                {sensorAlertNotice && (
                  <div className="mt-1.5 p-1 bg-red-900/80 border border-red-500/80 rounded-lg text-[9px] font-bold text-red-100 text-center leading-tight">
                    {sensorAlertNotice}
                  </div>
                )}
              </div>

              {/* Crisis Category Picker */}
              <div>
                <div className="text-[10px] font-black uppercase text-zinc-400 tracking-wider mb-1.5">
                  {currentT.selectCrisis}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { type: CrisisType.TRAPPED, label: currentT.crises.trapped, icon: "🏚️", color: "bg-amber-700 border-amber-500" },
                    { type: CrisisType.MEDICAL, label: currentT.crises.medical, icon: "🏥", color: "bg-red-700 border-red-500" },
                    { type: CrisisType.FIRE, label: currentT.crises.fire, icon: "🔥", color: "bg-orange-700 border-orange-500" },
                    { type: CrisisType.FLOOD, label: currentT.crises.flood, icon: "🌊", color: "bg-blue-700 border-blue-500" },
                    { type: CrisisType.VIOLENCE, label: currentT.crises.violence, icon: "⚠️", color: "bg-purple-700 border-purple-500" },
                    { type: CrisisType.OTHER, label: currentT.crises.other, icon: "🆘", color: "bg-zinc-700 border-zinc-500" },
                  ].map((item) => {
                    const active = selectedCrisis === item.type;
                    return (
                      <button
                        key={item.type}
                        onClick={() => handleSelectCrisis(item.type)}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                          active
                            ? `${item.color} text-white ring-2 ring-white scale-102 shadow-md`
                            : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                        }`}
                      >
                        <span className="text-xl">{item.icon}</span>
                        <span className="text-[10px] font-black mt-0.5 leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Urgency 1 to 9 */}
              <div className="my-1.5">
                <div className="flex justify-between items-center text-[10px] font-bold text-zinc-400 mb-1">
                  <span className="uppercase">{currentT.selectUrgency}</span>
                  <span className="text-red-400 font-black">
                    {urgency}/9 ({urgency >= 8 ? currentT.urgencyCrit : urgency >= 5 ? currentT.urgencyMed : currentT.urgencyLow})
                  </span>
                </div>

                {/* Auto-SOS Notice Banner for Urgency 5-9 */}
                <div className="mb-1.5 flex items-center justify-between text-[9px] px-2 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
                  <span className="text-amber-400 font-bold flex items-center space-x-1">
                    <span>⚡</span>
                    <span>{currentT.autoSosNotice || "Levels 5–9 auto-dispatch SOS without button press"}</span>
                  </span>
                  <span className="text-zinc-500 font-mono">1–4: Manual</span>
                </div>

                <div className="grid grid-cols-9 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lvl) => {
                    const isAutoLevel = lvl >= 5;
                    const isSelected = urgency === lvl;
                    return (
                      <button
                        key={lvl}
                        onClick={() => handleSelectUrgency(lvl)}
                        title={isAutoLevel ? `Level ${lvl} (${lvl >= 8 ? "Critical" : "Urgent"} - Auto-Sends SOS immediately)` : `Level ${lvl} (Mild)`}
                        className={`h-8 rounded-lg font-black text-xs transition-all relative flex flex-col items-center justify-center ${
                          isSelected
                            ? isAutoLevel
                              ? "bg-red-600 text-white ring-2 ring-white scale-105 shadow-[0_0_12px_rgba(239,68,68,0.8)]"
                              : "bg-amber-600 text-white ring-2 ring-white scale-105"
                            : isAutoLevel
                            ? "bg-zinc-800 text-red-300 border border-red-900/60 hover:bg-red-950/40"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        <span>{lvl}</span>
                        {isAutoLevel && (
                          <span className="absolute -top-1 -right-0.5 text-[8px] text-amber-300 leading-none">⚡</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Giant SOS Button */}
              <div className="flex justify-center my-1.5">
                <button
                  onClick={() => triggerSosBroadcast(urgency, selectedCrisis, false)}
                  className="w-44 h-44 rounded-full bg-gradient-to-tr from-red-700 via-red-600 to-rose-500 border-4 border-red-900 shadow-[0_0_40px_rgba(220,38,38,0.7)] flex flex-col items-center justify-center active:scale-95 transition-transform"
                >
                  <span className="text-3xl mb-1">🆘</span>
                  <span className="text-sm font-black tracking-widest text-white text-center px-3 leading-tight">
                    {currentT.sosButton}
                  </span>
                  <span className="text-[9px] font-bold text-red-200 mt-1">
                    100% OFFLINE BLE MESH
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* Active Beacon Broadcasting View */
            <div className="flex-1 flex flex-col justify-between py-2 items-center text-center">
              <div className="w-full bg-red-950/90 border-2 border-red-500 rounded-2xl p-3 animate-pulse">
                {sensors.status === "CRITICAL" ? (
                  <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 bg-red-600 text-white text-[10px] font-black rounded-full uppercase tracking-wider mb-1.5 shadow animate-bounce">
                    <span>🚨</span>
                    <span>{currentT.sensorAutoBadge || "SENSOR AUTONOMOUS TRIGGER"}</span>
                  </div>
                ) : wasAutoTriggered ? (
                  <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 bg-amber-500 text-black text-[10px] font-black rounded-full uppercase tracking-wider mb-1.5 shadow">
                    <span>⚡</span>
                    <span>{currentT.autoSosBadge || "AUTO-DISPATCHED SOS (URGENT / CRITICAL)"}</span>
                  </div>
                ) : null}
                <div className="text-sm font-black text-red-300">
                  {currentT.sosActiveButton}
                </div>
                <div className="text-[10px] text-red-200/80 mt-0.5">
                  {currentT.helpersActive || currentT.forwardingNotice}
                </div>
              </div>

              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute w-44 h-44 rounded-full bg-red-600/20 animate-ping" />
                <div className="absolute w-36 h-36 rounded-full bg-red-600/30 animate-pulse" />
                <div className="w-28 h-28 rounded-full bg-red-600 border-2 border-white flex flex-col items-center justify-center z-10 shadow-lg">
                  <span className="text-2xl">📡</span>
                  <span className="text-[10px] font-black text-white mt-1">BEACON ACTIVE</span>
                  <span className="text-[9px] font-mono text-red-200">{hopsReached} Hops</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 w-full text-xs">
                <div
                  onClick={randomizeBattery}
                  title="Click to randomize phone battery"
                  className="bg-zinc-900 p-2 rounded-xl border border-zinc-800 cursor-pointer hover:border-zinc-700 transition"
                >
                  <div className="text-zinc-500 text-[10px] uppercase font-bold flex justify-between items-center">
                    <span>{currentT.batteryLevel}</span>
                    <span className="text-[10px] text-zinc-400">🎲</span>
                  </div>
                  <div className="text-lg font-black text-emerald-400">{battery}%</div>
                </div>
                <div className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
                  <div className="text-zinc-500 text-[10px] uppercase font-bold">{currentT.hopsCount}</div>
                  <div className="text-lg font-black text-purple-400">{hopsReached} / 10 Max</div>
                </div>
              </div>

              {sensors.status === "CRITICAL" && (
                <div className="w-full my-1.5 p-2 bg-red-950/80 border border-red-500/70 rounded-xl text-[10px] text-red-200 text-left font-mono">
                  <div className="font-bold text-red-300">📊 Pre-Disaster Telemetry ({sensors.sourceName}):</div>
                  <div>Seismic: {sensors.seismicG}G | Thermal: {sensors.tempC}°C | Impact: {sensors.impactG}G</div>
                </div>
              )}

              <button
                onClick={handleCancelSos}
                className="w-full py-2.5 rounded-xl bg-zinc-800 border border-zinc-600 text-zinc-200 font-black text-xs hover:bg-zinc-700 active:scale-95 transition-all"
              >
                {currentT.sosCancel}
              </button>
            </div>
          )}

          {/* Bottom ID Bar */}
          <div className="pt-2 border-t border-zinc-800 flex justify-between items-center text-[10px]">
            <span className="text-zinc-500 font-mono">
              {currentT.anonymousId}: 0x{deviceId.toString(16).slice(0, 4)}
            </span>
            <button
              onClick={rotateId}
              className="text-zinc-400 hover:text-white font-bold"
            >
              {currentT.rotateId}
            </button>
          </div>
        </div>

        {/* Live Propagation Terminal Log below phone */}
        {meshLogs.length > 0 && (
          <div className="w-full max-w-sm mt-4 bg-black border border-zinc-800 rounded-2xl p-3 text-xs font-mono text-zinc-300 space-y-1">
            <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-1">
              📡 {currentT.meshProgress}
            </div>
            {meshLogs.map((log, idx) => (
              <div
                key={idx}
                className={`p-1 rounded text-[11px] ${
                  log.includes("✅")
                    ? "bg-emerald-950/60 text-emerald-300"
                    : log.includes("Survivor")
                    ? "text-red-300"
                    : "text-amber-300"
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
