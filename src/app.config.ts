import config from "@colyseus/tools";
import { GameRoom } from "./rooms/GameRoom.js";

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define("game_room", GameRoom);
  },

  initializeExpress: (app) => {
    app.get("/", (req, res) => {
      res.json({ status: "Zerchniv-Blitz server running", timestamp: new Date().toISOString() });
    });
  },

  beforeListen: () => {
    // Called before server starts listening
  }
});
