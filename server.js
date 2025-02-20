require('dotenv').config();
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');

// Create Google STT client (replace with your credentials)
const speechClient = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_SERVICE_KEY_PATH,
  // or pass credentials directly as JSON if you prefer
});

const PORT = process.env.PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

console.log(`Starting Google STT Bridge on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected.');

  let recognizeStream = null;

  ws.on('message', (message) => {
    try {
      // Check if JSON config
      const obj = JSON.parse(message);

      if (obj.type === 'config') {
        // Create streamingRecognize request
        const request = {
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            enableAutomaticPunctuation: true,
            languageCode: 'en-US',
            alternativeLanguageCodes: ['hi-IN'], // auto-detect English/Hindi
          },
          interimResults: true,
        };

        recognizeStream = speechClient.streamingRecognize(request)
          .on('error', (err) => {
            console.error('Google STT error:', err);
            ws.close(1011, 'Google STT error');
          })
          .on('data', (data) => {
            if (data.results && data.results.length > 0) {
              const { transcript } = data.results[0].alternatives[0];
              const isFinal = data.results[0].isFinal;

              ws.send(JSON.stringify({
                type: 'transcript',
                transcript,
                isFinal,
              }));
            }
          });

        // Acknowledge config
        ws.send(JSON.stringify({ type: 'ready' }));
        console.log('Recognize stream created.');
      }
    } catch {
      // Not JSON => raw audio data
      if (recognizeStream) {
        recognizeStream.write(message);
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});
