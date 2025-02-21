// server.js
require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');
const fetch = require('node-fetch'); // ✅ Add node-fetch for keep-alive requests

// Create an Express app
const app = express();
const server = require('http').createServer(app);

// ✅ Google STT Client (Uses Secret File in Render)
const speechClient = new speech.SpeechClient({
  keyFilename: '/etc/secrets/stt-key.json',
});

// ✅ Set PORT (Default 3001 if not provided)
const PORT = process.env.PORT || 3001;

// ✅ Keep-Alive Route (Prevents Render Free Tier from Sleeping)
app.get('/keep-alive', (req, res) => {
  res.send('✅ Server is awake!');
});

// ✅ Send Keep-Alive Request Every 5 Minutes
setInterval(() => {
  fetch(`https://your-app.onrender.com/keep-alive`).catch(() => {});
}, 300000); // 300000 ms = 5 minutes

// ✅ WebSocket Server Setup
const wss = new WebSocketServer({ server });
console.log(`🚀 Google STT WebSocket server running on port ${PORT}`);

// ✅ Start Express Server
server.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
});

// ✅ WebSocket Handling
wss.on('connection', (ws) => {
  console.log('✅ Client connected.');

  let recognizeStream = null;

  ws.on('message', (message) => {
    try {
      // ✅ Parse JSON if it's a config message
      const obj = JSON.parse(message);

      if (obj.type === 'config') {
        console.log("⚙️ Received STT config:", obj);

        // ✅ Updated Google STT streamingRecognize request
        const request = {
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            enableAutomaticPunctuation: true,
            enableWordTimeOffsets: true, // Helps Google detect multiple languages
            singleUtterance: false, // ✅ Ensures continuous transcription
            languageCode: obj.enableAutoDetection ? 'hi-IN' : (obj.language || 'en-US'), // Set primary language
            alternativeLanguageCodes: obj.enableAutoDetection ? ['en-US'] : [], // Allow English as an alternative
          },
          interimResults: true,
        };

        // ✅ Start streaming to Google STT
        recognizeStream = speechClient.streamingRecognize(request)
          .on('error', (err) => {
            console.error('❌ Google STT error:', err);
            ws.close(1011, 'Google STT error');
          })
          .on('data', (data) => {
            if (data.results && data.results.length > 0) {
              const transcript = data.results[0].alternatives[0].transcript;
              const isFinal = data.results[0].isFinal;

              // ✅ Send transcript to client
              ws.send(JSON.stringify({
                type: 'transcript',
                transcript,
                isFinal,
              }));

              console.log(`📝 Transcript (${isFinal ? "Final" : "Interim"}):`, transcript);
            }
          });

        // ✅ Notify client that STT stream is ready
        ws.send(JSON.stringify({ type: 'ready' }));
        console.log('✅ Google STT stream started with auto-detect languages.');
      }
    } catch {
      // ✅ If it's not JSON, assume it's audio data and send to STT
      if (recognizeStream) {
        recognizeStream.write(message);
      }
    }
  });

  // ✅ WebSocket Client Disconnect Handling
  ws.on('close', () => {
    console.log('⚠️ Client disconnected.');
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});
