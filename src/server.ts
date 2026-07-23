import "dotenv/config";
import express from "express";
import { syncRouter } from "./routes/syncRoutes";
import { metricsRouter } from "./routes/metricsRoutes";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    endpoints: [
      "POST /sync/run",
      "GET /sync/runs",
      "GET /sync/records?entityType=contact|payment|event",
      "POST /webhooks/:sourceSystem",
      "GET /metrics/revenue/summary?start=&end=",
      "GET /metrics/revenue/breakdown?start=&end=&granularity=day|week",
      "GET /metrics/revenue/consistency-check?start=&end=",
    ],
  });
});

app.use(syncRouter);
app.use(metricsRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
