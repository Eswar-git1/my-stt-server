require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');
const fetch = require('node-fetch'); // Add node-fetch for keep-alive requests

// Create an Express app
const app = express();
const server = require('http').createServer(app);

/**
 * Create a Google STT client.
 * We reference the file at the path /etc/secrets/stt-key.json,
 * which is where Render will mount our secret file.
 */
const speechClient = new speech.SpeechClient({
  keyFilename: '/etc/secrets/stt-key.json',
});

// Render provides a PORT environment variable for your service.
// Default to 3001 if not present:
const PORT = process.env.PORT || 3001;

// Create a raw WebSocket server
const wss = new WebSocketServer({ server });

console.log(`Google STT WebSocket server starting on port ${PORT}`);

// Keep-Alive Ping (Prevents Render Free Tier from Sleeping)
app.get('/keep-alive', (req, res) => {
  res.send('Server is awake!');
});

// Start the Express server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Send Keep-Alive Ping Every 5 Minutes
setInterval(() => {
  fetch(`http://localhost:${PORT}/keep-alive`).catch(() => {});
}, 300000); // 300000 ms = 5 minutes

wss.on('connection', (ws) => {
  console.log('Client connected.');

  let recognizeStream = null;

  // When the browser sends a message
  ws.on('message', (message) => {
    try {
      // 1) If message is JSON, parse it
      const obj = JSON.parse(message);

      if (obj.type === 'config') {
        // 2) Create Google STT streamingRecognize request
        const request = {
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            enableAutomaticPunctuation: true,
            languageCode: obj.language || 'en-US', // Use provided language or default to 'en-US'
            alternativeLanguageCodes: obj.enableAutoDetection ? ['hi-IN', 'en-US'] : [], // Enable auto-detection if mixed
          },
          interimResults: true,
        };

        // 3) Start streaming to Google STT
        recognizeStream = speechClient.streamingRecognize(request)
          .on('error', (err) => {
            console.error('Google STT error:', err);
            // Close the WebSocket with an error code
            ws.close(1011, 'Google STT error');
          })
          .on('data', (data) => {
            // 4) For each partial/final transcript
            if (data.results && data.results.length > 0) {
              const { transcript } = data.results[0].alternatives[0];
              const isFinal = data.results[0].isFinal;

              // Send to the browser
              ws.send(JSON.stringify({
                type: 'transcript',
                transcript,
                isFinal,
              }));
            }
          });

        // 5) Notify browser that STT stream is ready
        ws.send(JSON.stringify({ type: 'ready' }));
        console.log('Recognize stream created.');
      }
    } catch {
      // If it wasn't valid JSON, assume it's binary audio data
      if (recognizeStream) {
        recognizeStream.write(message);
      }
    }
  });

  // On client disconnect
  ws.on('close', () => {
    console.log('Client disconnected.');
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});