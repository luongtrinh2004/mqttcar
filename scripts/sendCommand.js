const mqtt = require("mqtt");
const readline = require("readline");

const client = mqtt.connect({
  host: "116.118.95.187",
  port: 1883,
  username: "ducchien0612",
  password: "123456",
  protocol: "mqtt",
});

const routeTopic = `car/+/route`;
const telemetryBaseTopic = `car`;
const cars = {};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

client.on("connect", () => {
  console.log("[CMD] Connected to MQTT broker");
  client.subscribe(routeTopic, (err) => {
    if (err) console.error("[CMD] Subscribe failed:", err.message);
    else console.log(`[CMD] Subscribed to ${routeTopic}`);
  });
});

client.on("message", (topic, message) => {
  const match = topic.match(/^car\/(.+)\/route$/);
  if (!match) return;

  const CAR_ID = match[1];
  const payload = JSON.parse(message.toString());

  if (!Array.isArray(payload.route)) {
    console.warn(`[${CAR_ID}] Invalid route`);
    return;
  }

  const newRoute = payload.route.map((p) => ({ ...p }));

  const isNewRoute =
    !cars[CAR_ID] ||
    JSON.stringify(newRoute) !== JSON.stringify(cars[CAR_ID].route);

  if (isNewRoute) {
    if (cars[CAR_ID]?.movingInterval)
      clearInterval(cars[CAR_ID].movingInterval);

    cars[CAR_ID] = {
      route: newRoute,
      statusArr: new Array(newRoute.length).fill(0),
      currentPositions: new Array(newRoute.length).fill(null),
      initialPosition: {
        lat: newRoute[0].lat,
        lng: newRoute[0].lng - 0.0004,
      },
      position: {
        lat: newRoute[0].lat,
        lng: newRoute[0].lng - 0.0004,
      },
      movingInterval: null,
    };

    cars[CAR_ID].currentPositions[0] = { ...cars[CAR_ID].position };
    console.log(`[${CAR_ID}] ✅ Route RESET, sẵn sàng chờ '1'`);
    promptNext(CAR_ID);
    return;
  }

  if (Array.isArray(payload.statusArr)) {
    const prev = cars[CAR_ID]?.statusArr || [];
    const allReset = payload.statusArr.every((s) => s === 0);
    const wasNotAllZero = prev.some((s) => s !== 0);

    if (allReset && wasNotAllZero) {
      console.log(
        `[${CAR_ID}] ❌ Cuốc đã bị hủy — reset trạng thái và vị trí ban đầu`
      );
      if (cars[CAR_ID].movingInterval)
        clearInterval(cars[CAR_ID].movingInterval);
      cars[CAR_ID].statusArr = new Array(cars[CAR_ID].route.length).fill(0);
      cars[CAR_ID].position = { ...cars[CAR_ID].initialPosition };
      cars[CAR_ID].currentPositions = new Array(cars[CAR_ID].route.length).fill(
        null
      );
      cars[CAR_ID].currentPositions[0] = { ...cars[CAR_ID].position };
      return;
    }

    cars[CAR_ID].statusArr = payload.statusArr.slice();
    console.log(`[${CAR_ID}] Cập nhật statusArr:`, payload.statusArr);
  }
});

function moveTowards(from, to, step = 5) {
  const latDiff = to.lat - from.lat;
  const lngDiff = to.lng - from.lng;
  const dist = Math.sqrt(latDiff ** 2 + lngDiff ** 2);
  if (dist === 0) return to;
  const stepDeg = step / 111320;
  const ratio = Math.min(stepDeg / dist, 1);

  return {
    lat: from.lat + latDiff * ratio,
    lng: from.lng + lngDiff * ratio,
  };
}

function buildPayload(CAR_ID) {
  const car = cars[CAR_ID];
  const routeWithStatus = car.route.map((p, i) => ({
    ...p,
    status: car.statusArr[i],
    lat: car.currentPositions[i]?.lat ?? p.lat,
    lng: car.currentPositions[i]?.lng ?? p.lng,
  }));

  return {
    id: CAR_ID,
    statusArr: car.statusArr,
    speed: 0,
    position: car.position,
    route: routeWithStatus,
    ts: Date.now(),
  };
}

function publishCommandToRoute(CAR_ID) {
  const car = cars[CAR_ID];
  const topic = `car/${CAR_ID}/route`;
  const payload = {
    route: car.route,
    statusArr: car.statusArr,
  };
  client.publish(topic, JSON.stringify(payload));
  console.log(`[CMD][${CAR_ID}] Đã gửi statusArr →`, payload.statusArr);
}

function publishTelemetry(CAR_ID, silent = false) {
  const topic = `${telemetryBaseTopic}/${CAR_ID}/telemetry`;
  const payload = buildPayload(CAR_ID);
  client.publish(topic, JSON.stringify(payload));
  if (!silent) {
    console.log(`[${CAR_ID}][PUB]`, JSON.stringify(payload, null, 2));
  }
}

