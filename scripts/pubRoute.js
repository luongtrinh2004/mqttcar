const mqtt = require("mqtt");

const client = mqtt.connect({
  host: "116.118.95.187",
  port: 1883,
  username: "ducchien0612",
  password: "123456",
  protocol: "mqtt",
});

const CAR_ID = "29F-67890";

const topic = `car/${CAR_ID}/route`;

const payload = {
  route: [
    {
      id: "68099c456161aea702b10688",
      title: "Nhà Đa Năng",

      lat: 20.961419,
      lng: 105.748132,
    },
    {
      id: "68099c586161aea702b10689",
      title: "Sân bóng",

      lat: 20.960986,
      lng: 105.748747,
    },
    {
      id: "68099c686161aea702b1068a",
      title: "Cổng Phụuuuuu",

      lat: 20.95948,
      lng: 105.747948,
    },
    {
      id: "68099c686161aea702b1068b",
      title: "PhenikaaX",

      lat: 20.959863,
      lng: 105.746686,
    },
  ],
  statusArr: [0, 0, 0, 0], // trạng thái ban đầu
};

client.on("connect", () => {
  console.log(`[TEST] Connected. Gửi route cho xe ${CAR_ID}...`);
  client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
    if (err) console.error("❌ Gửi thất bại:", err.message);
    else console.log("✅ Route đã được gửi lên", topic);
    client.end();
  });
});
