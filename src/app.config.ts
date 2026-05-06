import config from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { GameRoom } from "./rooms/GameRoom.js";

export default config({
  initializeGameServer: (gameServer) => {
    // Register "battle_room" — this is what the client calls joinOrCreate("battle_room")
    gameServer.define("battle_room", GameRoom);
  },

  initializeExpress: (app) => {
    // Optional: Colyseus monitor dashboard at /colyseus
    if (process.env.NODE_ENV !== "production") {
      app.use("/colyseus", monitor());
      app.use("/playground", playground());
    }
  },

  beforeListen: () => {
    // Any setup before the server starts listening
  }
});