function promptNext(CAR_ID) {
  const car = cars[CAR_ID];

  if (car.statusArr.every((s) => s === 2)) {
    console.log(`[${CAR_ID}] ✅ Đã đến tất cả các điểm.`);
    rl.question(`[${CAR_ID}] Nhập "0" để đặt lại hành trình: `, (input) => {
      if (input === "0") {
        car.statusArr = new Array(car.route.length).fill(0);
        car.position = { ...car.initialPosition };
        car.currentPositions = new Array(car.route.length).fill(null);
        car.currentPositions[0] = { ...car.position };
        console.log(`[${CAR_ID}] 🔁 Đã đặt lại trạng thái và vị trí.`);
        publishCommandToRoute(CAR_ID);
      } else {
        console.log(`[${CAR_ID}] ↳ Chỉ được nhập '0'`);
      }
      promptNext(CAR_ID);
    });
    return;
  }

  rl.question(
    `[${CAR_ID}] Nhập "1" (đang đến) hoặc "2" (đã đến): `,
    (input) => {
      if (input === "1") {
        const idx = car.statusArr.findIndex((s) => s === 0);
        if (idx === -1) {
          console.log(`[${CAR_ID}] ↳ Không còn điểm nào có status 0.`);
        } else {
          car.statusArr[idx] = 1;
          publishCommandToRoute(CAR_ID);
          const to = car.route[idx];

          if (car.movingInterval) clearInterval(car.movingInterval);

          car.movingInterval = setInterval(() => {
            const dLat = to.lat - car.position.lat;
            const dLng = to.lng - car.position.lng;
            const dMeter = Math.sqrt(
              (dLat * 111320) ** 2 + (dLng * 111320) ** 2
            );

            if (dMeter <= 1) {
              clearInterval(car.movingInterval);
              car.movingInterval = null;
              car.currentPositions[idx] = { ...to };
              car.position = { ...to };
              publishTelemetry(CAR_ID);
              console.log(`[${CAR_ID}] ↳ Đã đến điểm, bấm '2' để xác nhận.`);
              return;
            }

            const prev = { ...car.position };
            car.position = moveTowards(car.position, to, 5);
            car.currentPositions[idx] = { ...car.position };
            publishTelemetry(CAR_ID);
            console.log(
              `[${CAR_ID}] [MOVE] ${prev.lat} → ${car.position.lat}, ${prev.lng} → ${car.position.lng}`
            );
          }, 1000);
        }
      } else if (input === "2") {
        const idx = car.statusArr.findIndex((s) => s === 1);
        if (idx === -1) {
          console.log(`[${CAR_ID}] ↳ Không có điểm nào đang ở trạng thái 1.`);
        } else {
          car.statusArr[idx] = 2;
          if (car.movingInterval) {
            clearInterval(car.movingInterval);
            car.movingInterval = null;
          }
          car.currentPositions[idx] = { ...car.route[idx] };
          car.position = { ...car.currentPositions[idx] };
          publishCommandToRoute(CAR_ID);
          publishTelemetry(CAR_ID);
          console.log(`[${CAR_ID}] [STATUS] ${JSON.stringify(car.statusArr)}`);
        }
      } else {
        console.log(`[${CAR_ID}] ↳ Chỉ được nhập '1' hoặc '2'`);
      }

      promptNext(CAR_ID);
    }
  );
}

setInterval(() => {
  for (const CAR_ID of Object.keys(cars)) {
    publishTelemetry(CAR_ID, true);
  }
}, 2000);

process.on("SIGINT", () => {
  console.log(
    "\n[CMD] ⛔ Đang dừng chương trình — xử lý reset trước khi thoát..."
  );

  const carIDs = Object.keys(cars);
  for (const CAR_ID of carIDs) {
    const car = cars[CAR_ID];
    const prev = car.statusArr || [];
    const allReset = prev.every((s) => s === 0);
    const wasNotAllZero = prev.some((s) => s !== 0);

    if (wasNotAllZero && !allReset) {
      console.log(`[${CAR_ID}] ❌ Cuốc đã bị hủy do tắt chương trình`);
      if (car.movingInterval) clearInterval(car.movingInterval);

      car.statusArr = new Array(car.route.length).fill(0);
      car.position = { ...car.initialPosition };
      car.currentPositions = new Array(car.route.length).fill(null);
      car.currentPositions[0] = { ...car.position };

      publishCommandToRoute(CAR_ID);
      publishTelemetry(CAR_ID);
    } else {
      console.log(`[${CAR_ID}] ✅ Không cần reset`);
    }
  }

  // ✅ Đợi 1 giây để MQTT publish xong
  setTimeout(() => {
    console.log("[CMD] ✅ Đã xử lý reset. Thoát.");
    process.exit(0);
  }, 1000);
});
