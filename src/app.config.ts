import config from "@colyseus/tools";
import { GameRoom } from "./rooms/GameRoom.js";

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define("game_room", GameRoom);
  },

initializeExpress: (app) => {
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Headers", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    app.get("/", (req, res) => {
      res.json({ status: "Zerchniv-Blitz server running", timestamp: new Date().toISOString() });
    });
  },

  beforeListen: () => {
    // Called before server starts listening
  }
});
