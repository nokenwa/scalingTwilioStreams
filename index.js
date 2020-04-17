require("dotenv").config();
const _ = require("lodash");
const WebSocket = require("ws");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });
const path = require("path");

const bodyParser = require("body-parser");

//Include Google Speech to Text
const speech = require("@google-cloud/speech");
const speechClient = new speech.SpeechClient();

//Configure Transcription Request
const transcriptionConfig = {
  config: {
    encoding: "MULAW",
    sampleRateHertz: 8000,
    languageCode: "en-GB",
  },
  interimResults: true, // If you want interim results, set this to true
};

let activeCalls = [];

wss.on("connection", function connection(ws) {
  console.log("New Connection Initiated");
  let recognizeStream;
  ws.on("message", function incoming(message) {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log(`A new call has connected.`);
        break;
      case "start":
        console.log(`Starting Media Stream ${msg.streamSid}`);
        ws.streamSid = msg.streamSid;
        // Create Stream to the Google Speech to Text API
        recognizeStream = speechClient
          .streamingRecognize(transcriptionConfig)
          .on("error", console.error)
          .on("data", (data) => {
            wss.clients.forEach((client) => {
              if (
                client.readyState === WebSocket.OPEN &&
                client.subscribedStream === msg.streamSid
              ) {
                client.send(
                  JSON.stringify({
                    stream: msg.streamSid,
                    event: "interim-transcription",
                    text: data.results[0].alternatives[0].transcript,
                  })
                );
              }
            });
          });
        activeCalls.push({
          twilioStreamSid: msg.streamSid,
          fromNumber: msg.start.customParameters.number,
        });
        wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              event: "updateCalls",
              activeCalls,
            })
          );
        });
        console.log(`There are ${activeCalls.length} active calls`);
        break;
      case "media":
        // Write Media Packets to the recognize stream
        recognizeStream.write(msg.media.payload);
        break;
      case "stop":
        console.log(`Call Has Ended`);
        console.log(ws.streamSid);
        const i = activeCalls.findIndex(
          (stream) => stream.streamSid === ws.streamSid
        );
        activeCalls.splice(i, 1);
        wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              event: "updateCalls",
              activeCalls: activeCalls,
            })
          );
        });
        recognizeStream.destroy();
        break;
      case "subscribe":
        console.log("Client Subscribed");
        ws.subscribedStream = msg.streamSid;
        break;
      default:
        break;
    }
  });
});

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: false }));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "/index.html")));

app.post("/", (req, res) => {
  res.set("Content-Type", "text/xml");
  console.log(req.body.From);
  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/">
          <Parameter name="number" value="${req.body.From}"/>
        </Stream>
      </Start>
      <Say>I will stream the next 60 seconds of audio through your websocket</Say>
      <Pause length="60" />
    </Response>
  `);
});

console.log("Listening on Port 8080");
server.listen(8080);
