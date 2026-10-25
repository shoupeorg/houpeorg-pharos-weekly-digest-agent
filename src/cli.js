import { completedPeriods } from "./engine.js";

const [command = "help", ...args] = process.argv.slice(2);
if (command === "periods") {
  const cadence = args[0] || "weekly";
  console.log(JSON.stringify(completedPeriods(new Date(), cadence), null, 2));
} else {
  console.log("Usage: npm run cli -- periods [weekly|daily]");
  console.log("The CLI computes deterministic completed UTC periods; live generation is performed by the deployed API.");
}
