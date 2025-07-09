const mqtt = require("mqtt");
const fs = require("fs");

const CAR_ID = process.env.DRIVER_ID || "UNKNOWN";

// Load default position from drivers.json
const drivers = JSON.parse(fs.readFileSync("./drivers.json", "utf8"));
const driver = drivers.find((d) => d.id === CAR_ID);
if (!driver) {
  console.error(`[SIMULATOR][${CAR_ID}] ❌ Không tìm thấy trong drivers.json`);
  process.exit(1);
}
const defaultPosition = { lat: driver.lat, lng: driver.lng };

const client = mqtt.connect({
  host: "116.118.95.187",
  port: 1883,
  username: "ducchien0612",
  password: "123456",
  protocol: "mqtt",
});

const routeTopic = `car/${CAR_ID}/route`;

let route = [];
let statusArr = [];
let position = { ...defaultPosition };
let isMoving = false;
let currentInterval = null;

/**
 * Publish telemetry including:
 * - top-level lat, lng (current position)
 * - speed, statusArr, route, timestamp, online
 */
function publishTelemetry() {
  const telemetryTopic = `car/${CAR_ID}/telemetry`;
  const now = Date.now();
  const hasRoute = Array.isArray(route) && route.length > 0;

  const payload = {
    id: CAR_ID,
    title: driver.title || "",
    speed: isMoving ? 10 : 0,
    position,
    statusArr,
    route: hasRoute
      ? route.map((p, i) => ({
          id: p.id,
          title: p.title,
          lat: p.lat,
          lng: p.lng,
          status: statusArr[i] ?? 0,
        }))
      : [],
    ts: now,
    online: true,
  };

  client.publish(telemetryTopic, JSON.stringify(payload));
  console.log(
    `[SIMULATOR][${CAR_ID}] 📡 Sent telemetry: position=(${position.lat.toFixed(
      6
    )},${position.lng.toFixed(6)}), statusArr=[${statusArr.join(",")}]`
  );
}

client.on("connect", () => {
  console.log(`[SIMULATOR][${CAR_ID}] Connected to MQTT`);

  client.subscribe(routeTopic, (err) => {
    if (err) {
      console.error(`[SIMULATOR][${CAR_ID}] ❌ Subscribe error`, err.message);
    } else {
      console.log(`[SIMULATOR][${CAR_ID}] Subscribed to ${routeTopic}`);
    }
  });

  // Gửi một telemetry khởi tạo sau 1s
  setTimeout(publishTelemetry, 1000);
});

// Cũng publish telemetry định kỳ phòng khi đứng yên
setInterval(publishTelemetry, 5000);

client.on("message", (topic, message) => {
  if (topic !== routeTopic) return;

  try {
    const payload = JSON.parse(message.toString());

    // Nhận route mới
    if (Array.isArray(payload.route)) {
      const newRoute = payload.route.map((p) => ({
        id: p.id,
        title: p.title,
        lat: p.lat,
        lng: p.lng,
      }));
      const isSame = JSON.stringify(newRoute) === JSON.stringify(route);

      if (!isSame) {
        route = newRoute;
        position = { ...defaultPosition };
        statusArr = new Array(newRoute.length).fill(0);
        isMoving = false;
        if (currentInterval) clearInterval(currentInterval);
        console.log(`[SIMULATOR][${CAR_ID}] ✅ Đã nhận route mới`, route);
        publishTelemetry();
      } else {
        console.log(`[SIMULATOR][${CAR_ID}] 🔁 Route giống cũ`);
      }
    }

    // Nhận statusArr mới
    if (Array.isArray(payload.statusArr)) {
      const newStatus = payload.statusArr;
      const movingIdx = newStatus.findIndex((s) => s === 1);
      const wasMoving = statusArr.includes(1);

      statusArr = newStatus.slice();

      if (movingIdx !== -1 && !wasMoving) {
        // Bắt đầu di chuyển tới điểm movingIdx
        isMoving = true;
        simulateMove(movingIdx);
      } else if (movingIdx === -1) {
        // Dừng di chuyển nếu không còn 1 trong statusArr
        isMoving = false;
        if (currentInterval) {
          clearInterval(currentInterval);
          currentInterval = null;
        }
      }

      console.log(`[SIMULATOR][${CAR_ID}] ⚙ statusArr cập nhật:`, statusArr);
    }
  } catch (e) {
    console.error(`[SIMULATOR][${CAR_ID}] ❌ JSON lỗi:`, e.message);
  }
});

/**
 * Tính bước di chuyển từ `from` tới `to` khoảng `stepMeter` mét.
 */
function moveTowards(from, to, stepMeter = 10) {
  const latDiff = to.lat - from.lat;
  const lngDiff = to.lng - from.lng;
  // Đổi độ sang mét: 1° ≈ 111.32 km
  const dist = Math.sqrt((latDiff * 111320) ** 2 + (lngDiff * 111320) ** 2);
  if (dist === 0) return to;

  const ratio = Math.min(stepMeter / dist, 1);
  return {
    lat: from.lat + latDiff * ratio,
    lng: from.lng + lngDiff * ratio,
  };
}

/**
 * Bắt đầu simulate di chuyển tới route[idx], publish mỗi 1s tọa độ mới.
 */
function simulateMove(idx) {
  const target = route[idx];
  if (!target) return;

  // Nếu đang có interval cũ thì clear
  if (currentInterval) {
    clearInterval(currentInterval);
    currentInterval = null;
  }

  currentInterval = setInterval(() => {
    // Khoảng cách hiện tại tới đích (m)
    const dLat = target.lat - position.lat;
    const dLng = target.lng - position.lng;
    const distMeters = Math.sqrt((dLat * 111320) ** 2 + (dLng * 111320) ** 2);

    if (distMeters <= 1) {
      // Đã tới nơi
      clearInterval(currentInterval);
      currentInterval = null;
      position = { ...target };
      isMoving = false;
      statusArr[idx] = 2; // Đánh dấu đã đến
      console.log(`[SIMULATOR][${CAR_ID}] 🛬 Đã đến điểm #${idx + 1}`);
      publishTelemetry();
      return;
    }

    // Chưa tới, di chuyển bước tiếp
    position = moveTowards(position, target, 10);
    statusArr[idx] = 1; // Đang di chuyển
    console.log(
      `[SIMULATOR][${CAR_ID}] 🚗 Di chuyển... lat=${position.lat.toFixed(
        6
      )}, lng=${position.lng.toFixed(6)}`
    );
    publishTelemetry();
  }, 1000);
}
