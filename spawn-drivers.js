require("dotenv").config();
const { fork } = require("child_process");
const path = require("path");
const drivers = require("./drivers.json");

drivers.forEach((d) => {
  if (!d.id || !d.lat || !d.lng) {
    console.warn(`[SPAWN] ❌ Bỏ qua xe không hợp lệ:`, d);
    return;
  }

  console.log(`[SPAWN] 🚗 Forking simulator for DRIVER_ID=${d.id}`);
  fork(path.resolve(__dirname, "simulator.js"), [], {
    env: {
      ...process.env,
      DRIVER_ID: d.id,
    },
    stdio: "inherit", // inherit để log simulator hiển thị luôn
  });
});
