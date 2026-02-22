import { Server } from "colyseus";
import { createServer } from "http";
import { GameRoom } from "./rooms/GameRoom";
import express from "express";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ status: "Zerchniv-Blitz server running", timestamp: new Date().toISOString() });
});

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });

// Register rooms
gameServer.define("game_room", GameRoom).filterBy(["matchId"]);

gameServer.listen(port).then(() => {
  console.log(`✅ Zerchniv-Blitz server listening on port ${port}`);
});
