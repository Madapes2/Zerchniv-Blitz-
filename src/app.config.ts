import config from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom.js";

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define("battle_room", GameRoom);
  },

  initializeExpress: (app) => {
    // Allow requests from GitHub Pages and any origin during development
    app.use((req: any, res: any, next: any) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    if (process.env.NODE_ENV !== "production") {
      app.use("/colyseus", monitor());
    }
  },

  beforeListen: () => {},
});