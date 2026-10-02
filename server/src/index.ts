import "./instrument";
import { createApp } from "./app";
import { getDummyHash } from "./auth/passwords";
import { env } from "./env";
import { startJobs } from "./jobs/schedule";

await getDummyHash();
createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
startJobs();
